import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const j=v=>JSON.stringify(v??{})

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('權限不足')
  return account
}

async function customerUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM customers WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function orderUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function syncEntry(sql,auth,account,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('小幫手紀錄缺少 legacy id')
  if(account.role==='helper' && text(row.created_by_uid)!==auth.uid) throw new Error('只能同步自己的小幫手紀錄')
  const customerId=await customerUuid(sql,text(row.customer_id))
  const convertedOrderId=await orderUuid(sql,text(row.converted_order_id))
  const result=await sql`
    INSERT INTO helper_entries (
      legacy_id,created_by_uid,created_by_name,customer_id,customer_name,customer_phone_last2,total_amount,
      is_virtual,note,status,converted_order_id,direct_order,payload,converted_at,created_at,updated_at
    ) VALUES (
      ${legacyId},${text(row.created_by_uid)},${text(row.created_by_name)},${customerId},${text(row.customer_name)},${text(row.customer_phone_last2)},
      ${num(row.total_amount)},${row.is_virtual===true},${text(row.note)},${text(row.status)||'converted'},${convertedOrderId},${row.direct_order!==false},
      ${j(row)}::jsonb,${iso(row.converted_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      created_by_uid=EXCLUDED.created_by_uid,created_by_name=EXCLUDED.created_by_name,customer_id=EXCLUDED.customer_id,
      customer_name=EXCLUDED.customer_name,customer_phone_last2=EXCLUDED.customer_phone_last2,total_amount=EXCLUDED.total_amount,
      is_virtual=EXCLUDED.is_virtual,note=EXCLUDED.note,status=EXCLUDED.status,converted_order_id=EXCLUDED.converted_order_id,
      direct_order=EXCLUDED.direct_order,payload=EXCLUDED.payload,converted_at=EXCLUDED.converted_at,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const entryId=result[0]?.id
  if(entryId&&convertedOrderId) await sql`UPDATE orders SET helper_entry_id=${entryId},updated_at=${new Date().toISOString()} WHERE id=${convertedOrderId}`
  return legacyId
}

async function listCatalog(sql){
  const rows=await sql`
    SELECT legacy_id AS id,name,price,category,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,active,updated_at
    FROM products
    WHERE active<>false
    ORDER BY name ASC
  `
  return rows.map(row=>({
    ...row,
    price:Number(row.price||0),
    price_options:(row.price_options||[]).map(option=>({label:option?.label||'',price:Number(option?.price||0)})),
  }))
}

async function listMyEntries(sql,auth){
  const rows=await sql`
    SELECT h.legacy_id AS id,h.payload,h.created_by_uid,h.created_by_name,c.legacy_id AS customer_id,
      h.customer_name,h.customer_phone_last2,h.total_amount,h.is_virtual,h.note,h.status,
      o.legacy_id AS converted_order_id,h.direct_order,h.converted_at,h.created_at,h.updated_at
    FROM helper_entries h
    LEFT JOIN customers c ON c.id=h.customer_id
    LEFT JOIN orders o ON o.id=h.converted_order_id
    WHERE h.created_by_uid=${auth.uid}
    ORDER BY h.created_at DESC
  `
  return rows.map(row=>({
    ...(row.payload||{}),
    id:row.id,
    created_by_uid:row.created_by_uid,
    created_by_name:row.created_by_name,
    customer_id:row.customer_id,
    customer_name:row.customer_name,
    customer_phone_last2:row.customer_phone_last2,
    total_amount:Number(row.total_amount||0),
    is_virtual:row.is_virtual===true,
    note:row.note||'',
    status:row.status,
    converted_order_id:row.converted_order_id,
    direct_order:row.direct_order,
    converted_at:row.converted_at,
    created_at:row.created_at,
    updated_at:row.updated_at,
  }))
}

async function listMyPendingOrders(sql,auth){
  const orders=await sql`
    SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,
      o.customer_phone_last2,o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,
      o.is_virtual,o.source,o.fulfillment_type,o.note,o.created_by_uid,o.created_by_name,o.order_date,
      o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,o.status_history,o.refunds,
      o.created_at,o.updated_at,h.legacy_id AS helper_entry_id
    FROM orders o
    LEFT JOIN customers c ON c.id=o.customer_id
    LEFT JOIN helper_entries h ON h.id=o.helper_entry_id
    WHERE o.created_by_uid=${auth.uid} AND o.source='helper' AND o.status='pending' AND o.archived<>true
    ORDER BY o.order_date DESC
  `
  if(!orders.length) return []
  const items=await sql`
    SELECT oi.order_id,p.legacy_id AS product_id,oi.product_name,oi.category,oi.supplier,oi.sale_price,
      oi.cost_price,oi.qty,oi.subtotal,oi.cost_subtotal,oi.note,oi.spec_package,oi.spec_flavor,oi.spec_color,
      oi.spec_size,oi.fulfillment_type,oi.arrived_qty,oi.arrived_at,oi.supplier_payment_term,
      oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs,oi.line_no
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN products p ON p.id=oi.product_id
    WHERE o.created_by_uid=${auth.uid} AND o.source='helper' AND o.status='pending' AND o.archived<>true
    ORDER BY oi.order_id,oi.line_no
  `
  const byOrder=new Map()
  for(const item of items){
    if(!byOrder.has(item.order_id)) byOrder.set(item.order_id,[])
    byOrder.get(item.order_id).push({
      id:item.product_id||'',product_id:item.product_id||'',name:item.product_name,product_name:item.product_name,
      price:Number(item.sale_price||0),sale_price:Number(item.sale_price||0),cost_price:Number(item.cost_price||0),
      category:item.category,supplier:item.supplier,qty:Number(item.qty||0),subtotal:Number(item.subtotal||0),
      cost_subtotal:Number(item.cost_subtotal||0),note:item.note||'',
      spec:{package:item.spec_package||'',flavor:item.spec_flavor||'',color:item.spec_color||'',size:item.spec_size||''},
      fulfillment_type:item.fulfillment_type,arrived_qty:Number(item.arrived_qty||0),arrived_at:item.arrived_at,
      supplier_payment_term:item.supplier_payment_term,supplier_paid_amount:Number(item.supplier_paid_amount||0),
      supplier_payment_status:item.supplier_payment_status,supplier_payment_refs:item.supplier_payment_refs||[],
    })
  }
  return orders.map(({neon_id,...row})=>({
    ...row,total_amount:Number(row.total_amount||0),refund_amount:Number(row.refund_amount||0),items:byOrder.get(neon_id)||[],
  }))
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireAccount(sql,auth)
    const action=text(req.body?.action)
    if(action==='catalog') return res.status(200).json({ok:true,rows:await listCatalog(sql)})
    if(action==='my_entries') return res.status(200).json({ok:true,rows:await listMyEntries(sql,auth)})
    if(action==='my_pending_orders') return res.status(200).json({ok:true,rows:await listMyPendingOrders(sql,auth)})
    if(action==='sync') return res.status(200).json({ok:true,id:await syncEntry(sql,auth,account,req.body?.row||{})})
    if(action==='sync_many'){
      const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
      if(rows.length>200) throw new Error('單次最多同步 200 筆')
      let done=0
      for(const row of rows){await syncEntry(sql,auth,account,row);done++}
      return res.status(200).json({ok:true,done})
    }
    throw new Error('未知的小幫手動作')
  }catch(err){
    console.error('neon-helper-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
