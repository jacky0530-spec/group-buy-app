import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  runTransaction, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

const now = () => Timestamp.now()
const nowISO = () => new Date().toISOString()
const toISO = v => v?.toDate ? v.toDate().toISOString() : (v || null)

function normalizeSnap(d) {
  const row = { id:d.id, ...d.data() }
  ;['created_at','updated_at','received_at'].forEach(k => { if (row[k]) row[k] = toISO(row[k]) })
  return row
}

export function normalizeStockSpec(spec = {}) {
  return {
    package:String(spec.package || '').trim(),
    flavor:String(spec.flavor || '').trim(),
    color:String(spec.color || '').trim(),
    size:String(spec.size || '').trim(),
  }
}

export function stockSpecLabel(spec = {}) {
  const s = normalizeStockSpec(spec)
  return [
    s.package && `組合：${s.package}`,
    s.flavor && `口味：${s.flavor}`,
    s.color && `顏色：${s.color}`,
    s.size && `尺寸：${s.size}`,
  ].filter(Boolean).join('／') || '一般規格'
}

export function stockInventoryId(productId, spec = {}) {
  const s = normalizeStockSpec(spec)
  const key = [s.package,s.flavor,s.color,s.size].join('|') || 'default'
  return `${productId}__${encodeURIComponent(key)}`
}

function snapshotStockItem(product, inventory, qty, note = '') {
  const spec = normalizeStockSpec(inventory.spec)
  const option = (product.price_options || []).find(o => String(o.label || '') === spec.package) || null
  const price = Number(option?.price ?? product.price ?? 0)
  const cost = Number(option?.cost === '' || option?.cost == null ? (product.cost || 0) : option.cost)
  return {
    id:product.id,
    product_id:product.id,
    name:product.name,
    product_name:product.name,
    price,
    sale_price:price,
    cost_price:cost,
    category:product.category || 'other',
    supplier:product.supplier || inventory.supplier || '',
    supplier_payment_term:product.supplier_payment_term || 'manual',
    supplier_paid_amount:0,
    supplier_payment_status:'unpaid',
    supplier_payment_refs:[],
    qty,
    subtotal:price * qty,
    cost_subtotal:cost * qty,
    note:String(note || '').trim(),
    spec,
    fulfillment_type:'stock',
    stock_inventory_id:inventory.id,
  }
}

