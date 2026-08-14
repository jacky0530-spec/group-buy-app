# 團購百貨管理系統

以 React + Vite + Supabase 建立的內部團購後台，支援商品、客戶、訂單、出貨、收款、退款、供應商應付與銷售/損益報表。

## 主要功能

- 商品管理：分類、售價、成本、供應商、備註、軟封存。
- 商品規格：
  - 服飾：顏色 / 尺碼 / Free Size。
  - 日用品：顏色 / 尺寸 / 隨機出貨。
  - **冷凍食品 / 餅乾 / 糖果：第二層「口味」選項**，支援預設與自訂口味。
- 客戶管理：姓名可重複，以電話 / Line / FB 輔助辨識；採軟封存。
- 訂單管理：多商品、多口味/規格、批次開單、批次出貨、出貨單、取消、退款、供應商付款狀態。
- 報表：有效訂單總額、已出貨營收、已收款、未收款、退款、歷史毛利、熱銷、分類、買家追蹤、應收、應付、現金流、月損益、CSV / Excel 相容匯出。
- 權限：Supabase Auth + `accounts` 白名單 + `owner/staff` + PostgreSQL Row Level Security (RLS)。

## 技術

React 19、Vite、Supabase Auth、PostgreSQL、PostgREST / supabase-js、React Router、Recharts、Vercel。

## 資料庫

Schema 原始檔：`supabase/schema.sql`。

### `products`

`name`、`price`、`cost`、`category`、`supplier`、`spec_mode`、`spec_colors[]`、`spec_sizes[]`、`spec_flavors[]`、`active`、時間欄位。

### `customers`

`name`、`line_nick`、`fb_name`、`phone`、`note`、`active`、時間欄位。

### `orders`

包含客戶、`items` JSONB、總額、出貨狀態、收款狀態、供應商付款狀態、退款紀錄、取消紀錄與狀態歷史。

每個 `items[]` 保存商品歷史快照：

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

商品、客戶、訂單 ID 使用 `text`，新資料預設以 UUID 字串產生，但也能保留舊 Firestore document ID，方便既有資料遷移而不破壞關聯。

### `accounts`

`id` 必須等於 Supabase Auth `auth.users.id`，欄位包含 `email`、`display_name`、`role`、`disabled`、時間欄位。

## 環境變數

複製 `.env.example` 為 `.env.local`：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxx
```

前端只使用 Supabase **publishable key**；`service_role` 絕對不可放在 Vite / Browser 環境變數。

## 首次 Supabase 設定

完整步驟請看 `SUPABASE_SETUP.md`。核心步驟只有：

1. 建立一個獨立 Supabase Project。
2. 執行 `supabase/schema.sql` 建立 tables / functions / RLS。
3. 在 Supabase Auth 建立第一位使用者，並把該 UID 寫入 `accounts` 且角色設為 `owner`。
4. 部署 `supabase/functions/create-account`；之後 Owner 就能直接在系統內建立員工帳號。
5. Vercel 只需設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。

不需要 Firebase CLI，也不需要另外部署 Firestore Rules；Supabase RLS 就存在 PostgreSQL 資料庫中。

## 安全模型

- 未登入：無資料表權限。
- 已登入但 `accounts` 沒有紀錄：無資料權限。
- `disabled=true`：RLS 直接拒絕資料存取。
- `staff`：可操作商品、客戶、訂單。
- `owner`：除上述權限外，可管理帳號角色與停用狀態。
- 前端沒有任何 `DELETE` grant；商品、客戶、訂單一律軟封存。
- 建立 Auth User 透過受 JWT 保護的 Edge Function 執行；`service_role` 只存在伺服器端。

## 舊訂單資料升級

舊版本訂單若沒有 `cost_price/category/supplier` 快照，可用 Owner：

**帳號與權限 → 升級舊訂單快照**

系統會以目前仍可取得的商品資料補上快照並固定；若歷史真正成本與目前成本不同，重要舊單仍需人工校正。

如果已有 Firebase 正式資料，要搬到 Supabase，請先看 `MIGRATION_GUIDE.md`，不要直接切換 production 環境變數。

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

`vercel.json` 已設定 SPA rewrite。在 Vercel Project Settings → Environment Variables 設定：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## CI

`.github/workflows/ci.yml` 在 Pull Request 與 `main` push 時執行 production dependency audit、`npm ci`、`npm run lint`、`npm run build`。
