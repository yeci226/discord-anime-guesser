import { client } from "../index.js";
import { Events, EmbedBuilder } from "discord.js";
import { Logger } from "../utils/logger.js";
import { getResponse } from "../utils/getResponse.js";
import {
	getOrCreateConversation,
	saveConversation
} from "../utils/conversationManager.js";
import { getCharacter, getNewCharacter } from "../utils/game.js";
import { idToTags } from "../utils/id_tags.js";
import { QuickDB } from "quick.db";
import { GameState } from "../utils/gameState.js";
import { isCorrectGuess, normalizeText } from "../utils/guessUtils.js";

const db = new QuickDB();
const logger = new Logger("訊息");

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
	
	// 使用持久化狀態
	await GameState.set(guildId, {
		conversationId: conversation.conversationId,
		hintLevel: 0,
		characterId: character.id, // 儲存角色ID以便恢復
		startTime: Date.now()
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

	// 檢查是否已有進行中的遊戲 (僅限直接提及)
	if (isDirectMention && message.guild) {
		const gameState = await GameState.get(message.guild.id);
		// 如果有遊戲狀態且對話ID存在，表示有進行中的遊戲
		// 但這裡需要更嚴謹的檢查，因為 conversation 對象可能已經過期或丟失
		// 暫時保持原邏輯，但改為讀取 DB
		if (gameState && gameState.conversationId) {
			// 檢查這個 conversation 是否真的還在活躍中，或者是否應該允許覆蓋
			// 這裡簡單處理：如果用戶明確想開新局，提示他們先 skip
			await message.reply(
				"⚠️ 已有進行中的題目，請先完成或跳過再開新題目，可以透過回覆這則訊息「skip」跳過題目"
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

		// 如果 conversation 沒有 character，嘗試從 DB 恢復 (針對重啟後的情況)
		if (message.guild && !conversation.character) {
			const gameState = await GameState.get(message.guild.id);
			if (gameState && gameState.characterId) {
				// 嘗試重新獲取角色信息 (這裡簡化處理，實際上應該有一個 getCharacterById)
				// 由於 getCharacter(guildId) 會讀取 guildCache，我們需要確保 cache 也有
				// 這裡暫時依賴 getCharacter 的邏輯，如果 cache 空了它會 getNew
				// 這是一個潛在問題：重啟後 cache 空了，getCharacter 會給新角色，但 DB 說有舊角色
				// 我們應該修改 getCharacter 讓它支持從 ID 恢復，或者在這裡處理
				
				// 暫時邏輯：如果 DB 有狀態但 conversation 沒角色，視為意外中斷，
				// 為了簡單起見，我們可能需要重新初始化或嘗試恢復。
				// 由於 getCharacter(guildId) 目前是讀 cache，重啟後 cache 是空的。
				// 我們需要一個機制來"恢復"角色。
				// 為了不讓邏輯太複雜，如果 conversation 丟失了角色（重啟後），
				// 我們讓它變成一個普通的對話，或者重新開始一局。
				
				// 但為了使用者體驗，如果是非直接提及（即回覆），且沒有角色，
				// 我們檢查是否是"繼續"猜測。
				// 如果是重啟後第一次回覆，conversation 是新的，沒有 character。
				// 我們可以嘗試從 gameState.characterId 恢復角色數據。
				// 這需要一個 getCharacterById 函數，目前 bangumi.js 裡有 designateCharacter
				// 但這裡先保持簡單，如果沒有角色，就當作新對話或忽略
			}
		}

		// 非直接提及但有 guild，且未初始化角色 (自動開始新局的邏輯)
		if (!isDirectMention && message.guild && !conversation.character) {
			// 檢查是否應該自動開始？原邏輯是會自動開始
			const character = await initGameConversation({
				message,
				conversation,
				isDirectMention: false,
				reply
			});
			if (!character) return;
		}

		// 處理跳過命令
		if (
			skipCommands.some(cmd => cmd === prompt.toLowerCase()) &&
			conversation.character
		) {
			await handleSkip(message, reply, conversation);
			return;
		}

		// 處理提示請求
		if (prompt.toLowerCase() === "提示" && conversation.character) {
			await handleHintRequest(message, reply, conversation);
			return;
		}

		// 處理猜測
		if (
			conversation.character &&
			isCorrectGuess(prompt, conversation.character)
		) {
			await handleCorrectGuess(message, reply, conversation);
			return;
		}

		// 一般回應
		const response = await getResponse(messageObj, conversation);
		if (!response) {
			await reply.edit("⚠️ 無法生成回應");
			return;
		}
		saveConversation(reply.id, conversation);
		const responseWithId =
			`-# 我扮演了一位角色。你能猜出我是誰嗎？用「回覆」來問問題或直接猜！輸入「提示」拿線索，「skip」跳過。\n${response}`.slice(
				0,
				2000
			);

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

async function handleSkip(message, reply, conversation) {
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
				.setTitle(`已跳過當前題目，我是：${characterName}！`)
				.setFooter({
					text: `🎯 有 ${correctPercentage}%(${guessedCount}/${appearanceCount}) 的玩家猜對這個角色！`
				})
				.setImage(conversation.character.image || null)
		]
	});

	conversation.messages = [];
	conversation.character = null;
	await GameState.delete(message.guild.id);
}

async function handleCorrectGuess(message, reply, conversation) {
	const gameState = await GameState.get(message.guild.id);
	if (gameState && gameState.isSolved) {
		await reply.edit("⚠️ 本題已被其他玩家猜中，請等待下一題！");
		return;
	}
	
	if (gameState) {
		await GameState.update(message.guild.id, { isSolved: true });
	}

	const characterName =
		conversation.character.nameCn || conversation.character.name;
	const characterId = conversation.character.id;
	let guessedCount = (await db.get(`${characterId}_guessed`)) || 0;
	guessedCount += 1;
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
				.setTitle(`🎉 恭喜猜中！我是：${characterName}！`)
				.setFooter({
					text: `🎯 有 ${correctPercentage}%(${guessedCount}/${appearanceCount}) 的玩家猜對這個角色！`
				})
				.setImage(conversation.character.image || null)
		]
	});
	conversation.messages = [];
	conversation.character = null;
	await GameState.delete(message.guild.id);
	await db.set(`${characterId}_guessed`, guessedCount);
	await db.add(`guild_${message.guild.id}_user_${message.author.id}_score`, 1);
	await db.add(`guild_${message.guild.id}_user_${message.author.id}_weekly_score`, 1);
	await db.add(`guild_${message.guild.id}_user_${message.author.id}_games`, 1);
	await db.add(`guild_${message.guild.id}_channel_${message.channel.id}_usage`, 1);
	logger.info(
		`[${message.author.username} #${conversation.conversationId}] 成功猜中角色: ${characterName}`
	);
}

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

	const characterPrompt = `你是 ${character.name}${character.nameCn ? `（${character.nameCn}）` : ""}。
請注意：
1. **絕對不能**直接說出你的名字、聲優(CV)或任何能直接識別你身分的獨有名詞。
2. 請完全融入角色，用該角色的語氣、口癖和性格來回答。
3. 如果被問到你是誰，請用角色的方式模糊帶過，例如描述你的特徵或經歷。
4. 請使用繁體中文回答。

以下是關於你的資訊（僅供參考，不要一次全部說出來）：
- 出現在作品：${character.appearances.join("、")}
- 角色簡介：${character.summary.slice(0, 500)}...
${appearanceDisplay}- 相關標籤：${character.rawTags ? [...character.rawTags.keys()].join("、") : "無標籤"}
- 聲優：${character.animeVAs.join("、")}
- 出現年份：${character.earliestAppearance} - ${character.latestAppearance}
`;

	return characterPrompt;
}

