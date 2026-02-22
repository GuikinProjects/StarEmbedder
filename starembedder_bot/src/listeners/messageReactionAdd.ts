import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import {
	Attachment,
	Events,
	MessageReaction,
	PartialMessageReaction,
	PartialUser,
	StickerFormatType,
	User
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { blacklistedEntries, guildConfigs, skulledMessages } from '../lib/db/schema';

// ─── Inline payload types (shared shape with starembedder_web) ───────────────

interface RenderAttachment {
	url: string;
	name: string;
	contentType: string;
	width?: number;
	height?: number;
	size?: number;
}

interface RenderEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

interface RenderEmbed {
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

interface RenderReaction {
	name: string;
	emojiUrl?: string;
	count: number;
	isCustom: boolean;
}

interface RenderReply {
	authorName: string;
	avatarUrl: string;
	roleColor?: string;
	content: string;
	attachment: boolean;
	edited: boolean;
}

interface RenderAuthorInfo {
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

interface RenderSticker {
	id: string;
	name: string;
	url: string;
}

interface RenderPayload {
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

// ─────────────────────────────────────────────────────────────────────────────

/** Extract all snowflake IDs from a Discord message content string. */
function extractMentionIds(content: string) {
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
 * Fetches a Tenor page and extracts the direct media1.tenor.com GIF URL.
 * Falls back to null if the page can't be fetched or no gif is found.
 */
async function resolveTenorGif(tenorPageUrl: string): Promise<string | null> {
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

const AUTO_EMBED_TYPES = new Set(['image', 'gifv', 'video']);

function attachmentToRender(att: Attachment): RenderAttachment {
	return {
		url: att.url,
		name: att.name,
		contentType: att.contentType ?? 'application/octet-stream',
		width: att.width ?? undefined,
		height: att.height ?? undefined,
		size: att.size
	};
}

@ApplyOptions<Listener.Options>({ name: Events.MessageReactionAdd })
export class MessageReactionAddListener extends Listener {
	/** In-memory lock: prevents duplicate posts from concurrent reactions on the same message. */
	private readonly processing = new Set<string>();

	public override async run(
		reaction: MessageReaction | PartialMessageReaction,
		user: User | PartialUser
	) {
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				this.container.logger.error('Something went wrong when fetching the reaction:', error);
				return;
			}
		}

		if (user.partial) {
			try {
				await user.fetch();
			} catch (error) {
				this.container.logger.error('Something went wrong when fetching the user:', error);
				return;
			}
		}

		const { db } = this.container;
		const guildId = reaction.message.guildId;

		if (!guildId) return;

		const config = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).get();
		const rawBlacklist = db
			.select()
			.from(blacklistedEntries)
			.where(eq(blacklistedEntries.guildId, guildId))
			.all();

		if (!config || !config.skullboardChannelId) return;

		const blacklistedIds = new Set(rawBlacklist.map((e) => e.entryId));
		const msgChannel = reaction.message.channel;
		const categoryId = 'parentId' in msgChannel ? msgChannel.parentId : null;
		const isBlacklisted =
			blacklistedIds.has(reaction.message.channelId) ||
			(categoryId != null && blacklistedIds.has(categoryId));
		if (isBlacklisted) return;

		const existingSkull = db
			.select()
			.from(skulledMessages)
			.where(eq(skulledMessages.originalMessageId, reaction.message.id))
			.get();

		if (existingSkull) {
			this.container.logger.info(
				`Skullboard: Message ${reaction.message.id} already posted as ${existingSkull.skullboardMessageId}, skipping.`
			);
			return;
		}

		if (reaction.emoji.name !== config.skullEmoji) return;
		if ((reaction.count ?? 0) < config.skullThreshold) {
			this.container.logger.info(
				`Skullboard: Message ${reaction.message.id} has ${reaction.count} reactions, below threshold of ${config.skullThreshold}, skipping.`
			);
			return;
		}

		// Lock against concurrent reactions on the same message
		const lockKey = `${guildId}:${reaction.message.id}`;
		if (this.processing.has(lockKey)) {
			this.container.logger.info(`Skullboard: Message ${reaction.message.id} already processing, skipping.`);
			return;
		}
		this.processing.add(lockKey);

		try {
		const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
		const guild = message.guild!;

		// Fetch skullboard channel
		const skullboardChannel =
			guild.channels.cache.get(config.skullboardChannelId) ??
			(await guild.channels.fetch(config.skullboardChannelId).catch(() => null));
		if (!skullboardChannel || !skullboardChannel.isTextBased() || !('send' in skullboardChannel)) return;

		// ── Resolve mentions ──────────────────────────────────────────────────
		const content = message.content ?? '';

		// Collect all text that may contain mentions: message content + embed descriptions/fields
		const embedText = message.embeds
			.map((e) => [e.description ?? '', ...e.fields.map((f) => f.value)].join(' '))
			.join(' ');
		const { userIds, roleIds, channelIds } = extractMentionIds(`${content} ${embedText}`);

		const resolvedUsers: Record<string, string> = {};
		const resolvedRoles: Record<string, { name: string; color: string }> = {};
		const resolvedChannels: Record<string, string> = {};

		// Resolve users
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

		// Resolve roles
		for (const roleId of roleIds) {
			const role = guild.roles.cache.get(roleId);
			if (role) {
				resolvedRoles[roleId] = { name: role.name, color: role.hexColor };
			}
		}

		// Resolve channels
		for (const channelId of channelIds) {
			const ch = guild.channels.cache.get(channelId);
			if (ch && 'name' in ch && ch.name) {
				resolvedChannels[channelId] = ch.name;
			}
		}

		// ── Resolve channel name for metadata ─────────────────────────────────
		const sourceChannel = guild.channels.cache.get(message.channelId);
		const channelName =
			sourceChannel && 'name' in sourceChannel && sourceChannel.name ? sourceChannel.name : 'unknown';

		// ── Author info ───────────────────────────────────────────────────────
		const author = message.author!;
		const member = message.member ?? (await guild.members.fetch(author.id).catch(() => null));
		const roleColor = member?.displayHexColor !== '#000000' ? member?.displayHexColor : undefined;
		const iconRole = member?.roles.cache
			.filter((r) => r.icon != null)
			.sort((a, b) => b.position - a.position)
			.first();
		const roleIconUrl = iconRole?.iconURL({ size: 32, extension: 'png' }) ?? undefined;
		const roleName = iconRole?.name ?? undefined;

		const pg = author.primaryGuild;
		const clanTag = pg?.identityEnabled && pg.tag ? pg.tag : undefined;
		const clanIconUrl =
			pg?.identityEnabled && pg.badge
				? (author.guildTagBadgeURL({ size: 32, extension: 'png' }) ?? undefined)
				: undefined;

		// ── Map reactions ─────────────────────────────────────────────────────
		const reactions: RenderReaction[] = message.reactions.cache.map((r) => ({
			name: r.emoji.name ?? '?',
			emojiUrl: r.emoji.id
				? `https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? 'gif' : 'webp'}?size=64`
				: undefined,
			count: r.count,
			isCustom: !!r.emoji.id
		}));

		// ── Resolve reply ─────────────────────────────────────────────────────
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

		// ── Process embeds ──────────────────────────────────────────────────
		// Split Discord auto-embeds (type=image/gifv/video) from rich embeds.
		// Auto-embeds are just URLs the client turned into previews — render them
		// as image/video attachments instead so the attachment gallery is used.
		const autoEmbedAttachments: RenderAttachment[] = [];
		const richEmbeds: typeof message.embeds = [];
		// Track canonical page URLs to strip bare-URL content
		const autoEmbedCanonicalUrls = new Set<string>();

		for (const e of message.embeds) {
			const type = (e.data as { type?: string }).type ?? 'rich';
			if (AUTO_EMBED_TYPES.has(type)) {
				// Track the canonical embed URL for content stripping
				if (e.url) autoEmbedCanonicalUrls.add(e.url.split('?')[0]);

				let url: string | null | undefined;
				let contentType: string;
				let width: number | undefined;
				let height: number | undefined;

				if (type === 'gifv') {
					// gifv (Tenor etc): fetch the page to extract the actual animated GIF URL.
					// Fall back to thumbnail if extraction fails.
					const tenorGif = e.url ? await resolveTenorGif(e.url) : null;
					url = tenorGif ?? e.thumbnail?.url;
					contentType = 'image/gif';
					width = e.video?.width ?? e.thumbnail?.width ?? undefined;
					height = e.video?.height ?? e.thumbnail?.height ?? undefined;
				} else if (type === 'video') {
					url = e.video?.url;
					contentType = 'video/mp4';
					width = e.video?.width ?? undefined;
					height = e.video?.height ?? undefined;
				} else {
					// type === 'image'
					url = e.image?.url;
					const rawUrl = url ?? '';
					contentType = /\.gif/i.test(rawUrl) ? 'image/gif' : 'image/webp';
					width = e.image?.width ?? undefined;
					height = e.image?.height ?? undefined;
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

		// Strip bare URL-only content when it caused an auto-embed (Discord hides it).
		const trimmedContent = content.trim();
		const strippedContent =
			autoEmbedCanonicalUrls.size > 0 &&
			/^https?:\/\/\S+$/.test(trimmedContent) &&
			autoEmbedCanonicalUrls.has(trimmedContent.split('?')[0])
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
				attachments: [
					...[...message.attachments.values()].map(attachmentToRender),
					...autoEmbedAttachments
				],
				embeds: richEmbeds.map((e) => ({
					title: e.title ?? undefined,
					description: e.description ?? undefined,
					color: e.color ?? undefined,
					url: e.url ?? undefined,
					author: e.author
						? {
								name: e.author.name,
								url: e.author.url ?? undefined,
								iconURL: e.author.iconURL ?? undefined
							}
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
				reactionCount: reaction.count ?? 0,
				reactionEmoji: config.skullEmoji,
				messageUrl: message.url
			},
			resolved: { users: resolvedUsers, roles: resolvedRoles, channels: resolvedChannels }
		};

		// ── Request render from web server ────────────────────────────────────
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
				this.container.logger.warn(`Skullboard render failed: HTTP ${res.status}`);
			}
		} catch (err) {
			this.container.logger.warn('Skullboard render request failed:', err);
		}

		// ── Post to skullboard channel ────────────────────────────────────────
		const skullboardMessage = await skullboardChannel.send({
			...(pngBuffer
				? { files: [{ attachment: pngBuffer, name: 'skullboard.png' }] }
				: {}),
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
					timestamp: message.createdAt.toISOString(),
				}
			]
		});

		// ── Persist to DB ─────────────────────────────────────────────────────
		const dbResult = await db
			.insert(skulledMessages)
			.values({
				guildId,
				originalMessageId: message.id,
				originalChannelId: message.channelId,
				skullboardMessageId: skullboardMessage.id,
				reactionCount: reaction.count ?? undefined,
				createdAt: new Date()
			})
			.onConflictDoNothing()
			.run();

		this.container.logger.info(
			`Skullboard: Posted message ${message.id} to #${channelName} in guild ${guildId}. DB entry ID: ${dbResult.lastInsertRowid}`
		);
		} finally {
			this.processing.delete(lockKey);
		}
	}
}
