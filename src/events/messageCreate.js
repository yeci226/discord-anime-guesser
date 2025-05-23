import { client } from "../index.js";
import { ChannelType, Events, EmbedBuilder } from "discord.js";
import { Logger } from "../utils/logger.js";
import { getResponse } from "../utils/getResponse.js";
import {
	getOrCreateConversation,
	saveConversation
} from "../utils/conversationManager.js";
import { getCharacter, getNewCharacter } from "../utils/game.js";
import { idToTags } from "../utils/id_tags.js";
import { QuickDB } from "quick.db";

const db = new QuickDB();
const logger = new Logger("訊息");

// 存儲每個頻道的遊戲狀態，包括提示級別
const guildGameStates = new Map();

// 遊戲初始化工具函數
async function initGameConversation({
	message,
	conversation,
	isDirectMention,
	reply
}) {
	const guildId = message.guild.id;
	const character = isDirectMention
		? await getNewCharacter(guildId)
		: await getCharacter(guildId);
	if (!character) {
		await reply.edit("⚠️ 無法獲取角色資料，請稍後再試。");
		return null;
	}
	const characterPrompt = getCharacterPrompt(character);
	guildGameStates.set(message.guild.id, {
		conversationId: conversation.conversationId,
		hintLevel: 0
	});
	conversation.messages = [];
	conversation.messages.unshift({
		role: "system",
		text: characterPrompt
	});
	conversation.character = character;
	return character;
}

// 主事件處理器
client.on(Events.MessageCreate, async message => {
	const prefix = `<@${client.user.id}>`;
	const isReply = message.reference && message.reference.messageId;
	const isDirectMention = message.content.startsWith(prefix);

	// 檢查是否需要處理此消息
	if (
		message.author.bot ||
		message.system ||
		message.channel.type === ChannelType.DM ||
		(!isDirectMention && !isReply)
	) {
		return;
	}

	// 若是回覆，檢查被回覆的消息是否是機器人的
	if (isReply) {
		try {
			const repliedMessage = await message.channel.messages.fetch(
				message.reference.messageId
			);
			if (repliedMessage.author.id !== client.user.id) return;
		} catch (err) {
			return;
		}
	}

	if (isDirectMention && message.guild) {
		const gameState = guildGameStates.get(message.guild.id);
		if (gameState && gameState.conversationId) {
			await message.reply(
				"⚠️ 本頻道已有進行中的題目，請先完成或跳過再開新題目。"
			);
			return;
		}
	}

	try {
		let prompt = isDirectMention
			? message.content.replace(prefix, "").trim()
			: message.content.trim();
		if (!prompt || prompt.length > 1000) return;

		logger.info(`接收訊息 [${message.author.username}]: ${prompt}`);
		const reply = await message.reply({
			content: "<a:Prints_dark:1373977594147508344> 正在思考..."
		});

		const skipCommands = [
			"s",
			"skip",
			"giveup",
			"跳過",
			"放棄",
			"放弃",
			"換一個",
			"换一个"
		];
		const messageObj = {
			content: prompt,
			author: { id: message.author.id }
		};
		let conversation;

		if (isDirectMention && message.guild) {
			conversation = getOrCreateConversation(message.author.id);
			const character = await initGameConversation({
				message,
				conversation,
				isDirectMention,
				reply
			});
			if (!character) return;
		} else if (isReply) {
			conversation = getOrCreateConversation(
				message.author.id,
				message.reference.messageId
			);
		} else {
			conversation = getOrCreateConversation(message.author.id);
		}

		// 非直接提及但有 guild，且未初始化角色
		if (!isDirectMention && message.guild && !conversation.character) {
			const character = await initGameConversation({
				message,
				conversation,
				isDirectMention: false,
				reply
			});
			if (!character) return;
		}

		// Track character appearance count
		if (conversation.character) {
			const characterId = conversation.character.id;
			const appearanceCount =
				(await db.get(`${characterId}_appearances`)) || 0;
			await db.set(`${characterId}_appearances`, appearanceCount + 1);
		}

		// 處理跳過命令
		if (
			skipCommands.includes(prompt.toLowerCase()) &&
			conversation.character
		) {
			const characterName =
				conversation.character.nameCn || conversation.character.name;
			const characterId = conversation.character.id;

			// 從資料庫取得猜對次數與出現次數
			const guessedCount = (await db.get(`${characterId}_guessed`)) || 0;
			const appearanceCount =
				(await db.get(`${characterId}_appearances`)) || 1;

			const correctPercentage = Math.round(
				(guessedCount / appearanceCount) * 100
			);

			await reply.edit({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setColor("Random")
						.setTitle(
							`已跳過當前題目，這個角色是：${characterName}`
						)
						.setFooter({
							text: `🎯 有 ${correctPercentage}%(${guessedCount}/${appearanceCount}) 的玩家猜對這個角色！`
						})
						.setImage(conversation.character.image || null)
				]
			});

			conversation.messages = [];
			conversation.character = null;
			guildGameStates.delete(message.guild.id);
			return;
			``;
		}

		// 處理提示請求
		if (prompt.toLowerCase() === "提示" && conversation.character) {
			await handleHintRequest(message, reply, conversation.character);
			return;
		}

		// 處理猜測
		if (
			conversation.character &&
			isCorrectGuess(prompt, conversation.character)
		) {
			const gameState = guildGameStates.get(message.guild.id);
			if (gameState && gameState.isSolved) {
				await reply.edit("⚠️ 本題已被其他玩家猜中，請等待下一題！");
				return;
			}
			if (gameState) gameState.isSolved = true;

			const characterName =
				conversation.character.nameCn || conversation.character.name;
			const characterId = conversation.character.id;
			const guessedCount = (await db.get(`${characterId}_guessed`)) || 0;
			const appearanceCount =
				(await db.get(`${characterId}_appearances`)) || 1;
			const correctPercentage = Math.round(
				(guessedCount / appearanceCount) * 100
			);

			await reply.edit({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setColor("Random")
						.setTitle(
							`已跳過當前題目，這個角色是：${characterName}`
						)
						.setFooter({
							text: `🎯 有 ${correctPercentage}%(${guessedCount}/${appearanceCount}) 的玩家猜對這個角色！`
						})
						.setImage(conversation.character.image || null)
				]
			});
			conversation.messages = [];
			conversation.character = null;
			guildGameStates.delete(message.guild.id);
			logger.info(
				`[${message.author.username} #${conversation.conversationId}] 成功猜中角色: ${characterName}`
			);
			return;
		}

		// 一般回應
		const response = await getResponse(messageObj, conversation);
		if (!response) {
			await reply.edit("⚠️ 無法生成回應");
			return;
		}
		saveConversation(reply.id, conversation);
		const responseWithId = `-# #${conversation.conversationId} 我扮演了一位角色。你能猜出我是誰嗎？用「回覆」來問問題或直接猜！輸入「提示」拿線索，「skip」跳過。\n${response}`;
		await reply.edit({ content: responseWithId });
	} catch (error) {
		console.log(error);
		logger.error(
			`[${message.author.username}] 處理訊息失敗: ${error.message}`
		);
		try {
			await message.reply("⚠️ 處理您的訊息時發生錯誤。請稍後再試。");
		} catch (replyError) {
			logger.error(
				`[${message.author.username}] 回覆錯誤訊息失敗: ${replyError.message}`
			);
		}
	}
});

