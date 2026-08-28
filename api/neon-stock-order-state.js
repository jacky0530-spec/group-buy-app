import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('只有管理人員可以變更現貨訂單狀態')
}

async function updateStockOrder(sql,auth,legacyOrderId,status,reason=''){
  const allowed=['pending','shipped','cancelled']
  if(!allowed.includes(status)) throw new Error('訂單狀態不正確')
  const cancelled=status==='cancelled'
  const movementType=cancelled?'restore':'reconsume'
  const movementNote=cancelled?'取消現貨訂單自動還庫':'取消訂單恢復後重新扣庫存'

  const rows=await sql`
    WITH target_order AS (
      SELECT id,status,payment_status
      FROM orders
      WHERE legacy_id=${legacyOrderId} AND fulfillment_type='stock'
      LIMIT 1
    ), item_groups AS (
      SELECT oi.product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,SUM(oi.qty)::int AS qty
      FROM order_items oi
      JOIN target_order o ON o.id=oi.order_id
      WHERE oi.fulfillment_type='stock'
      GROUP BY oi.product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size
    ), resolved AS (
      SELECT g.*,s.id AS inventory_id,s.available_qty
      FROM item_groups g
      LEFT JOIN stock_inventory s
        ON s.product_id=g.product_id
       AND s.spec_package=g.spec_package
       AND s.spec_flavor=g.spec_flavor
       AND s.spec_color=g.spec_color
       AND s.spec_size=g.spec_size
    ), movement_state AS (
      SELECT r.product_id,r.spec_package,r.spec_flavor,r.spec_color,r.spec_size,r.qty,r.inventory_id,r.available_qty,
        COALESCE(SUM(it.qty_change) FILTER (WHERE it.transaction_type IN ('sale','restore','reconsume')),0)::int AS net,
        COUNT(it.id) FILTER (WHERE it.transaction_type IN ('sale','restore','reconsume'))::int AS movement_count
      FROM resolved r
      LEFT JOIN target_order o ON true
      LEFT JOIN inventory_transactions it ON it.inventory_id=r.inventory_id AND it.order_id=o.id
      GROUP BY r.product_id,r.spec_package,r.spec_flavor,r.spec_color,r.spec_size,r.qty,r.inventory_id,r.available_qty
    ), deltas AS (
      SELECT *,
        CASE
          WHEN ${cancelled} THEN
            CASE WHEN net<0 THEN -net WHEN net=0 AND movement_count=0 THEN qty ELSE 0 END
          ELSE
            CASE WHEN net=0 AND movement_count>0 THEN -qty WHEN net>0 THEN -LEAST(net,qty) ELSE 0 END
        END::int AS delta
      FROM movement_state
    ), checks AS (
      SELECT
        (SELECT COUNT(*)::int FROM item_groups) AS group_count,
        (SELECT COUNT(*)::int FROM resolved WHERE inventory_id IS NOT NULL) AS resolved_count,
        COALESCE((SELECT bool_and(delta>=0 OR available_qty>=(-delta)) FROM deltas),true) AS enough
    ), updated_inventory AS (
      UPDATE stock_inventory s
      SET available_qty=s.available_qty+d.delta,updated_at=now()
      FROM deltas d,checks c
      WHERE s.id=d.inventory_id
        AND c.group_count=c.resolved_count
        AND c.enough
        AND d.delta<>0
      RETURNING s.id,s.available_qty
    ), movements AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid)
      SELECT d.inventory_id,d.delta,u.available_qty,${movementType},o.id,${movementNote},${auth.uid}
      FROM deltas d
      JOIN updated_inventory u ON u.id=d.inventory_id
      JOIN target_order o ON true
      WHERE d.delta<>0
      RETURNING id
    ), updated_order AS (
      UPDATE orders o
      SET
        status=${status},
        shipped_at=CASE WHEN ${status}='shipped' THEN now() WHEN ${status}='pending' THEN NULL ELSE o.shipped_at END,
        cancelled_at=CASE WHEN ${status}='cancelled' THEN now() ELSE NULL END,
        cancellation_reason=CASE
          WHEN ${status}='cancelled' THEN CASE WHEN o.status='cancelled' AND ${text(reason)}='' THEN o.cancellation_reason ELSE ${text(reason)} END
          ELSE ''
        END,
        payment_status=CASE
          WHEN ${status}='shipped' AND o.payment_status NOT IN ('partial_refund','refunded') THEN 'paid'
          ELSE o.payment_status
        END,
        status_history=CASE
          WHEN o.status<>${status} THEN COALESCE(o.status_history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('status',${status},'at',now(),'note',${text(reason)}))
          ELSE COALESCE(o.status_history,'[]'::jsonb)
        END,
        updated_at=now()
      FROM target_order t,checks c
      WHERE o.id=t.id
        AND c.group_count=c.resolved_count
        AND c.enough
      RETURNING o.legacy_id AS id,o.status,o.payment_status,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.updated_at
    )
    SELECT u.*,
      (SELECT COUNT(*)::int FROM movements) AS movement_count,
      (SELECT group_count FROM checks) AS stock_group_count
    FROM updated_order u
  `

  if(rows.length) return rows[0]

  const meta=await sql`SELECT id,fulfillment_type FROM orders WHERE legacy_id=${legacyOrderId} LIMIT 1`
  if(!meta[0]) throw new Error('Neon 找不到訂單')
  if(meta[0].fulfillment_type!=='stock') throw new Error('此訂單不是現貨訂單')
  throw new Error('現貨庫存不存在或數量不足，狀態未變更')
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const legacyOrderId=text(req.body?.order_id)
    if(!legacyOrderId) throw new Error('缺少訂單 ID')
    const requested=text(req.body?.status)
    const status=['pending','shipped','cancelled'].includes(requested)
      ? requested
      : (req.body?.cancelled===true?'cancelled':'pending')
    const result=await updateStockOrder(sql,auth,legacyOrderId,status,text(req.body?.reason))
    return res.status(200).json({ok:true,result,order_id:legacyOrderId,status,cancelled:status==='cancelled'})
  }catch(err){
    console.error('neon-stock-order-state',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
