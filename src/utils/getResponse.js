import { Logger } from "./logger.js";
import { GoogleGenAI } from "@google/genai";
const cooldowns = new Map();
const cooldownTime = 5000; // 5秒冷卻時間

const ai = new GoogleGenAI({
	apiKey: process.env.GOOGLE_API_KEY
});

export const getResponse = async (message, conversation = null) => {
	try {
		const cooldownRemaining = isOnCooldown(message);
		if (cooldownRemaining) {
			return `⚠️ 請等待 ${cooldownRemaining} 秒後再試`;
		}

		setCooldown(message.author.id);

		// 準備傳送給AI的內容
		let contents = [
			{
				role: "system",
				text: "預設以繁體中文回答，如果使用者要求以其他語言回答，請以使用者要求的語言回答。"
			}
		];

		// 如果有對話歷史，加入歷史消息
		if (conversation && conversation.messages.length > 0) {
			contents = [...conversation.messages];
		}

		// 加入當前消息
		contents.push({ role: "user", text: message.content });

		// 更新對話歷史
		if (conversation) {
			conversation.messages = contents;
		}

		const response = await ai.models.generateContent({
			model: "gemini-2.0-flash-lite",
			contents,
			generationConfig: {
				maxOutputTokens: 1024
			}
		});

		const responseText = response.text;

		if (conversation) {
			conversation.messages.push({ role: "model", text: responseText });
			// 如果對話太長，只保留最近的10個消息
			if (conversation.messages.length > 10) {
				conversation.messages = conversation.messages.slice(-10);
			}
		}

		return responseText;
	} catch (err) {
		new Logger("系統").error(`生成回應時發生錯誤：${err.message}`);
		return "⚠️ 出了點問題";
	}
};

const isOnCooldown = message => {
	const now = Date.now();
	const cooldownEndTime = cooldowns.get(message.author.id);

	if (cooldownEndTime && now < cooldownEndTime) {
		return `<t:${Math.floor(cooldownEndTime / 1000)}:R>`;
	}

	return false;
};

const setCooldown = userId => {
	const cooldownEndTime = Date.now() + cooldownTime;
	cooldowns.set(userId, cooldownEndTime);

	setTimeout(() => {
		cooldowns.delete(userId);
	}, cooldownTime);
};
