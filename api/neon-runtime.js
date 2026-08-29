import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const json=(res,status,data)=>res.status(status).json(data)
const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const j=v=>JSON.stringify(v??[])

async function requireNeonAccount(sql,auth){
  const rows=await sql`SELECT firebase_uid,role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('帳號權限無效')
  return account
}
function requireStaff(account){if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')}

async function syncCustomer(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('客戶缺少 legacy id')
  await sql`INSERT INTO customers (legacy_id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at)
    VALUES (${legacyId},${text(row.name)||'未命名客戶'},${text(row.phone)},${text(row.phone_last2)},${text(row.line_nick)},${text(row.fb_name)},${text(row.note)},${row.active!==false},${iso(row.joined_at)||new Date().toISOString()},${iso(row.archived_at)},${iso(row.updated_at)||new Date().toISOString()})
    ON CONFLICT (legacy_id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,phone_last2=EXCLUDED.phone_last2,line_nick=EXCLUDED.line_nick,fb_name=EXCLUDED.fb_name,note=EXCLUDED.note,active=EXCLUDED.active,joined_at=EXCLUDED.joined_at,archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at`
  return legacyId
}

async function syncProduct(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('商品缺少 legacy id')
  await sql`INSERT INTO products (legacy_id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,active,created_at,archived_at,updated_at)
    VALUES (${legacyId},${text(row.name)||'未命名商品'},${text(row.category)||'other'},${text(row.supplier)},${num(row.price)},${num(row.cost)},${text(row.pricing_mode)||((row.price_options||[]).length?'options':'single')},${text(row.spec_mode)||'none'},${j(row.spec_colors)}::jsonb,${j(row.spec_sizes)}::jsonb,${j(row.spec_flavors)}::jsonb,${j(row.price_options)}::jsonb,${text(row.supplier_payment_term)||'manual'},${row.active!==false},${iso(row.created_at)||new Date().toISOString()},${iso(row.archived_at)},${iso(row.updated_at)||new Date().toISOString()})
    ON CONFLICT (legacy_id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,supplier=EXCLUDED.supplier,price=EXCLUDED.price,cost=EXCLUDED.cost,pricing_mode=EXCLUDED.pricing_mode,spec_mode=EXCLUDED.spec_mode,spec_colors=EXCLUDED.spec_colors,spec_sizes=EXCLUDED.spec_sizes,spec_flavors=EXCLUDED.spec_flavors,price_options=EXCLUDED.price_options,supplier_payment_term=EXCLUDED.supplier_payment_term,active=EXCLUDED.active,created_at=EXCLUDED.created_at,archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at`
  return legacyId
}

async function syncExpense(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('費用缺少 legacy id')
  const type=['shipping','other','discount'].includes(row?.type)?row.type:'other'
  await sql`INSERT INTO expenses (legacy_id,month,supplier,type,amount,note,active,archived_at,created_at,updated_at)
    VALUES (${legacyId},${text(row.month)||null},${text(row.supplier)},${type},${Math.abs(num(row.amount))},${text(row.note)},${row.active!==false},${iso(row.archived_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()})
    ON CONFLICT (legacy_id) DO UPDATE SET month=EXCLUDED.month,supplier=EXCLUDED.supplier,type=EXCLUDED.type,amount=EXCLUDED.amount,note=EXCLUDED.note,active=EXCLUDED.active,archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at`
  return legacyId
}

async function writeCustomer(sql,body){
  const op=text(body?.op)||'update',id=text(body?.id||body?.row?.id)
  if(!id) throw new Error('缺少客戶 ID')
  const now=new Date().toISOString()
  if(op==='create'){const row={...(body.row||{}),id,active:true,joined_at:body.row?.joined_at||now,updated_at:now};await syncCustomer(sql,row);return row}
  const rows=await sql`SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at FROM customers WHERE legacy_id=${id} LIMIT 1`
  if(!rows[0]) throw new Error('Neon 找不到客戶')
  let row={...rows[0],...(body.data||{}),id,updated_at:now}
  if(op==='archive') row={...row,active:false,archived_at:now}
  if(op==='restore') row={...row,active:true,archived_at:null}
  await syncCustomer(sql,row);return row
}

async function writeProduct(sql,body){
  const op=text(body?.op)||'update',id=text(body?.id||body?.row?.id)
  if(!id) throw new Error('缺少商品 ID')
  const now=new Date().toISOString()
  if(op==='create'){const row={...(body.row||{}),id,active:true,created_at:body.row?.created_at||now,updated_at:now};await syncProduct(sql,row);return row}
  const rows=await sql`SELECT legacy_id AS id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,active,created_at,archived_at,updated_at FROM products WHERE legacy_id=${id} LIMIT 1`
  if(!rows[0]) throw new Error('Neon 找不到商品')
  let row={...rows[0],...(body.data||{}),id,updated_at:now}
  if(op==='archive') row={...row,active:false,archived_at:now}
  if(op==='restore') row={...row,active:true,archived_at:null}
  await syncProduct(sql,row);return row
}

async function writeExpense(sql,body){
  const op=text(body?.op)||'update',id=text(body?.id||body?.row?.id)
  if(!id) throw new Error('缺少費用 ID')
  const now=new Date().toISOString()
  if(op==='create'){const row={...(body.row||{}),id,active:true,created_at:body.row?.created_at||now,updated_at:now};await syncExpense(sql,row);return row}
  const rows=await sql`SELECT legacy_id AS id,month,supplier,type,amount,note,active,archived_at,created_at,updated_at FROM expenses WHERE legacy_id=${id} LIMIT 1`
  if(!rows[0]) throw new Error('Neon 找不到費用')
  let row={...rows[0],...(body.data||{}),id,updated_at:now}
  if(op==='archive') row={...row,active:false,archived_at:now}
  await syncExpense(sql,row);return row
}

async function expenseMonth(sql,body){
  const month=text(body?.month)
  if(!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式錯誤')
  const [statsRows,rows]=await Promise.all([
    sql`SELECT COALESCE(SUM(amount) FILTER (WHERE type='shipping'),0) AS shipping,COALESCE(SUM(amount) FILTER (WHERE type='other'),0) AS other,COALESCE(SUM(amount) FILTER (WHERE type='discount'),0) AS discount,COALESCE(SUM(CASE WHEN type='discount' THEN -amount ELSE amount END),0) AS net,COUNT(*)::int AS count FROM expenses WHERE active<>false AND month=${month}`,
    sql`SELECT legacy_id AS id,month,supplier,type,amount,note,active,archived_at,created_at,updated_at FROM expenses WHERE active<>false AND month=${month} ORDER BY created_at DESC`
  ])
  const s=statsRows[0]||{}
  return {rows:rows.map(r=>({...r,amount:Number(r.amount||0)})),stats:{shipping:Number(s.shipping||0),other:Number(s.other||0),discount:Number(s.discount||0),net:Number(s.net||0),count:Number(s.count||0)}}
}

function stockSpecLabel(row){
  return [row.spec_package&&`組合：${row.spec_package}`,row.spec_flavor&&`口味：${row.spec_flavor}`,row.spec_color&&`顏色：${row.spec_color}`,row.spec_size&&`尺寸：${row.spec_size}`].filter(Boolean).join('／')||'一般規格'
}

async function stockSearch(sql,body,account){
  const query=text(body?.search).toLowerCase()
  const limit=Math.min(200,Math.max(1,Math.trunc(num(body?.limit)||80)))
  const includeZero=body?.includeZero===true&&['owner','staff'].includes(account.role)
  const rows=await sql`
    SELECT s.id::text AS neon_id,p.legacy_id AS product_id,p.name AS product_name,s.supplier,s.spec_package,s.spec_flavor,s.spec_color,s.spec_size,s.available_qty,s.adjustment_note,s.created_at,s.updated_at
    FROM stock_inventory s
    JOIN products p ON p.id=s.product_id
    WHERE p.active<>false
      AND (${includeZero} OR s.available_qty>0)
      AND (${query}='' OR POSITION(${query} IN LOWER(COALESCE(p.name,'')))>0 OR POSITION(${query} IN LOWER(COALESCE(s.supplier,'')))>0 OR POSITION(${query} IN LOWER(COALESCE(s.spec_package,'')))>0 OR POSITION(${query} IN LOWER(COALESCE(s.spec_flavor,'')))>0 OR POSITION(${query} IN LOWER(COALESCE(s.spec_color,'')))>0 OR POSITION(${query} IN LOWER(COALESCE(s.spec_size,'')))>0)
    ORDER BY p.name ASC,s.spec_package ASC,s.spec_flavor ASC,s.spec_color ASC,s.spec_size ASC
    LIMIT ${limit}`
  return rows.map(row=>{
    const spec={package:row.spec_package||'',flavor:row.spec_flavor||'',color:row.spec_color||'',size:row.spec_size||''}
    const key=[spec.package,spec.flavor,spec.color,spec.size].join('|')||'default'
    return {neon_id:row.neon_id,id:`${row.product_id}__${encodeURIComponent(key)}`,product_id:row.product_id,product_name:row.product_name||'',supplier:row.supplier||'',spec,spec_label:stockSpecLabel(row),available_qty:Number(row.available_qty||0),adjustment_note:row.adjustment_note||'',created_at:row.created_at,updated_at:row.updated_at}
  })
}

async function listOrders(sql){
  const orders=await sql`SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN helper_entries h ON h.id=o.helper_entry_id ORDER BY o.order_date DESC`
  const items=await sql`SELECT oi.order_id,p.legacy_id AS product_id,oi.product_name,oi.category,oi.supplier,oi.sale_price,oi.cost_price,oi.qty,oi.original_qty,oi.subtotal,oi.cost_subtotal,oi.note,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,oi.fulfillment_type,oi.arrived_qty,oi.arrived_at,oi.supplier_payment_term,oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs,oi.created_at,oi.updated_at,oi.line_no FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id ORDER BY oi.order_id,oi.line_no`
  const byOrder=new Map()
  for(const item of items){
    const row={id:item.product_id||'',product_id:item.product_id||'',name:item.product_name,product_name:item.product_name,category:item.category,supplier:item.supplier,price:Number(item.sale_price||0),sale_price:Number(item.sale_price||0),cost_price:Number(item.cost_price||0),qty:Number(item.qty||0),original_qty:Number(item.original_qty??item.qty??0),subtotal:Number(item.subtotal||0),cost_subtotal:Number(item.cost_subtotal||0),note:item.note||'',spec:{package:item.spec_package||'',flavor:item.spec_flavor||'',color:item.spec_color||'',size:item.spec_size||''},fulfillment_type:item.fulfillment_type,arrived_qty:Number(item.arrived_qty||0),arrived_at:item.arrived_at,supplier_payment_term:item.supplier_payment_term,supplier_paid_amount:Number(item.supplier_paid_amount||0),supplier_payment_status:item.supplier_payment_status,supplier_payment_refs:item.supplier_payment_refs||[],created_at:item.created_at,updated_at:item.updated_at}
    if(!byOrder.has(item.order_id))byOrder.set(item.order_id,[])
    byOrder.get(item.order_id).push(row)
  }
  return orders.map(({neon_id,...order})=>({...order,total_amount:Number(order.total_amount||0),refund_amount:Number(order.refund_amount||0),items:byOrder.get(neon_id)||[]}))
}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req),sql=neon(process.env.DATABASE_URL),account=await requireNeonAccount(sql,auth),action=text(req.body?.action)
    if(action==='ping') return json(res,200,{ok:true,role:account.role})
    if(action==='stock_search') return json(res,200,{ok:true,rows:await stockSearch(sql,req.body||{},account)})
    if(action==='list_customers'){requireStaff(account);const includeArchived=req.body?.includeArchived===true;const rows=includeArchived?await sql`SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at FROM customers ORDER BY joined_at DESC`:await sql`SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at FROM customers WHERE active<>false ORDER BY joined_at DESC`;return json(res,200,{ok:true,rows})}
    if(action==='list_products'){requireStaff(account);const includeArchived=req.body?.includeArchived===true;const rows=includeArchived?await sql`SELECT legacy_id AS id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,active,created_at,archived_at,updated_at FROM products ORDER BY created_at DESC`:await sql`SELECT legacy_id AS id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,active,created_at,archived_at,updated_at FROM products WHERE active<>false ORDER BY created_at DESC`;return json(res,200,{ok:true,rows})}
    if(action==='list_orders'){requireStaff(account);return json(res,200,{ok:true,rows:await listOrders(sql)})}
    if(action==='list_expenses'){requireStaff(account);const includeArchived=req.body?.includeArchived===true;const rows=includeArchived?await sql`SELECT legacy_id AS id,month,supplier,type,amount,note,active,archived_at,created_at,updated_at FROM expenses ORDER BY month DESC,created_at DESC`:await sql`SELECT legacy_id AS id,month,supplier,type,amount,note,active,archived_at,created_at,updated_at FROM expenses WHERE active<>false ORDER BY month DESC,created_at DESC`;return json(res,200,{ok:true,rows})}
    if(action==='expense_month'){requireStaff(account);return json(res,200,{ok:true,...await expenseMonth(sql,req.body||{})})}
    if(action==='sync_customer'){requireStaff(account);return json(res,200,{ok:true,id:await syncCustomer(sql,req.body?.row||{})})}
    if(action==='sync_customers'){requireStaff(account);const rows=Array.isArray(req.body?.rows)?req.body.rows:[];if(rows.length>250)throw new Error('單次最多同步 250 位客戶');let done=0;for(const row of rows){await syncCustomer(sql,row);done++}return json(res,200,{ok:true,done})}
    if(action==='sync_product'){requireStaff(account);return json(res,200,{ok:true,id:await syncProduct(sql,req.body?.row||{})})}
    if(action==='sync_expense'){requireStaff(account);return json(res,200,{ok:true,id:await syncExpense(sql,req.body?.row||{})})}
    if(action==='write_customer'){requireStaff(account);return json(res,200,{ok:true,result:await writeCustomer(sql,req.body||{})})}
    if(action==='write_product'){requireStaff(account);return json(res,200,{ok:true,result:await writeProduct(sql,req.body||{})})}
    if(action==='write_expense'){requireStaff(account);return json(res,200,{ok:true,result:await writeExpense(sql,req.body||{})})}
    throw new Error('未知的 Neon runtime 動作')
  }catch(err){console.error('neon-runtime',err);return json(res,401,{ok:false,error:String(err?.message||err)})}
}
