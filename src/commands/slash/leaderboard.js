import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { QuickDB } from "quick.db";

const db = new QuickDB();

export default {
	data: new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("查看猜題排行榜"),
	async execute(client, interaction) {
		await interaction.deferReply();

		const guildId = interaction.guild.id;
		const allData = await db.all();
		const userScores = allData
			.filter(entry => entry.id.startsWith(`guild_${guildId}_user_`) && entry.id.endsWith("_score"))
			.map(entry => ({
				userId: entry.id.replace(`guild_${guildId}_user_`, "").replace("_score", ""),
				score: entry.value
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 10);

		if (userScores.length === 0) {
			await interaction.editReply("目前還沒有人猜對過喔！");
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle("🏆 猜題排行榜")
			.setColor("Gold")
			.setTimestamp();

		let description = "";
		for (let i = 0; i < userScores.length; i++) {
			const { userId, score } = userScores[i];
			let user;
			try {
				user = await client.users.fetch(userId);
			} catch (e) {
				user = { username: "Unknown User" };
			}
			
			const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
			description += `${medal} **${user.username}** - ${score} 題\n`;
		}

		embed.setDescription(description);
		await interaction.editReply({ embeds: [embed] });
	}
};
