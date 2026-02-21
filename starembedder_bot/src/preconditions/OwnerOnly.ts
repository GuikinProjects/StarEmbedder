import { Precondition } from '@sapphire/framework';
import { envParseArray } from '@skyra/env-utilities';
import type { CommandInteraction, ContextMenuCommandInteraction, Snowflake } from 'discord.js';

const OWNERS = envParseArray('OWNERS');

export class UserPrecondition extends Precondition {
	#message = 'This command can only be used by the owner.';

	public override chatInputRun(interaction: CommandInteraction) {
		return this.doOwnerCheck(interaction.user.id);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
		return this.doOwnerCheck(interaction.user.id);
	}

	private doOwnerCheck(userId: Snowflake) {
		return OWNERS.includes(userId) ? this.ok() : this.error({ message: this.#message });
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		OwnerOnly: never;
	}
}
