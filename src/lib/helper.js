import { collection, doc, getDoc, getDocs, updateDoc, writeBatch, Timestamp, query, where } from 'firebase/firestore'
import { db } from './firebase'

const now = () => Timestamp.now()
const nowISO = () => new Date().toISOString()
const toISO = v => v?.toDate ? v.toDate().toISOString() : (v || null)
const normalize = d => {
  const x = { id:d.id, ...d.data() }
  ;['created_at','updated_at','converted_at','order_date'].forEach(k => { if (x[k]) x[k] = toISO(x[k]) })
  return x
}

function snapshotItem(product, line = {}) {
  const spec = line.spec || {}
  const option = (product.price_options || []).find(o => o.label === spec.package) || null
  const salePrice = Number(option?.price ?? product.price ?? line.sale_price ?? 0)
  const costPrice = Number(option?.cost === '' || option?.cost == null ? (product.cost || 0) : option.cost)
  const qty = Math.max(1, Number(line.qty || 1))
  return {
    id:product.id,
    product_id:product.id,
    name:product.name || line.product_name || '',
    product_name:product.name || line.product_name || '',
    price:salePrice,
    sale_price:salePrice,
    cost_price:costPrice,
    category:product.category || 'other',
    supplier:product.supplier || '',
    supplier_payment_term:product.supplier_payment_term || 'manual',
    supplier_paid_amount:0,
    supplier_payment_status:'unpaid',
    supplier_payment_refs:[],
    qty,
    subtotal:salePrice * qty,
    cost_subtotal:costPrice * qty,
    note:line.note || '',
    spec:{
      color:spec.color || '',
      size:spec.size || '',
      flavor:spec.flavor || '',
      package:option?.label || spec.package || '',
    },
  }
}

async function hydrateOrderItems(lines = []) {
  const ids = [...new Set(lines.map(x => x.product_id || x.id).filter(Boolean))]
  const pairs = await Promise.all(ids.map(async id => {
    const snap = await getDoc(doc(db,'products',id))
    return [id, snap.exists() ? { id:snap.id, ...snap.data() } : null]
  }))
  const products = Object.fromEntries(pairs)
  return lines.map(line => {
    const id = line.product_id || line.id
    const product = products[id]
    if (!product || product.active === false) throw new Error(`商品「${line.product_name || line.name || ''}」不存在或已封存`)
    return snapshotItem(product,line)
  })
}

function orderPayloadFromEntry(data, items, entryId) {
  const total = items.reduce((s,item) => s + Number(item.subtotal || 0),0)
  return {
    customer_id:data.customer_id,
    customer_name:data.customer_name,
    customer_phone_last2:data.customer_phone_last2 || '',
    customer_phone:data.customer_phone || '',
    items,
    total_amount:total,
    note:data.note || '',
    is_virtual:Boolean(data.is_virtual),
    source:'helper',
    helper_entry_id:entryId,
    created_by_uid:data.created_by_uid || '',
    created_by_name:data.created_by_name || '',
    status:'pending',
    payment_status:'unpaid',
    payable_status:'unpaid',
    refund_amount:0,
    refunds:[],
    status_history:[{ status:'pending', at:nowISO(), note:'小幫手直接建立訂單' }],
  }
}

