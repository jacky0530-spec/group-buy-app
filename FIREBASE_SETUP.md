# Firebase 一次性設定指南

目標：Firebase 只設定一次，之後日常維護不需要 Firebase CLI，也不需要 `firebase deploy`。

## 1. 建立 / 確認 Firebase 專案

1. Firebase Console 建立或打開既有專案。
2. 建立 Web App。
3. 建立 Firestore Database。
4. Authentication → Sign-in method → 啟用 Email/Password。

## 2. 設定前端環境變數

把 `.env.example` 複製成 `.env.local`，填入 Firebase Web App 設定的 `VITE_FIREBASE_*`。

`.env` / `.env.local` 不要提交到 GitHub。

如果網站部署在 Vercel，同樣把 `VITE_FIREBASE_*` 填到 Vercel Project Settings → Environment Variables。

## 3. 建立第一位 Owner

1. Firebase Console → Authentication → Users → Add user。
2. 建立第一位管理員帳號。
3. 複製該使用者 UID。
4. Firestore Database → Data → 建立 collection：`accounts`。
5. Document ID 使用剛才的 UID。
6. 建立欄位：

```json
{
  "email": "owner@example.com",
  "display_name": "負責人",
  "role": "owner",
  "disabled": false,
  "created_at": "2026-08-14T00:00:00.000Z"
}
```

## 4. Security Rules：只做這一次

不需要安裝 Firebase CLI。

1. Firebase Console → Firestore Database → Rules。
2. 打開 GitHub repository 裡的 `firestore.rules`。
3. 全選複製。
4. 貼到 Firebase Console Rules 編輯器。
5. 按「發布」。

完成後，日常維護不需要再次處理 Firebase Rules。

## 5. 為什麼未來不需要重新發布 Rules

目前規則把 `accounts` 獨立保護，其餘 business collections 使用通用 wildcard 規則。

所以未來新增：

- `suppliers`
- `inventory`
- `purchases`
- `refund_details`
- 其他團購功能 collection

都會自動套用相同登入/白名單權限，不需要修改 Rules。

Firestore 本身也是 schemaless，新增商品欄位、訂單欄位、口味欄位，不需要資料庫 migration。

## 6. 查詢與 Index 維護

目前系統不依賴自訂 composite indexes。

商品、客戶、訂單的主要查詢只使用 Firestore 自動建立的單欄索引，因此不需要另外維護或部署 `firestore.indexes.json`。

若未來真的新增複雜的多條件 server-side query，才需要重新評估是否要 composite index；一般功能優先使用目前的低維護查詢策略。

## 7. 日常維護流程

平常只需要：

1. 修改 GitHub 程式。
2. 建立 PR / 合併到 `main`。
3. GitHub Actions 自動檢查 lint / build。
4. 若 Vercel 已連結 GitHub，Vercel 自動更新網站。

Firebase 不需要跟著部署。

## 8. 權限模型

- 未登入：拒絕。
- UID 不在 `accounts`：拒絕。
- `disabled=true`：拒絕。
- staff：可操作一般團購資料。
- owner：另可管理 accounts。
- Client 禁止 hard delete；商品、客戶、訂單採軟封存，保留歷史帳務。

## 9. 舊訂單升級

Owner 登入後：

**帳號與權限 → 升級舊訂單快照**

系統會把目前可取得的成本、分類、供應商補入舊訂單快照，避免後續商品異動繼續影響歷史報表。