function getCharacterPrompt(character) {
	// 過濾角色外觀標籤，只保留成功轉換為文本的標籤
	let appearanceDisplay = "";
	if (character.appearanceIds && character.appearanceIds.length > 0) {
		const validAppearances = character.appearanceIds.filter(id => {
			// 如果已經是字符串類型的標籤，則保留
			if (typeof id === "string" && !/^\d+$/.test(id)) {
				return true;
			}
			// 如果是數字或數字字符串，則檢查是否有對應的標籤
			return idToTags[id] && typeof idToTags[id] === "string";
		});

		// 如果有有效的外觀標籤，則顯示
		if (validAppearances.length > 0) {
			appearanceDisplay = `- 角色外觀：${validAppearances
				.map(id =>
					typeof id === "string" && !/^\d+$/.test(id)
						? id
						: idToTags[id]
				)
				.join("、")}\n`;
		}
	}

	const characterPrompt = `你是 ${character.name}${character.nameCn ? `（${character.nameCn}）` : ""}，但不能直接說出你的名字，也不能太過於直白。請根據以下提示回答使用者問題：

- 出現在作品：${character.appearances.join("、")}
- 角色簡介：${character.summary.slice(0, 500)}...
${appearanceDisplay}- 相關標籤：${character.rawTags ? [...character.rawTags.keys()].join("、") : "無標籤"}
- 聲優：${character.animeVAs.join("、")}
- 出現年份：${character.earliestAppearance} - ${character.latestAppearance}

請使用角色語氣回答，不能洩露你的名字，直到使用者猜中。並且使用繁體中文回答。`;

	return characterPrompt;
}