// 處理提示請求
async function handleHintRequest(message, reply, conversation) {
	const guildId = message.guild.id;
	let gameState = (await GameState.get(guildId)) || { hintLevel: 0 };
	
	const newHintLevel = Math.min((gameState.hintLevel || 0) + 1, 5);
	await GameState.update(guildId, { hintLevel: newHintLevel });
	
	// 更新本地變量以供 switch 使用
	gameState.hintLevel = newHintLevel;

	let hintFact = "";

	// 工具：隨機取n個元素
	function pickRandom(arr, n) {
		if (!Array.isArray(arr) || arr.length === 0) return [];
		const shuffled = arr.slice().sort(() => 0.5 - Math.random());
		return shuffled.slice(0, Math.min(n, arr.length));
	}
	
	const character = conversation.character;

	switch (gameState.hintLevel) {
		case 1:
			// 第一級提示：隨機選一個年份或作品
			if (
				character.appearances &&
				character.appearances.length > 0 &&
				Math.random() < 0.5
			) {
				const work = pickRandom(character.appearances, 1)[0];
				hintFact = `我出現在作品：${work}`;
			} else {
				hintFact = `我出現的年份是：${character.earliestAppearance} - ${character.latestAppearance}`;
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
					hintFact = `我的外觀特徵包括：${randomAppearances.join("、")}`;
				}
			}
			break;
		case 3:
			// 第三級提示：性別或標籤
			if (character.gender && Math.random() < 0.5) {
				hintFact = `我的性別是 ${character.gender}`;
			} else if (character.rawTags && character.rawTags.size > 0) {
				const tags = [...character.rawTags.keys()];
				const randomTags = pickRandom(
					tags,
					2 + Math.floor(Math.random() * 2)
				);
				hintFact = `與我相關的標籤有：${randomTags.join("、")}`;
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
				hintFact = `與我相關的標籤有：${randomTags.join("、")}`;
			} else if (character.animeVAs && character.animeVAs.length > 0) {
				const vas = pickRandom(
					character.animeVAs,
					1 + Math.floor(Math.random() * 2)
				);
				hintFact = `我的聲優有：${vas.join("、")}`;
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
				hintFact = `我的聲優有：${vas.join("、")}`;
			}
			// 額外加一個名字首字
			hintFact += ` 我的名字第一個字是：${(character.nameCn || character.name).charAt(0)}`;
			break;
		default:
			// 超過五級提示，提供更明確的線索
			hintFact = `我的名字第一個字是：${(character.nameCn || character.name).charAt(0)}`;
			if (character.summary) {
				const briefSummary = character.summary.substring(0, 100);
				hintFact += ` 我的簡介開頭：${briefSummary}...`;
			}
	}
	
	if (!hintFact) {
		hintFact = "我好像想不起來什麼特別的特徵...";
	}

	const prompt = `(系統提示：使用者使用了提示功能。請用你的語氣**清楚且明確**地將以下線索告訴使用者，不要模糊帶過，但絕對不能直接說出你的名字：${hintFact})`;
	
	// 構造一個假的消息對象傳遞給 getResponse
	const fakeMessage = {
		...message,
		content: prompt,
		author: { id: message.author.id } // 保持作者ID以處理冷卻(雖然這裡是提示，可能不需要冷卻?)
	};
	
	// 為了避免提示也觸發冷卻，我們可以暫時繞過冷卻，或者就讓它冷卻
	// 這裡直接調用 getResponse，它會處理歷史記錄
	const response = await getResponse(fakeMessage, conversation);
	
	if (!response) {
		await reply.edit("⚠️ 無法生成提示");
		return;
	}
	
	// 保存對話歷史 (getResponse 已經更新了 conversation.messages，但我們需要保存到文件/DB如果有的話)
	// 這裡 conversation 是引用，所以已經更新了
	saveConversation(reply.id, conversation);

	await reply.edit(response);
}
