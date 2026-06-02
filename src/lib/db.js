/**
 * ============================================================
 *  db.js — 資料存取層 (Data Access Layer)
 * ============================================================
 *  所有頁面只呼叫此檔案的函式，不直接使用 Firebase SDK。
 *  未來遷移 Supabase 時，只需改動此單一檔案即可。
 *
 *  資料結構設計完全對齊 Supabase SQL Schema：
 *    Collection/Table : products | customers | orders
 *    欄位命名         : snake_case (e.g. order_date, customer_id)
 *    時間欄位         : ISO 8601 string (相容 PostgreSQL timestamptz)
 *
 * ============================================================
 *  未來換 Supabase 步驟：
 *   1. npm uninstall firebase
 *   2. npm install @supabase/supabase-js
 *   3. 將下方每個函式的實作替換成對應的 Supabase 呼叫
 *      (可參考 MIGRATION_GUIDE.md)
 *   4. 其他頁面零改動 ✓
 * ============================================================
 */

import {
  collection, doc,
  getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// ── 內部工具 ─────────────────────────────────────────────────

/** Firestore Timestamp → ISO string (相容 Supabase) */
function tsToISO(val) {
  if (!val) return null
  if (val instanceof Timestamp) return val.toDate().toISOString()
  if (val?.seconds) return new Timestamp(val.seconds, val.nanoseconds).toDate().toISOString()
  return val // 已是 string
}

/** 將文件資料正規化，時間欄位統一輸出 ISO string */
function normalize(docSnap) {
  const d = { id: docSnap.id, ...docSnap.data() }
  const timeFields = ['created_at','updated_at','joined_at','order_date','shipped_at']
  timeFields.forEach(f => { if (d[f]) d[f] = tsToISO(d[f]) })
  return d
}

/** 現在時間的 Firestore Timestamp */
const now = () => Timestamp.now()

// ── Products ─────────────────────────────────────────────────

export const ProductsAPI = {
  async list() {
    const snap = await getDocs(query(collection(db,'products'), orderBy('created_at','desc')))
    return snap.docs.map(normalize)
  },

  async create(data) {
    const payload = { ...data, created_at: now(), updated_at: now() }
    const ref = await addDoc(collection(db,'products'), payload)
    return { id: ref.id, ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  },

  async update(id, data) {
    await updateDoc(doc(db,'products',id), { ...data, updated_at: now() })
  },

  async delete(id) {
    await deleteDoc(doc(db,'products',id))
  },

  /** 查重 (排除自身 id) */
  async isDuplicate(name, excludeId = null) {
    const snap = await getDocs(query(collection(db,'products'), where('name','==',name)))
    return snap.docs.some(d => d.id !== excludeId)
  },
}

// ── Customers ────────────────────────────────────────────────

export const CustomersAPI = {
  async list() {
    const snap = await getDocs(query(collection(db,'customers'), orderBy('joined_at','desc')))
    return snap.docs.map(normalize)
  },

  async create(data) {
    const payload = { ...data, joined_at: now(), updated_at: now() }
    const ref = await addDoc(collection(db,'customers'), payload)
    return { id: ref.id, ...data }
  },

  async update(id, data) {
    await updateDoc(doc(db,'customers',id), { ...data, updated_at: now() })
  },

  async delete(id) {
    await deleteDoc(doc(db,'customers',id))
  },

  async isDuplicate(name, excludeId = null) {
    const snap = await getDocs(query(collection(db,'customers'), where('name','==',name)))
    return snap.docs.some(d => d.id !== excludeId)
  },
}

// ── Orders ───────────────────────────────────────────────────

export const OrdersAPI = {
  async list() {
    const snap = await getDocs(query(collection(db,'orders'), orderBy('order_date','desc')))
    return snap.docs.map(normalize)
  },

  async create(data) {
    const payload = {
      ...data,
      status: 'pending',
      payment_status: 'unpaid',
      order_date: now(),
      updated_at: now(),
    }
    const ref = await addDoc(collection(db,'orders'), payload)
    return { id: ref.id, ...data }
  },

  async update(id, data) {
    await updateDoc(doc(db,'orders',id), { ...data, updated_at: now() })
  },

  async updateStatus(id, status) {
    const patch = { status, updated_at: now() }
    if (status === 'shipped') patch.shipped_at = now()
    await updateDoc(doc(db,'orders',id), patch)
  },

  async updatePayment(id, payment_status) {
    await updateDoc(doc(db,'orders',id), { payment_status, updated_at: now() })
  },

  async delete(id) {
    await deleteDoc(doc(db,'orders',id))
  },

  async batchUpdateStatus(ids, status) {
    const patch = { status, updated_at: now() }
    if (status === 'shipped') patch.shipped_at = now()
    await Promise.all(ids.map(id => updateDoc(doc(db,'orders',id), patch)))
  },
}

// ── Dashboard summary (Home page) ────────────────────────────

export const StatsAPI = {
  async getSummary() {
    const [products, customers, orders] = await Promise.all([
      getDocs(collection(db,'products')),
      getDocs(collection(db,'customers')),
      getDocs(query(collection(db,'orders'), orderBy('order_date','desc'))),
    ])
    const orderData = orders.docs.map(normalize)
    const recentOrders = orderData.slice(0, 5)
    const pending  = orderData.filter(o => o.status === 'pending').length
    const revenue  = orderData.filter(o => o.status === 'shipped').reduce((s,o) => s+(o.total_amount||0), 0)
    return {
      productCount:  products.size,
      customerCount: customers.size,
      orderCount:    orderData.length,
      pendingCount:  pending,
      revenue,
      recentOrders,
    }
  },
}
