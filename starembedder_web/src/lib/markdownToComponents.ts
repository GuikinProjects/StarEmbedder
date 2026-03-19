/**
 * Converts Discord markdown to @skyra/discord-components-core HTML elements.
 * Adapted from https://github.com/sapphiredev/resource-webhooks/blob/main/lib/utils/MarkdownToDiscordWebComponents.ts
 * Modified to remove Nuxt composable dependency and accept resolved mention maps.
 */
import emojibaseData from 'emojibase-data/en/compact.json';
import joypixelsShortcodes from 'emojibase-data/en/shortcodes/joypixels.json';
import iamcalShortcodes from 'emojibase-data/en/shortcodes/iamcal.json';
import githubShortcodes from 'emojibase-data/en/shortcodes/github.json';

/**
 * Merged shortcode → Unicode map built from joypixels + iamcal + github databases.
 * Covers the full set of shortcodes Discord supports (7000+ entries).
 */
const SHORTCODE_MAP: Map<string, string> = (() => {
	const hexToUnicode = new Map<string, string>();
	for (const entry of emojibaseData as Array<{ hexcode: string; unicode: string; skins?: Array<{ hexcode: string; unicode: string }> }>) {
		hexToUnicode.set(entry.hexcode, entry.unicode);
		for (const skin of entry.skins ?? []) hexToUnicode.set(skin.hexcode, skin.unicode);
	}
	const map = new Map<string, string>();
	for (const db of [joypixelsShortcodes, iamcalShortcodes, githubShortcodes] as Array<Record<string, string | string[]>>) {
		for (const [hex, codes] of Object.entries(db)) {
			const uni = hexToUnicode.get(hex);
			if (!uni) continue;
			const list = Array.isArray(codes) ? codes : [codes];
			for (const code of list) if (!map.has(code)) map.set(code, uni);
		}
	}
	return map;
})();

export interface ResolvedMentions {
	users: Record<string, string>;
	roles: Record<string, { name: string; color: string }>;
	channels: Record<string, string>;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const CUSTOM_EMOJI_RE = /<(a?):(\w+):(\d+)>/g;
// Matches Unicode emoji: single pictographic with optional FE0F, plus any ZWJ chains.
// The trailing \uFE0F? on each segment ensures ZWJ sequences like 🏃‍➡️ are captured whole.
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}\uFE0F?((\u200D\p{Extended_Pictographic}\uFE0F?)+)?/gu;
// Matches :shortcode: style emoji (Discord text emoji)
const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

/**
 * Converts a Unicode emoji string to a Twemoji CDN URL.
 * Mirrors Twemoji's toCodePoint logic: strip \uFE0F from non-ZWJ sequences.
 */
