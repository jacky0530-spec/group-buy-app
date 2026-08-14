# Firebase 正式設定指南

## 1. 建立專案

1. Firebase Console 建立專案。
2. 建立 Web App。
3. Firestore Database 建立資料庫。
4. Authentication → Sign-in method → 啟用 Email/Password。

正式環境**不要長期使用 Test Mode**。

## 2. 設定前端環境變數

```bash
cp .env.example .env.local
```

填入 `VITE_FIREBASE_*`。`.env` 與 `.env.local` 不應提交到 GitHub。

## 3. 建立第一位 Owner

嚴格 Security Rules 會要求使用者 UID 已存在 `accounts/{uid}`，因此第一位 Owner 必須手動 bootstrap：

1. Authentication → Users → Add user。
2. 複製 UID。
3. Firestore 建立 `accounts/{UID}`：

```json
{
  "email": "owner@example.com",
  "display_name": "負責人",
  "role": "owner",
  "disabled": false,
  "created_at": "2026-08-14T00:00:00.000Z"
}
```

## 4. 部署 Firestore Rules

Repository 內已有 `firestore.rules`、`firestore.indexes.json`、`firebase.json`：

```bash
npm install -g firebase-tools
firebase login
firebase use <PROJECT_ID>
firebase deploy --only firestore:rules,firestore:indexes
```

## 5. 權限模型

- 未登入：拒絕。
- UID 不在 accounts：拒絕。
- `disabled=true`：拒絕。
- staff：可操作商品、客戶、訂單。
- owner：另可管理 accounts。

前端 React 的按鈕顯示只屬 UX；真正權限在 Firestore Rules。

## 6. 舊訂單升級

用 Owner 登入：**帳號與權限 → 升級舊訂單快照**。

這會把目前已知商品成本、分類與供應商寫進舊訂單，避免未來再被商品異動影響。系統無法自動知道舊訂單「當時真正成本」，只能用目前可取得資料補齊。

## 7. 啟動 / 檢查

```bash
npm install
npm run dev
npm run lint
npm run build
```
