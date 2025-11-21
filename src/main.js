import { client } from "./index.js";

import { Loader } from "./core/Loader.js";
import { WeeklyReport } from "./services/WeeklyReport.js";
import { Collection } from "discord.js";
import { ClusterClient } from "discord-hybrid-sharding";
import config from "./config.json" with { type: "json" };

// Global Variables
client.config = config;
client.cluster = new ClusterClient(client);
client.commands = {
	slash: new Collection(),
	message: new Collection()
};
client.loader = new Loader(client);
client.weeklyReport = new WeeklyReport(client);
await client.loader.load();
client.weeklyReport.start();

client.login(process.env.TOKEN);