function twemojiUrl(emoji: string): string {
	const hasZWJ = emoji.includes('\u200D');
	const normalized = hasZWJ ? emoji : emoji.replace(/\uFE0F/g, '');
	const codepoint = [...normalized].map((c) => c.codePointAt(0)!.toString(16)).join('-');
	return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg/${codepoint}.svg`;
}

function twemojiImg(emoji: string, size: number, margin = '0 1px'): string {
	const url = twemojiUrl(emoji);
	return `<img src="${url}" alt="${escapeHtml(emoji)}" style="width:${size}px;height:${size}px;vertical-align:middle;display:inline-block;margin:${margin};">`;
}

/**
 * Like String.replace() but only applies the replacement to plain text portions,
 * skipping anything inside an HTML tag (< ... >).  This prevents double-processing
 * emoji that already appear inside generated <img alt="..."> attributes.
 */
function replaceTextOnly(
	html: string,
	regex: RegExp,
	replacer: (match: string, ...args: string[]) => string
): string {
	const parts: string[] = [];
	let last = 0;
	const tagRe = /<[^>]*>/g;
	let m: RegExpExecArray | null;
	while ((m = tagRe.exec(html)) !== null) {
		if (m.index > last) {
			parts.push(html.slice(last, m.index).replace(regex, replacer));
		}
		parts.push(m[0]);
		last = m.index + m[0].length;
	}
	if (last < html.length) {
		parts.push(html.slice(last).replace(regex, replacer));
	}
	return parts.join('');
}

/**
 * Determines whether the entire message is emoji-only (custom + unicode, no other text).
 * Returns { jumbo: true } if emoji-only and total count ≤ 30.
 */
function detectJumbo(content: string): boolean {
	const stripped = content
		.replace(CUSTOM_EMOJI_RE, '')
		.replace(UNICODE_EMOJI_RE, '')
		.replace(SHORTCODE_RE, (_, name) => (SHORTCODE_MAP.has(name) ? '' : `:${name}:`))
		.replace(/\s/g, '');
	if (stripped.length > 0) return false;

	const shortcodeCount = [...content.matchAll(new RegExp(SHORTCODE_RE.source, 'g'))].filter(
		([, name]) => SHORTCODE_MAP.has(name)
	).length;
	const count =
		[...content.matchAll(new RegExp(CUSTOM_EMOJI_RE.source, 'g'))].length +
		[...content.matchAll(new RegExp(UNICODE_EMOJI_RE.source, 'gu'))].length +
		shortcodeCount;
	return count > 0 && count <= 30;
}

function processInline(text: string, resolved: ResolvedMentions, jumbo = false): string {
	let result = text;

	// Slash command mentions: </commandName:id>
	result = result.replace(/<\/([^:>]+):\d+>/g, (_, cmdName) => {
		return `<discord-mention type="slash">${escapeHtml(cmdName)}</discord-mention>`;
	});

	// User mentions: <@userId> or <@!userId>
	result = result.replace(/<@!?(\d+)>/g, (_, userId) => {
		const name = resolved.users[userId] ?? `Unknown User`;
		return `<discord-mention type="user">${escapeHtml(name)}</discord-mention>`;
	});

	// Role mentions: <@&roleId>
	result = result.replace(/<@&(\d+)>/g, (_, roleId) => {
		const role = resolved.roles[roleId];
		if (role) {
			return `<discord-mention type="role" color="${escapeHtml(role.color)}">${escapeHtml(role.name)}</discord-mention>`;
		}
		return `<discord-mention type="role">Unknown Role</discord-mention>`;
	});

	// Channel mentions: <#channelId>
	result = result.replace(/<#(\d+)>/g, (_, channelId) => {
		const name = resolved.channels[channelId] ?? 'unknown-channel';
		return `<discord-mention type="channel">${escapeHtml(name)}</discord-mention>`;
	});

	// Timestamps: <t:unix:format>
	result = result.replace(/<t:(\d+)(?::[tTdDfFR])?>/g, () => '<discord-time></discord-time>');

	// Custom / animated emojis: <:name:id> or <a:name:id> — must run BEFORE shortcode processing
	// so that <:shrug:123> isn't split by the :shrug: shortcode match
	result = result.replace(/<(a?):(\w+):(\d+)>/g, (_full, animated, name, id) => {
		const ext = animated ? 'gif' : 'webp';
		const cdnSize = jumbo ? 64 : 32;
		const displaySize = jumbo ? 48 : 22;
		const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=${cdnSize}&quality=lossless`;
		const style = jumbo
			? `width:${displaySize}px;height:${displaySize}px;vertical-align:middle;display:inline-block;margin:0 2px;`
			: `width:${displaySize}px;height:${displaySize}px;vertical-align:middle;display:inline-block;margin:0 1px;`;
		return `<img src="${url}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" style="${style}">`;
	});

	// Shortcode emojis: :8ball: :thumbsup: etc. — resolve via SHORTCODE_MAP then render as Twemoji
	// Must use replaceTextOnly so the regex doesn't fire inside alt/title attributes of custom emoji imgs
	{
		const size = jumbo ? 48 : 22;
		const margin = jumbo ? '0 2px' : '0 1px';
		result = replaceTextOnly(result, /:([a-zA-Z0-9_+-]+):/g, (full, name) => {
			const emoji = SHORTCODE_MAP.get(name);
			if (!emoji) return full;
			return twemojiImg(emoji, size, margin);
		});
	}

	// Multiline code blocks: ```lang\n...\n```
	result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_full, lang, code) => {
		const langAttr = lang ? ` language="${escapeHtml(lang)}"` : '';
		return `<discord-code multiline${langAttr}>${escapeHtml(code.trim())}</discord-code>`;
	});

	// Inline code: `code`
	result = result.replace(/`([^`]+)`/g, (_full, code) => {
		return `<discord-code>${escapeHtml(code)}</discord-code>`;
	});

	// Bold italic: ***text***
	result = result.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_full, content) => {
		return `<discord-bold><discord-italic>${content}</discord-italic></discord-bold>`;
	});

	// Bold: **text**
	result = result.replace(/\*\*([\s\S]+?)\*\*/g, (_full, content) => {
		return `<discord-bold>${content}</discord-bold>`;
	});

	// Italic: *text* or _text_
	result = result.replace(/\*([\s\S]+?)\*/g, (_full, content) => {
		return `<discord-italic>${content}</discord-italic>`;
	});

	// Underline: __text__
	result = result.replace(/__([\s\S]+?)__/g, (_full, content) => {
		return `<discord-underlined>${content}</discord-underlined>`;
	});

	// Strikethrough: ~~text~~
	result = result.replace(/~~([\s\S]+?)~~/g, (_full, content) => {
		return `<s>${content}</s>`;
	});

	// Spoiler: ||text||
	result = result.replace(/\|\|([\s\S]+?)\|\|/g, (_full, content) => {
		return `<discord-spoiler>${content}</discord-spoiler>`;
	});

	// Masked links: [label](<url>) or [label](url)
	result = result.replace(/\[([^\]]+)\]\(<?(https?:\/\/[^>)]+)>?\)/g, (_full, label, url) => {
		return `<discord-link href="${escapeHtml(url)}" target="_blank">${escapeHtml(label)}</discord-link>`;
	});

	// Angle-bracket URLs: <https://example.com> (Discord embed-suppressed links)
	result = result.replace(/<(https?:\/\/[^\s>]+)>/g, (_full, url) => {
		return `<discord-link href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</discord-link>`;
	});

	// Bare URLs (leave as-is inside discord-link)
	result = result.replace(/(^|[\s])(https?:\/\/[^\s<>"]+)/g, (_full, pre, url) => {
		return `${pre}<discord-link href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</discord-link>`;
	});

	// Unicode emoji → Twemoji images (only in text nodes, not inside generated HTML tags)
	{
		const size = jumbo ? 48 : 22;
		const margin = jumbo ? '0 2px' : '0 1px';
		result = replaceTextOnly(
			result,
			/\p{Extended_Pictographic}\uFE0F?((\u200D\p{Extended_Pictographic}\uFE0F?)+)?/gu,
			(emoji) => twemojiImg(emoji, size, margin)
		);
	}

	return result;
}

export function markdownToDiscordComponents(markdown: string, resolved: ResolvedMentions): string {
	const jumbo = detectJumbo(markdown);
	const lines = markdown.split('\n');
	const output: string[] = [];

	let inCodeBlock = false;
	let codeBlockLang = '';
	let codeBlockContent: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Handle code block start/end
		if (line.startsWith('```')) {
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeBlockLang = line.slice(3).trim();
				codeBlockContent = [];
			} else {
				inCodeBlock = false;
				const langAttr = codeBlockLang ? ` language="${escapeHtml(codeBlockLang)}"` : '';
				output.push(
					`<discord-code multiline${langAttr}>${escapeHtml(codeBlockContent.join('\n'))}</discord-code>`
				);
				codeBlockLang = '';
				codeBlockContent = [];
			}
			continue;
		}

		if (inCodeBlock) {
			codeBlockContent.push(line);
			continue;
		}

		// Subscript: -# text (Discord's small text)
		if (line.startsWith('-# ')) {
			const content = processInline(line.slice(3), resolved, jumbo);
			output.push(`<discord-subscript>${content}</discord-subscript>`);
			continue;
		}

		// Headers: ### ## #
		const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headerMatch) {
			const level = headerMatch[1].length;
			const content = processInline(headerMatch[2], resolved, jumbo);
			output.push(`<discord-header level="${level}">${content}</discord-header>`);
			continue;
		}

		// Blockquote: > text — group consecutive lines into a single <discord-quote>
		if (line.startsWith('> ') || line === '>') {
			const quoteLines: string[] = [
				processInline(line.startsWith('> ') ? line.slice(2) : '', resolved, jumbo)
			];
			while (i + 1 < lines.length && (lines[i + 1].startsWith('> ') || lines[i + 1] === '>')) {
				i++;
				quoteLines.push(
					processInline(lines[i].startsWith('> ') ? lines[i].slice(2) : '', resolved, jumbo)
				);
			}
			output.push(`<discord-quote>${quoteLines.join('<br>')}</discord-quote>`);
			continue;
		}

		// Empty line → spacer
		if (line.trim() === '') {
			output.push('<div></div>');
			continue;
		}

		// Unordered list items: - item or * item
		if (/^[*-] /.test(line)) {
			const content = processInline(line.slice(2), resolved, jumbo);
			output.push(
				`<discord-unordered-list><discord-list-item>${content}</discord-list-item></discord-unordered-list>`
			);
			continue;
		}

		// Ordered list items: 1. item
		if (/^\d+\. /.test(line)) {
			const itemMatch = line.match(/^(\d+)\. (.+)$/);
			if (itemMatch) {
				const content = processInline(itemMatch[2], resolved, jumbo);
				output.push(
					`<discord-ordered-list start="${itemMatch[1]}"><discord-list-item>${content}</discord-list-item></discord-ordered-list>`
				);
				continue;
			}
		}

		// Normal line with inline formatting
		const content = processInline(line, resolved, jumbo);
		output.push(content + '<br>');
	}

	return output.join('\n');
}

