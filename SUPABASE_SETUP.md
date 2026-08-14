# Supabase 部署說明（不需要 CLI）

這個版本已不再使用 Firebase。一般正式部署只需要 Supabase Project + PostgreSQL schema + 兩個 Vercel 環境變數。

## 1. 建立獨立 Supabase Project

建議每個正式系統使用獨立 Project，不要與旅遊或其他系統共用資料庫。

推薦區域：東京 `ap-northeast-1`（台灣延遲較低）。

## 2. 建立資料庫與 RLS

在 Supabase Dashboard → SQL Editor，執行 Repository 的：

`supabase/schema.sql`

這個 SQL 會建立：

- `accounts`
- `products`
- `customers`
- `orders`
- 訂單狀態 / 退款 RPC functions
- PostgreSQL Row Level Security (RLS)
- owner / staff 權限
- 必要 indexes

RLS 已設計成：沒有登入、沒有 accounts 紀錄或 `disabled=true` 都無法讀寫業務資料。

## 3. 建立第一位 Owner

Supabase Dashboard → Authentication → Users → Add user，建立第一位管理者。

記下 Email，然後在 SQL Editor 執行：

```sql
insert into public.accounts (id, email, display_name, role, disabled)
select id, email, '負責人', 'owner', false
from auth.users
where lower(email) = lower('你的Email@example.com')
on conflict (id) do update
set role = 'owner', disabled = false;
```

把 `你的Email@example.com` 改成剛才建立的 Email。

## 4. 部署 create-account Edge Function

程式碼位於：

`supabase/functions/create-account/index.ts`

這個 Function 只接受已登入且 `accounts.role='owner'` 的使用者呼叫，並使用伺服器端 `service_role` 建立新的 Supabase Auth User。`service_role` 不會出現在瀏覽器。

部署完成後，Owner 可直接在「帳號與權限 → 新增帳號」建立員工。

## 5. 取得前端連線資訊

Supabase Dashboard → Connect / API，取得：

- Project URL
- Publishable key (`sb_publishable_...`)

Vercel Project Settings → Environment Variables 設定：

```env
VITE_SUPABASE_URL=https://你的project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
```

不要把 `service_role` / secret key 放進 `VITE_*`。

## 6. 重新部署 Vercel

Vercel 儲存環境變數後重新部署。系統即可使用 Supabase Auth + PostgreSQL。

## 7. 驗證清單

1. Owner 可登入。
2. 商品新增 / 修改 / 封存正常。
3. 冷凍食品、餅乾、糖果可設定第二層口味。
4. 客戶新增 / 修改 / 封存正常。
5. 訂單新增、出貨、取消、退款正常。
6. 報表金額正常。
7. Owner 可建立 staff。
8. staff 無法修改帳號角色。
9. 停用 staff 後，該帳號無法讀取資料。

## Firebase 舊資料

如果舊 Firebase 已經有正式商品 / 客戶 / 訂單，先看 `MIGRATION_GUIDE.md`。不要在資料搬完以前直接切換 production 環境變數。
