import { client } from "../index.js";
import { Logger } from "../utils/logger.js";

client.on("error", error => {
	console.log(error);
	new Logger("系統").error(`錯誤訊息：${error.message}`);
});

client.on("warn", error => {
	console.log(error);
	new Logger("系統").warn(`警告訊息：${error.message}`);
});

process.on("unhandledRejection", error => {
	console.log(error);
	new Logger("系統").error(`錯誤訊息：${error.message}`);
});

process.on("uncaughtException", error => {
	console.log(error);
	new Logger("系統").error(`錯誤訊息：${error.message}`);
});
