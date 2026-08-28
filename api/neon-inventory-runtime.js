import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package??row?.spec_package),flavor:text(s.flavor??row?.spec_flavor),color:text(s.color??row?.spec_color),size:text(s.size??row?.spec_size)}}
const randomId=()=>`${Date.now().toString(36)}${Math.random().toString(36).slice(2,14)}`

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('權限不足')
  return account
}
function requireStaff(account){if(!['owner','staff'].includes(account.role)) throw new Error('庫存管理僅限管理人員')}
async function productUuid(sql,legacyId){if(!legacyId)return null;const rows=await sql`SELECT id FROM products WHERE legacy_id=${legacyId} LIMIT 1`;return rows[0]?.id||null}
async function orderUuid(sql,legacyId){if(!legacyId)return null;const rows=await sql`SELECT id,created_by_uid,source FROM orders WHERE legacy_id=${legacyId} LIMIT 1`;return rows[0]||null}
async function inventoryUuid(sql,productId,spec){if(!productId)return null;const rows=await sql`SELECT id FROM stock_inventory WHERE product_id=${productId} AND spec_package=${spec.package} AND spec_flavor=${spec.flavor} AND spec_color=${spec.color} AND spec_size=${spec.size} LIMIT 1`;return rows[0]?.id||null}
function legacyInventoryId(productId,spec){const key=[spec.package||'',spec.flavor||'',spec.color||'',spec.size||''].join('|')||'default';return `${productId}__${encodeURIComponent(key)}`}

async function syncInventory(sql,row){
  const productId=await productUuid(sql,text(row.product_id));if(!productId) throw new Error('Neon 找不到庫存商品')
  const spec=cleanSpec(row)
  const rows=await sql`INSERT INTO stock_inventory (product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,available_qty,adjustment_note,created_at,updated_at)
    VALUES (${productId},${text(row.supplier)},${spec.package},${spec.flavor},${spec.color},${spec.size},${Math.max(0,Math.trunc(num(row.available_qty)))},${text(row.adjustment_note)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()})
    ON CONFLICT (product_id,spec_package,spec_flavor,spec_color,spec_size) DO UPDATE SET supplier=EXCLUDED.supplier,available_qty=EXCLUDED.available_qty,adjustment_note=EXCLUDED.adjustment_note,updated_at=EXCLUDED.updated_at RETURNING id`
  return rows[0]?.id||null
}

async function syncExtra(sql,row){
  const legacyId=text(row.id||row.legacy_id),productId=await productUuid(sql,text(row.product_id));if(!legacyId||!productId) throw new Error('額外叫貨缺少對應商品或 ID')
  const spec=cleanSpec(row),invId=await inventoryUuid(sql,productId,spec)
  const status=['ordered','received','cancelled'].includes(row.status)?row.status:(num(row.received_qty)>=num(row.ordered_qty)&&num(row.ordered_qty)>0?'received':'ordered')
  await sql`INSERT INTO stock_purchase_extras (legacy_id,product_id,product_name,supplier,spec_package,spec_flavor,spec_color,spec_size,spec_label,ordered_qty,received_qty,unit_cost,note,status,stock_inventory_id,received_at,created_at,updated_at)
    VALUES (${legacyId},${productId},${text(row.product_name)},${text(row.supplier)},${spec.package},${spec.flavor},${spec.color},${spec.size},${text(row.spec_label)},${Math.max(1,Math.trunc(num(row.ordered_qty)||1))},${Math.max(0,Math.trunc(num(row.received_qty)))},${num(row.unit_cost)},${text(row.note)},${status},${invId},${iso(row.received_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()})
    ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET product_id=EXCLUDED.product_id,product_name=EXCLUDED.product_name,supplier=EXCLUDED.supplier,spec_package=EXCLUDED.spec_package,spec_flavor=EXCLUDED.spec_flavor,spec_color=EXCLUDED.spec_color,spec_size=EXCLUDED.spec_size,spec_label=EXCLUDED.spec_label,ordered_qty=EXCLUDED.ordered_qty,received_qty=EXCLUDED.received_qty,unit_cost=EXCLUDED.unit_cost,note=EXCLUDED.note,status=EXCLUDED.status,stock_inventory_id=EXCLUDED.stock_inventory_id,received_at=EXCLUDED.received_at,updated_at=EXCLUDED.updated_at`
  return legacyId
}

