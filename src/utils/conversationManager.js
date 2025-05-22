// 對話管理工具
const conversations = new Map();
const CONVERSATION_TIMEOUT = 60 * 60 * 1000; // 1小時超時

// 生成唯一聊天ID
const generateConversationId = () => {
	return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// 獲取或創建對話
export const getOrCreateConversation = (userId, messageId = null) => {
	// 如果是回覆消息且存在該消息的對話，則返回
	if (messageId && conversations.has(messageId)) {
		const conversation = conversations.get(messageId);
		resetConversationTimeout(messageId);
		return conversation;
	}

	// 否則創建新對話
	const newConversation = {
		userId,
		messages: [],
		createdAt: Date.now(),
		lastUpdated: Date.now(),
		messageId: null,
		conversationId: generateConversationId(),
		character: null
	};

	return newConversation;
};

// 保存對話
export const saveConversation = (messageId, conversation) => {
	conversation.messageId = messageId;
	conversation.lastUpdated = Date.now();
	conversations.set(messageId, conversation);

	// 設置超時清理
	resetConversationTimeout(messageId);
};

// 重設對話超時
const resetConversationTimeout = messageId => {
	const conversation = conversations.get(messageId);
	if (!conversation) return;

	// 清除舊的超時計時器
	if (conversation.timeoutId) {
		clearTimeout(conversation.timeoutId);
	}

	// 設置新的超時計時器
	conversation.timeoutId = setTimeout(() => {
		conversations.delete(messageId);
	}, CONVERSATION_TIMEOUT);
};
