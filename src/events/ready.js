import { Events } from "discord.js";
import { Logger } from "../utils/logger.js";

export default {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		new Logger("系統").success(`${client.user.tag} 已經上線！`);
	},
};
