import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { eq, and } from 'drizzle-orm';
import {
	ChannelType,
	ContainerBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	SlashCommandChannelOption,
	TextDisplayBuilder
} from 'discord.js';
import { buildErrorComponents } from '../../../lib/skullboard/displayConfig';
import { blacklistedEntries } from '../../../lib/db/schema';

@ApplyOptions<Command.Options>({
	name: 'blacklist-remove',
	description: 'Re-allow a previously blacklisted channel or category to be tracked by the Skullboard'
})
@RegisterSubCommand('skullboard', (builder) =>
	builder
		.setName('blacklist-remove')
		.setDescription('Re-allow a previously blacklisted channel or category to be tracked by the Skullboard')
		.addChannelOption((option: SlashCommandChannelOption) =>
			option
				.setName('target')
				.setDescription('Channel or category to remove from the blacklist')
				.addChannelTypes(
					ChannelType.GuildText,
					ChannelType.GuildAnnouncement,
					ChannelType.GuildForum,
					ChannelType.GuildMedia,
					ChannelType.GuildVoice,
					ChannelType.GuildStageVoice,
					ChannelType.GuildCategory
				)
				.setRequired(true)
		)
)
export class SkullboardBlacklistRemoveCommand extends Command {
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

		const target = interaction.options.getChannel('target', true);
		const isCategory = target.type === ChannelType.GuildCategory;
		const { db } = this.container;
		const guildId = interaction.guildId;

		const existing = db
			.select()
			.from(blacklistedEntries)
			.where(and(eq(blacklistedEntries.guildId, guildId), eq(blacklistedEntries.entryId, target.id)))
			.get();

		if (!existing) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents(`${isCategory ? 'Category' : 'Channel'} <#${target.id}> is not in the blacklist.`)
			});
		}

		db.delete(blacklistedEntries)
			.where(and(eq(blacklistedEntries.guildId, guildId), eq(blacklistedEntries.entryId, target.id)))
			.run();

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: [
				new ContainerBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent('## ✅ Blacklist Updated'))
					.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`${isCategory ? 'Category' : 'Channel'} <#${target.id}> has been **removed from the blacklist**.\nMessages in this ${existing.type} will now be tracked by the Skullboard again.`
						)
					)
			]
		});
	}
}
