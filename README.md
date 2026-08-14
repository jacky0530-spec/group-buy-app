# 團購百貨管理系統

以 React + Vite + Firebase 建立的內部團購後台，支援商品、客戶、訂單、出貨、收款、退款、供應商應付與銷售/損益報表。

## 主要功能

- 商品管理：分類、售價、成本、供應商、備註、軟封存。
- 商品規格：
  - 服飾：顏色 / 尺碼 / Free Size。
  - 日用品：顏色 / 尺寸 / 隨機出貨。
  - **冷凍食品 / 餅乾 / 糖果：第二層「口味」選項**，支援預設與自訂口味。
- 客戶管理：姓名可重複，以電話 / Line / FB 輔助辨識；採軟封存。
- 訂單管理：多商品、多口味/規格、批次開單、批次出貨、出貨單、取消、退款、供應商付款狀態。
- 報表：有效訂單總額、已出貨營收、已收款、未收款、退款、歷史毛利、熱銷、分類、買家追蹤、應收、應付、現金流、月損益、CSV / Excel 相容匯出。
- 權限：Firebase Authentication + `accounts/{uid}` 白名單 + `owner/staff` + Firestore Security Rules。

## 技術

React 19、Vite、Firebase Authentication、Cloud Firestore、React Router、Recharts、Vercel。

## Firestore collections

### `products`

`name`、`price`、`cost`、`category`、`supplier`、`spec_mode`、`spec_colors[]`、`spec_sizes[]`、`spec_flavors[]`、`active`、時間欄位。

### `customers`

`name`、`line_nick`、`fb_name`、`phone`、`note`、`active`、時間欄位。

### `orders`

包含客戶、`items[]`、總額、出貨狀態、收款狀態、供應商付款狀態、退款紀錄、取消紀錄與狀態歷史。

每個 `items[]` 都保存商品歷史快照：

- `product_id`
- `product_name`
- `sale_price`
- `cost_price`
- `category`
- `supplier`
- `qty`
- `subtotal`
- `cost_subtotal`
- `spec.color`
- `spec.size`
- `spec.flavor`

因此日後修改商品價格、成本、供應商或封存商品，不會改變新制訂單的歷史毛利。

### `accounts`

Document ID 必須等於 Firebase Auth UID，欄位包含 `email`、`display_name`、`role`、`disabled`、`created_at`。

## 環境變數

複製 `.env.example` 為 `.env.local`，填入所有 `VITE_FIREBASE_*`。`.env` / `.env.local` 已被 `.gitignore` 排除。

> Firebase Web API Key 會出現在前端 bundle；真正的資料保護必須依賴 Authentication + Firestore Security Rules，而不是把 Web API Key 當秘密。

## 首次部署：建立第一位 Owner

這一步必須在啟用嚴格 Firestore Rules 前完成：

1. Firebase Console → Authentication → Sign-in method → 啟用 Email/Password。
2. Authentication → Users → 建立第一位管理員。
3. 複製 UID。
4. Firestore 建立 `accounts/{UID}`。
5. 欄位：

```json
{
  "email": "owner@example.com",
  "display_name": "負責人",
  "role": "owner",
  "disabled": false,
  "created_at": "2026-08-14T00:00:00.000Z"
}
```

6. 確認 Owner 可登入後，再部署 Security Rules。

## Firestore Security Rules

Repository 已包含 `firebase.json`、`firestore.rules`、`firestore.indexes.json`。

```bash
npm install -g firebase-tools
firebase login
firebase use <YOUR_PROJECT_ID>
firebase deploy --only firestore:rules,firestore:indexes
```

規則：未登入拒絕；UID 不在 accounts 拒絕；`disabled=true` 拒絕；staff 可操作商品/客戶/訂單；owner 另可管理 accounts；Client 不允許刪除 accounts 文件。

## 舊訂單資料升級

舊版本訂單沒有 `cost_price/category/supplier` 快照，技術上無法還原「當時真正成本」。更新後請用 Owner：

**帳號與權限 → 升級舊訂單快照**

系統會以目前仍可取得的商品資料補上快照並固定；若歷史真實成本與目前成本不同，重要舊單請人工校正。

## 統一財務定義

- **有效訂單總額**：非取消訂單總額－退款。
- **已出貨營收**：已出貨訂單的有效金額。
- **已收款淨額**：已收款 / 退款後訂單的有效金額。
- **未收款**：非取消、`payment_status=unpaid` 的有效金額。
- **已出貨毛利**：已出貨營收－訂單商品歷史成本快照。
- **應付帳款**：非取消訂單中，尚未標記 `payable_status=paid` 的成本快照。
- **現金流淨額**：已收款淨額－已付供應商成本。

取消訂單不計營收、毛利、應收與應付。

## 本機開發與檢查

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Vercel

`vercel.json` 已設定 SPA rewrite。在 Vercel Project Settings → Environment Variables 設定所有 `VITE_FIREBASE_*`。

## 安全注意事項

- 正式環境不要使用 Firestore Test Mode。
- 不要提交 `.env`、Service Account JSON、Admin SDK 私鑰。
- 前端按鈕隱藏不是安全控制；真正權限以 `firestore.rules` 為準。
- 帳號停用會保留 Firebase Auth UID 與稽核資料，但 Firestore 權限會拒絕該帳號。
- 若未來要真正刪除 Firebase Auth User，應透過 Firebase Admin SDK / Cloud Functions / 受保護 Server API 執行，不能把 Admin 憑證放前端。

## CI

`.github/workflows/ci.yml` 在 Pull Request 與 `main` push 時執行 `npm ci`、`npm run lint`、`npm run build`。
