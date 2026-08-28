import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package??row?.spec_package),flavor:text(s.flavor??row?.spec_flavor),color:text(s.color??row?.spec_color),size:text(s.size??row?.spec_size)}}

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('權限不足')
  return account
}

function requireStaff(account){
  if(!['owner','staff'].includes(account.role)) throw new Error('庫存管理僅限管理人員')
}

async function productUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM products WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function orderUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id,created_by_uid,source FROM orders WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]||null
}

async function inventoryUuid(sql,productId,spec){
  if(!productId)return null
  const rows=await sql`SELECT id FROM stock_inventory WHERE product_id=${productId} AND spec_package=${spec.package} AND spec_flavor=${spec.flavor} AND spec_color=${spec.color} AND spec_size=${spec.size} LIMIT 1`
  return rows[0]?.id||null
}

function legacyInventoryId(productId,spec){
  const key=[spec.package||'',spec.flavor||'',spec.color||'',spec.size||''].join('|')||'default'
  return `${productId}__${encodeURIComponent(key)}`
}

async function syncInventory(sql,row){
  const productId=await productUuid(sql,text(row.product_id))
  if(!productId) throw new Error('Neon 找不到庫存商品')
  const spec=cleanSpec(row)
  const rows=await sql`
    INSERT INTO stock_inventory (
      product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,available_qty,adjustment_note,created_at,updated_at
    ) VALUES (
      ${productId},${text(row.supplier)},${spec.package},${spec.flavor},${spec.color},${spec.size},
      ${Math.max(0,Math.trunc(num(row.available_qty)))},${text(row.adjustment_note)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (product_id,spec_package,spec_flavor,spec_color,spec_size) DO UPDATE SET
      supplier=EXCLUDED.supplier,available_qty=EXCLUDED.available_qty,adjustment_note=EXCLUDED.adjustment_note,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  return rows[0]?.id||null
}

async function syncExtra(sql,row){
  const legacyId=text(row.id||row.legacy_id)
  const productId=await productUuid(sql,text(row.product_id))
  if(!legacyId||!productId) throw new Error('額外叫貨缺少對應商品或 ID')
  const spec=cleanSpec(row)
  const invId=await inventoryUuid(sql,productId,spec)
  const status=['ordered','received','cancelled'].includes(row.status)?row.status:(num(row.received_qty)>=num(row.ordered_qty)&&num(row.ordered_qty)>0?'received':'ordered')
  await sql`
    INSERT INTO stock_purchase_extras (
      legacy_id,product_id,product_name,supplier,spec_package,spec_flavor,spec_color,spec_size,spec_label,
      ordered_qty,received_qty,unit_cost,note,status,stock_inventory_id,received_at,created_at,updated_at
    ) VALUES (
      ${legacyId},${productId},${text(row.product_name)},${text(row.supplier)},${spec.package},${spec.flavor},${spec.color},${spec.size},${text(row.spec_label)},
      ${Math.max(1,Math.trunc(num(row.ordered_qty)||1))},${Math.max(0,Math.trunc(num(row.received_qty)))},${num(row.unit_cost)},${text(row.note)},${status},${invId},
      ${iso(row.received_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
      product_id=EXCLUDED.product_id,product_name=EXCLUDED.product_name,supplier=EXCLUDED.supplier,
      spec_package=EXCLUDED.spec_package,spec_flavor=EXCLUDED.spec_flavor,spec_color=EXCLUDED.spec_color,spec_size=EXCLUDED.spec_size,spec_label=EXCLUDED.spec_label,
      ordered_qty=EXCLUDED.ordered_qty,received_qty=EXCLUDED.received_qty,unit_cost=EXCLUDED.unit_cost,note=EXCLUDED.note,status=EXCLUDED.status,
      stock_inventory_id=EXCLUDED.stock_inventory_id,received_at=EXCLUDED.received_at,updated_at=EXCLUDED.updated_at
  `
  return legacyId
}

async function consumeStock(sql,auth,account,payload){
  const qty=Math.max(1,Math.trunc(num(payload?.qty)||1))
  const order=await orderUuid(sql,text(payload?.order_id))
  if(!order) throw new Error('Neon 找不到現貨訂單')
  if(account.role==='helper' && (order.created_by_uid!==auth.uid || order.source!=='helper')) throw new Error('只能扣除自己建立的現貨訂單庫存')
  const productId=await productUuid(sql,text(payload?.product_id))
  if(!productId) throw new Error('Neon 找不到現貨商品')
  const spec=cleanSpec(payload)
  const rows=await sql`
    WITH target AS (
      SELECT id FROM stock_inventory
      WHERE product_id=${productId}
        AND spec_package=${spec.package} AND spec_flavor=${spec.flavor}
        AND spec_color=${spec.color} AND spec_size=${spec.size}
    ), already AS (
      SELECT 1 AS done FROM inventory_transactions it,target t
      WHERE it.inventory_id=t.id AND it.order_id=${order.id} AND it.transaction_type='sale'
      LIMIT 1
    ), updated AS (
      UPDATE stock_inventory s
      SET available_qty=s.available_qty-${qty},updated_at=now()
      FROM target t
      WHERE s.id=t.id AND s.available_qty>=${qty} AND NOT EXISTS (SELECT 1 FROM already)
      RETURNING s.id,s.available_qty
    ), movement AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid)
      SELECT u.id,${-qty},u.available_qty,'sale',${order.id},${text(payload?.note)||'現貨訂單扣庫存'},${auth.uid}
      FROM updated u
      RETURNING id
    )
    SELECT 'updated'::text AS state,available_qty FROM updated
    UNION ALL
    SELECT 'already'::text AS state,s.available_qty
    FROM stock_inventory s,target t WHERE s.id=t.id AND EXISTS (SELECT 1 FROM already)
    LIMIT 1
  `
  if(!rows.length) throw new Error('Neon 現貨不足或庫存不存在')
  return {state:rows[0].state,available_qty:Number(rows[0].available_qty||0)}
}

async function setStock(sql,auth,payload){
  const targetQty=Math.max(0,Math.trunc(num(payload?.available_qty)))
  const productId=await productUuid(sql,text(payload?.product_id))
  if(!productId) throw new Error('Neon 找不到庫存商品')
  const spec=cleanSpec(payload)
  const note=text(payload?.note||payload?.adjustment_note)||'手動調整庫存'
  const rows=await sql`
    WITH previous AS (
      SELECT id,available_qty FROM stock_inventory
      WHERE product_id=${productId}
        AND spec_package=${spec.package} AND spec_flavor=${spec.flavor}
        AND spec_color=${spec.color} AND spec_size=${spec.size}
      FOR UPDATE
    ), changed AS (
      UPDATE stock_inventory s
      SET available_qty=${targetQty},adjustment_note=${note},updated_at=now()
      FROM previous p WHERE s.id=p.id
      RETURNING s.id,p.available_qty AS before_qty,s.available_qty AS after_qty
    ), movement AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,note,created_by_uid)
      SELECT id,after_qty-before_qty,after_qty,'adjustment',${note},${auth.uid}
      FROM changed WHERE after_qty<>before_qty
      RETURNING id
    )
    SELECT before_qty,after_qty FROM changed
  `
  if(!rows.length) throw new Error('Neon 找不到要調整的庫存')
  return {before:Number(rows[0].before_qty||0),after:Number(rows[0].after_qty||0)}
}

async function receiveExtra(sql,auth,payload){
  const legacyId=text(payload?.extra_id)
  const incoming=Math.max(1,Math.trunc(num(payload?.qty)||1))
  if(!legacyId) throw new Error('缺少額外叫貨 ID')
  const rows=await sql`
    WITH extra AS (
      SELECT id,product_id,supplier,spec_package,spec_flavor,spec_color,spec_size
      FROM stock_purchase_extras WHERE legacy_id=${legacyId} LIMIT 1
    ), guard AS (
      SELECT e.* FROM extra e
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_transactions it
        WHERE it.extra_purchase_id=e.id AND it.transaction_type='receive'
      )
    ), upsert_inventory AS (
      INSERT INTO stock_inventory (product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,available_qty,created_at,updated_at)
      SELECT product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,${incoming},now(),now() FROM guard
      ON CONFLICT (product_id,spec_package,spec_flavor,spec_color,spec_size)
      DO UPDATE SET available_qty=stock_inventory.available_qty+${incoming},updated_at=now()
      RETURNING id,available_qty
    ), linked AS (
      UPDATE stock_purchase_extras e
      SET stock_inventory_id=u.id,updated_at=now()
      FROM upsert_inventory u,guard g WHERE e.id=g.id
      RETURNING e.id,u.id AS inventory_id,u.available_qty
    ), movement AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,extra_purchase_id,note,created_by_uid)
      SELECT l.inventory_id,${incoming},l.available_qty,'receive',l.id,${text(payload?.note)||'額外叫貨入庫'},${auth.uid}
      FROM linked l RETURNING id
    )
    SELECT 'received'::text AS state,available_qty FROM linked
    UNION ALL
    SELECT 'already'::text AS state,s.available_qty
    FROM extra e
    JOIN stock_inventory s ON s.id=e.stock_inventory_id
    WHERE NOT EXISTS (SELECT 1 FROM guard)
    LIMIT 1
  `
  if(!rows.length) throw new Error('Neon 找不到額外叫貨或庫存')
  return {state:rows[0].state,available_qty:Number(rows[0].available_qty||0)}
}

async function listStock(sql){
  const rows=await sql`
    SELECT p.legacy_id AS product_id,p.name AS product_name,s.supplier,s.spec_package,s.spec_flavor,s.spec_color,s.spec_size,
      s.available_qty,s.adjustment_note,s.created_at,s.updated_at
    FROM stock_inventory s
    JOIN products p ON p.id=s.product_id
    ORDER BY p.name ASC,s.spec_package ASC,s.spec_flavor ASC,s.spec_color ASC,s.spec_size ASC
  `
  return rows.map(row=>{
    const spec={package:row.spec_package||'',flavor:row.spec_flavor||'',color:row.spec_color||'',size:row.spec_size||''}
    const specLabel=[spec.package&&`組合：${spec.package}`,spec.flavor&&`口味：${spec.flavor}`,spec.color&&`顏色：${spec.color}`,spec.size&&`尺寸：${spec.size}`].filter(Boolean).join('／')||'一般規格'
    return {
      id:legacyInventoryId(row.product_id,spec),product_id:row.product_id,product_name:row.product_name||'',supplier:row.supplier||'',
      spec,spec_label:specLabel,available_qty:Number(row.available_qty||0),adjustment_note:row.adjustment_note||'',created_at:row.created_at,updated_at:row.updated_at,
    }
  })
}

async function listExtras(sql){
  const rows=await sql`
    SELECT e.legacy_id AS id,p.legacy_id AS product_id,e.product_name,e.supplier,e.spec_package,e.spec_flavor,e.spec_color,e.spec_size,
      e.spec_label,e.ordered_qty,e.received_qty,e.unit_cost,e.note,e.status,e.received_at,e.created_at,e.updated_at
    FROM stock_purchase_extras e
    JOIN products p ON p.id=e.product_id
    ORDER BY e.created_at DESC
  `
  return rows.map(row=>({
    id:row.id,product_id:row.product_id,product_name:row.product_name||'',supplier:row.supplier||'',
    spec:{package:row.spec_package||'',flavor:row.spec_flavor||'',color:row.spec_color||'',size:row.spec_size||''},
    spec_label:row.spec_label||'',ordered_qty:Number(row.ordered_qty||0),received_qty:Number(row.received_qty||0),unit_cost:Number(row.unit_cost||0),
    note:row.note||'',status:row.status,received_at:row.received_at,created_at:row.created_at,updated_at:row.updated_at,
  }))
}

async function listMovements(sql){
  const rows=await sql`
    SELECT it.id,p.legacy_id AS product_id,p.name AS product_name,it.qty_change,it.balance_after,it.transaction_type,
      o.legacy_id AS order_id,e.legacy_id AS extra_id,it.note,it.created_by_uid,it.created_at
    FROM inventory_transactions it
    JOIN stock_inventory s ON s.id=it.inventory_id
    JOIN products p ON p.id=s.product_id
    LEFT JOIN orders o ON o.id=it.order_id
    LEFT JOIN stock_purchase_extras e ON e.id=it.extra_purchase_id
    ORDER BY it.created_at DESC
    LIMIT 500
  `
  return rows.map(r=>({...r,qty_change:Number(r.qty_change||0),balance_after:Number(r.balance_after||0)}))
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireAccount(sql,auth)
    const action=text(req.body?.action)
    if(action==='list_stock') return res.status(200).json({ok:true,rows:await listStock(sql)})
    if(action==='consume_stock') return res.status(200).json({ok:true,result:await consumeStock(sql,auth,account,req.body||{})})
    if(action==='list_extras'){
      requireStaff(account)
      return res.status(200).json({ok:true,rows:await listExtras(sql)})
    }
    requireStaff(account)
    if(action==='sync_inventory') return res.status(200).json({ok:true,id:await syncInventory(sql,req.body?.row||{})})
    if(action==='sync_extra') return res.status(200).json({ok:true,id:await syncExtra(sql,req.body?.row||{})})
    if(action==='set_stock') return res.status(200).json({ok:true,result:await setStock(sql,auth,req.body||{})})
    if(action==='receive_extra') return res.status(200).json({ok:true,result:await receiveExtra(sql,auth,req.body||{})})
    if(action==='list_movements') return res.status(200).json({ok:true,rows:await listMovements(sql)})
    throw new Error('未知的庫存動作')
  }catch(err){
    console.error('neon-inventory-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
