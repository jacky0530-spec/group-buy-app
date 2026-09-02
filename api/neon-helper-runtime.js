import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const int=(v,d=0)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):d
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const j=v=>JSON.stringify(v??{})
const nowISO=()=>new Date().toISOString()

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('權限不足')
  return account
}
function requireStaff(account){
  if(!['owner','staff'].includes(account?.role)) throw new Error('權限不足')
}
async function ensureProductDeadlineSchema(sql){
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS order_deadline date`
}
const deadlineText=v=>v?String(v).slice(0,10):''

async function customerRow(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id,legacy_id,name,phone,phone_last2 FROM customers WHERE legacy_id=${legacyId} AND active<>false LIMIT 1`
  return rows[0]||null
}
async function customerUuid(sql,legacyId){return (await customerRow(sql,legacyId))?.id||null}
async function orderUuid(sql,legacyId){if(!legacyId)return null;const rows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyId} LIMIT 1`;return rows[0]?.id||null}

async function productSnapshot(sql,line={},enforceDeadline=false){
  const legacy=text(line.product_id||line.id).replace(/^stock:/,'')
  if(!legacy) throw new Error('商品資料不完整')
  const rows=await sql`
    SELECT id,legacy_id,name,category,supplier,price,cost,price_options,supplier_payment_term,order_deadline,
      (order_deadline IS NOT NULL AND order_deadline < (now() AT TIME ZONE 'Asia/Taipei')::date) AS helper_closed
    FROM products WHERE legacy_id=${legacy} AND active<>false LIMIT 1`
  const p=rows[0]
  if(!p) throw new Error(`商品「${text(line.product_name||line.name)||legacy}」不存在或已封存`)
  if(enforceDeadline&&p.helper_closed===true) throw new Error(`商品「${p.name}」已於 ${deadlineText(p.order_deadline)} 結單，小幫手不可再開單`)
  const spec=line.spec||{}
  const packageLabel=text(spec.package)
  const options=Array.isArray(p.price_options)?p.price_options:[]
  const option=packageLabel?options.find(x=>text(x?.label)===packageLabel):null
  const qty=Math.max(1,Math.trunc(num(line.qty)||1))
  const originalQty=Math.max(1,Math.trunc(num(line.original_qty)||qty))
  const sale=Number(option?.price??p.price??0)
  const cost=Number(option?.cost===''||option?.cost==null?p.cost:option.cost)||0
  return {
    product_uuid:p.id,product_id:p.legacy_id,product_name:p.name,category:p.category||'other',supplier:p.supplier||'',
    sale_price:sale,cost_price:cost,qty,original_qty:originalQty,subtotal:sale*qty,cost_subtotal:cost*qty,note:text(line.note),
    spec:{package:text(option?.label||spec.package),flavor:text(spec.flavor),color:text(spec.color),size:text(spec.size)},
    supplier_payment_term:p.supplier_payment_term||'manual',supplier_paid_amount:0,supplier_payment_status:'unpaid',supplier_payment_refs:[],
  }
}

async function hydrateItems(sql,lines=[],enforceDeadline=false){
  await ensureProductDeadlineSchema(sql)
  const items=[]
  for(const line of lines) items.push(await productSnapshot(sql,line,enforceDeadline))
  if(!items.length) throw new Error('至少需要一個商品')
  return items
}

async function assertHelperNewOrderProductsOpen(sql,account,lines=[]){
  if(account?.role!=='helper') return
  await ensureProductDeadlineSchema(sql)
  const ids=[...new Set((Array.isArray(lines)?lines:[]).map(line=>text(line?.product_id||line?.id).replace(/^stock:/,'')).filter(Boolean))]
  if(!ids.length)return
  const rows=await sql`
    SELECT legacy_id AS id,name,order_deadline
    FROM products
    WHERE legacy_id=ANY(${ids}::text[])
      AND active<>false
      AND order_deadline IS NOT NULL
      AND order_deadline < (now() AT TIME ZONE 'Asia/Taipei')::date
    ORDER BY name ASC LIMIT 1`
  if(rows[0]) throw new Error(`商品「${rows[0].name}」已於 ${deadlineText(rows[0].order_deadline)} 結單，小幫手不可再開單`)
}

async function upsertHelperPreorder(sql,auth,account,payload,{editing=false}={}){
  const orderLegacy=text(payload.order_id),entryLegacy=text(payload.entry_id||payload.helper_entry_id)
  if(!orderLegacy||!entryLegacy) throw new Error('缺少訂單識別碼')
  const customer=await customerRow(sql,text(payload.customer_id))
  if(!customer) throw new Error('找不到客戶')
  const sourceLines=Array.isArray(payload.items)?payload.items:[]
  const items=await hydrateItems(sql,sourceLines,account?.role==='helper'&&!editing)
  const total=items.reduce((s,x)=>s+x.subtotal,0)
  const createdAt=text(payload.created_at)||nowISO()
  const displayName=text(payload.created_by_name||payload.display_name)
  const note=text(payload.note)
  const isVirtual=payload.is_virtual===true

  let orderUuidValue=null
  if(editing){
    const current=await sql`SELECT id,helper_entry_id,status,archived,source,created_by_uid,fulfillment_type FROM orders WHERE legacy_id=${orderLegacy} LIMIT 1`
    const o=current[0]
    if(!o||o.source!=='helper'||o.created_by_uid!==auth.uid) throw new Error('只能修改自己建立的訂單')
    if(o.status!=='pending'||o.archived===true) throw new Error('此訂單已離開未出貨狀態，不能修改')
    if(o.fulfillment_type==='stock') throw new Error('現貨訂單不可使用一般預購修改')
    const arrived=await sql`SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=${o.id} AND arrived_qty>0`
    if(Number(arrived[0]?.n||0)>0) throw new Error('此訂單已有商品到貨，請聯絡管理者修改')
    orderUuidValue=o.id
    await sql`UPDATE orders SET customer_id=${customer.id},customer_name=${customer.name},customer_phone=${customer.phone||''},customer_phone_last2=${customer.phone_last2||''},total_amount=${total},note=${note},is_virtual=${isVirtual},updated_at=now() WHERE id=${o.id}`
  }else{
    const rows=await sql`
      INSERT INTO orders (legacy_id,customer_id,customer_name,customer_phone,customer_phone_last2,total_amount,status,payment_status,payable_status,refund_amount,is_virtual,source,fulfillment_type,note,created_by_uid,created_by_name,order_date,status_history,refunds,archived,created_at,updated_at)
      VALUES (${orderLegacy},${customer.id},${customer.name},${customer.phone||''},${customer.phone_last2||''},${total},'pending','unpaid','unpaid',0,${isVirtual},'helper','preorder',${note},${auth.uid},${displayName},${createdAt},${JSON.stringify([{status:'pending',at:createdAt,note:'小幫手直接建立訂單'}])}::jsonb,'[]'::jsonb,false,${createdAt},${createdAt})
      ON CONFLICT (legacy_id) DO UPDATE SET updated_at=orders.updated_at
      RETURNING id
    `
    orderUuidValue=rows[0]?.id
    if(!orderUuidValue) throw new Error('Neon 建立訂單失敗')
    const owner=await sql`SELECT created_by_uid,source,fulfillment_type FROM orders WHERE id=${orderUuidValue} LIMIT 1`
    if(owner[0]?.created_by_uid!==auth.uid||owner[0]?.source!=='helper'||owner[0]?.fulfillment_type==='stock') throw new Error('訂單 ID 已被其他資料使用')
  }

  const previousItems=await sql`SELECT line_no,product_id,spec_package,spec_flavor,spec_color,spec_size,qty,original_qty FROM order_items WHERE order_id=${orderUuidValue}`
  await sql`DELETE FROM order_items WHERE order_id=${orderUuidValue}`
  for(let i=0;i<items.length;i++){
    const x=items[i],s=x.spec,lineNo=i+1
    const previous=previousItems.find(p=>Number(p.line_no)===lineNo&&text(p.product_id)===text(x.product_uuid)&&text(p.spec_package)===s.package&&text(p.spec_flavor)===s.flavor&&text(p.spec_color)===s.color&&text(p.spec_size)===s.size)
    x.original_qty=previous?Math.max(1,Math.trunc(num(previous.original_qty??previous.qty)||x.qty)):x.original_qty
    await sql`INSERT INTO order_items (order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,original_qty,subtotal,cost_subtotal,note,spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,arrived_qty,supplier_payment_term,supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at) VALUES (${orderUuidValue},${lineNo},${x.product_uuid},${x.product_name},${x.category},${x.supplier},${x.sale_price},${x.cost_price},${x.qty},${x.original_qty},${x.subtotal},${x.cost_subtotal},${x.note},${s.package},${s.flavor},${s.color},${s.size},'preorder',0,${x.supplier_payment_term},0,'unpaid','[]'::jsonb,now(),now())`
  }

  const publicItems=items.map(x=>({id:x.product_id,product_id:x.product_id,name:x.product_name,product_name:x.product_name,price:x.sale_price,sale_price:x.sale_price,qty:x.qty,original_qty:x.original_qty,subtotal:x.subtotal,note:x.note,spec:x.spec}))
  const entryPayload={customer_id:customer.legacy_id,customer_name:customer.name,customer_phone_last2:customer.phone_last2||'',items:publicItems,total_amount:total,is_virtual:isVirtual,note,status:'converted',converted_order_id:orderLegacy,direct_order:true,created_by_uid:auth.uid,created_by_name:displayName}
  const entryRows=await sql`
    INSERT INTO helper_entries (legacy_id,created_by_uid,created_by_name,customer_id,customer_name,customer_phone_last2,total_amount,is_virtual,note,status,converted_order_id,direct_order,payload,converted_at,created_at,updated_at)
    VALUES (${entryLegacy},${auth.uid},${displayName},${customer.id},${customer.name},${customer.phone_last2||''},${total},${isVirtual},${note},'converted',${orderUuidValue},true,${JSON.stringify(entryPayload)}::jsonb,now(),${createdAt},now())
    ON CONFLICT (legacy_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,customer_phone_last2=EXCLUDED.customer_phone_last2,total_amount=EXCLUDED.total_amount,is_virtual=EXCLUDED.is_virtual,note=EXCLUDED.note,status='converted',converted_order_id=EXCLUDED.converted_order_id,direct_order=true,payload=EXCLUDED.payload,updated_at=now()
    RETURNING id
  `
  const entryUuid=entryRows[0]?.id
  if(entryUuid) await sql`UPDATE orders SET helper_entry_id=${entryUuid},updated_at=now() WHERE id=${orderUuidValue}`
  return {entry_id:entryLegacy,order_id:orderLegacy,total_amount:total,items:publicItems}
}

async function syncEntry(sql,auth,account,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('小幫手紀錄缺少 legacy id')
  if(account.role==='helper'&&text(row.created_by_uid)!==auth.uid) throw new Error('只能同步自己的小幫手紀錄')
  const customerId=await customerUuid(sql,text(row.customer_id))
  const convertedOrderId=await orderUuid(sql,text(row.converted_order_id))
  const result=await sql`INSERT INTO helper_entries (legacy_id,created_by_uid,created_by_name,customer_id,customer_name,customer_phone_last2,total_amount,is_virtual,note,status,converted_order_id,direct_order,payload,converted_at,created_at,updated_at) VALUES (${legacyId},${text(row.created_by_uid)},${text(row.created_by_name)},${customerId},${text(row.customer_name)},${text(row.customer_phone_last2)},${num(row.total_amount)},${row.is_virtual===true},${text(row.note)},${text(row.status)||'converted'},${convertedOrderId},${row.direct_order!==false},${j(row)}::jsonb,${iso(row.converted_at)},${iso(row.created_at)||nowISO()},${iso(row.updated_at)||nowISO()}) ON CONFLICT (legacy_id) DO UPDATE SET created_by_uid=EXCLUDED.created_by_uid,created_by_name=EXCLUDED.created_by_name,customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,customer_phone_last2=EXCLUDED.customer_phone_last2,total_amount=EXCLUDED.total_amount,is_virtual=EXCLUDED.is_virtual,note=EXCLUDED.note,status=EXCLUDED.status,converted_order_id=EXCLUDED.converted_order_id,direct_order=EXCLUDED.direct_order,payload=EXCLUDED.payload,converted_at=EXCLUDED.converted_at,updated_at=EXCLUDED.updated_at RETURNING id`
  const entryId=result[0]?.id
  if(entryId&&convertedOrderId) await sql`UPDATE orders SET helper_entry_id=${entryId},updated_at=now() WHERE id=${convertedOrderId}`
  return legacyId
}

function mapCatalogRows(rows){
  return rows.map(row=>({...row,price:Number(row.price||0),order_deadline:deadlineText(row.order_deadline),shipped_out:row.shipped_out===true,price_options:(row.price_options||[]).map(option=>({label:option?.label||'',price:Number(option?.price||0)}))}))
}
async function listCatalog(sql){
  await ensureProductDeadlineSchema(sql)
  const rows=await sql`
    SELECT p.legacy_id AS id,p.name,p.price,p.category,p.pricing_mode,p.spec_mode,p.spec_colors,p.spec_sizes,p.spec_flavors,p.price_options,p.order_deadline,p.active,p.updated_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.product_id=p.id AND o.archived<>true AND o.status='shipped'
      ) AND NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.product_id=p.id AND o.archived<>true AND o.status='pending'
      ) THEN true ELSE false END AS shipped_out
    FROM products p
    WHERE p.active<>false
    ORDER BY p.name ASC`
  return mapCatalogRows(rows)
}
async function searchCatalog(sql,q,limit=30,account=null){
  await ensureProductDeadlineSchema(sql)
  const query=text(q).toLowerCase()
  const take=Math.min(50,Math.max(1,int(limit,30)))
  const helperOnly=account?.role==='helper'
  const rows=await sql`
    SELECT p.legacy_id AS id,p.name,p.price,p.category,p.pricing_mode,p.spec_mode,p.spec_colors,p.spec_sizes,p.spec_flavors,p.price_options,p.order_deadline,p.active,p.updated_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.product_id=p.id AND o.archived<>true AND o.status='shipped'
      ) AND NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.product_id=p.id AND o.archived<>true AND o.status='pending'
      ) THEN true ELSE false END AS shipped_out
    FROM products p
    WHERE p.active<>false
      AND (NOT ${helperOnly}::boolean OR p.order_deadline IS NULL OR p.order_deadline >= (now() AT TIME ZONE 'Asia/Taipei')::date)
      AND (${query}='' OR POSITION(${query} IN LOWER(COALESCE(p.name,'')))>0)
    ORDER BY p.name ASC
    LIMIT ${take}`
  return mapCatalogRows(rows)
}

async function listProductDeadlines(sql,body){
  await ensureProductDeadlineSchema(sql)
  const query=text(body?.q).toLowerCase()
  const take=Math.min(250,Math.max(20,int(body?.limit,100)))
  const rows=await sql`
    SELECT legacy_id AS id,name,order_deadline,
      CASE WHEN order_deadline IS NULL THEN 'open'
        WHEN order_deadline < (now() AT TIME ZONE 'Asia/Taipei')::date THEN 'closed'
        WHEN order_deadline = (now() AT TIME ZONE 'Asia/Taipei')::date THEN 'today'
        ELSE 'scheduled' END AS deadline_status
    FROM products
    WHERE active<>false
      AND (${query}='' OR POSITION(${query} IN LOWER(COALESCE(name,'')))>0)
    ORDER BY name ASC
    LIMIT ${take}`
  return rows.map(r=>({...r,order_deadline:deadlineText(r.order_deadline)}))
}
async function setProductDeadline(sql,body){
  await ensureProductDeadlineSchema(sql)
  const id=text(body?.id),deadline=text(body?.order_deadline)
  if(!id) throw new Error('缺少商品 ID')
  if(deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error('結單日格式不正確')
  const rows=await sql`
    UPDATE products SET order_deadline=NULLIF(${deadline},'')::date,updated_at=now()
    WHERE legacy_id=${id} AND active<>false
    RETURNING legacy_id AS id,name,order_deadline`
  if(!rows[0]) throw new Error('找不到商品')
  return {id:rows[0].id,name:rows[0].name,order_deadline:deadlineText(rows[0].order_deadline)}
}

async function listCustomers(sql){return sql`SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note FROM customers WHERE active<>false ORDER BY name ASC`}
async function searchCustomers(sql,q,limit=20){
  const query=text(q).toLowerCase()
  if(!query)return[]
  const take=Math.min(50,Math.max(1,int(limit,20)))
  return sql`
    SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note
    FROM customers
    WHERE active<>false AND (
      POSITION(${query} IN LOWER(COALESCE(name,'')))>0 OR
      POSITION(${query} IN LOWER(COALESCE(phone,'')))>0 OR
      POSITION(${query} IN LOWER(COALESCE(phone_last2,'')))>0 OR
      POSITION(${query} IN LOWER(COALESCE(line_nick,'')))>0 OR
      POSITION(${query} IN LOWER(COALESCE(fb_name,'')))>0 OR
      POSITION(${query} IN LOWER(COALESCE(note,'')))>0
    )
    ORDER BY name ASC
    LIMIT ${take}`
}
async function listMyEntries(sql,auth,limit=20){
  const take=Math.min(100,Math.max(1,int(limit,20)))
  const rows=await sql`SELECT h.legacy_id AS id,h.payload,h.created_by_uid,h.created_by_name,c.legacy_id AS customer_id,h.customer_name,h.customer_phone_last2,h.total_amount,h.is_virtual,h.note,h.status,o.legacy_id AS converted_order_id,h.direct_order,h.converted_at,h.created_at,h.updated_at FROM helper_entries h LEFT JOIN customers c ON c.id=h.customer_id LEFT JOIN orders o ON o.id=h.converted_order_id WHERE h.created_by_uid=${auth.uid} ORDER BY h.created_at DESC LIMIT ${take}`
  return rows.map(row=>({...(row.payload||{}),id:row.id,created_by_uid:row.created_by_uid,created_by_name:row.created_by_name,customer_id:row.customer_id,customer_name:row.customer_name,customer_phone_last2:row.customer_phone_last2,total_amount:Number(row.total_amount||0),is_virtual:row.is_virtual===true,note:row.note||'',status:row.status,converted_order_id:row.converted_order_id,direct_order:row.direct_order,converted_at:row.converted_at,created_at:row.created_at,updated_at:row.updated_at}))
}
async function listMyPendingOrders(sql,auth){
  const orders=await sql`SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN helper_entries h ON h.id=o.helper_entry_id WHERE o.created_by_uid=${auth.uid} AND o.source='helper' AND o.status='pending' AND o.archived<>true ORDER BY o.order_date DESC`
  if(!orders.length)return[]
  const items=await sql`SELECT oi.order_id,p.legacy_id AS product_id,oi.product_name,oi.category,oi.supplier,oi.sale_price,oi.cost_price,oi.qty,oi.original_qty,oi.subtotal,oi.cost_subtotal,oi.note,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,oi.fulfillment_type,oi.arrived_qty,oi.arrived_at,oi.supplier_payment_term,oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs,oi.line_no FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id WHERE o.created_by_uid=${auth.uid} AND o.source='helper' AND o.status='pending' AND o.archived<>true ORDER BY oi.order_id,oi.line_no`
  const byOrder=new Map()
  for(const item of items){if(!byOrder.has(item.order_id))byOrder.set(item.order_id,[]);byOrder.get(item.order_id).push({id:item.product_id||'',product_id:item.product_id||'',name:item.product_name,product_name:item.product_name,price:Number(item.sale_price||0),sale_price:Number(item.sale_price||0),cost_price:Number(item.cost_price||0),category:item.category,supplier:item.supplier,qty:Number(item.qty||0),original_qty:Number(item.original_qty??item.qty??0),subtotal:Number(item.subtotal||0),cost_subtotal:Number(item.cost_subtotal||0),note:item.note||'',spec:{package:item.spec_package||'',flavor:item.spec_flavor||'',color:item.spec_color||'',size:item.spec_size||''},fulfillment_type:item.fulfillment_type,arrived_qty:Number(item.arrived_qty||0),arrived_at:item.arrived_at,supplier_payment_term:item.supplier_payment_term,supplier_paid_amount:Number(item.supplier_paid_amount||0),supplier_payment_status:item.supplier_payment_status,supplier_payment_refs:item.supplier_payment_refs||[]})}
  return orders.map(({neon_id,...row})=>({...row,total_amount:Number(row.total_amount||0),refund_amount:Number(row.refund_amount||0),items:byOrder.get(neon_id)||[]}))
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireAccount(sql,auth)
    const action=text(req.body?.action)
    if(action==='catalog')return res.status(200).json({ok:true,rows:await listCatalog(sql)})
    if(action==='search_catalog')return res.status(200).json({ok:true,rows:await searchCatalog(sql,req.body?.q,req.body?.limit,account)})
    if(action==='product_deadlines'){requireStaff(account);return res.status(200).json({ok:true,rows:await listProductDeadlines(sql,req.body||{})})}
    if(action==='set_product_deadline'){requireStaff(account);return res.status(200).json({ok:true,result:await setProductDeadline(sql,req.body||{})})}
    if(action==='customers')return res.status(200).json({ok:true,rows:await listCustomers(sql)})
    if(action==='search_customers')return res.status(200).json({ok:true,rows:await searchCustomers(sql,req.body?.q,req.body?.limit)})
    if(action==='my_entries')return res.status(200).json({ok:true,rows:await listMyEntries(sql,auth,req.body?.limit)})
    if(action==='my_pending_orders')return res.status(200).json({ok:true,rows:await listMyPendingOrders(sql,auth)})
    if(action==='create_direct'){
      await assertHelperNewOrderProductsOpen(sql,account,req.body?.items||[])
      return res.status(200).json({ok:true,result:await upsertHelperPreorder(sql,auth,account,req.body||{})})
    }
    if(action==='create_direct_many'){
      const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
      if(!rows.length)throw new Error('沒有可建立的訂單')
      if(rows.length>100)throw new Error('單次最多建立 100 筆')
      await assertHelperNewOrderProductsOpen(sql,account,rows.flatMap(row=>Array.isArray(row?.items)?row.items:[]))
      const created=[]
      for(const row of rows)created.push(await upsertHelperPreorder(sql,auth,account,row))
      return res.status(200).json({ok:true,rows:created})
    }
    if(action==='update_pending')return res.status(200).json({ok:true,result:await upsertHelperPreorder(sql,auth,account,req.body||{},{editing:true})})
    if(action==='sync')return res.status(200).json({ok:true,id:await syncEntry(sql,auth,account,req.body?.row||{})})
    if(action==='sync_many'){
      const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
      if(rows.length>200)throw new Error('單次最多同步 200 筆')
      let done=0;for(const row of rows){await syncEntry(sql,auth,account,row);done++}
      return res.status(200).json({ok:true,done})
    }
    throw new Error('未知的小幫手動作')
  }catch(err){
    console.error('neon-helper-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}