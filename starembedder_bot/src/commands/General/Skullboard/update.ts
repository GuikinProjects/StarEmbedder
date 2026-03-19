import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { eq } from 'drizzle-orm';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { guildConfigs } from '../../../lib/db/schema';
import { updateSkullboardPost } from '../../../lib/skullboard/postMessage';

/** Parse a Discord message link into its component IDs. Returns null if invalid. */
function parseMessageLink(link: string): { guildId: string; channelId: string; messageId: string } | null {
  const match = link.match(/^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

@ApplyOptions<Command.Options>({
  name: 'update',
  description: 'Re-render and update an existing skullboard post in place'
})
@RegisterSubCommand('skullboard', (builder) =>
  builder
    .setName('update')
    .setDescription('Re-render and update an existing skullboard post in place')
    .addStringOption((option) =>
      option
        .setName('message-link')
        .setDescription('Link to the original message or the skullboard post')
        .setRequired(true)
    )
)
export class SkullboardUpdateCommand extends Command {
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
    const config = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, interaction.guildId)).get();

    if (!config || !config.skullboardChannelId) {
      return interaction.editReply({ content: 'Skullboard is not configured for this server. Use `/skullboard config-edit` first.' });
    }

    try {
      const result = await updateSkullboardPost({
        messageId: parsed.messageId,
        guild: interaction.guild,
        skullboardChannelId: config.skullboardChannelId,
        skullEmoji: config.skullEmoji
      });

      if (result.status === 'not_found') {
        return interaction.editReply({
          content: 'No skullboard entry found for that message. Use `/skullboard force-post` to create one.'
        });
      }

      if (result.status === 'skullboard_deleted') {
        return interaction.editReply({
          content: 'The skullboard post for that message has been deleted. Use `/skullboard force-post` to re-create it.'
        });
      }

      return interaction.editReply({
        content: `Done! The skullboard post has been updated: https://discord.com/channels/${interaction.guildId}/${config.skullboardChannelId}/${result.skullboardMessageId}`
      });
    } catch (err) {
      this.container.logger.error('Skullboard update pipeline failed:', err);
      return interaction.editReply({ content: 'An error occurred while updating the post. Check bot logs for details.' });
    }
  }
}