// 處理提示請求
async function handleHintRequest(message, reply, character) {
	const guildId = message.guild.id;
	let gameState = guildGameStates.get(guildId) || { hintLevel: 0 };
	gameState.hintLevel = Math.min(gameState.hintLevel + 1, 5);
	guildGameStates.set(guildId, gameState);

	let hintMessage = "🔍 **角色提示**\n\n";

	// 工具：隨機取n個元素
	function pickRandom(arr, n) {
		if (!Array.isArray(arr) || arr.length === 0) return [];
		const shuffled = arr.slice().sort(() => 0.5 - Math.random());
		return shuffled.slice(0, Math.min(n, arr.length));
	}

	switch (gameState.hintLevel) {
		case 1:
			// 第一級提示：隨機選一個年份或作品
			if (
				character.appearances &&
				character.appearances.length > 0 &&
				Math.random() < 0.5
			) {
				const work = pickRandom(character.appearances, 1)[0];
				hintMessage += `- 我出現在作品：${work}\n`;
			} else {
				hintMessage += `- 我出現的年份是：${character.earliestAppearance} - ${character.latestAppearance}\n`;
			}
			break;
		case 2:
			// 第二級提示：隨機外觀特徵
			if (character.appearanceIds && character.appearanceIds.length > 0) {
				const validAppearances = character.appearanceIds
					.map(id =>
						typeof id === "string" && !/^\d+$/.test(id)
							? id
							: idToTags[id] && Array.isArray(idToTags[id])
								? idToTags[id][0]
								: idToTags[id]
					)
					.filter(tag => tag && tag.length > 0);
				const randomAppearances = pickRandom(
					validAppearances,
					2 + Math.floor(Math.random() * 2)
				);
				if (randomAppearances.length > 0) {
					hintMessage += `- 我的外觀特徵包括：${randomAppearances.join("、")}\n`;
				}
			}
			break;
		case 3:
			// 第三級提示：性別或標籤
			if (character.gender && Math.random() < 0.5) {
				hintMessage += `- 我的性別是 ${character.gender}\n`;
			} else if (character.rawTags && character.rawTags.size > 0) {
				const tags = [...character.rawTags.keys()];
				const randomTags = pickRandom(
					tags,
					2 + Math.floor(Math.random() * 2)
				);
				hintMessage += `- 與我相關的標籤有：${randomTags.join("、")}\n`;
			}
			break;
		case 4:
			// 第四級提示：標籤或聲優
			if (
				character.rawTags &&
				character.rawTags.size > 0 &&
				Math.random() < 0.5
			) {
				const tags = [...character.rawTags.keys()];
				const randomTags = pickRandom(
					tags,
					2 + Math.floor(Math.random() * 2)
				);
				hintMessage += `- 與我相關的標籤有：${randomTags.join("、")}\n`;
			} else if (character.animeVAs && character.animeVAs.length > 0) {
				const vas = pickRandom(
					character.animeVAs,
					1 + Math.floor(Math.random() * 2)
				);
				hintMessage += `- 我的聲優有：${vas.join("、")}\n`;
			}
			break;
		case 5:
			// 第五級提示：聲優或名字首字
			if (
				character.animeVAs &&
				character.animeVAs.length > 0 &&
				Math.random() < 0.7
			) {
				const vas = pickRandom(
					character.animeVAs,
					1 + Math.floor(Math.random() * 2)
				);
				hintMessage += `- 我的聲優有：${vas.join("、")}\n`;
			}
			// 額外加一個名字首字
			hintMessage += `- 我的名字第一個字是：${(character.nameCn || character.name).charAt(0)}\n`;
			break;
		default:
			// 超過五級提示，提供更明確的線索
			hintMessage += `- 我的名字第一個字是：${(character.nameCn || character.name).charAt(0)}\n`;
			if (character.summary) {
				const briefSummary = character.summary.substring(0, 100);
				hintMessage += `- 我的簡介開頭：${briefSummary}...\n`;
			}
	}

	hintMessage += "\n還想要更多提示嗎？再次輸入「提示」獲取更多線索。";

	await reply.edit(hintMessage);
}

function normalizeText(text) {
	if (!text) return "";
	return text
		.toLowerCase()
		.replace(/[\s·・\u3000]+/g, "") // 去除各種空白符號
		.replace(/[?？!！,，.。:：;；(（)）\[\]「」『』""'']+/g, "") // 去除標點符號
		.replace(/の|之|的|[&＆]/g, "") // 去除常見的連接詞（注意这里添加了/g标志）
		.trim();
}

