import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterSubCommand } from '@kaname-png/plugin-subcommands-advanced';
import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'ping',
	description: 'Skullboard Module Latency Command'
})
@RegisterSubCommand('skullboard', (builder) => builder.setName('ping').setDescription('Skullboard Module Latency Command'))
export class SkullboardPingCommand extends Command {
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
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
