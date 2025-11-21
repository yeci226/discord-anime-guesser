import { QuickDB } from "quick.db";

const db = new QuickDB();
const gameTable = db.table("guild_game_states");

export const GameState = {
	async get(guildId) {
		return await gameTable.get(guildId);
	},

	async set(guildId, state) {
		await gameTable.set(guildId, state);
	},

	async delete(guildId) {
		await gameTable.delete(guildId);
	},

	async update(guildId, updates) {
		const currentState = (await this.get(guildId)) || {};
		await this.set(guildId, { ...currentState, ...updates });
	}
};
