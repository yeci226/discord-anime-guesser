import {
	getCharacterAppearances,
	getRandomCharacter
	// getCharacterDetails,
	// getCharactersBySubjectId
} from "./bangumi.js";
import { idToTags } from "./id_tags.js";

const gameSettings = {
	startYear: new Date().getFullYear() - 20, // 開始年份
	endYear: new Date().getFullYear(), // 結束年份
	useSubjectPerYear: true, // 是否使用每年隨機選擇作品
	topNSubjects: 50, // 每年選擇作品數量
	metaTags: ["", "", ""], // 作品類型
	useIndex: false, // 是否使用索引
	indexId: null, // 索引ID
	addedSubjects: [], // 已添加作品
	mainCharacterOnly: true, // 是否只選擇主要角色
	characterNum: 6, // 角色數量
	maxAttempts: 10, // 最大嘗試次數
	enableHints: false, // 是否啟用提示
	includeGame: false, // 是否包含遊戲
	timeLimit: null, // 時間限制
	subjectSearch: true, // 是否進行作品搜索
	characterTagNum: 6, // 角色標籤數量
	subjectTagNum: 6, // 作品標籤數量
	enableTagCensor: false, // 是否啟用標籤過濾
	commonTags: true, // 是否使用常見標籤
	externalTagMode: false // 是否使用外部標籤模式
};

export const guildCache = new Map();

export async function getNewCharacter(guildId) {
	let character = await getRandomCharacter(gameSettings);

	if (
		character.appearanceIds &&
		character.appearanceIds.some(id => typeof id === "number")
	) {
		character.appearanceIds = character.appearanceIds.map(
			id => idToTags[id] || id
		);
	}

	guildCache.set(guildId, character);
	return character;
}

export async function getCharacter(guildId) {
	const character = guildCache.get(guildId);
	if (!character) {
		return getNewCharacter(guildId);
	}

	return character;
}
