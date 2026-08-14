# Firebase → Supabase 資料遷移指南

這份文件只在「舊 Firebase 已經有正式資料」時需要。如果目前只是測試資料，可以直接建立新的 Supabase Project，不必搬資料。

## 先說明：哪些資料可以直接搬？

可以直接搬並保留原 ID：

- `products`
- `customers`
- `orders`

新版 Supabase schema 刻意把這三張表的 `id` 設成 `text`，所以舊 Firestore document ID 可以原封不動保留，訂單內的 `customer_id` / `product_id` 關聯不會因為遷移而失效。

Supabase Auth 帳號不建議直接搬 Firebase 密碼雜湊；管理者與員工帳號請在 Supabase 重新建立。業務資料不受影響。

## 建議切換流程

1. 先建立新的 Supabase Project。
2. 執行 `supabase/schema.sql`。
3. 建立第一位 Supabase Owner。
4. 從 Firebase 匯出 `products / customers / orders`。
5. 匯入 Supabase 並核對筆數與金額。
6. 在測試網址登入並驗證商品、客戶、訂單與報表。
7. 確認無誤後，才把 Vercel 的環境變數從 Firebase 改成 Supabase。

## Firebase 匯出格式

建議整理成一個 JSON：

```json
{
  "products": [],
  "customers": [],
  "orders": []
}
```

每筆資料請保留原本 Firestore document ID，例如：

```json
{
  "id": "AbCdEf123456",
  "name": "商品名稱"
}
```

Firestore Timestamp 請轉成 ISO 8601 字串，例如：

```text
2026-08-14T08:00:00.000Z
```

## 欄位對應

### products

保留：

- `id`
- `name`
- `price`
- `cost`
- `category`
- `supplier`
- `note`
- `spec_mode`
- `spec_colors`
- `spec_sizes`
- `spec_flavors`
- `active`
- `created_at`
- `updated_at`
- `archived_at`

舊資料沒有 `spec_flavors` 時使用空陣列 `[]`。

### customers

保留：

- `id`
- `name`
- `line_nick`
- `fb_name`
- `phone`
- `note`
- `active`
- `joined_at`
- `updated_at`
- `archived_at`

### orders

保留：

- `id`
- `customer_id`
- `customer_name`
- `items`
- `total_amount`
- `note`
- `status`
- `payment_status`
- `payable_status`
- `refund_amount`
- `refunds`
- `status_history`
- `cancellation_reason`
- `archived`
- `order_date`
- `created_at`
- `updated_at`
- `shipped_at`
- `cancelled_at`
- `refunded_at`
- `archived_at`

舊訂單缺少成本快照時，匯入後用：

**帳號與權限 → 升級舊訂單快照**

系統會以目前商品資料補上 `sale_price / cost_price / category / supplier`。

## 驗證方式

遷移完成後至少核對：

- 商品總筆數
- 客戶總筆數
- 訂單總筆數
- 待出貨筆數
- 已出貨筆數
- 有效訂單總額
- 已出貨營收
- 未收款金額
- 退款總額

如果你把 Firebase 匯出的 JSON 檔交給 ChatGPT，可以直接依這個 schema 整理並匯入新的 Supabase Project，不需要自行寫匯入程式。
