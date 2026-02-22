<script lang="ts">
	import '@skyra/discord-components-core';
	import { html } from 'lit';
	// Deep import to access the icons Map — bypasses exports map via Vite alias (vite.config.ts).
	// The TS path is declared in app.d.ts. Runtime module deduplication ensures icons.set()
	// affects the same Map instance the discord-author-info component uses.
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	import { icons } from '@skyra/discord-components-core/dist/config.js';
	import { markdownToDiscordComponents, replyToHtml } from '$lib/markdownToComponents.js';
	import type { RenderPayload, RenderAttachment } from '$lib/types.js';

	let { data }: { data: { payload: RenderPayload } } = $props();
	const message = $derived(data.payload.message);
	const resolved = $derived(data.payload.resolved);
	const isEdited = $derived(message.editedAt != null);

	// Register clan icon URL into the component's icons map before Lit renders.
	// The component has a bug (clanIcon === 'string' instead of typeof ... === 'string')
	// so external URLs never render as <img> unless they're in the map as TemplateResults.
	$effect.pre(() => {
		const url = message.author.clanIconUrl;
		if (url && !icons.has(url)) {
			icons.set(url, html`<img srcset="${url}" width="12" height="12" draggable="false" alt="" />`);
		}
	});

	function formatDiscordTimestamp(iso: string): string {
		const date = new Date(iso);
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);

		const timeStr = date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});

		if (date.toDateString() === now.toDateString()) return `Today at ${timeStr}`;
		if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${timeStr}`;
		return (
			date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) +
			' ' +
			timeStr
		);
	}

	const createdAt = $derived(formatDiscordTimestamp(message.createdAt));

	const renderedContent = $derived(markdownToDiscordComponents(message.content ?? '', resolved));
	const renderedReply = $derived(message.reply ? replyToHtml(message.reply.content) : '');

	function colorToHex(color: number | undefined): string | undefined {
		if (color == null) return undefined;
		return '#' + color.toString(16).padStart(6, '0');
	}

	function isImage(att: RenderAttachment): boolean {
		return att.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
	}

	function isVideo(att: RenderAttachment): boolean {
		return att.contentType?.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(att.name);
	}

	function isAudio(att: RenderAttachment): boolean {
		return att.contentType?.startsWith('audio/') || /\.(mp3|ogg|wav|flac)$/i.test(att.name);
	}

	const imageAtts = $derived(message.attachments.filter(isImage));
	const videoAtts = $derived(message.attachments.filter(isVideo));
	const audioAtts = $derived(message.attachments.filter(isAudio));
	const fileAtts = $derived(message.attachments.filter((a) => !isImage(a) && !isVideo(a) && !isAudio(a)));

	const hasAttachments = $derived(
		imageAtts.length > 0 || videoAtts.length > 0 || audioAtts.length > 0 || fileAtts.length > 0 || (message.stickers?.length ?? 0) > 0
	);

	function constrainDimensions(
		w: number,
		h: number,
		maxW = 520,
		maxH = 350
	): { width: number; height: number } {
		const ratio = Math.min(maxW / w, maxH / h, 1);
		return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
	}
</script>

<svelte:head>
	<title>Skullboard Render</title>
</svelte:head>

<div class="wrapper">
	<discord-messages>
		<discord-message
			author={message.author.displayName}
			avatar={message.author.avatarUrl}
			role-color={message.author.roleColor}
			role-icon={message.author.roleIconUrl}
			role-name={message.author.roleName}
			clan-icon={message.author.clanIconUrl}
			clan-tag={message.author.clanTag}
			bot={message.author.bot}
			timestamp={createdAt}
			edited={isEdited}
		>
			{#if message.reply}
				<discord-reply
					slot="reply"
					author={message.reply.authorName}
					avatar={message.reply.avatarUrl}
					role-color={message.reply.roleColor}
					edited={message.reply.edited}
					attachment={message.reply.attachment}
				>{@html renderedReply}</discord-reply>
			{/if}

			{@html renderedContent}

			{#if hasAttachments}
				<discord-attachments slot="attachments">
					{#each message.stickers ?? [] as sticker}
						<discord-image-attachment
							url={sticker.url}
							width={160}
							height={160}
							alt={sticker.name}
						></discord-image-attachment>
					{/each}
					{#each imageAtts as att}
						{@const dim = constrainDimensions(att.width ?? 400, att.height ?? 300)}
						<discord-image-attachment
							url={att.url}
							width={dim.width}
							height={dim.height}
							alt={att.name}
						></discord-image-attachment>
					{/each}
					{#each videoAtts as att}
						<discord-video-attachment href={att.url}></discord-video-attachment>
					{/each}
					{#each audioAtts as att}
						<discord-audio-attachment
							href={att.url}
							name={att.name}
							bytes={att.size ?? 0}
						></discord-audio-attachment>
					{/each}
					{#each fileAtts as att}
						<discord-file-attachment
							name={att.name}
							bytes={att.size ?? 0}
							href={att.url}
							target="_blank"
							type={att.contentType}
						></discord-file-attachment>
					{/each}
				</discord-attachments>
			{/if}

			{#each message.embeds as embed (embed)}
				{@const embedColor = colorToHex(embed.color)}
				<discord-embed
					slot="embeds"
					color={embedColor}
					embed-title={embed.title}
					url={embed.url}
					author-name={embed.author?.name}
					author-url={embed.author?.url}
					author-image={embed.author?.iconURL}
					thumbnail={embed.thumbnail}
					image={embed.image}
					provider={embed.provider}
					timestamp={embed.timestamp}
				>
					{#if embed.description}
						<discord-embed-description slot="description">
							{@html markdownToDiscordComponents(embed.description, resolved)}
						</discord-embed-description>
					{/if}

					{#if embed.fields?.length}
						<discord-embed-fields slot="fields">
							{#each embed.fields as field, i}
								<discord-embed-field
									field-title={field.name}
									inline={field.inline}
									inline-index={field.inline ? i + 1 : undefined}
								>
									{@html markdownToDiscordComponents(field.value, resolved)}
								</discord-embed-field>
							{/each}
						</discord-embed-fields>
					{/if}

					{#if embed.footer}
						<discord-embed-footer slot="footer" footer-image={embed.footer.iconURL}>
							{embed.footer.text}
						</discord-embed-footer>
					{/if}
				</discord-embed>
			{/each}
		</discord-message>
	</discord-messages>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: transparent;
	}

	.wrapper {
		width: 520px;
		display: inline-block;
		padding: 16px;
		box-sizing: border-box;
		background-color: #36393e;
	}

	/* Override discord-reply's internal margin-left (shadow :host is 56px by default).
	   Increase this value to push the reply bar further right. */
	:global(discord-reply) {
		margin-left: 55px !important;
	}
</style>