async function consumeStock(sql,auth,account,payload){
  const qty=Math.max(1,Math.trunc(num(payload?.qty)||1)),order=await orderUuid(sql,text(payload?.order_id));if(!order) throw new Error('Neon 找不到現貨訂單')
  if(account.role==='helper'&&(order.created_by_uid!==auth.uid||order.source!=='helper')) throw new Error('只能扣除自己建立的現貨訂單庫存')
  const productId=await productUuid(sql,text(payload?.product_id));if(!productId) throw new Error('Neon 找不到現貨商品')
  const spec=cleanSpec(payload)
  const rows=await sql`WITH target AS (SELECT id FROM stock_inventory WHERE product_id=${productId} AND spec_package=${spec.package} AND spec_flavor=${spec.flavor} AND spec_color=${spec.color} AND spec_size=${spec.size}),
    already AS (SELECT 1 AS done FROM inventory_transactions it,target t WHERE it.inventory_id=t.id AND it.order_id=${order.id} AND it.transaction_type='sale' LIMIT 1),
    updated AS (UPDATE stock_inventory s SET available_qty=s.available_qty-${qty},updated_at=now() FROM target t WHERE s.id=t.id AND s.available_qty>=${qty} AND NOT EXISTS (SELECT 1 FROM already) RETURNING s.id,s.available_qty),
    movement AS (INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid) SELECT u.id,${-qty},u.available_qty,'sale',${order.id},${text(payload?.note)||'現貨訂單扣庫存'},${auth.uid} FROM updated u RETURNING id)
    SELECT 'updated'::text AS state,available_qty FROM updated UNION ALL SELECT 'already'::text AS state,s.available_qty FROM stock_inventory s,target t WHERE s.id=t.id AND EXISTS (SELECT 1 FROM already) LIMIT 1`
  if(!rows.length) throw new Error('Neon 現貨不足或庫存不存在')
  return {state:rows[0].state,available_qty:Number(rows[0].available_qty||0)}
}

async function setStock(sql,auth,payload){
  const targetQty=Math.max(0,Math.trunc(num(payload?.available_qty))),productId=await productUuid(sql,text(payload?.product_id));if(!productId) throw new Error('Neon 找不到庫存商品')
  const spec=cleanSpec(payload),note=text(payload?.note||payload?.adjustment_note)||'手動調整庫存'
  const rows=await sql`WITH previous AS (SELECT id,available_qty FROM stock_inventory WHERE product_id=${productId} AND spec_package=${spec.package} AND spec_flavor=${spec.flavor} AND spec_color=${spec.color} AND spec_size=${spec.size} FOR UPDATE),
    changed AS (UPDATE stock_inventory s SET available_qty=${targetQty},adjustment_note=${note},updated_at=now() FROM previous p WHERE s.id=p.id RETURNING s.id,p.available_qty AS before_qty,s.available_qty AS after_qty),
    movement AS (INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,note,created_by_uid) SELECT id,after_qty-before_qty,after_qty,'adjustment',${note},${auth.uid} FROM changed WHERE after_qty<>before_qty RETURNING id)
    SELECT before_qty,after_qty FROM changed`
  if(!rows.length) throw new Error('Neon 找不到要調整的庫存')
  return {before:Number(rows[0].before_qty||0),after:Number(rows[0].after_qty||0)}
}

