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
	name: 'blacklist-add',
	description: 'Prevent a channel or category from being tracked by the Skullboard'
})
@RegisterSubCommand('skullboard', (builder) =>
	builder
		.setName('blacklist-add')
		.setDescription('Prevent a channel or category from being tracked by the Skullboard')
		.addChannelOption((option: SlashCommandChannelOption) =>
			option
				.setName('target')
				.setDescription('Channel or category to blacklist')
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
export class SkullboardBlacklistAddCommand extends Command {
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
		const type = isCategory ? ('category' as const) : ('channel' as const);
		const { db } = this.container;
		const guildId = interaction.guildId;

		// Check if already blacklisted.
		const existing = db
			.select()
			.from(blacklistedEntries)
			.where(and(eq(blacklistedEntries.guildId, guildId), eq(blacklistedEntries.entryId, target.id)))
			.get();

		if (existing) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents(`${isCategory ? 'Category' : 'Channel'} <#${target.id}> is already blacklisted.`)
			});
		}

		db.insert(blacklistedEntries).values({ guildId, entryId: target.id, type, createdAt: new Date() }).run();

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: [
				new ContainerBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🚫 Blacklist Updated'))
					.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`${isCategory ? 'Category' : 'Channel'} <#${target.id}> has been **blacklisted**.\nMessages in this ${type} will no longer be tracked by the Skullboard.`
						)
					)
			]
		});
	}
}
