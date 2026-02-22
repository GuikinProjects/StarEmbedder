import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Per-guild configuration for the skullboard feature.
 */
export const guildConfigs = sqliteTable('guild_configs', {
	guildId: text('guild_id').primaryKey(),
	skullboardChannelId: text('skullboard_channel_id'),
	skullThreshold: integer('skull_threshold').notNull().default(3),
	skullEmoji: text('skull_emoji').notNull().default('💀'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

/**
 * Tracks every message that has been posted to a skullboard so we never
 * duplicate entries and can update the reaction count over time.
 */
export const skulledMessages = sqliteTable(
	'skulled_messages',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		guildId: text('guild_id').notNull(),
		/** Snowflake of the original user message that received skull reactions. */
		originalMessageId: text('original_message_id').notNull(),
		originalChannelId: text('original_channel_id').notNull(),
		/** Snowflake of the bot's repost in the skullboard channel (null until posted). */
		skullboardMessageId: text('skullboard_message_id'),
		reactionCount: integer('reaction_count').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [uniqueIndex('skulled_messages_guild_msg_idx').on(t.guildId, t.originalMessageId)]
);

/**
 * Channels or categories that are excluded from skullboard tracking in a guild.
 */
export const blacklistedEntries = sqliteTable(
	'blacklisted_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		guildId: text('guild_id').notNull(),
		/** Discord snowflake of the channel or category. */
		entryId: text('entry_id').notNull(),
		type: text('type', { enum: ['channel', 'category'] }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [uniqueIndex('blacklisted_entries_guild_entry_idx').on(t.guildId, t.entryId)]
);
