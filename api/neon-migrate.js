import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken, verifyFirestoreOwner } from '../server/firebaseToken.js'

const json = (res,status,data) => res.status(status).json(data)
const text = v => String(v ?? '').trim()
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0
const bool = v => v === true
const iso = v => {
  if(!v) return null
  if(typeof v === 'string') return v
  if(v?.seconds) return new Date(Number(v.seconds) * 1000).toISOString()
  return null
}
const role = v => ['owner','staff','helper'].includes(v) ? v : 'staff'
const status = v => ['pending','shipped','cancelled'].includes(v) ? v : 'pending'
const fulfillment = v => v === 'stock' ? 'stock' : 'preorder'
const j = v => JSON.stringify(v ?? [])

async function upsertAccounts(sql,rows){
  let done = 0
  for(const row of rows){
    const uid = text(row.id || row.firebase_uid)
    if(!uid) continue
    await sql`
      INSERT INTO accounts (firebase_uid,email,display_name,role,disabled,created_at,updated_at)
      VALUES (${uid},${text(row.email).toLowerCase() || null},${text(row.display_name)},${role(row.role)},${bool(row.disabled)},${iso(row.created_at) || new Date().toISOString()},${new Date().toISOString()})
      ON CONFLICT (firebase_uid) DO UPDATE SET
        email=EXCLUDED.email, display_name=EXCLUDED.display_name, role=EXCLUDED.role,
        disabled=EXCLUDED.disabled, updated_at=EXCLUDED.updated_at
    `
    done += 1
  }
  return done
}

async function upsertCustomers(sql,rows){
  let done = 0
  for(const row of rows){
    const legacyId = text(row.id || row.legacy_id)
    if(!legacyId) continue
    await sql`
      INSERT INTO customers (legacy_id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at)
      VALUES (${legacyId},${text(row.name) || '未命名客戶'},${text(row.phone)},${text(row.phone_last2)},${text(row.line_nick)},${text(row.fb_name)},${text(row.note)},${row.active !== false},${iso(row.joined_at) || new Date().toISOString()},${iso(row.archived_at)},${new Date().toISOString()})
      ON CONFLICT (legacy_id) DO UPDATE SET
        name=EXCLUDED.name,phone=EXCLUDED.phone,phone_last2=EXCLUDED.phone_last2,
        line_nick=EXCLUDED.line_nick,fb_name=EXCLUDED.fb_name,note=EXCLUDED.note,
        active=EXCLUDED.active,archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at
    `
    done += 1
  }
  return done
}

async function upsertProducts(sql,rows){
  let done = 0
  for(const row of rows){
    const legacyId = text(row.id || row.legacy_id)
    if(!legacyId) continue
    await sql`
      INSERT INTO products (
        legacy_id,name,category,supplier,price,cost,pricing_mode,spec_mode,
        spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,
        active,created_at,archived_at,updated_at
      ) VALUES (
        ${legacyId},${text(row.name) || '未命名商品'},${text(row.category) || 'other'},${text(row.supplier)},
        ${num(row.price)},${num(row.cost)},${text(row.pricing_mode) || ((row.price_options || []).length ? 'options' : 'single')},${text(row.spec_mode) || 'none'},
        ${j(row.spec_colors)}::jsonb,${j(row.spec_sizes)}::jsonb,${j(row.spec_flavors)}::jsonb,${j(row.price_options)}::jsonb,${text(row.supplier_payment_term) || 'manual'},
        ${row.active !== false},${iso(row.created_at) || new Date().toISOString()},${iso(row.archived_at)},${new Date().toISOString()}
      )
      ON CONFLICT (legacy_id) DO UPDATE SET
        name=EXCLUDED.name,category=EXCLUDED.category,supplier=EXCLUDED.supplier,
        price=EXCLUDED.price,cost=EXCLUDED.cost,pricing_mode=EXCLUDED.pricing_mode,
        spec_mode=EXCLUDED.spec_mode,spec_colors=EXCLUDED.spec_colors,spec_sizes=EXCLUDED.spec_sizes,
        spec_flavors=EXCLUDED.spec_flavors,price_options=EXCLUDED.price_options,
        supplier_payment_term=EXCLUDED.supplier_payment_term,active=EXCLUDED.active,
        archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at
    `
    done += 1
  }
  return done
}

async function customerUuid(sql,legacyId){
  if(!legacyId) return null
  const rows = await sql`SELECT id FROM customers WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id || null
}
async function productUuid(sql,legacyId){
  if(!legacyId) return null
  const rows = await sql`SELECT id FROM products WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id || null
}

