import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { ContainerBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { buildErrorComponents } from '../../../lib/skullboard/displayConfig';

@ApplyOptions<Command.Options>({
	name: 'ping',
	description: 'Skullboard Module Latency Command'
})
@RegisterSubCommand('skullboard', (builder) => builder.setName('ping').setDescription('Skullboard Module Latency Command'))
export class SkullboardPingCommand extends Command {
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents('This command can only be used inside a server.')
			});
		}

		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.reply({
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: buildErrorComponents('You need the **Manage Server** permission to use this command.')
			});
		}

		const { resource } = await interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: this.buildComponents('...', '...'),
			withResponse: true
		});

		const botLatency = Math.round(this.container.client.ws.ping);
		const apiLatency = resource!.message!.createdTimestamp - interaction.createdTimestamp;

		return interaction.editReply({
			components: this.buildComponents(`${botLatency}ms`, `${apiLatency}ms`)
		});
	}

	private buildComponents(botLatency: string, apiLatency: string) {
		return [
			new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Pong 🏓'))
				.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`> ### Bot Latency\n\`\`\`${botLatency}\`\`\`\n\n> ### API Latency\n\`\`\`${apiLatency}\`\`\``
					)
				)
				.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Latency from the Skullboard Modular Bot'))
		];
	}
}
