export function normalizeText(text) {
	if (!text) return "";
	return text
		.toLowerCase()
		.replace(/[\s·・\u3000]+/g, "") // 去除各種空白符號
		.replace(/[?？!！,，.。:：;；(（)）\[\]「」『』""'']+/g, "") // 去除標點符號
		.replace(/の|之|的|[&＆]/g, "") // 去除常見的連接詞
		.trim();
}

export function isCorrectGuess(messageText, character) {
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
