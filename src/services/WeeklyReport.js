import { EmbedBuilder } from "discord.js";
import db from "quick.db";
import cron from "node-cron";
import { Logger } from "../utils/logger.js";

export class WeeklyReport {
	constructor(client) {
		this.client = client;
		this.logger = new Logger("WeeklyReport");
	}

	start() {
		// Schedule to run every Monday at 00:00
		// Cron format: Minute Hour DayOfMonth Month DayOfWeek
		cron.schedule("0 0 * * 1", async () => {
			this.logger.info("Starting weekly report generation...");
			await this.generateAndSendReports();
		});
		this.logger.info("Weekly report scheduler started (Every Monday at 00:00)");
	}

	async generateAndSendReports() {
		const allData = await db.all();
		
		// Group data by guild
		const guilds = new Set();
		allData.forEach(entry => {
			if (entry.id.startsWith("guild_")) {
				const parts = entry.id.split("_");
				if (parts.length > 1) {
					guilds.add(parts[1]);
				}
			}
		});

		for (const guildId of guilds) {
			try {
				await this.processGuild(guildId);
			} catch (error) {
				this.logger.error(`Failed to process weekly report for guild ${guildId}: ${error.message}`);
			}
		}
	}

	async processGuild(guildId) {
		const guild = this.client.guilds.cache.get(guildId);
		if (!guild) return;

		// Find most used channel
		const channelUsage = await this.getMostUsedChannel(guildId);
		if (!channelUsage) {
			this.logger.info(`No channel usage data for guild ${guildId}, skipping report.`);
			return;
		}

		const channel = guild.channels.cache.get(channelUsage.channelId);
		if (!channel) {
			this.logger.warn(`Target channel ${channelUsage.channelId} not found in guild ${guildId}`);
			return;
		}

		// Get top users for the week
		const topUsers = await this.getWeeklyTopUsers(guildId);
		if (topUsers.length === 0) {
			this.logger.info(`No weekly scores for guild ${guildId}, skipping report.`);
			return;
		}

		// Create Embed
		const embed = new EmbedBuilder()
			.setTitle("📅 上週猜謎週報")
			.setColor("Gold")
			.setDescription("新的一週開始了！來看看上週誰是猜謎王吧！")
			.setTimestamp();

		let description = "";
		topUsers.forEach((user, index) => {
			const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;
			description += `${medal} <@${user.userId}> - **${user.score}** 分\n`;
		});

		embed.addFields({ name: "🏆 排行榜", value: description });

		await channel.send({ embeds: [embed] });
		this.logger.info(`Sent weekly report to guild ${guild.name} in channel ${channel.name}`);

		// Reset weekly scores
		await this.resetWeeklyScores(guildId);
	}

	async getMostUsedChannel(guildId) {
		const allData = await db.all();
		const channels = allData
			.filter(entry => entry.id.startsWith(`guild_${guildId}_channel_`) && entry.id.endsWith("_usage"))
			.map(entry => ({
				channelId: entry.id.replace(`guild_${guildId}_channel_`, "").replace("_usage", ""),
				usage: entry.value
			}))
			.sort((a, b) => b.usage - a.usage);

		return channels.length > 0 ? channels[0] : null;
	}

	async getWeeklyTopUsers(guildId) {
		const allData = await db.all();
		return allData
			.filter(entry => entry.id.startsWith(`guild_${guildId}_user_`) && entry.id.endsWith("_weekly_score"))
			.map(entry => ({
				userId: entry.id.replace(`guild_${guildId}_user_`, "").replace("_weekly_score", ""),
				score: entry.value
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 10);
	}

	async resetWeeklyScores(guildId) {
		const allData = await db.all();
		const keysToDelete = allData
			.filter(entry => entry.id.startsWith(`guild_${guildId}_user_`) && entry.id.endsWith("_weekly_score"))
			.map(entry => entry.id);

		for (const key of keysToDelete) {
			await db.delete(key);
		}
	}
}