async function receiveExtra(sql,auth,payload){
  const legacyId=text(payload?.extra_id);if(!legacyId) throw new Error('缺少額外叫貨 ID')
  const rows=await sql`WITH extra AS (
      SELECT id,product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,stock_inventory_id,ordered_qty,received_qty,status
      FROM stock_purchase_extras WHERE legacy_id=${legacyId} LIMIT 1
    ),
    guard AS (
      SELECT e.*,GREATEST(e.ordered_qty-e.received_qty,0)::integer AS incoming
      FROM extra e
      WHERE e.status<>'cancelled' AND e.ordered_qty>e.received_qty
        AND NOT EXISTS (SELECT 1 FROM inventory_transactions it WHERE it.extra_purchase_id=e.id AND it.transaction_type='receive')
    ),
    upsert_inventory AS (
      INSERT INTO stock_inventory (product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,available_qty,created_at,updated_at)
      SELECT product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,incoming,now(),now() FROM guard
      ON CONFLICT (product_id,spec_package,spec_flavor,spec_color,spec_size)
      DO UPDATE SET available_qty=stock_inventory.available_qty+EXCLUDED.available_qty,updated_at=now()
      RETURNING id,available_qty
    ),
    linked AS (
      UPDATE stock_purchase_extras e
      SET stock_inventory_id=u.id,received_qty=e.ordered_qty,status='received',received_at=now(),updated_at=now()
      FROM upsert_inventory u,guard g WHERE e.id=g.id
      RETURNING e.id,u.id AS inventory_id,u.available_qty,g.incoming
    ),
    movement AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,extra_purchase_id,note,created_by_uid)
      SELECT l.inventory_id,l.incoming,l.available_qty,'receive',l.id,${text(payload?.note)||'額外叫貨入庫'},${auth.uid} FROM linked l
      RETURNING id
    )
    SELECT 'received'::text AS state,available_qty,incoming FROM linked
    UNION ALL
    SELECT 'already'::text AS state,s.available_qty,0::integer AS incoming
    FROM extra e JOIN stock_inventory s ON s.id=e.stock_inventory_id
    WHERE NOT EXISTS (SELECT 1 FROM guard) AND e.stock_inventory_id IS NOT NULL
    LIMIT 1`
  if(!rows.length) throw new Error('Neon 找不到額外叫貨、此筆已取消，或庫存狀態不完整')
  return {state:rows[0].state,available_qty:Number(rows[0].available_qty||0),received:Number(rows[0].incoming||0)}
}

