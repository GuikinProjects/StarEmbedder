import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { buildConfigComponents, buildErrorComponents } from '../../../lib/skullboard/displayConfig';
import { blacklistedEntries, guildConfigs } from '../../../lib/db/schema';

@ApplyOptions<Command.Options>({
	name: 'config-view',
	description: 'View the current Skullboard configuration for this server'
})
@RegisterSubCommand('skullboard', (builder) =>
	builder.setName('config-view').setDescription('View the current Skullboard configuration for this server')
)
export class SkullboardConfigViewCommand extends Command {
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents('This command can only be used inside a server.')
			});
		}

		const { db } = this.container;
		const guildId = interaction.guildId;

		const config = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).get();
		const rawBlacklist = db.select().from(blacklistedEntries).where(eq(blacklistedEntries.guildId, guildId)).all();

		// Resolve category names from the guild channel cache — <#id> doesn't render for categories.
		const blacklist = rawBlacklist.map((e) => ({
			...e,
			name: e.type === 'category' ? (interaction.guild.channels.cache.get(e.entryId)?.name ?? e.entryId) : undefined
		}));

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: buildConfigComponents(
				config ?? null,
				'## ⚙️ Skullboard Configuration',
				config
					? '-# Use `/skullboard config-edit` to change any setting.'
					: '-# No configuration set yet. Use `/skullboard config-edit` to get started.',
				blacklist
			)
		});
	}
}