export const HelperAPI = {
  async catalog(){
    const snap = await getDocs(collection(db,'helper_catalog'))
    return snap.docs.map(normalize).filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  },
  async customers(){
    const snap = await getDocs(collection(db,'customers'))
    return snap.docs.map(normalize).filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  },
  async myEntries(uid){
    const snap = await getDocs(query(collection(db,'helper_entries'),where('created_by_uid','==',uid)))
    return snap.docs.map(normalize).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
  },
  async myPendingOrders(uid){
    // Firestore rules only allow helpers to read orders that are both their own
    // and explicitly marked source='helper'. The query must carry both
    // constraints; filtering source only after getDocs is rejected by Rules.
    const snap = await getDocs(query(
      collection(db,'orders'),
      where('created_by_uid','==',uid),
      where('source','==','helper')
    ))
    return snap.docs.map(normalize)
      .filter(x=>x.status==='pending' && x.archived!==true)
      .sort((a,b)=>String(b.order_date||b.created_at||'').localeCompare(String(a.order_date||a.created_at||'')))
  },
  async allEntries(){
    const snap = await getDocs(collection(db,'helper_entries'))
    return snap.docs.map(normalize).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
  },
  async createDirectEntry(data){
    const items = await hydrateOrderItems(data.items || [])
    const entryRef = doc(collection(db,'helper_entries'))
    const orderRef = doc(collection(db,'orders'))
    const at = now()
    const orderPayload = orderPayloadFromEntry(data,items,entryRef.id)
    const entryPayload = {
      ...data,
      items:(data.items || []).map((x,index) => ({ ...x, sale_price:items[index]?.sale_price ?? x.sale_price ?? 0 })),
      total_amount:items.reduce((s,item)=>s+Number(item.subtotal||0),0),
      status:'converted',
      converted_order_id:orderRef.id,
      converted_at:at,
      direct_order:true,
      created_at:at,
      updated_at:at,
    }
    const batch = writeBatch(db)
    batch.set(entryRef,entryPayload)
    batch.set(orderRef,{ ...orderPayload, order_date:at, created_at:at, updated_at:at })
    await batch.commit()
    return { entry_id:entryRef.id, order_id:orderRef.id }
  },
  async createDirectEntries(entries=[]){
    const prepared = []
    for (const data of entries) {
      const items = await hydrateOrderItems(data.items || [])
      prepared.push({ data,items })
    }
    let created = 0
    for (let i=0; i<prepared.length; i+=190) {
      const batch = writeBatch(db)
      const at = now()
      prepared.slice(i,i+190).forEach(({ data,items }) => {
        const entryRef = doc(collection(db,'helper_entries'))
        const orderRef = doc(collection(db,'orders'))
        const orderPayload = orderPayloadFromEntry(data,items,entryRef.id)
        batch.set(entryRef,{
          ...data,
          items:(data.items || []).map((x,index) => ({ ...x, sale_price:items[index]?.sale_price ?? x.sale_price ?? 0 })),
          total_amount:items.reduce((s,item)=>s+Number(item.subtotal||0),0),
          status:'converted',
          converted_order_id:orderRef.id,
          converted_at:at,
          direct_order:true,
          created_at:at,
          updated_at:at,
        })
        batch.set(orderRef,{ ...orderPayload, order_date:at, created_at:at, updated_at:at })
        created += 1
      })
      await batch.commit()
    }
    return created
  },
  async updateMyPendingOrder(uid,orderId,data){
    const orderRef = doc(db,'orders',orderId)
    const snap = await getDoc(orderRef)
    if (!snap.exists()) throw new Error('找不到訂單')
    const current = snap.data()
    if (current.source !== 'helper' || current.created_by_uid !== uid) throw new Error('只能修改自己建立的訂單')
    if (current.status !== 'pending' || current.archived === true) throw new Error('此訂單已離開未出貨狀態，不能修改')
    if ((current.items || []).some(item => Number(item.arrived_qty || 0) > 0)) throw new Error('此訂單已有商品到貨，請聯絡管理者修改')
    const items = await hydrateOrderItems(data.items || [])
    const total = items.reduce((s,item)=>s+Number(item.subtotal||0),0)
    const at = now()
    const patch = { items,total_amount:total,note:data.note || '',is_virtual:Boolean(data.is_virtual),updated_at:at }
    const batch = writeBatch(db)
    batch.update(orderRef,patch)
    if (current.helper_entry_id) {
      const entryRef = doc(db,'helper_entries',current.helper_entry_id)
      const entrySnap = await getDoc(entryRef)
      if (entrySnap.exists() && entrySnap.data().created_by_uid === uid) {
        batch.update(entryRef,{
          items:(data.items || []).map((x,index)=>({ ...x,sale_price:items[index]?.sale_price ?? x.sale_price ?? 0 })),
          total_amount:total,
          note:data.note || '',
          is_virtual:Boolean(data.is_virtual),
          updated_at:at,
        })
      }
    }
    await batch.commit()
    return true
  },
  async updateEntry(id,data){ await updateDoc(doc(db,'helper_entries',id),{...data,updated_at:now()}) },
  async syncCatalog(products=[]){
    for(let i=0;i<products.length;i+=400){
      const batch=writeBatch(db)
      products.slice(i,i+400).forEach(p=>batch.set(doc(db,'helper_catalog',p.id),{
        name:p.name||'',price:Number(p.price||0),category:p.category||'other',
        pricing_mode:p.pricing_mode||((p.price_options||[]).length?'options':'single'),
        spec_mode:p.spec_mode||'none',spec_colors:p.spec_colors||[],spec_sizes:p.spec_sizes||[],spec_flavors:p.spec_flavors||[],
        price_options:(p.price_options||[]).map(o=>({label:o.label||'',price:Number(o.price||0)})),
        active:p.active!==false,updated_at:now(),
      },{merge:true}))
      await batch.commit()
    }
    return products.length
  }
}
