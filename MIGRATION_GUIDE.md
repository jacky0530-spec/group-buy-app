# 🔄 Firebase → Supabase 遷移指南

本系統刻意將所有資料庫操作集中在 `src/lib/db.js`，
遷移時只需修改這一個檔案，所有頁面零改動。

---

## 第一步：匯出 Firebase 資料

在瀏覽器開發者主控台（F12）執行下方程式碼，
或在專案中建立一個臨時頁面執行：

```js
import { db } from './src/lib/firebase'
import { collection, getDocs } from 'firebase/firestore'

async function exportAll() {
  const cols = ['products', 'customers', 'orders']
  const result = {}
  for (const col of cols) {
    const snap = await getDocs(collection(db, col))
    result[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }
  // 下載 JSON
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'firebase_export.json'
  a.click()
}
exportAll()
```

---

## 第二步：在 Supabase 建立資料庫

到 Supabase Dashboard → SQL Editor，執行 `SUPABASE_SCHEMA.sql`。

---

## 第三步：匯入資料到 Supabase

建立一個臨時腳本 `import_to_supabase.mjs`：

```js
import { createClient } from '@supabase/supabase-js'
import data from './firebase_export.json' assert { type: 'json' }

const supabase = createClient('YOUR_URL', 'YOUR_ANON_KEY')

// Firestore Timestamp → ISO string
function tsToISO(val) {
  if (!val) return null
  if (val._seconds) return new Date(val._seconds * 1000).toISOString()
  return val
}

async function importAll() {
  // --- products ---
  const products = data.products.map(p => ({
    id:         p.id,
    name:       p.name,
    price:      p.price || 0,
    cost:       p.cost  || 0,
    category:   p.category || 'other',
    note:       p.note || null,
    created_at: tsToISO(p.created_at),
    updated_at: tsToISO(p.updated_at),
  }))
  const { error: pe } = await supabase.from('products').upsert(products)
  if (pe) console.error('products error:', pe)
  else console.log(`✅ 匯入 ${products.length} 筆商品`)

  // --- customers ---
  const customers = data.customers.map(c => ({
    id:        c.id,
    name:      c.name,
    line_nick: c.line_nick || null,
    fb_name:   c.fb_name   || null,
    phone:     c.phone     || null,
    note:      c.note      || null,
    joined_at: tsToISO(c.joined_at),
    updated_at:tsToISO(c.updated_at),
  }))
  const { error: ce } = await supabase.from('customers').upsert(customers)
  if (ce) console.error('customers error:', ce)
  else console.log(`✅ 匯入 ${customers.length} 筆客戶`)

  // --- orders ---
  const orders = data.orders.map(o => ({
    id:             o.id,
    customer_id:    o.customer_id   || null,
    customer_name:  o.customer_name,
    items:          o.items || [],
    total_amount:   o.total_amount  || 0,
    status:         o.status        || 'pending',
    payment_status: o.payment_status|| 'unpaid',
    note:           o.note          || null,
    order_date:     tsToISO(o.order_date),
    shipped_at:     tsToISO(o.shipped_at),
    updated_at:     tsToISO(o.updated_at),
  }))
  const { error: oe } = await supabase.from('orders').upsert(orders)
  if (oe) console.error('orders error:', oe)
  else console.log(`✅ 匯入 ${orders.length} 筆訂單`)

  console.log('🎉 資料匯入完成！')
}

importAll()
```

執行：
```bash
node import_to_supabase.mjs
```

---

## 第四步：替換 db.js

將 `src/lib/db.js` 內容替換為以下 Supabase 版本：

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export const ProductsAPI = {
  async list() {
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false })
    return data || []
  },
  async create(payload) {
    const { data } = await supabase.from('products').insert({ ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single()
    return data
  },
  async update(id, payload) {
    await supabase.from('products').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
  },
  async delete(id) {
    await supabase.from('products').delete().eq('id', id)
  },
  async isDuplicate(name, excludeId = null) {
    let q = supabase.from('products').select('id').eq('name', name)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q
    return data && data.length > 0
  },
}

export const CustomersAPI = {
  async list() {
    const { data } = await supabase.from('customers').select('*').order('joined_at', { ascending: false })
    return data || []
  },
  async create(payload) {
    const { data } = await supabase.from('customers').insert({ ...payload, joined_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single()
    return data
  },
  async update(id, payload) {
    await supabase.from('customers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
  },
  async delete(id) {
    await supabase.from('customers').delete().eq('id', id)
  },
  async isDuplicate(name, excludeId = null) {
    let q = supabase.from('customers').select('id').eq('name', name)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q
    return data && data.length > 0
  },
}

export const OrdersAPI = {
  async list() {
    const { data } = await supabase.from('orders').select('*').order('order_date', { ascending: false })
    return data || []
  },
  async create(payload) {
    const { data } = await supabase.from('orders').insert({ ...payload, status: 'pending', payment_status: 'unpaid', order_date: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single()
    return data
  },
  async update(id, payload) {
    await supabase.from('orders').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
  },
  async updateStatus(id, status) {
    const patch = { status, updated_at: new Date().toISOString() }
    if (status === 'shipped') patch.shipped_at = new Date().toISOString()
    await supabase.from('orders').update(patch).eq('id', id)
  },
  async updatePayment(id, payment_status) {
    await supabase.from('orders').update({ payment_status, updated_at: new Date().toISOString() }).eq('id', id)
  },
  async delete(id) {
    await supabase.from('orders').delete().eq('id', id)
  },
  async batchUpdateStatus(ids, status) {
    const patch = { status, updated_at: new Date().toISOString() }
    if (status === 'shipped') patch.shipped_at = new Date().toISOString()
    await supabase.from('orders').update(patch).in('id', ids)
  },
}

export const StatsAPI = {
  async getSummary() {
    const [{ count: productCount }, { count: customerCount }, { data: orders }] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('customers').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('*').order('order_date', { ascending: false }),
    ])
    const all = orders || []
    return {
      productCount:  productCount || 0,
      customerCount: customerCount || 0,
      orderCount:    all.length,
      pendingCount:  all.filter(o => o.status === 'pending').length,
      revenue:       all.filter(o => o.status === 'shipped').reduce((s, o) => s + (o.total_amount || 0), 0),
      recentOrders:  all.slice(0, 5),
    }
  },
}
```

---

## 第五步：更新 .env.local

```
# 停用 Firebase（保留備份）
# VITE_FIREBASE_API_KEY=...

# 啟用 Supabase
VITE_SUPABASE_URL=https://your_project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## 遷移完成 ✅

| 步驟 | 工作量 |
|------|--------|
| 匯出 Firebase 資料 | 5 分鐘 |
| 建立 Supabase Schema | 2 分鐘 |
| 匯入資料腳本 | 3 分鐘 |
| 替換 db.js | 直接複製貼上 |
| 更新 .env | 1 分鐘 |
| **頁面元件修改量** | **零改動** |

> 這就是資料存取層（DAL）設計的價值：業務邏輯與資料庫解耦，
> 未來不管換 Supabase、PlanetScale 或其他服務，頁面程式碼永遠不動。