export const InventoryAPI = {
  async listStock() {
    const snap = await getDocs(collection(db,'stock_inventory'))
    return snap.docs.map(normalizeSnap).sort((a,b) => String(a.product_name||'').localeCompare(String(b.product_name||''),'zh-Hant'))
  },

  async listExtras() {
    const snap = await getDocs(collection(db,'stock_purchase_extras'))
    return snap.docs.map(normalizeSnap).sort((a,b) => String(b.created_at||'').localeCompare(String(a.created_at||'')))
  },

  async createExtraPurchase({ product, spec = {}, qty = 1, note = '' }) {
    const amount = Math.max(1,Number(qty || 1))
    if (!product?.id) throw new Error('請選擇商品')
    if (!Number.isInteger(amount)) throw new Error('額外叫貨數量必須是整數')
    const cleanSpec = normalizeStockSpec(spec)
    const ref = await addDoc(collection(db,'stock_purchase_extras'),{
      product_id:product.id,
      product_name:product.name || '',
      supplier:product.supplier || '',
      spec:cleanSpec,
      spec_label:stockSpecLabel(cleanSpec),
      ordered_qty:amount,
      received_qty:0,
      unit_cost:Number(product.cost || 0),
      note:String(note || '').trim(),
      status:'ordered',
      created_at:now(),
      updated_at:now(),
    })
    return ref.id
  },

  async receiveExtraPurchase(extraId) {
    const extraRef = doc(db,'stock_purchase_extras',extraId)
    return runTransaction(db,async tx => {
      const extraSnap = await tx.get(extraRef)
      if (!extraSnap.exists()) throw new Error('找不到額外叫貨紀錄')
      const extra = extraSnap.data()
      const ordered = Math.max(0,Number(extra.ordered_qty || 0))
      const received = Math.max(0,Number(extra.received_qty || 0))
      const incoming = ordered - received
      if (incoming <= 0) throw new Error('此筆額外叫貨已全部入庫')
      const invId = stockInventoryId(extra.product_id,extra.spec)
      const invRef = doc(db,'stock_inventory',invId)
      const invSnap = await tx.get(invRef)
      const oldAvailable = invSnap.exists() ? Math.max(0,Number(invSnap.data().available_qty || 0)) : 0
      const inventoryPayload = {
        product_id:extra.product_id,
        product_name:extra.product_name || '',
        supplier:extra.supplier || '',
        spec:normalizeStockSpec(extra.spec),
        spec_label:extra.spec_label || stockSpecLabel(extra.spec),
        available_qty:oldAvailable + incoming,
        updated_at:now(),
      }
      if (!invSnap.exists()) inventoryPayload.created_at = now()
      tx.set(invRef,inventoryPayload,{ merge:true })
      tx.update(extraRef,{
        received_qty:ordered,
        status:'received',
        received_at:now(),
        stock_inventory_id:invId,
        updated_at:now(),
      })
      return { inventory_id:invId, received:incoming, available:oldAvailable + incoming }
    })
  },

  async adjustAvailable(inventoryId, nextQty, note = '') {
    const qty = Number(nextQty)
    if (!Number.isInteger(qty) || qty < 0) throw new Error('現貨數量必須是 0 以上整數')
    await updateDoc(doc(db,'stock_inventory',inventoryId),{
      available_qty:qty,
      adjustment_note:String(note || '').trim(),
      updated_at:now(),
    })
  },

  async createHelperStockOrder({ uid, displayName = '', customer, inventory, qty = 1, note = '' }) {
    const amount = Number(qty)
    if (!uid) throw new Error('登入狀態失效')
    if (!customer?.id) throw new Error('請選擇客戶')
    if (!inventory?.id) throw new Error('請選擇現貨商品')
    if (!Number.isInteger(amount) || amount < 1) throw new Error('數量至少為 1')

    const invRef = doc(db,'stock_inventory',inventory.id)
    const productRef = doc(db,'products',inventory.product_id)
    const entryRef = doc(collection(db,'helper_entries'))
    const orderRef = doc(collection(db,'orders'))

    await runTransaction(db,async tx => {
      const [invSnap,productSnap] = await Promise.all([tx.get(invRef),tx.get(productRef)])
      if (!invSnap.exists()) throw new Error('此現貨庫存不存在')
      if (!productSnap.exists() || productSnap.data().active === false) throw new Error('商品不存在或已封存')
      const inv = { id:invSnap.id, ...invSnap.data() }
      const available = Math.max(0,Number(inv.available_qty || 0))
      if (available < amount) throw new Error(`現貨不足，目前可售 ${available} 件`)
      const product = { id:productSnap.id, ...productSnap.data() }
      const item = snapshotStockItem(product,inv,amount,note)
      const at = now()
      const entryPayload = {
        created_by_uid:uid,
        created_by_name:displayName,
        customer_id:customer.id,
        customer_name:customer.name || '',
        customer_phone_last2:customer.phone_last2 || '',
        items:[{
          product_id:item.product_id,
          product_name:item.product_name,
          sale_price:item.sale_price,
          qty:item.qty,
          spec:item.spec,
          note:item.note,
          fulfillment_type:'stock',
          stock_inventory_id:inventory.id,
        }],
        total_amount:item.subtotal,
        is_virtual:false,
        note:'現貨開單',
        status:'converted',
        converted_order_id:orderRef.id,
        converted_at:at,
        direct_order:true,
        created_at:at,
        updated_at:at,
      }
      const orderPayload = {
        customer_id:customer.id,
        customer_name:customer.name || '',
        customer_phone_last2:customer.phone_last2 || '',
        customer_phone:customer.phone || '',
        items:[item],
        total_amount:item.subtotal,
        note:'現貨開單',
        is_virtual:false,
        source:'helper',
        helper_entry_id:entryRef.id,
        created_by_uid:uid,
        created_by_name:displayName,
        status:'pending',
        payment_status:'unpaid',
        payable_status:'unpaid',
        refund_amount:0,
        refunds:[],
        status_history:[{ status:'pending',at:nowISO(),note:'小幫手現貨開單' }],
        order_date:at,
        created_at:at,
        updated_at:at,
      }
      tx.update(invRef,{ available_qty:available-amount,updated_at:at })
      tx.set(entryRef,entryPayload)
      tx.set(orderRef,orderPayload)
    })
    return orderRef.id
  },
}
