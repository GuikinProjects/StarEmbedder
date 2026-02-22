import { defineConfig } from 'drizzle-kit';
import { join } from 'node:path';

const dbPath = process.env.DATABASE_PATH ?? join(process.cwd(), 'src', 'lib', 'db', 'data', 'skullboard.db');

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/db/schema.ts',
	out: './src/lib/db/migrations',
	dbCredentials: {
		url: dbPath
	}
});