async function createHelperStockOrder(sql,auth,payload){
  const customerLegacy=text(payload?.customer_id),productLegacy=text(payload?.product_id),qty=Math.trunc(num(payload?.qty))
  if(!customerLegacy) throw new Error('請選擇客戶')
  if(!productLegacy) throw new Error('請選擇現貨商品')
  if(qty<1) throw new Error('數量至少為 1')
  const spec=cleanSpec(payload),orderLegacy=text(payload?.order_id)||randomId(),entryLegacy=text(payload?.helper_entry_id)||randomId(),note=text(payload?.note)
  const rows=await sql`WITH customer AS (SELECT id,legacy_id,name,phone,phone_last2 FROM customers WHERE legacy_id=${customerLegacy} AND active<>false LIMIT 1),
    product AS (SELECT id,legacy_id,name,category,supplier,price,cost,price_options,supplier_payment_term FROM products WHERE legacy_id=${productLegacy} AND active<>false LIMIT 1),
    inventory AS (SELECT s.id,s.available_qty,s.supplier,p.id AS product_id,p.legacy_id AS product_legacy,p.name AS product_name,p.category,p.price,p.cost,p.price_options,p.supplier_payment_term FROM stock_inventory s JOIN product p ON p.id=s.product_id WHERE s.spec_package=${spec.package} AND s.spec_flavor=${spec.flavor} AND s.spec_color=${spec.color} AND s.spec_size=${spec.size} FOR UPDATE),
    priced AS (SELECT i.*,COALESCE((SELECT (x->>'price')::numeric FROM jsonb_array_elements(COALESCE(i.price_options,'[]'::jsonb)) x WHERE x->>'label'=${spec.package} LIMIT 1),i.price,0) AS sale_price,COALESCE((SELECT NULLIF(x->>'cost','')::numeric FROM jsonb_array_elements(COALESCE(i.price_options,'[]'::jsonb)) x WHERE x->>'label'=${spec.package} LIMIT 1),i.cost,0) AS cost_price FROM inventory i WHERE i.available_qty>=${qty}),
    created_order AS (INSERT INTO orders (legacy_id,customer_id,customer_name,customer_phone,customer_phone_last2,total_amount,status,payment_status,payable_status,refund_amount,is_virtual,source,fulfillment_type,note,created_by_uid,created_by_name,order_date,status_history,refunds,archived,created_at,updated_at) SELECT ${orderLegacy},c.id,c.name,c.phone,c.phone_last2,p.sale_price*${qty},'pending','unpaid','paid',0,false,'helper','stock','現貨開單',${auth.uid},${text(payload?.display_name)},now(),${JSON.stringify([{status:'pending',at:new Date().toISOString(),note:'小幫手現貨開單'}])}::jsonb,'[]'::jsonb,false,now(),now() FROM customer c,priced p ON CONFLICT (legacy_id) DO NOTHING RETURNING id),
    created_item AS (INSERT INTO order_items (order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,subtotal,cost_subtotal,note,spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,arrived_qty,supplier_payment_term,supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at) SELECT o.id,1,p.product_id,p.product_name||'【現貨】',p.category,p.supplier,p.sale_price,p.cost_price,${qty},p.sale_price*${qty},p.cost_price*${qty},${note},${spec.package},${spec.flavor},${spec.color},${spec.size},'stock',${qty},COALESCE(p.supplier_payment_term,'manual'),p.cost_price*${qty},'paid','["stock_inventory"]'::jsonb,now(),now() FROM created_order o,priced p RETURNING order_id),
    created_entry AS (INSERT INTO helper_entries (legacy_id,created_by_uid,created_by_name,customer_id,customer_name,customer_phone_last2,items,total_amount,is_virtual,note,status,converted_order_id,converted_at,direct_order,created_at,updated_at) SELECT ${entryLegacy},${auth.uid},${text(payload?.display_name)},c.id,c.name,c.phone_last2,jsonb_build_array(jsonb_build_object('product_id','stock:'||p.product_legacy,'original_product_id',p.product_legacy,'product_name',p.product_name||'【現貨】','sale_price',p.sale_price,'qty',${qty}::integer,'spec',jsonb_build_object('package',${spec.package}::text,'flavor',${spec.flavor}::text,'color',${spec.color}::text,'size',${spec.size}::text),'note',${note}::text,'fulfillment_type','stock','stock_inventory_id',${legacyInventoryId(productLegacy,spec)}::text)),p.sale_price*${qty},false,'現貨開單','converted',o.id,now(),true,now(),now() FROM created_order o,customer c,priced p RETURNING id,converted_order_id),
    linked_order AS (UPDATE orders o SET helper_entry_id=e.id,updated_at=now() FROM created_entry e WHERE o.id=e.converted_order_id RETURNING o.id),
    deducted AS (UPDATE stock_inventory s SET available_qty=s.available_qty-${qty},updated_at=now() FROM priced p,linked_order l WHERE s.id=p.id RETURNING s.id,s.available_qty,l.id AS order_id),
    movement AS (INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid) SELECT d.id,${-qty},d.available_qty,'sale',d.order_id,'小幫手現貨開單',${auth.uid} FROM deducted d RETURNING id)
    SELECT ${orderLegacy}::text AS order_id,${entryLegacy}::text AS helper_entry_id,d.available_qty,p.sale_price*${qty} AS total_amount FROM deducted d,priced p`
  if(!rows.length){
    const existing=await sql`SELECT legacy_id FROM orders WHERE legacy_id=${orderLegacy} AND created_by_uid=${auth.uid} AND source='helper' LIMIT 1`
    if(existing.length) return {order_id:orderLegacy,helper_entry_id:entryLegacy,state:'already'}
    throw new Error('Neon 現貨不足、商品/客戶不存在，或訂單建立失敗')
  }
  return {order_id:rows[0].order_id,helper_entry_id:rows[0].helper_entry_id,available_qty:Number(rows[0].available_qty||0),total_amount:Number(rows[0].total_amount||0),state:'created'}
}

