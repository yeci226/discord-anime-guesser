import { client } from "../index.js";
import { ApplicationCommandOptionType, Events, ChannelType } from "discord.js";
import { Logger } from "../utils/logger.js";

// Handle slash commands
async function handleSlashCommand(interaction) {
	const command = client.commands.slash.get(interaction.commandName);
	if (!command) {
		return interaction.followUp({
			content: "An error has occurred",
			ephemeral: true
		});
	}

	const args = interaction.options.data.reduce((acc, option) => {
		if (option.type === ApplicationCommandOptionType.Subcommand) {
			if (option.name) acc.push(option.name);
			option.options?.forEach(x => {
				if (x.value) acc.push(x.value);
			});
		} else if (option.value) {
			acc.push(option.value);
		}
		return acc;
	}, []);

	try {
		await command.execute(client, interaction, args);
		logCommandExecution(interaction, command);
	} catch (error) {
		console.error("Command execution error:", error);
		new Logger("指令").error(`錯誤訊息：${error.message}`);

		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({
				content: "哦喲，好像出了一點小問題，請重試",
				ephemeral: true
			});
		}
	}
}

// Log command execution
function logCommandExecution(interaction, command) {
	const executionTime = (
		(Date.now() - interaction.createdTimestamp) /
		1000
	).toFixed(2);
	const timeString = `花費 ${executionTime} 秒`;

	new Logger("指令").command(
		`${interaction.user.displayName}(${interaction.user.id}) 執行 ${command.data.name} - ${timeString}`
	);
}

// Main interaction handler
client.on(Events.InteractionCreate, async interaction => {
	if (interaction.channel.type === ChannelType.DM) return;

	try {
		if (interaction.isAutocomplete()) {
			await handleAutocomplete(interaction);
		} else if (interaction.isButton()) {
			await interaction.deferUpdate().catch(() => {});
		} else if (interaction.isCommand()) {
			await handleSlashCommand(interaction);
		} else if (interaction.isContextMenuCommand()) {
			const command = client.commands.slash.get(interaction.commandName);
			if (command) {
				await command.execute(client, interaction);
			}
		}
	} catch (error) {
		console.error("Interaction handling error:", error);
	}
});
