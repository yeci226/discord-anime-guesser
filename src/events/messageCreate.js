import { client } from "../index.js";
import {
	ChannelType,
	Events,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} from "discord.js";
import { Logger } from "../utils/logger.js";
import { getResponse } from "../utils/getResponse.js";
import {
	getOrCreateConversation,
	saveConversation
} from "../utils/conversationManager.js";
import { getCharacter, getNewCharacter } from "../utils/game.js";
import { idToTags } from "../utils/id_tags.js";

const logger = new Logger("訊息");

// 存儲每個頻道的遊戲狀態，包括提示級別
const channelGameStates = new Map();

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

	try {
		// 獲取提示內容
		let prompt;
		if (isDirectMention) {
			prompt = message.content.replace(prefix, "").trim();
		} else {
			prompt = message.content.trim();
		}

		if (!prompt || prompt.length > 1000) return;

		logger.info(`接收訊息 [${message.author.username}]: ${prompt}`);

		const reply = await message.reply({
			content: "<a:Prints_dark:1373977594147508344> 正在思考..."
		});

		// 創建一個符合 getResponse 所需的消息對象
		const messageObj = {
			content: prompt,
			author: {
				id: message.author.id
			}
		};

		// 獲取或創建對話
		let conversation;

		// 如果是直接提及並要求開始遊戲，則創建新遊戲（僅在沒有進行中的遊戲時）
		if (isDirectMention && message.guild) {
			// 創建新對話
			conversation = getOrCreateConversation(message.author.id);
			channelGameStates.set(message.channel.id, {
				conversationId: conversation.conversationId,
				hintLevel: 0
			});

			const guildId = message.guild.id;
			const character = await getNewCharacter(guildId);
			if (!character) {
				return await reply.edit("⚠️ 無法獲取角色資料，請稍後再試。");
			}

			// 構建角色扮演的系統提示
			const characterPrompt = getCharacterPrompt(character);

			// 設置遊戲模式
			conversation.messages = [];
			conversation.messages.unshift({
				role: "system",
				text: characterPrompt
			});
			conversation.character = character;
		} else if (isReply) {
			// 如果是回覆，嘗試繼續同一個對話
			conversation = getOrCreateConversation(
				message.author.id,
				message.reference.messageId
			);
		} else {
			// 如果是新消息且不是開始遊戲命令，創建新的普通對話
			conversation = getOrCreateConversation(message.author.id);
		}

		// 處理新的遊戲開始（非直接提及的情況）
		if (!isDirectMention && message.guild) {
			const guildId = message.guild.id;
			const character = await getCharacter(guildId);
			if (!character) {
				return await reply.edit("⚠️ 無法獲取角色資料，請稍後再試。");
			}

			// 構建角色扮演的系統提示
			const characterPrompt = getCharacterPrompt(character);
			channelGameStates.set(message.channel.id, {
				conversationId: conversation.conversationId,
				hintLevel: 0
			});

			// 設置遊戲模式
			conversation.messages = [];
			conversation.messages.unshift({
				role: "system",
				text: characterPrompt
			});
			conversation.character = character;
		}

		// 檢查是否是提示請求
		if (prompt.toLowerCase() === "提示" && conversation.character) {
			await handleHintRequest(message, reply, conversation.character);
			return; // 處理完提示請求後直接返回
		}

		// 檢查是否為猜測 - 移到這裡，确保在常规处理之前检查
		if (conversation.character) {
			if (isCorrectGuess(prompt, conversation.character)) {
				const characterName =
					conversation.character.nameCn ||
					conversation.character.name;
				await reply.edit({
					content: "",
					embeds: [
						new EmbedBuilder()
							.setColor("Random")
							.setTitle(
								`🎉 恭喜你猜對了！我是 ${characterName}！`
							)
							.setImage(conversation.character.image || null)
					]
				});

				// 清理遊戲狀態
				conversation.messages = [];
				conversation.character = null;

				// 清理該頻道的提示狀態
				channelGameStates.delete(message.channel.id);

				// 記錄成功猜測
				logger.info(
					`[${message.author.username} #${conversation.conversationId}] 成功猜中角色: ${characterName}`
				);

				return; // 🛑 結束後不再呼叫 Gemini
			}
		}

		// 獲取回應
		const response = await getResponse(messageObj, conversation);
		if (!response) {
			return await reply.edit("⚠️ 無法生成回應");
		}

		// 保存對話
		saveConversation(reply.id, conversation);

		const responseWithId = `-# #${conversation.conversationId} | 我現在正在扮演一位角色，猜猜我是誰？你可以透過使用「回覆」向我提問和猜測，但我不會直接告訴你我的名字，也可以輸入「提示」獲取提示\n${response}`;

		await reply.edit({
			content: responseWithId
		});
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
	const channelId = message.channel.id;
	let gameState = channelGameStates.get(channelId) || { hintLevel: 0 };
	gameState.hintLevel = Math.min(gameState.hintLevel + 1, 4);
	channelGameStates.set(channelId, gameState);

	let hintMessage = "🔍 **角色提示**\n\n";

	switch (gameState.hintLevel) {
		case 1:
			// 第一級提示：提供出現年份
			hintMessage += `- 我出現的年份是：${character.earliestAppearance} - ${character.latestAppearance}\n`;
			break;
		case 2:
			// 第二級提示：提供聲優
			hintMessage += `- 我的聲優是：${character.animeVAs.join("、")}\n`;
			break;
		case 3:
			// 第三級提示：提供外觀特徵和作品名的一部分
			if (character.appearanceIds && character.appearanceIds.length > 0) {
				const validAppearances = character.appearanceIds
					.filter(id => {
						// 检查是否为字符串类型的标签
						if (typeof id === "string" && !/^\d+$/.test(id))
							return true;

						// 检查是否存在对应的标签数组
						return (
							idToTags[id] &&
							Array.isArray(idToTags[id]) &&
							idToTags[id].length > 0
						);
					})
					.map(id => {
						// 如果是字符串直接返回
						if (typeof id === "string" && !/^\d+$/.test(id))
							return id;

						// 从标签数组中返回第一个标签
						return idToTags[id] && Array.isArray(idToTags[id])
							? idToTags[id][0]
							: "";
					})
					.filter(tag => tag && tag.length > 0); // 过滤掉空标签

				if (validAppearances.length > 0) {
					hintMessage += `- 我的外觀特徵包括：${validAppearances.slice(0, 3).join("、")}\n`;
				}
			}
			break;
		case 4: // 第四級提示：提供標籤
			if (character.rawTags && character.rawTags.size > 0) {
				const tags = [...character.rawTags.keys()];
				const randomTags = tags
					.sort(() => 0.5 - Math.random())
					.slice(0, Math.min(3, tags.length));
				hintMessage += `- 與我相關的標籤有：${randomTags.join("、")}\n`;
			}
		default:
			// 超過三級提示，提供更明確的線索
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
