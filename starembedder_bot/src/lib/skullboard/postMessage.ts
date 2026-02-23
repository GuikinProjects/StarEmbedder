/**
 * Shared skullboard pipeline.
 *
 * Contains all render-payload types, helper utilities, and the single
 * `executeSkullboardPost` function used by both the reaction listener and the
 * `/skullboard force-post` command.
 */

import { container } from '@sapphire/pieces';
import { envParseString } from '@skyra/env-utilities';
import { type Attachment, type Guild, type Message, StickerFormatType } from 'discord.js';
import { skulledMessages } from '../db/schema';

// ─── Render payload types (shared shape with starembedder_web) ────────────────

export interface RenderAttachment {
	url: string;
	name: string;
	contentType: string;
	width?: number;
	height?: number;
	size?: number;
}

export interface RenderEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface RenderEmbed {
	title?: string;
	description?: string;
	color?: number;
	url?: string;
	author?: { name: string; url?: string; iconURL?: string };
	thumbnail?: string;
	image?: string;
	video?: string;
	footer?: { text: string; iconURL?: string };
	timestamp?: string;
	fields?: RenderEmbedField[];
	provider?: string;
}

export interface RenderReaction {
	name: string;
	emojiUrl?: string;
	count: number;
	isCustom: boolean;
}

export interface RenderReply {
	authorName: string;
	avatarUrl: string;
	roleColor?: string;
	content: string;
	attachment: boolean;
	edited: boolean;
}

export interface RenderAuthorInfo {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string;
	bot: boolean;
	roleColor?: string;
	roleIconUrl?: string;
	roleName?: string;
	clanIconUrl?: string;
	clanTag?: string;
}

export interface RenderSticker {
	id: string;
	name: string;
	url: string;
}

