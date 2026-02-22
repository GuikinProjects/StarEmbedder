import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { eq } from 'drizzle-orm';
import { ContainerBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { buildErrorComponents } from '../../../lib/skullboard/displayConfig';
import { blacklistedEntries } from '../../../lib/db/schema';

@ApplyOptions<Command.Options>({
	name: 'blacklist-list',
	description: 'Show all blacklisted channels and categories for this server'
})
@RegisterSubCommand('skullboard', (builder) =>
	builder.setName('blacklist-list').setDescription('Show all blacklisted channels and categories for this server')
)
export class SkullboardBlacklistListCommand extends Command {
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents('This command can only be used inside a server.')
			});
		}

		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents('You need the **Manage Server** permission to use this command.')
			});
		}

		const entries = this.container.db.select().from(blacklistedEntries).where(eq(blacklistedEntries.guildId, interaction.guildId)).all();

		const channels = entries.filter((e) => e.type === 'channel');
		const categories = entries.filter((e) => e.type === 'category');

		const channelLines = channels.length ? channels.map((e) => `• <#${e.entryId}>`).join('\n') : '*None*';
		const categoryLines = categories.length
			? categories
					.map((e) => {
						const name = interaction.guild.channels.cache.get(e.entryId)?.name ?? e.entryId;
						return `• \`${name}\``;
					})
					.join('\n')
			: '*None*';

		const body = `> ### Channels\n${channelLines}\n\n> ### Categories\n${categoryLines}`;

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: [
				new ContainerBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🚫 Blacklisted Entries'))
					.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
					.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent('-# Use `/skullboard blacklist-add` or `/skullboard blacklist-remove` to manage entries.')
					)
			]
		});
	}
}