async function listStock(sql){
  const rows=await sql`SELECT p.legacy_id AS product_id,p.name AS product_name,s.supplier,s.spec_package,s.spec_flavor,s.spec_color,s.spec_size,s.available_qty,s.adjustment_note,s.created_at,s.updated_at FROM stock_inventory s JOIN products p ON p.id=s.product_id ORDER BY p.name ASC,s.spec_package ASC,s.spec_flavor ASC,s.spec_color ASC,s.spec_size ASC`
  return rows.map(row=>{const spec={package:row.spec_package||'',flavor:row.spec_flavor||'',color:row.spec_color||'',size:row.spec_size||''};const specLabel=[spec.package&&`組合：${spec.package}`,spec.flavor&&`口味：${spec.flavor}`,spec.color&&`顏色：${spec.color}`,spec.size&&`尺寸：${spec.size}`].filter(Boolean).join('／')||'一般規格';return{id:legacyInventoryId(row.product_id,spec),product_id:row.product_id,product_name:row.product_name||'',supplier:row.supplier||'',spec,spec_label:specLabel,available_qty:Number(row.available_qty||0),adjustment_note:row.adjustment_note||'',created_at:row.created_at,updated_at:row.updated_at}})
}
async function listExtras(sql){const rows=await sql`SELECT e.legacy_id AS id,p.legacy_id AS product_id,e.product_name,e.supplier,e.spec_package,e.spec_flavor,e.spec_color,e.spec_size,e.spec_label,e.ordered_qty,e.received_qty,e.unit_cost,e.note,e.status,e.received_at,e.created_at,e.updated_at FROM stock_purchase_extras e JOIN products p ON p.id=e.product_id ORDER BY e.created_at DESC`;return rows.map(row=>({id:row.id,product_id:row.product_id,product_name:row.product_name||'',supplier:row.supplier||'',spec:{package:row.spec_package||'',flavor:row.spec_flavor||'',color:row.spec_color||'',size:row.spec_size||''},spec_label:row.spec_label||'',ordered_qty:Number(row.ordered_qty||0),received_qty:Number(row.received_qty||0),unit_cost:Number(row.unit_cost||0),note:row.note||'',status:row.status,received_at:row.received_at,created_at:row.created_at,updated_at:row.updated_at}))}
async function listMovements(sql){const rows=await sql`SELECT it.id,p.legacy_id AS product_id,p.name AS product_name,it.qty_change,it.balance_after,it.transaction_type,o.legacy_id AS order_id,e.legacy_id AS extra_id,it.note,it.created_by_uid,it.created_at FROM inventory_transactions it JOIN stock_inventory s ON s.id=it.inventory_id JOIN products p ON p.id=s.product_id LEFT JOIN orders o ON o.id=it.order_id LEFT JOIN stock_purchase_extras e ON e.id=it.extra_purchase_id ORDER BY it.created_at DESC LIMIT 500`;return rows.map(r=>({...r,qty_change:Number(r.qty_change||0),balance_after:Number(r.balance_after||0)}))}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req),sql=neon(process.env.DATABASE_URL),account=await requireAccount(sql,auth),action=text(req.body?.action)
    if(action==='list_stock') return res.status(200).json({ok:true,rows:await listStock(sql)})
    if(action==='consume_stock') return res.status(200).json({ok:true,result:await consumeStock(sql,auth,account,req.body||{})})
    if(action==='create_helper_stock_order') return res.status(200).json({ok:true,result:await createHelperStockOrder(sql,auth,req.body||{})})
    if(action==='list_extras'){requireStaff(account);return res.status(200).json({ok:true,rows:await listExtras(sql)})}
    requireStaff(account)
    if(action==='sync_inventory') return res.status(200).json({ok:true,id:await syncInventory(sql,req.body?.row||{})})
    if(action==='sync_extra') return res.status(200).json({ok:true,id:await syncExtra(sql,req.body?.row||{})})
    if(action==='set_stock') return res.status(200).json({ok:true,result:await setStock(sql,auth,req.body||{})})
    if(action==='receive_extra') return res.status(200).json({ok:true,result:await receiveExtra(sql,auth,req.body||{})})
    if(action==='list_movements') return res.status(200).json({ok:true,rows:await listMovements(sql)})
    throw new Error('未知的庫存動作')
  }catch(err){console.error('neon-inventory-runtime',err);return res.status(400).json({ok:false,error:String(err?.message||err)})}
}