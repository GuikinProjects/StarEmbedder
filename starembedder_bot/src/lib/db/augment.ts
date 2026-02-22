import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema';

declare module '@sapphire/pieces' {
	interface Container {
		db: BetterSQLite3Database<typeof schema>;
	}
}
