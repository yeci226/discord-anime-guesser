## 📖 二次元角色猜猜吧
一個可以讓你在 Discord 上透過AI對話猜二次元角色的哈基米，靈感來自 [https://github.com/kennylimz/anime-character-guessr](https://github.com/kennylimz/anime-character-guessr)

## 📦 本地架設
### 1. 安裝 package
```
npm install
```

### 2. 設定 env
重新命名 .env.exmaple -> .env
輸入 Discord Bot Token 及 Gemini API 金鑰 [獲取方法](https://ai.google.dev/gemini-api/docs/api-key?hl=zh-tw)

### 3. 執行
```
npm run start
```

## 🎮 遊玩方法

- 把機器人邀進去群組之後 @機器人 <要說的話> 開始一局遊戲
- 機器人會透過該題目角色的語氣回覆你
- 你可以透過Discord的回覆功能繼續猜測，也能透過打 "提示" 獲取提示
- 當你打出該角色的全名或大部分名稱時就會得到 `🎉 恭喜你猜對了！我是 ${characterName}！`

## ✨ 參考
[kennylimz/anime-character-guessr](https://github.com/kennylimz/anime-character-guessr)
