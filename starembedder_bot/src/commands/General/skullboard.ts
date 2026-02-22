import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@kaname-png/plugin-subcommands-advanced';
import { PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	description: 'Skullboard commands'
})
export class SkullboardCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) => {
			this.hooks.subcommands(this, builder);

			return builder
				.setName(this.name)
				.setDescription(this.description)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
		});
	}
}
