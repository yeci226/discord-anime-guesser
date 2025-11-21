import axios from "axios";
import CryptoJS from "crypto-js";
import { QuickDB } from "quick.db";

const db = new QuickDB();
const cacheDB = db.table("api_cache");

// 创建带有自定义User-Agent的axios实例
const axiosInstance = axios.create({
	headers: {
		"User-Agent":
			"yeci226/discord-anime-guesser (https://github.com/yeci226/discord-anime-guesser)"
	}
});

class RequestCache {
	constructor(options = {}) {
		this.stat = {
			cache_hit: {
				GET: 0,
				POST: 0
			},
			fetch: {
				GET: 0,
				POST: 0
			}
		};
		// 设置默认缓存过期时间（毫秒）
		this.cacheExpiration = options.cacheExpiration || 3600000 * 24; // 默认24小时
	}

	async get(url, config = {}) {
		const cacheKey = this._generateCacheKey("GET", url, config);
		const cachedData = await this.getCache(cacheKey);
		
		if (cachedData) {
			this.stat.cache_hit.GET++;
			return cachedData;
		}

		this.stat.fetch.GET++;
		const response = await this.request("GET", url, null, config);
		await this.setCache(cacheKey, response);
		return response;
	}

	async post(url, data = {}, config = {}) {
		const cacheKey = this._generateCacheKey("POST", url, {
			data,
			...config
		});
		const cachedData = await this.getCache(cacheKey);

		if (cachedData) {
			this.stat.cache_hit.POST++;
			return cachedData;
		}

		this.stat.fetch.POST++;
		const response = await this.request("POST", url, data, config);
		await this.setCache(cacheKey, response);
		return response;
	}

	async clearCache() {
		await cacheDB.deleteAll();
	}

	async getCache(key) {
		const cacheItem = await cacheDB.get(key);
		// 检查缓存是否过期
		if (
			cacheItem &&
			Date.now() - cacheItem.timestamp > this.cacheExpiration
		) {
			await cacheDB.delete(key);
			return null;
		}
		return cacheItem ? cacheItem.data : null;
	}

	async setCache(key, value) {
		// check if status is 200
		if (value.status !== 200) return;
		// do not cache headers
		const { headers, request, config, ...rest } = value;
		// 添加时间戳用于缓存过期检查
		const cacheItem = {
			data: rest,
			timestamp: Date.now()
		};
		await cacheDB.set(key, cacheItem);
	}

	async removeFromCache(method, url, config = {}) {
		const cacheKey = this._generateCacheKey(method, url, config);
		await cacheDB.delete(cacheKey);
	}

	_generateCacheKey(method, url, config) {
		const configString =
			Object.keys(config).length === 0
				? ""
				: `:${CryptoJS.MD5(JSON.stringify(config)).toString()}`;
		// Ensure key is safe for quick.db (remove dots or other special chars if needed, but MD5 usually handles it)
		// quick.db keys are strings. MD5 is hex string, so it's safe.
		// However, the prefix "GET:url" might contain dots.
		// Let's hash the whole key to be safe and short.
		const rawKey = `${method}:${url}${configString}`;
		return CryptoJS.MD5(rawKey).toString();
	}

	async request(method, url, data, config = {}) {
		let response;
		if (method === "GET") {
			response = await axiosInstance.get(url, config);
		} else {
			response = await axiosInstance.post(url, data, config);
		}
		return response;
	}
}

export default new RequestCache();
