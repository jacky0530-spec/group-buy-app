# 🔥 Firebase 設定說明

## 1. 建立 Firebase 專案
1. 前往 https://console.firebase.google.com
2. 點「新增專案」→ 輸入專案名稱 → 建立
3. 左側選「建置 → Firestore Database」→「建立資料庫」
4. 選「以測試模式啟動」（開發期間方便使用）

## 2. 取得設定值
1. 專案首頁 → 齒輪圖示「專案設定」
2. 捲到「您的應用程式」→ 點「</>」Web 圖示 → 新增應用程式
3. 複製 firebaseConfig 內的各項值

## 3. 設定環境變數
複製 `.env.example` 為 `.env.local`，貼上對應值：

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

## 4. 啟動
```bash
npm install
npm run dev
```

## 5. Firestore 索引（如遇錯誤）
如瀏覽器主控台出現索引錯誤，點擊錯誤訊息中的連結自動建立索引即可。

## 6. 未來遷移 Supabase
請參考 `MIGRATION_GUIDE.md`。