export interface RenderPayload {
	message: {
		id: string;
		author: RenderAuthorInfo;
		content: string;
		attachments: RenderAttachment[];
		embeds: RenderEmbed[];
		reactions: RenderReaction[];
		reply?: RenderReply;
		stickers?: RenderSticker[];
		createdAt: string;
		editedAt?: string;
	};
	guild: { name: string };
	channel: { name: string };
	skullboard: {
		reactionCount: number;
		reactionEmoji: string;
		messageUrl: string;
	};
	resolved: {
		users: Record<string, string>;
		roles: Record<string, { name: string; color: string }>;
		channels: Record<string, string>;
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const AUTO_EMBED_TYPES = new Set(['image', 'gifv', 'video']);

/** Extract all snowflake IDs mentioned in a Discord message content string. */
export function extractMentionIds(content: string) {
	const userIds = [...content.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
	const roleIds = [...content.matchAll(/<@&(\d+)>/g)].map((m) => m[1]);
	const channelIds = [...content.matchAll(/<#(\d+)>/g)].map((m) => m[1]);
	return {
		userIds: [...new Set(userIds)],
		roleIds: [...new Set(roleIds)],
		channelIds: [...new Set(channelIds)]
	};
}

/**
 * Fetch a Tenor page and extract the direct media1.tenor.com GIF URL.
 * Returns null if the page can't be fetched or no gif is found.
 */
export async function resolveTenorGif(tenorPageUrl: string): Promise<string | null> {
	try {
		const res = await fetch(tenorPageUrl, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarEmbedder/1.0)' }
		});
		const html = await res.text();
		const match = html.match(/https?:\/\/media1\.tenor\.com\/m[^"'\s]+\.gif/);
		return match ? match[0] : null;
	} catch {
		return null;
	}
}

export function attachmentToRender(att: Attachment): RenderAttachment {
	return {
		url: att.url,
		name: att.name,
		contentType: att.contentType ?? 'application/octet-stream',
		width: att.width ?? undefined,
		height: att.height ?? undefined,
		size: att.size
	};
}

/** Returns true for Discord CDN URLs that carry expiry params (ex=...). */
function isExpirableDiscordUrl(url: string): boolean {
	return /^https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\//.test(url) && url.includes('ex=');
}

/**
 * Refresh one or more Discord CDN URLs via POST /attachments/refresh-urls.
 * Returns a map of original → refreshed. Any URL that can't be refreshed keeps its original value.
 */
async function refreshDiscordUrls(urls: string[]): Promise<Map<string, string>> {
	const map = new Map<string, string>(urls.map((u) => [u, u]));
	const toRefresh = urls.filter(isExpirableDiscordUrl);
	if (toRefresh.length === 0) return map;

	try {
		const response = (await container.client.rest.post('/attachments/refresh-urls', {
			body: { attachment_urls: toRefresh }
		})) as { refreshed_urls: { original: string; refreshed: string }[] };

		for (const { original, refreshed } of response.refreshed_urls) {
			map.set(original, refreshed);
		}
	} catch (err) {
		container.logger.warn('[refreshDiscordUrls] Failed to refresh URLs:', err);
	}

	return map;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface SkullboardPostOptions {
	/** Fully-fetched source message. */
	message: Message;
	/** Cached guild the message belongs to. */
	guild: Guild;
	/** Skullboard channel snowflake from the guild config. */
	skullboardChannelId: string;
	/** Configured skull emoji for this guild. */
	skullEmoji: string;
	/** Reaction count to display on the embed. */
	reactionCount: number;
	/** When true, skip reading from and writing to the skulled_messages DB table. */
	skipDb?: boolean;
}

/**
 * Run the full skullboard pipeline for a message:
 * build the render payload, request a PNG from the web server, post to the
 * skullboard channel, and persist the record to the database.
 *
 * @returns The snowflake of the message posted to the skullboard channel.
 */
export async function executeSkullboardPost(options: SkullboardPostOptions): Promise<string> {
	const { message, guild, skullboardChannelId, skullEmoji, reactionCount, skipDb = false } = options;
	const { db, logger } = container;

	// Fetch skullboard channel
	const skullboardChannel =
		guild.channels.cache.get(skullboardChannelId) ?? (await guild.channels.fetch(skullboardChannelId).catch(() => null));
	if (!skullboardChannel || !skullboardChannel.isTextBased() || !('send' in skullboardChannel)) {
		throw new Error(`Skullboard channel ${skullboardChannelId} is inaccessible.`);
	}

	// ── Resolve mentions ──────────────────────────────────────────────────────
	const content = message.content ?? '';
	const embedText = message.embeds.map((e) => [e.description ?? '', ...e.fields.map((f) => f.value)].join(' ')).join(' ');
	const { userIds, roleIds, channelIds } = extractMentionIds(`${content} ${embedText}`);

	const resolvedUsers: Record<string, string> = {};
	const resolvedRoles: Record<string, { name: string; color: string }> = {};
	const resolvedChannels: Record<string, string> = {};

	if (userIds.length > 0) {
		try {
			const members = await guild.members.fetch({ user: userIds });
			for (const [id, member] of members) {
				resolvedUsers[id] = member.displayName;
			}
		} catch {
			// Partial resolution is fine
		}
	}

	for (const roleId of roleIds) {
		const role = guild.roles.cache.get(roleId);
		if (role) resolvedRoles[roleId] = { name: role.name, color: role.hexColor };
	}

	for (const channelId of channelIds) {
		const ch = guild.channels.cache.get(channelId);
		if (ch && 'name' in ch && ch.name) resolvedChannels[channelId] = ch.name;
	}

	// ── Resolve channel name for metadata ─────────────────────────────────────
	const sourceChannel = guild.channels.cache.get(message.channelId);
	const channelName = sourceChannel && 'name' in sourceChannel && sourceChannel.name ? sourceChannel.name : 'unknown';

	// ── Author info ───────────────────────────────────────────────────────────
	const author = message.author!;
	const member = message.member ?? (await guild.members.fetch(author.id).catch(() => null));
	const roleColor = member?.displayHexColor !== '#000000' ? member?.displayHexColor : undefined;
	const iconRole = member?.roles.cache
		.filter((r) => r.icon != null)
		.sort((a, b) => b.position - a.position)
		.first();
	const roleIconUrl = iconRole?.iconURL({ size: 128, extension: 'png' }) ?? undefined;
	const roleName = iconRole?.name ?? undefined;

	const pg = author.primaryGuild;
	const clanTag = pg?.identityEnabled && pg.tag ? pg.tag : undefined;
	const clanIconUrl = pg?.identityEnabled && pg.badge ? (author.guildTagBadgeURL({ size: 32, extension: 'png' }) ?? undefined) : undefined;

	// ── Map reactions ─────────────────────────────────────────────────────────
	const reactions: RenderReaction[] = message.reactions.cache.map((r) => ({
		name: r.emoji.name ?? '?',
		emojiUrl: r.emoji.id ? `https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? 'gif' : 'webp'}?size=64` : undefined,
		count: r.count,
		isCustom: !!r.emoji.id
	}));

	// ── Resolve reply ─────────────────────────────────────────────────────────
	let replyPayload: RenderReply | undefined;
	const refId = message.reference?.messageId;
	if (refId) {
		try {
			const refMsg = await message.channel.messages.fetch(refId);
			const refMember = refMsg.member ?? (await guild.members.fetch(refMsg.author.id).catch(() => null));
			const refRoleColor = refMember?.displayHexColor !== '#000000' ? refMember?.displayHexColor : undefined;
			replyPayload = {
				authorName: refMember?.displayName ?? refMsg.author.displayName,
				avatarUrl: refMember?.displayAvatarURL({ size: 64 }) ?? refMsg.author.displayAvatarURL({ size: 64 }),
				roleColor: refRoleColor,
				content: refMsg.content ?? '',
				attachment: refMsg.attachments.size > 0 || refMsg.embeds.some((e) => AUTO_EMBED_TYPES.has((e.data as { type?: string }).type ?? '')),
				edited: refMsg.editedAt != null
			};
		} catch {
			// Referenced message deleted or inaccessible — omit reply
		}
	}

	// ── Process embeds ────────────────────────────────────────────────────────
	// Split Discord auto-embeds (type=image/gifv/video) from rich embeds.
	const autoEmbedAttachments: RenderAttachment[] = [];
	const richEmbeds: typeof message.embeds = [];
	const autoEmbedCanonicalUrls = new Set<string>();

	for (const e of message.embeds) {
		const type = (e.data as { type?: string }).type ?? 'rich';
		if (AUTO_EMBED_TYPES.has(type)) {
			if (e.url) autoEmbedCanonicalUrls.add(e.url.split('?')[0]);

			let url: string | null | undefined;
			let contentType: string;
			let width: number | undefined;
			let height: number | undefined;

			if (type === 'gifv') {
				const tenorGif = e.url ? await resolveTenorGif(e.url) : null;
				url = tenorGif ?? e.thumbnail?.url ?? e.url;
				contentType = 'image/gif';
				width = e.video?.width ?? e.thumbnail?.width ?? undefined;
				height = e.video?.height ?? e.thumbnail?.height ?? undefined;
			} else if (type === 'video') {
				url = e.video?.url;
				contentType = 'video/mp4';
				width = e.video?.width ?? undefined;
				height = e.video?.height ?? undefined;
			} else {
				const rawData = e.data as { image?: { url?: string; proxy_url?: string; width?: number; height?: number }; url?: string };
				url = e.image?.proxyURL ?? rawData.image?.proxy_url ?? e.image?.url ?? rawData.image?.url ?? e.url;
				const rawUrl = url ?? '';
				contentType = /\.gif/i.test(rawUrl) ? 'image/gif' : 'image/webp';
				width = rawData.image?.width ?? e.image?.width ?? undefined;
				height = rawData.image?.height ?? e.image?.height ?? undefined;
			}

			if (url) {
				autoEmbedAttachments.push({
					url,
					name: url.split('/').pop()?.split('?')[0] ?? 'media',
					contentType,
					width,
					height
				});
			}
		} else {
			richEmbeds.push(e);
		}
	}

	// ── Refresh expired Discord CDN URLs in a single batch ──────────────────────
	const regularAttachments = [...message.attachments.values()].map(attachmentToRender);

	const urlsToRefresh = [
		...autoEmbedAttachments.map((a) => a.url),
		...regularAttachments.map((a) => a.url)
	];
	const refreshedUrlMap = await refreshDiscordUrls(urlsToRefresh);

	for (const att of autoEmbedAttachments) att.url = refreshedUrlMap.get(att.url) ?? att.url;
	for (const att of regularAttachments) att.url = refreshedUrlMap.get(att.url) ?? att.url;

	// Strip bare URL-only content when it caused an auto-embed (Discord hides it).
	const trimmedContent = content.trim();
	const strippedContent =
		autoEmbedCanonicalUrls.size > 0 && /^https?:\/\/\S+$/.test(trimmedContent) && autoEmbedCanonicalUrls.has(trimmedContent.split('?')[0])
			? ''
			: content;

	const payload: RenderPayload = {
		message: {
			id: message.id,
			author: {
				id: author.id,
				username: author.username,
				displayName: member?.displayName ?? author.displayName,
				avatarUrl: member?.displayAvatarURL({ size: 128 }) ?? author.displayAvatarURL({ size: 128 }),
				bot: author.bot,
				roleColor,
				roleIconUrl,
				roleName,
				clanIconUrl,
				clanTag
			},
			content: strippedContent,
			attachments: [...regularAttachments, ...autoEmbedAttachments],
			embeds: richEmbeds.map((e) => ({
				title: e.title ?? undefined,
				description: e.description ?? undefined,
				color: e.color ?? undefined,
				url: e.url ?? undefined,
				author: e.author
					? { name: e.author.name, url: e.author.url ?? undefined, iconURL: e.author.iconURL ?? undefined }
					: undefined,
				thumbnail: e.thumbnail?.url ?? undefined,
				image: e.image?.url ?? undefined,
				video: e.video?.url ?? undefined,
				footer: e.footer ? { text: e.footer.text, iconURL: e.footer.iconURL ?? undefined } : undefined,
				timestamp: e.timestamp ?? undefined,
				fields: e.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
				provider: e.provider?.name ?? undefined
			})),
			reactions,
			reply: replyPayload,
			stickers: [...message.stickers.values()]
				.filter((s) => s.format !== StickerFormatType.Lottie)
				.map((s) => ({
					id: s.id,
					name: s.name,
					url: `https://cdn.discordapp.com/stickers/${s.id}.${s.format === StickerFormatType.GIF ? 'gif' : 'png'}`
				})),
			createdAt: message.createdAt.toISOString(),
			editedAt: message.editedAt?.toISOString()
		},
		guild: { name: guild.name },
		channel: { name: channelName },
		skullboard: {
			reactionCount,
			reactionEmoji: skullEmoji,
			messageUrl: message.url
		},
		resolved: { users: resolvedUsers, roles: resolvedRoles, channels: resolvedChannels }
	};

	// ── Request render from web server ────────────────────────────────────────
	const webServerUrl = envParseString('WEB_SERVER_URL');
	let pngBuffer: Buffer | null = null;

	try {
		const res = await fetch(`${webServerUrl}/api/render`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (res.ok) {
			pngBuffer = Buffer.from(await res.arrayBuffer());
		} else {
			logger.warn(`Skullboard render failed: HTTP ${res.status}`);
		}
	} catch (err) {
		logger.warn('Skullboard render request failed:', err);
	}

	// ── Post to skullboard channel ────────────────────────────────────────────
	const skullboardMessage = await skullboardChannel.send({
		...(pngBuffer ? { files: [{ attachment: pngBuffer, name: 'skullboard.png' }] } : {}),
		embeds: [
			{
				author: {
					name: member?.displayName ?? author.displayName,
					icon_url: member?.displayAvatarURL({ size: 64 }) ?? author.displayAvatarURL({ size: 64 })
				},
				color: 0xffd700,
				...(pngBuffer ? { image: { url: 'attachment://skullboard.png' } } : {}),
				fields: [
					{ name: 'Author', value: `<@${author.id}> (${member?.displayName ?? author.displayName})`, inline: true },
					{ name: 'Channel', value: `<#${message.channelId}>`, inline: true },
					{ name: 'Jump to Message', value: `[Click here](${message.url})`, inline: true }
				],
				timestamp: message.createdAt.toISOString()
			}
		]
	});

	// ── Persist to DB ─────────────────────────────────────────────────────────
	if (!skipDb) {
		const dbResult = await db
			.insert(skulledMessages)
			.values({
				guildId: guild.id,
				originalMessageId: message.id,
				originalChannelId: message.channelId,
				skullboardMessageId: skullboardMessage.id,
				reactionCount,
				createdAt: new Date()
			})
			.onConflictDoNothing()
			.run();

		logger.info(
			`Skullboard: Posted message ${message.id} to #${channelName} in guild ${guild.id}. DB entry ID: ${dbResult.lastInsertRowid}`
		);
	} else {
		logger.info(`Skullboard: Posted message ${message.id} to #${channelName} in guild ${guild.id} (force-post, DB skipped).`);
	}

	return skullboardMessage.id;
}
