// Unless explicitly defined, set NODE_ENV as development:
process.env.NODE_ENV ??= 'development';

import { ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework';
import '@kaname-png/plugin-subcommands-advanced/register';
import '@sapphire/plugin-logger/register';
import '@sapphire/plugin-subcommands/register';
import { container } from '@sapphire/pieces';
import { setup, type ArrayString } from '@skyra/env-utilities';
import * as colorette from 'colorette';
import { join } from 'path';
import { inspect } from 'util';
import { srcDir } from './constants';
import './db/augment';
import { db } from './db/index';

// Set default behavior to bulk overwrite
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.Overwrite);

// Read env var
setup({ path: join(srcDir, '.env') });

// Set default inspection depth
inspect.defaultOptions.depth = 1;

// Enable colorette
colorette.createColors({ useColor: true });

// Attach the database instance to Sapphire's container so every command,
// listener, and precondition can access it via `this.container.db`.
container.db = db;

declare module '@skyra/env-utilities' {
	interface Env {
		OWNERS: ArrayString;
		/** Absolute path to the SQLite database file. Defaults to <cwd>/data/skullboard.db. */
		DATABASE_PATH: string;
	}
}
