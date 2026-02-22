import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { eq } from 'drizzle-orm';
import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandChannelOption,
	SlashCommandIntegerOption,
	SlashCommandStringOption
} from 'discord.js';
import { buildConfigComponents, buildErrorComponents } from '../../../lib/skullboard/displayConfig';
import { guildConfigs } from '../../../lib/db/schema';

@ApplyOptions<Command.Options>({
	name: 'config-edit',
	description: 'Update the Skullboard configuration for this server'
})
@RegisterSubCommand('skullboard', (builder) =>
	builder
		.setName('config-edit')
		.setDescription('Update the Skullboard configuration for this server')
		.addChannelOption((option: SlashCommandChannelOption) =>
			option
				.setName('channel')
				.setDescription('Channel where skulled messages will be reposted')
				.setRequired(false)
		)
		.addIntegerOption((option: SlashCommandIntegerOption) =>
			option
				.setName('threshold')
				.setDescription('Number of skull reactions required to post (default: 3)')
				.setMinValue(1)
				.setMaxValue(100)
				.setRequired(false)
		)
		.addStringOption((option: SlashCommandStringOption) =>
			option.setName('emoji').setDescription('Emoji to track as a skull reaction (default: 💀)').setRequired(false)
		)
)
export class SkullboardConfigEditCommand extends Command {
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

		const channel = interaction.options.getChannel('channel');
		const threshold = interaction.options.getInteger('threshold');
		const emoji = interaction.options.getString('emoji');

		const { db } = this.container;
		const guildId = interaction.guildId;

		const isUpdating = channel !== null || threshold !== null || emoji !== null;

		// Fetch current config so we can fill defaults for unchanged fields.
		const existing = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).get();

		const newChannel = channel?.id ?? existing?.skullboardChannelId ?? null;
		const newThreshold = threshold ?? existing?.skullThreshold ?? 3;
		const newEmoji = emoji ?? existing?.skullEmoji ?? '💀';
		const now = new Date();

		db.insert(guildConfigs)
			.values({
				guildId,
				skullboardChannelId: newChannel,
				skullThreshold: newThreshold,
				skullEmoji: newEmoji,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: guildConfigs.guildId,
				set: {
					skullboardChannelId: newChannel,
					skullThreshold: newThreshold,
					skullEmoji: newEmoji,
					updatedAt: now
				}
			})
			.run();

		const result = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).get()!;

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: buildConfigComponents(
				result,
				isUpdating ? '## ⚙️ Configuration Updated' : '## ⚙️ Skullboard Configuration',
				'-# Use `/skullboard config-edit` with options to change any setting.'
			)
		});
	}
}
