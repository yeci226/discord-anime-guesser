import { client } from "../index.js";
import { Events } from "discord.js";
import { Logger } from "../utils/logger.js";

client.on(Events.ClientReady, async () => {
	new Logger("系統").success(`${client.user.tag} 已經上線！`);
});
