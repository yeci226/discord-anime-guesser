import axios from "axios";
import CryptoJS from "crypto-js";
import debounce from "lodash.debounce";

// 检查是否在浏览器环境中
const isBrowser =
	typeof window !== "undefined" && typeof localStorage !== "undefined";

// 创建带有自定义User-Agent的axios实例
const axiosInstance = axios.create({
	headers: {
		"User-Agent":
			"yeci226/discord-anime-guesser (https://github.com/yeci226/discord-anime-guesser)"
	}
});

class RequestCache {
	constructor(options = {}) {
		this.cache = new Map();
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
		this.cacheExpiration = options.cacheExpiration || 3600000; // 默认1小时
		this._loadCacheFromStorage();
	}

	async get(url, config = {}) {
		const cacheKey = this._generateCacheKey("GET", url, config);
		if (this.cache.has(cacheKey)) {
			this.stat.cache_hit.GET++;
			return this.getCache(cacheKey);
		}

		this.stat.fetch.GET++;
		const response = await this.request("GET", url, null, config);
		this.setCache(cacheKey, response);
		return response;
	}

	async post(url, data = {}, config = {}) {
		const cacheKey = this._generateCacheKey("POST", url, {
			data,
			...config
		});
		if (this.cache.has(cacheKey)) {
			this.stat.cache_hit.POST++;
			return this.getCache(cacheKey);
		}

		this.stat.fetch.POST++;
		const response = await this.request("POST", url, data, config);
		this.setCache(cacheKey, response);
		return response;
	}

	clearCache() {
		this.cache.clear();
		localStorage.removeItem("requestCache");
	}

	getCache(key) {
		const cacheItem = this.cache.get(key);
		// 检查缓存是否过期
		if (
			cacheItem &&
			Date.now() - cacheItem.timestamp > this.cacheExpiration
		) {
			this.cache.delete(key);
			this._removeCacheFromStorage(key);
			return null;
		}
		return cacheItem ? cacheItem.data : null;
	}

	setCache(key, value) {
		// check if status is 200
		if (value.status !== 200) return;
		// do not cache headers
		const { headers, ...rest } = value;
		// 添加时间戳用于缓存过期检查
		const cacheItem = {
			data: rest,
			timestamp: Date.now()
		};
		this.cache.set(key, cacheItem);
		this._saveCacheToStorage();
	}

	removeFromCache(method, url, config = {}) {
		const cacheKey = this._generateCacheKey(method, url, config);
		this.cache.delete(cacheKey);
		this._removeCacheFromStorage(cacheKey);
	}

	_generateCacheKey(method, url, config) {
		const configString =
			Object.keys(config).length === 0
				? ""
				: `:${CryptoJS.MD5(JSON.stringify(config)).toString()}`;
		return `${method}:${url}${configString}`;
	}

	_saveCacheToStorageInternal() {
		if (!isBrowser) return;

		try {
			const cacheData = {};
			this.cache.forEach((value, key) => {
				cacheData[key] = value;
			});
			localStorage.setItem("requestCache", JSON.stringify(cacheData));
		} catch (error) {
			if (
				error.name === "QuotaExceededError" ||
				error.message.includes("quota") ||
				error.message.includes("storage")
			) {
				console.warn("存储配额已超出，正在清除所有缓存");
				this.clearCache();
			} else {
				console.error("缓存保存失败:", error);
			}
		}
	}

	_saveCacheToStorage = debounce(this._saveCacheToStorageInternal, 1000);

	_loadCacheFromStorage() {
		if (!isBrowser) return;

		try {
			const cacheData =
				JSON.parse(localStorage.getItem("requestCache")) || {};
			Object.entries(cacheData).forEach(([key, value]) => {
				this.cache.set(key, value);
			});
		} catch (error) {
			console.error("加载缓存失败:", error);
			this.clearCache();
		}
	}

	_removeCacheFromStorage(cacheKey) {
		if (!isBrowser) return;

		try {
			const cacheData =
				JSON.parse(localStorage.getItem("requestCache")) || {};
			delete cacheData[cacheKey];
			localStorage.setItem("requestCache", JSON.stringify(cacheData));
		} catch (error) {
			console.error("删除缓存项失败:", error);
		}
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
