import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { eq } from 'drizzle-orm';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { guildConfigs } from '../../../lib/db/schema';
import { executeSkullboardPost } from '../../../lib/skullboard/postMessage';

/** Parse a Discord message link into its component IDs. Returns null if invalid. */
function parseMessageLink(link: string): { guildId: string; channelId: string; messageId: string } | null {
	const match = link.match(/^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
	if (!match) return null;
	return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

@ApplyOptions<Command.Options>({
	name: 'force-post',
	description: 'Force-post a message to the skullboard, bypassing the reaction threshold'
})
@RegisterSubCommand('skullboard', (builder) =>
	builder
		.setName('force-post')
		.setDescription('Force-post a message to the skullboard, bypassing the reaction threshold')
		.addStringOption((option) =>
			option.setName('message-link').setDescription('The Discord message link to force-post').setRequired(true)
		)
)
export class SkullboardForcePostCommand extends Command {
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({
flags: MessageFlags.Ephemeral,
content: 'This command can only be used inside a server.'
});
		}

		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.reply({
flags: MessageFlags.Ephemeral,
content: 'You need the **Manage Server** permission to use this command.'
});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const messageLink = interaction.options.getString('message-link', true);
		const parsed = parseMessageLink(messageLink);

		if (!parsed) {
			return interaction.editReply({ content: 'Invalid message link. Please provide a valid Discord message URL.' });
		}

		if (parsed.guildId !== interaction.guildId) {
			return interaction.editReply({ content: 'That message link belongs to a different server.' });
		}

		const { db } = this.container;
		const guildId = interaction.guildId;

		const config = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).get();
		if (!config || !config.skullboardChannelId) {
			return interaction.editReply({ content: 'Skullboard is not configured for this server. Use `/skullboard config-edit` first.' });
		}

		const guild = interaction.guild;
		const sourceChannel = guild.channels.cache.get(parsed.channelId) ?? (await guild.channels.fetch(parsed.channelId).catch(() => null));

		if (!sourceChannel || !sourceChannel.isTextBased() || !('messages' in sourceChannel)) {
			return interaction.editReply({ content: 'Could not find or access that channel.' });
		}

		const message = await sourceChannel.messages.fetch({ message: parsed.messageId, force: true }).catch(() => null);
		if (!message) {
			return interaction.editReply({ content: 'Could not find that message. Make sure the link is correct and the bot has access to the channel.' });
		}

		const skullReaction = message.reactions.cache.find((r) => r.emoji.name === config.skullEmoji);
		const reactionCount = skullReaction?.count ?? 1;

		try {
			await executeSkullboardPost({
message,
guild,
skullboardChannelId: config.skullboardChannelId,
skullEmoji: config.skullEmoji,
reactionCount,
skipDb: true
});
		} catch (err) {
			this.container.logger.error('Skullboard force-post pipeline failed:', err);
			return interaction.editReply({ content: 'An error occurred while posting the message. Check bot logs for details.' });
		}

		this.container.logger.info(`Skullboard force-post: Forced message ${message.id} in guild ${guildId} (by ${interaction.user.tag}).`);

		return interaction.editReply({ content: `Done! Message has been force-posted to <#${config.skullboardChannelId}>.` });
	}
}
