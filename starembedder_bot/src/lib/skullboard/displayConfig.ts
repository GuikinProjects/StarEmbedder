import { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';

export interface GuildConfigDisplay {
	skullboardChannelId: string | null;
	skullThreshold: number;
	skullEmoji: string;
}

export interface BlacklistEntry {
	entryId: string;
	type: 'channel' | 'category';
	name?: string;
}

export function buildConfigComponents(config: GuildConfigDisplay | null, header: string, hint: string, blacklist?: BlacklistEntry[]) {
	const channelDisplay = config?.skullboardChannelId ? `<#${config.skullboardChannelId}>` : '*Not set*';
	const thresholdDisplay = config ? String(config.skullThreshold) : '3 *(default)*';
	const emojiDisplay = config?.skullEmoji ?? '💀 *(default)*';

	const body = `> ### Channel\n${channelDisplay}\n\n> ### Threshold\n\`\`\`${thresholdDisplay}\`\`\`\n\n> ### Emoji\n\`\`\`${emojiDisplay}\`\`\``;

	const container = new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
		.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

	if (blacklist !== undefined) {
		const channels = blacklist.filter((e) => e.type === 'channel');
		const categories = blacklist.filter((e) => e.type === 'category');

		const channelLines = channels.length ? channels.map((e) => `• <#${e.entryId}>`).join('\n') : '*None*';
		const categoryLines = categories.length ? categories.map((e) => `• \`${e.name ?? e.entryId}\``).join('\n') : '*None*';

		const blacklistBody = `> ### Blacklisted Channels\n${channelLines}\n\n> ### Blacklisted Categories\n${categoryLines}`;

		container
			.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(blacklistBody));
	}

	container
		.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(hint));

	return [container];
}

export function buildErrorComponents(message: string) {
	return [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ❌ Error\n${message}`))];
}
