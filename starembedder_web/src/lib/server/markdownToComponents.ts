/**
 * Converts Discord markdown to @skyra/discord-components-core HTML elements.
 * Adapted from https://github.com/sapphiredev/resource-webhooks/blob/main/lib/utils/MarkdownToDiscordWebComponents.ts
 * Modified to remove Nuxt composable dependency and accept resolved mention maps.
 */

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

function processInline(text: string, resolved: ResolvedMentions): string {
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
	result = result.replace(/<t:(\d+)(?::[tTdDfFR])?>/g, () => {
		return `<discord-time></discord-time>`;
	});

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

	// Bare URLs (leave as-is inside discord-link)
	result = result.replace(/(^|[\s])(https?:\/\/[^\s<>"]+)/g, (_full, pre, url) => {
		return `${pre}<discord-link href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</discord-link>`;
	});

	return result;
}

export function markdownToDiscordComponents(markdown: string, resolved: ResolvedMentions): string {
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
			const content = processInline(line.slice(3), resolved);
			output.push(`<discord-subscript>${content}</discord-subscript>`);
			continue;
		}

		// Headers: ### ## #
		const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headerMatch) {
			const level = headerMatch[1].length;
			const content = processInline(headerMatch[2], resolved);
			output.push(`<discord-header level="${level}">${content}</discord-header>`);
			continue;
		}

		// Blockquote: > text — group consecutive lines into a single <discord-quote>
		if (line.startsWith('> ') || line === '>') {
			const quoteLines: string[] = [
				processInline(line.startsWith('> ') ? line.slice(2) : '', resolved)
			];
			while (i + 1 < lines.length && (lines[i + 1].startsWith('> ') || lines[i + 1] === '>')) {
				i++;
				quoteLines.push(
					processInline(lines[i].startsWith('> ') ? lines[i].slice(2) : '', resolved)
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
			const content = processInline(line.slice(2), resolved);
			output.push(
				`<discord-unordered-list><discord-list-item>${content}</discord-list-item></discord-unordered-list>`
			);
			continue;
		}

		// Ordered list items: 1. item
		if (/^\d+\. /.test(line)) {
			const itemMatch = line.match(/^(\d+)\. (.+)$/);
			if (itemMatch) {
				const content = processInline(itemMatch[2], resolved);
				output.push(
					`<discord-ordered-list start="${itemMatch[1]}"><discord-list-item>${content}</discord-list-item></discord-ordered-list>`
				);
				continue;
			}
		}

		// Normal line with inline formatting
		const content = processInline(line, resolved);
		output.push(content + '<br>');
	}

	return output.join('\n');
}
