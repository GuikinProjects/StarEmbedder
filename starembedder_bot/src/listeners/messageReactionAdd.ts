import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { eq } from 'drizzle-orm';
import { blacklistedEntries, guildConfigs, skulledMessages } from '../lib/db/schema';
import { executeSkullboardPost } from '../lib/skullboard/postMessage';


@ApplyOptions<Listener.Options>({ name: Events.MessageReactionAdd })
export class MessageReactionAddListener extends Listener {
	/** In-memory lock: prevents duplicate posts from concurrent reactions on the same message. */
	private readonly processing = new Set<string>();

	public override async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				this.container.logger.error('Something went wrong when fetching the reaction:', error);
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

		const blacklistedIds = new Set(rawBlacklist.map((e) => e.entryId));
		const msgChannel = reaction.message.channel;
		const categoryId = 'parentId' in msgChannel ? msgChannel.parentId : null;
		const isBlacklisted = blacklistedIds.has(reaction.message.channelId) || (categoryId != null && blacklistedIds.has(categoryId));
		if (isBlacklisted) return;

		const existingSkull = db.select().from(skulledMessages).where(eq(skulledMessages.originalMessageId, reaction.message.id)).get();

		if (existingSkull) {
			this.container.logger.info(
				`Skullboard: Message ${reaction.message.id} already posted as ${existingSkull.skullboardMessageId}, skipping.`
			);
			return;
		}

		if (reaction.emoji.name !== config.skullEmoji) return;
		if ((reaction.count ?? 0) < config.skullThreshold) {
			this.container.logger.info(
				`Skullboard: Message ${reaction.message.id} has ${reaction.count} reactions, below threshold of ${config.skullThreshold}, skipping.`
			);
			return;
		}

		// Lock against concurrent reactions on the same message
		const lockKey = `${guildId}:${reaction.message.id}`;
		if (this.processing.has(lockKey)) {
			this.container.logger.info(`Skullboard: Message ${reaction.message.id} already processing, skipping.`);
			return;
		}
		this.processing.add(lockKey);

		try {
			// Always force-fetch to get fresh CDN URLs (cached messages may have expired attachment URLs).
			const message = await reaction.message.fetch(true);
			const guild = message.guild!;

			await executeSkullboardPost({
				message,
				guild,
				skullboardChannelId: config.skullboardChannelId,
				skullEmoji: config.skullEmoji,
				reactionCount: reaction.count ?? 0
			});
		} catch (err) {
			this.container.logger.error('Skullboard pipeline failed:', err);
		} finally {
			this.processing.delete(lockKey);
		}
	}
}