function isCorrectGuess(messageText, character) {
	// 先將輸入文本轉換為小寫並清理
	const userInput = normalizeText(messageText);

	// 優先處理"你是XX"的情況
	const youArePattern =
		/^(你是|你就是|猜你是|你應該是|你应该是|你可能是|你会是|你不是|你會是|是不是).+/i;
	if (youArePattern.test(messageText)) {
		// 從"你是XX"中提取名字部分
		const nameOnly = messageText.replace(
			/^(你是|你就是|猜你是|你應該是|你应该是|你可能是|你会是|你不是|你會是|是不是)\s*/i,
			""
		);

		// 標準化提取的名字
		const normalizedNameOnly = normalizeText(nameOnly);

		// 創建角色名稱變體
		const names = [
			character.name,
			character.nameCn,
			...(character.aliases || [])
		].filter(Boolean);

		// 標準化角色名稱
		const normalizedNames = names.map(name => normalizeText(name));

		// 檢查提取的名字是否匹配角色名稱
		for (const name of normalizedNames) {
			// 完全匹配或包含（要求名稱長度>1，避免單字符誤判）
			if (
				name.length > 1 &&
				(normalizedNameOnly === name ||
					normalizedNameOnly.includes(name))
			) {
				return true;
			}
		}
	}

	// 準備所有可能的角色名稱形式（包括變體）
	const names = [
		character.name,
		character.nameCn,
		...(character.aliases || [])
	].filter(Boolean); // 避免 undefined

	// 為日文/中文名稱創建更多變體，以提高匹配機會
	const nameVariants = new Set();
	names.forEach(name => {
		if (name) {
			nameVariants.add(name);
			// 添加去除空格的變體
			nameVariants.add(name.replace(/\s+/g, ""));
			// 添加小寫變體
			nameVariants.add(name.toLowerCase());

			// 對於中文/日文名字，嘗試拆分後面的部分（如"小木曾雪菜"拆分為"雪菜"）
			if (/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/.test(name)) {
				if (name.length >= 2) {
					// 取名字的最後2-3個字作為可能的暱稱
					nameVariants.add(name.slice(-2));
					if (name.length >= 3) {
						nameVariants.add(name.slice(-3));
					}

					// 對帶有分隔符的中文名稱進行拆分
					const chineseParts = name.split(/[·・\.\s]/);
					if (chineseParts.length > 1) {
						// 添加第一部分作為可能的名稱（通常是名字主要部分）
						if (chineseParts[0].length > 1) {
							nameVariants.add(chineseParts[0]);
						}

						// 对于格式如"洛琪希·米格路迪亚·格雷拉特"，提取"洛琪希"部分
						const firstPartMatch = name.match(/^([^·・\.\s]+)/);
						if (firstPartMatch && firstPartMatch[1].length > 1) {
							nameVariants.add(firstPartMatch[1]);
						}
					}
				}
			}

			// 處理複合名稱中的單獨部分
			const nameParts = name.split(/[\s·・\u3000\.-]+/);
			nameParts.forEach(part => {
				if (part.length > 1) {
					nameVariants.add(part);
					nameVariants.add(part.toLowerCase());
				}
			});
		}
	});

	// 轉換回數組並標準化所有名稱
	const normalizedNames = [...nameVariants].map(name => normalizeText(name));

	// 檢查用戶輸入是否完全匹配任何名稱
	for (const name of normalizedNames) {
		if (userInput === name) {
			return true;
		}
	}

	// 檢查用戶輸入是否以名稱開頭或結尾
	for (const name of normalizedNames) {
		if (name.length <= 1) continue; // 跳過單字符名稱，避免誤判

		if (userInput.startsWith(name)) {
			return true;
		}

		if (userInput.endsWith(name)) {
			return true;
		}
	}

	// 檢查輸入中是否包含完整的名稱
	for (const name of normalizedNames) {
		if (name.length <= 1) continue; // 跳過單字符名稱，避免誤判

		if (userInput.includes(name)) {
			return true;
		}
	}

	// 檢查是否包含猜測關鍵詞
	const guessKeywords = [
		"我猜",
		"猜你",
		"猜是",
		"guess",
		"你是",
		"应该是",
		"是不是",
		"是否",
		"应该",
		"可能",
		"難道",
		"难道",
		"大概",
		"估計",
		"估计"
	];

	let hasGuessKeyword = false;
	for (const keyword of guessKeywords) {
		if (userInput.includes(normalizeText(keyword))) {
			hasGuessKeyword = true;
			break;
		}
	}

	// 如果包含猜測關鍵詞，使用更寬鬆的匹配條件
	if (hasGuessKeyword) {
		// 首先嘗試直接匹配名稱
		for (const name of normalizedNames) {
			if (name.length <= 1) continue;
			if (userInput.includes(name)) {
				return true;
			}
		}

		// 檢查是否包含名稱的大部分（50%以上的字符）
		for (const name of normalizedNames) {
			if (name.length <= 1) continue; // 避免匹配單個字符

			// 計算名稱中包含在用戶輸入中的字符數量
			let matchedChars = 0;
			for (let char of name) {
				if (userInput.includes(char)) matchedChars++;
			}

			// 如果匹配了超過一半的字符，視為部分匹配
			const matchRatio = matchedChars / name.length;
			if (matchRatio > 0.5) {
				return true;
			}
		}
	}

	return false;
}
