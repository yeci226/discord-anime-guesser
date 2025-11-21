import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { QuickDB } from "quick.db";

const db = new QuickDB();

export default {
	data: new SlashCommandBuilder()
		.setName("stats")
		.setDescription("查看個人猜題數據")
		.addUserOption(option => 
			option.setName("user")
				.setDescription("要查看的用戶 (預設為自己)")
				.setRequired(false)
		),
	async execute(client, interaction) {
		await interaction.deferReply();

		const targetUser = interaction.options.getUser("user") || interaction.user;
		const guildId = interaction.guild.id;
		const score = (await db.get(`guild_${guildId}_user_${targetUser.id}_score`)) || 0;
		const games = (await db.get(`guild_${guildId}_user_${targetUser.id}_games`)) || 0;

		// Currently we only track wins via _score. 
		// If we want accuracy, we need to track total attempts/games.
		// I added `user_${message.author.id}_games` in messageCreate.js as well just now.

		const embed = new EmbedBuilder()
			.setTitle(`📊 ${targetUser.username} 的數據`)
			.setColor("Blue")
			.setThumbnail(targetUser.displayAvatarURL())
			.addFields(
				{ name: "猜對次數", value: `${score}`, inline: true },
				// { name: "參與次數", value: `${games}`, inline: true } // Optional if we track it
			)
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	}
};