async function upsertOrders(sql,rows){
  let done = 0
  let itemsDone = 0
  for(const row of rows){
    const legacyId = text(row.id || row.legacy_id)
    if(!legacyId) continue
    const customerId = await customerUuid(sql,text(row.customer_id))
    const orderFulfillment = fulfillment(row.fulfillment_type || ((row.items || []).every(i => i.fulfillment_type === 'stock') ? 'stock' : 'preorder'))
    const orderRows = await sql`
      INSERT INTO orders (
        legacy_id,customer_id,customer_name,customer_phone,customer_phone_last2,total_amount,
        status,payment_status,payable_status,refund_amount,is_virtual,source,fulfillment_type,note,
        created_by_uid,created_by_name,order_date,shipped_at,cancelled_at,cancellation_reason,
        archived,archived_at,status_history,refunds,created_at,updated_at
      ) VALUES (
        ${legacyId},${customerId},${text(row.customer_name)},${text(row.customer_phone)},${text(row.customer_phone_last2)},${num(row.total_amount)},
        ${status(row.status)},${text(row.payment_status) || 'unpaid'},${text(row.payable_status) || 'unpaid'},${num(row.refund_amount)},${bool(row.is_virtual)},${text(row.source) || 'admin'},${orderFulfillment},${text(row.note)},
        ${text(row.created_by_uid)},${text(row.created_by_name)},${iso(row.order_date) || iso(row.created_at) || new Date().toISOString()},${iso(row.shipped_at)},${iso(row.cancelled_at)},${text(row.cancellation_reason)},
        ${bool(row.archived)},${iso(row.archived_at)},${j(row.status_history)}::jsonb,${j(row.refunds)}::jsonb,${iso(row.created_at) || new Date().toISOString()},${new Date().toISOString()}
      )
      ON CONFLICT (legacy_id) DO UPDATE SET
        customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,
        customer_phone=EXCLUDED.customer_phone,customer_phone_last2=EXCLUDED.customer_phone_last2,
        total_amount=EXCLUDED.total_amount,status=EXCLUDED.status,payment_status=EXCLUDED.payment_status,
        payable_status=EXCLUDED.payable_status,refund_amount=EXCLUDED.refund_amount,
        is_virtual=EXCLUDED.is_virtual,source=EXCLUDED.source,fulfillment_type=EXCLUDED.fulfillment_type,
        note=EXCLUDED.note,created_by_uid=EXCLUDED.created_by_uid,created_by_name=EXCLUDED.created_by_name,
        order_date=EXCLUDED.order_date,shipped_at=EXCLUDED.shipped_at,cancelled_at=EXCLUDED.cancelled_at,
        cancellation_reason=EXCLUDED.cancellation_reason,archived=EXCLUDED.archived,archived_at=EXCLUDED.archived_at,
        status_history=EXCLUDED.status_history,refunds=EXCLUDED.refunds,updated_at=EXCLUDED.updated_at
      RETURNING id
    `
    const orderId = orderRows[0]?.id
    if(!orderId) continue
    await sql`DELETE FROM order_items WHERE order_id=${orderId}`
    let lineNo = 0
    for(const item of (row.items || [])){
      lineNo += 1
      const legacyProductId = text(item.product_id || item.id)
      const pid = await productUuid(sql,legacyProductId)
      const spec = item.spec || {}
      const qty = Math.max(1,Math.trunc(num(item.qty) || 1))
      const salePrice = num(item.sale_price ?? item.price)
      const costPrice = num(item.cost_price)
      await sql`
        INSERT INTO order_items (
          order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,
          subtotal,cost_subtotal,note,spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,
          arrived_qty,arrived_at,supplier_payment_term,supplier_paid_amount,supplier_payment_status,
          supplier_payment_refs,created_at,updated_at
        ) VALUES (
          ${orderId},${lineNo},${pid},${text(item.product_name || item.name)},${text(item.category) || 'other'},${text(item.supplier)},
          ${salePrice},${costPrice},${qty},${num(item.subtotal || salePrice * qty)},${num(item.cost_subtotal || costPrice * qty)},${text(item.note)},
          ${text(spec.package)},${text(spec.flavor)},${text(spec.color)},${text(spec.size)},${fulfillment(item.fulfillment_type || orderFulfillment)},
          ${Math.max(0,Math.trunc(num(item.arrived_qty)))},${iso(item.arrived_at)},${text(item.supplier_payment_term) || 'manual'},
          ${num(item.supplier_paid_amount)},${text(item.supplier_payment_status) || 'unpaid'},${j(item.supplier_payment_refs)}::jsonb,
          ${iso(row.created_at) || new Date().toISOString()},${new Date().toISOString()}
        )
      `
      itemsDone += 1
    }
    done += 1
  }
  return { orders:done, items:itemsDone }
}

async function counts(sql){
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM customers) AS customers,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM orders) AS orders,
      (SELECT count(*)::int FROM order_items) AS order_items
  `
  return rows[0]
}

export default async function handler(req,res){
  if(req.method !== 'POST') return json(res,405,{ ok:false,error:'Method Not Allowed' })
  try{
    if(!process.env.DATABASE_URL) throw new Error('Vercel 尚未設定 DATABASE_URL')
    const auth = await verifyFirebaseIdToken(req)
    await verifyFirestoreOwner(auth)
    const sql = neon(process.env.DATABASE_URL)
    const action = text(req.body?.action)
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    if(rows.length > 250) throw new Error('單次最多搬移 250 筆，請分批處理')
    let migrated = null
    if(action === 'accounts') migrated = await upsertAccounts(sql,rows)
    else if(action === 'customers') migrated = await upsertCustomers(sql,rows)
    else if(action === 'products') migrated = await upsertProducts(sql,rows)
    else if(action === 'orders') migrated = await upsertOrders(sql,rows)
    else if(action === 'counts') migrated = await counts(sql)
    else throw new Error('未知的搬移動作')
    return json(res,200,{ ok:true,action,migrated,counts:await counts(sql) })
  }catch(err){
    console.error('neon-migrate',err)
    return json(res,400,{ ok:false,error:err?.message || '搬移失敗' })
  }
}
