# 團購百貨管理系統

React + Vite + Firebase 的內部團購後台。Firebase 只負責 Authentication 與 Firestore；網站由 Vercel / GitHub 管理。

## 維護原則：Firebase 一次設定，之後不必部署

本專案已改成「低維護 Firebase 架構」：

- Firestore 採 schemaless 欄位設計，新增商品欄位、口味、報表欄位不需要 migration。
- Firestore Rules 使用通用 business collection 規則；未來新增 `suppliers`、`inventory`、`purchases` 等 collection 不需要改 Rules。
- 不依賴自訂 Firestore composite indexes；目前查詢只使用 Firestore 自動單欄索引。
- 不使用 Cloud Functions / Admin SDK 作為日常功能依賴。
- Firebase CLI、`firebase deploy` 不再是日常維護流程。
- 平常程式更新只需要 GitHub；若 Vercel 已連結 GitHub，合併到 `main` 後由 Vercel 自動更新網站。

> 只有第一次正式啟用安全規則時，需要到 Firebase Console → Firestore Database → Rules，把 repository 的 `firestore.rules` 貼上後按一次「發布」。完成後日常功能更新不需要再次處理 Firebase Rules。

## 主要功能

- 商品管理：分類、售價、成本、供應商、備註、軟封存。
- 商品規格：
  - 服飾：顏色 / 尺碼 / Free Size。
  - 日用品：顏色 / 尺寸 / 隨機出貨。
  - 冷凍食品 / 餅乾 / 糖果：第二層「口味」選項，可預設或自訂。
- 客戶管理：姓名可重複，以電話 / Line / FB 輔助辨識；採軟封存。
- 訂單管理：多商品、多口味/規格、批次開單、批次出貨、出貨單、取消、退款、供應商付款狀態。
- 報表：有效訂單總額、已出貨營收、已收款、未收款、退款、歷史毛利、熱銷、分類、買家追蹤、應收、應付、現金流、月損益、CSV / Excel 相容匯出。
- 權限：Firebase Authentication + `accounts/{uid}` 白名單 + `owner/staff`。

## Firestore collections

### `products`

`name`、`price`、`cost`、`category`、`supplier`、`spec_mode`、`spec_colors[]`、`spec_sizes[]`、`spec_flavors[]`、`active`、時間欄位。

### `customers`

`name`、`line_nick`、`fb_name`、`phone`、`note`、`active`、時間欄位。

### `orders`

包含客戶、`items[]`、總額、出貨狀態、收款狀態、供應商付款狀態、退款紀錄、取消紀錄與狀態歷史。

每個 `items[]` 保存歷史快照：`product_id`、`product_name`、`sale_price`、`cost_price`、`category`、`supplier`、`qty`、`subtotal`、`cost_subtotal`、`spec.color`、`spec.size`、`spec.flavor`。

因此日後修改商品價格、成本、分類、供應商或封存商品，都不會改變新制訂單的歷史毛利。

### `accounts`

Document ID 必須等於 Firebase Auth UID。主要欄位：`email`、`display_name`、`role`、`disabled`、`created_at`。

## 第一次 Firebase 設定

1. Firebase Console → Authentication → Sign-in method → 啟用 Email/Password。
2. Authentication → Users → 建立第一位管理員並複製 UID。
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

4. Firebase Console → Firestore Database → Rules。
5. 將 repository 的 `firestore.rules` 全部貼上，按「發布」。

完成後，不需要安裝 `firebase-tools`，也不需要執行 `firebase deploy`。

## Firestore Rules 維護策略

`accounts` 維持特殊權限：只有 Owner 可以新增、調整角色與停用帳號。

其他所有應用 collection 共用同一條規則：

- 必須 Firebase Auth 已登入。
- 登入 UID 必須存在 `accounts/{uid}`。
- `disabled=true` 立即拒絕。
- 允許 read / create / update。
- 禁止 client hard delete，資料使用軟封存。

因此新增 business collection 或新增欄位時，不需要再次更新 Rules。

## 環境變數

複製 `.env.example` 為 `.env.local`，填入 `VITE_FIREBASE_*`。`.env` / `.env.local` 已由 `.gitignore` 排除。

在 Vercel Project Settings → Environment Variables 同樣設定 `VITE_FIREBASE_*` 即可。

## 舊訂單資料升級

舊版本訂單沒有成本/分類/供應商快照時，用 Owner 登入：

**帳號與權限 → 升級舊訂單快照**

系統會以目前可取得的商品資料補上快照。過去沒有保存的「當時真正成本」無法自動還原，重要歷史訂單可再人工修正。

## 統一財務定義

- 有效訂單總額：非取消訂單總額－退款。
- 已出貨營收：已出貨訂單有效金額。
- 已收款淨額：已收款 / 退款後訂單有效金額。
- 未收款：非取消且 `payment_status=unpaid` 的有效金額。
- 已出貨毛利：已出貨營收－訂單商品歷史成本快照。
- 應付帳款：非取消且尚未標記供應商已付款的成本快照。
- 現金流淨額：已收款淨額－已付供應商成本。

取消訂單不計營收、毛利、應收與應付。

## 開發與驗證

```bash
npm install
npm run dev
npm run lint
npm run build
```

## CI

`.github/workflows/ci.yml` 在 Pull Request 與 `main` push 時執行 dependency audit、lint 與 build。
