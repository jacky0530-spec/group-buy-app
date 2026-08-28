import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('只有管理人員可以變更現貨訂單狀態')
}

async function applyInventoryState(sql,auth,orderId,group,cancelled){
  const invRows=await sql`
    SELECT id,available_qty FROM stock_inventory
    WHERE product_id=${group.product_id}
      AND spec_package=${group.spec_package}
      AND spec_flavor=${group.spec_flavor}
      AND spec_color=${group.spec_color}
      AND spec_size=${group.spec_size}
    LIMIT 1
  `
  const inventory=invRows[0]
  if(!inventory) throw new Error(`Neon 找不到現貨庫存：${group.product_name||''}`)

  const movementRows=await sql`
    SELECT COALESCE(SUM(qty_change),0)::int AS net,COUNT(*)::int AS movement_count
    FROM inventory_transactions
    WHERE inventory_id=${inventory.id} AND order_id=${orderId}
      AND transaction_type IN ('sale','restore','reconsume')
  `
  const net=Number(movementRows[0]?.net||0)
  const movementCount=Number(movementRows[0]?.movement_count||0)
  const qty=Math.max(1,Math.trunc(num(group.qty)||1))
  let delta=0
  let type='restore'

  if(cancelled){
    if(net<0) delta=-net
    else if(net===0 && movementCount===0) delta=qty
    type='restore'
  }else{
    if(net===0 && movementCount>0) delta=-qty
    else if(net>0) delta=-Math.min(net,qty)
    type='reconsume'
  }

  if(delta===0) return {inventory_id:inventory.id,delta:0,balance:Number(inventory.available_qty||0),state:'already'}

  const rows=await sql`
    WITH updated AS (
      UPDATE stock_inventory
      SET available_qty=available_qty+${delta},updated_at=now()
      WHERE id=${inventory.id} AND (${delta}>=0 OR available_qty>=${Math.abs(Math.min(0,delta))})
      RETURNING id,available_qty
    ), movement AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid)
      SELECT id,${delta},available_qty,${type},${orderId},${cancelled?'取消現貨訂單自動還庫':'取消訂單恢復後重新扣庫存'},${auth.uid}
      FROM updated RETURNING id
    )
    SELECT available_qty FROM updated
  `
  if(!rows.length) throw new Error(`現貨不足，無法恢復訂單：${group.product_name||''}`)
  return {inventory_id:inventory.id,delta,balance:Number(rows[0].available_qty||0),state:type}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const legacyOrderId=text(req.body?.order_id)
    const cancelled=req.body?.cancelled===true
    if(!legacyOrderId) throw new Error('缺少訂單 ID')
    const orderRows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyOrderId} LIMIT 1`
    const orderId=orderRows[0]?.id
    if(!orderId) throw new Error('Neon 找不到訂單')
    const groups=await sql`
      SELECT oi.product_id,MAX(oi.product_name) AS product_name,
        oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,SUM(oi.qty)::int AS qty
      FROM order_items oi
      WHERE oi.order_id=${orderId} AND oi.fulfillment_type='stock'
      GROUP BY oi.product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size
    `
    const changes=[]
    for(const group of groups) changes.push(await applyInventoryState(sql,auth,orderId,group,cancelled))
    return res.status(200).json({ok:true,order_id:legacyOrderId,cancelled,changes})
  }catch(err){
    console.error('neon-stock-order-state',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