/**
 * Renders a reply-bar preview: custom emojis become small inline images,
 * all markdown is stripped to plain text, truncated with … at maxChars.
 */
export function replyToHtml(content: string, maxChars = 80): string {
	// 1. Collapse whitespace and strip block-level markup
	const text = content
		.replace(/\r?\n/g, ' ')
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`[^`]+`/g, '')
		.replace(/\*{1,3}|_{1,2}|~~|\|\|/g, '') // bold/italic/strike/spoiler
		.replace(/^#+\s*/gm, '') // headers
		.replace(/^>\s*/gm, '') // blockquotes
		.replace(/<@!?(\d+)>/g, '')
		.replace(/<@&(\d+)>/g, '')
		.replace(/<#(\d+)>/g, '')
		.replace(/<\/[^:>]+:\d+>/g, '')
		.replace(/<t:\d+(?::[tTdDfFR])?>/g, '')
		.replace(/<(https?:\/\/[^\s>]+)>/g, '') // strip angle-bracket URLs
		.replace(/https?:\/\/\S+/g, '') // strip bare URLs
		.replace(/\s{2,}/g, ' ')
		.trim();

	// 2. Walk through the text, turning custom emoji into <img> and everything
	//    else into escaped plain text, stopping once maxChars is reached.
	let html = '';
	let charCount = 0;
	let lastIndex = 0;
	let truncated = false;
	const emojiRe = /<a?:(\w+):(\d+)>/g;
	let match: RegExpExecArray | null;

	const appendText = (raw: string) => {
		if (charCount >= maxChars) {
			truncated = truncated || raw.length > 0;
			return;
		}
		const remaining = maxChars - charCount;
		const slice = raw.slice(0, remaining);
		html += escapeHtml(slice);
		charCount += slice.length;
		if (raw.length > remaining) truncated = true;
	};

	while ((match = emojiRe.exec(text)) !== null) {
		appendText(text.slice(lastIndex, match.index));
		if (charCount < maxChars) {
			const [, name, id] = match;
			const ext = match[0].startsWith('<a:') ? 'gif' : 'webp';
			html +=
				`<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=32" ` +
				`alt=":${escapeHtml(name)}:" ` +
				`style="width:1em;height:1em;vertical-align:-0.2em;display:inline-block;">`;
		} else {
			truncated = true;
		}
		lastIndex = match.index + match[0].length;
	}
	appendText(text.slice(lastIndex));

	// 3. Strip any leftover partial Discord tags (e.g. truncated mid-tag)
	html = html.replace(/<[^>]*$/g, '');

	// If we stripped everything (e.g. URL-only message) show … regardless
	if (!html.trim()) return '\u2026';
	if (truncated) html += '\u2026';
	return html;
}
