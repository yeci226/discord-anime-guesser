import { glob } from "glob";
import { pathToFileURL } from "url";
import { ApplicationCommandType } from "discord.js";
import { Logger } from "../utils/logger.js";

export class Loader {
	constructor(client) {
		this.client = client;
	}
	async load() {
		const events = await glob(`${process.cwd().replace(/\\/g, "/")}/src/events/*.js`);
		for (let dir of events) {
			await import(pathToFileURL(dir).href);
		}

		const slashs = await glob(`${process.cwd().replace(/\\/g, "/")}/src/commands/**/*.js`);

		const slashArr = [];
		for (let dir of slashs) {
			const file = (await import(`file://${dir}`))?.default;
			if ("data" in file && "execute" in file) {
				this.client.commands.slash.set(file.data.name, file);
			} else {
				new Logger("系統").error(
					`${dir} 處的指令缺少必要的「資料」或「執行」屬性`
				);
			}
			this.client.commands.slash.set(file.name, file);

			if (
				[
					ApplicationCommandType.Message,
					ApplicationCommandType.User
				].includes(file.type)
			)
				delete file.description;
			slashArr.push(file.data);
		}

		new Logger("系統").success(
			`已載入 ${events.length} 事件、${slashArr.length} 斜線指令`
		);

		this.client.on("ready", async () => {
			await this.client.application.commands.set(slashArr);
		});
	}
}
