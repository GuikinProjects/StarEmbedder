import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	Events,
	MessageReaction,
	// MessageReactionEventDetails,
	PartialMessageReaction,
	PartialUser,
	User
} from 'discord.js';
import { blacklistedEntries, guildConfigs, skulledMessages } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

@ApplyOptions<Listener.Options>({ name: Events.MessageReactionAdd })
export class MessageReactionAddListener extends Listener {
	public override async run(
		reaction: MessageReaction | PartialMessageReaction,
		user: User | PartialUser
		// details: MessageReactionEventDetails
	) {
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				this.container.logger.error('Something went wrong when fetching the message:', error);
				return;
			}
		}

		if (user.partial) {
			try {
				await user.fetch();
			} catch (error) {
				this.container.logger.error('Something went wrong when fetching the user:', error);
				return;
			}
		}

		const { db } = this.container;
		const guildId = reaction.message.guildId;

		if (!guildId) return;

		const config = db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).get();
		const rawBlacklist = db.select().from(blacklistedEntries).where(eq(blacklistedEntries.guildId, guildId)).all();

		if (!config || !config.skullboardChannelId) return;

		const isBlacklisted = rawBlacklist.some((entry) => entry.entryId === reaction.message.channelId);
		if (isBlacklisted) return;

        const existingSkull = db
            .select()
            .from(skulledMessages)
            .where(eq(skulledMessages.originalMessageId, reaction.message.id))
            .get();

        if (existingSkull) {
            this.container.logger.info(`Skullboard: Message ${reaction.message.id} in guild ${guildId} already posted to skullboard as message ${existingSkull.skullboardMessageId}, skipping.`);
            return;
        }

		if (reaction.emoji.name === config.skullEmoji) {
			const skullboardChannel =
				reaction.message.guild?.channels.cache.get(config.skullboardChannelId) ??
				(await reaction.message.guild?.channels.fetch(config.skullboardChannelId).catch(() => null));
			if (!skullboardChannel || !skullboardChannel.isTextBased() || !('send' in skullboardChannel)) return;

			if ((reaction.count ?? 0) < config.skullThreshold) {
				this.container.logger.info(`Skullboard: Message ${reaction.message.id} in guild ${guildId} has ${reaction.count} reactions, below threshold of ${config.skullThreshold}, skipping.`);
				return;
			}

			const skullboardMessage = await skullboardChannel.send({
				content: `💀 **Skullboard** 💀\n\nA message by <@${reaction.message.author?.id}> in <#${reaction.message.channelId}> has received a reaction ${config.skullEmoji} and has been posted to the skullboard!\n\n[Jump to message](${reaction.message.url})`
			});

			const dbResult = await db
				.insert(skulledMessages)
				.values({
					guildId: guildId,
					originalMessageId: reaction.message.id,
					originalChannelId: reaction.message.channelId,
					skullboardMessageId: skullboardMessage.id,
					reactionCount: reaction.count ?? undefined,
					createdAt: new Date()
				})
				.run();

			this.container.logger.info(`Skullboard: Posted message ${reaction.message.id} to skullboard channel ${config.skullboardChannelId} in guild ${guildId}. DB entry ID: ${dbResult.lastInsertRowid}`);

		}
	}
}
