import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('只有管理人員可以變更現貨訂單')
}

async function resizeStockItem(sql,auth,legacyOrderId,itemIndex,nextQty){
  const lineNo=Math.trunc(num(itemIndex))+1
  const qty=Math.trunc(num(nextQty))
  if(lineNo<1) throw new Error('現貨品項索引不正確')
  if(qty<1) throw new Error('現貨數量至少為 1')

  const rows=await sql`
    WITH target AS (
      SELECT o.id AS order_id,o.helper_entry_id,o.status,
        oi.line_no,oi.product_id,oi.product_name,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,
        oi.qty AS old_qty,oi.sale_price,oi.cost_price,
        s.id AS inventory_id,s.available_qty,
        (${qty}-oi.qty)::int AS diff
      FROM orders o
      JOIN order_items oi ON oi.order_id=o.id AND oi.line_no=${lineNo}
      LEFT JOIN stock_inventory s
        ON s.product_id=oi.product_id
       AND s.spec_package=oi.spec_package
       AND s.spec_flavor=oi.spec_flavor
       AND s.spec_color=oi.spec_color
       AND s.spec_size=oi.spec_size
      WHERE o.legacy_id=${legacyOrderId}
        AND o.fulfillment_type='stock'
        AND oi.fulfillment_type='stock'
        AND o.status='pending'
      LIMIT 1
    ), inventory_update AS (
      UPDATE stock_inventory s
      SET available_qty=s.available_qty-t.diff,updated_at=now()
      FROM target t
      WHERE s.id=t.inventory_id
        AND t.inventory_id IS NOT NULL
        AND (t.diff<=0 OR s.available_qty>=t.diff)
      RETURNING s.id,s.available_qty
    ), item_update AS (
      UPDATE order_items oi
      SET qty=${qty},subtotal=oi.sale_price*${qty},cost_subtotal=oi.cost_price*${qty},
        arrived_qty=${qty},arrived_at=COALESCE(oi.arrived_at,now()),
        supplier_paid_amount=oi.cost_price*${qty},supplier_payment_status='paid',updated_at=now()
      FROM target t,inventory_update u
      WHERE oi.order_id=t.order_id AND oi.line_no=t.line_no
      RETURNING oi.order_id,oi.line_no,oi.qty,oi.subtotal,oi.cost_subtotal,t.diff,t.inventory_id,u.available_qty,t.helper_entry_id
    ), movement AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid)
      SELECT i.inventory_id,-i.diff,i.available_qty,
        CASE WHEN i.diff>0 THEN 'stock_sale' ELSE 'return' END,
        i.order_id,
        CASE WHEN i.diff>0 THEN '出貨報表增加現貨數量' ELSE '出貨報表減少現貨數量' END,
        ${auth.uid}
      FROM item_update i
      WHERE i.diff<>0
      RETURNING id
    ), order_update AS (
      UPDATE orders o
      SET total_amount=(SELECT COALESCE(SUM(subtotal),0) FROM order_items WHERE order_id=o.id),updated_at=now()
      FROM item_update i
      WHERE o.id=i.order_id
      RETURNING o.id,o.total_amount,i.qty,i.available_qty,i.diff,i.helper_entry_id
    ), helper_update AS (
      UPDATE helper_entries h
      SET total_amount=o.total_amount,
        items=CASE
          WHEN jsonb_typeof(COALESCE(h.items,'[]'::jsonb))='array' AND jsonb_array_length(COALESCE(h.items,'[]'::jsonb))>${Math.trunc(num(itemIndex))}
          THEN jsonb_set(COALESCE(h.items,'[]'::jsonb),ARRAY[${String(Math.trunc(num(itemIndex)))},'qty'],to_jsonb(${qty}),true)
          ELSE h.items
        END,
        updated_at=now()
      FROM order_update o
      WHERE h.id=o.helper_entry_id
      RETURNING h.id
    )
    SELECT total_amount,qty,available_qty,diff,(SELECT COUNT(*)::int FROM movement) AS movement_count
    FROM order_update
  `

  if(rows.length) return {
    id:legacyOrderId,item_index:Math.trunc(num(itemIndex)),qty:Number(rows[0].qty||0),
    total_amount:Number(rows[0].total_amount||0),available_qty:Number(rows[0].available_qty||0),
    inventory_change:-Number(rows[0].diff||0),movement_count:Number(rows[0].movement_count||0),
  }

  const meta=await sql`
    SELECT o.status,o.fulfillment_type,oi.fulfillment_type AS item_fulfillment,s.id AS inventory_id,s.available_qty,oi.qty
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id AND oi.line_no=${lineNo}
    LEFT JOIN stock_inventory s ON s.product_id=oi.product_id AND s.spec_package=oi.spec_package AND s.spec_flavor=oi.spec_flavor AND s.spec_color=oi.spec_color AND s.spec_size=oi.spec_size
    WHERE o.legacy_id=${legacyOrderId} LIMIT 1
  `
  const m=meta[0]
  if(!m) throw new Error('Neon 找不到訂單')
  if(m.fulfillment_type!=='stock'||m.item_fulfillment!=='stock') throw new Error('此品項不是現貨訂單')
  if(m.status!=='pending') throw new Error('只有待出貨的現貨訂單可修改數量')
  if(!m.inventory_id) throw new Error('找不到對應現貨庫存')
  const diff=qty-Number(m.qty||0)
  if(diff>Number(m.available_qty||0)) throw new Error(`現貨不足，最多只能再增加 ${Number(m.available_qty||0)} 件`)
  throw new Error('現貨數量更新失敗')
}

async function updateStockOrder(sql,auth,legacyOrderId,status,reason=''){
  const allowed=['pending','shipped','cancelled']
  if(!allowed.includes(status)) throw new Error('訂單狀態不正確')
  const cancelled=status==='cancelled'
  const movementType=cancelled?'return':'stock_sale'
  const movementNote=cancelled?'取消現貨訂單自動還庫':'取消訂單恢復後重新扣庫存'

  const rows=await sql`
    WITH target_order AS (
      SELECT id,status,payment_status FROM orders WHERE legacy_id=${legacyOrderId} AND fulfillment_type='stock' LIMIT 1
    ), item_groups AS (
      SELECT oi.product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,SUM(oi.qty)::int AS qty
      FROM order_items oi JOIN target_order o ON o.id=oi.order_id
      WHERE oi.fulfillment_type='stock'
      GROUP BY oi.product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size
    ), resolved AS (
      SELECT g.*,s.id AS inventory_id,s.available_qty FROM item_groups g
      LEFT JOIN stock_inventory s ON s.product_id=g.product_id AND s.spec_package=g.spec_package AND s.spec_flavor=g.spec_flavor AND s.spec_color=g.spec_color AND s.spec_size=g.spec_size
    ), movement_state AS (
      SELECT r.product_id,r.spec_package,r.spec_flavor,r.spec_color,r.spec_size,r.qty,r.inventory_id,r.available_qty,
        COALESCE(SUM(it.qty_change) FILTER (WHERE it.transaction_type IN ('stock_sale','return')),0)::int AS net,
        COUNT(it.id) FILTER (WHERE it.transaction_type IN ('stock_sale','return'))::int AS movement_count
      FROM resolved r LEFT JOIN target_order o ON true
      LEFT JOIN inventory_transactions it ON it.inventory_id=r.inventory_id AND it.order_id=o.id
      GROUP BY r.product_id,r.spec_package,r.spec_flavor,r.spec_color,r.spec_size,r.qty,r.inventory_id,r.available_qty
    ), deltas AS (
      SELECT *,CASE WHEN ${cancelled}
        THEN CASE WHEN net<0 THEN -net WHEN net=0 AND movement_count=0 THEN qty ELSE 0 END
        ELSE CASE WHEN net=0 AND movement_count>0 THEN -qty WHEN net>0 THEN -LEAST(net,qty) ELSE 0 END
      END::int AS delta FROM movement_state
    ), checks AS (
      SELECT (SELECT COUNT(*)::int FROM item_groups) AS group_count,
        (SELECT COUNT(*)::int FROM resolved WHERE inventory_id IS NOT NULL) AS resolved_count,
        COALESCE((SELECT bool_and(delta>=0 OR available_qty>=(-delta)) FROM deltas),true) AS enough
    ), updated_inventory AS (
      UPDATE stock_inventory s SET available_qty=s.available_qty+d.delta,updated_at=now()
      FROM deltas d,checks c WHERE s.id=d.inventory_id AND c.group_count=c.resolved_count AND c.enough AND d.delta<>0
      RETURNING s.id,s.available_qty
    ), movements AS (
      INSERT INTO inventory_transactions (inventory_id,qty_change,balance_after,transaction_type,order_id,note,created_by_uid)
      SELECT d.inventory_id,d.delta,u.available_qty,${movementType},o.id,${movementNote},${auth.uid}
      FROM deltas d JOIN updated_inventory u ON u.id=d.inventory_id JOIN target_order o ON true WHERE d.delta<>0 RETURNING id
    ), updated_order AS (
      UPDATE orders o SET status=${status},
        shipped_at=CASE WHEN ${status}='shipped' THEN now() WHEN ${status}='pending' THEN NULL ELSE o.shipped_at END,
        cancelled_at=CASE WHEN ${status}='cancelled' THEN now() ELSE NULL END,
        cancellation_reason=CASE WHEN ${status}='cancelled' THEN CASE WHEN o.status='cancelled' AND ${text(reason)}='' THEN o.cancellation_reason ELSE ${text(reason)} END ELSE '' END,
        payment_status=CASE WHEN ${status}='shipped' AND o.payment_status NOT IN ('partial_refund','refunded') THEN 'paid' ELSE o.payment_status END,
        status_history=CASE WHEN o.status<>${status} THEN COALESCE(o.status_history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('status',${status},'at',now(),'note',${text(reason)})) ELSE COALESCE(o.status_history,'[]'::jsonb) END,
        updated_at=now()
      FROM target_order t,checks c WHERE o.id=t.id AND c.group_count=c.resolved_count AND c.enough
      RETURNING o.legacy_id AS id,o.status,o.payment_status,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.updated_at
    )
    SELECT u.*,(SELECT COUNT(*)::int FROM movements) AS movement_count,(SELECT group_count FROM checks) AS stock_group_count FROM updated_order u
  `
  if(rows.length)return rows[0]
  const meta=await sql`SELECT id,fulfillment_type FROM orders WHERE legacy_id=${legacyOrderId} LIMIT 1`
  if(!meta[0])throw new Error('Neon 找不到訂單')
  if(meta[0].fulfillment_type!=='stock')throw new Error('此訂單不是現貨訂單')
  throw new Error('現貨庫存不存在或數量不足，狀態未變更')
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const legacyOrderId=text(req.body?.order_id)
    if(!legacyOrderId)throw new Error('缺少訂單 ID')
    if(text(req.body?.action)==='resize_item'){
      const result=await resizeStockItem(sql,auth,legacyOrderId,req.body?.item_index,req.body?.qty)
      return res.status(200).json({ok:true,result})
    }
    const requested=text(req.body?.status)
    const status=['pending','shipped','cancelled'].includes(requested)?requested:(req.body?.cancelled===true?'cancelled':'pending')
    const result=await updateStockOrder(sql,auth,legacyOrderId,status,text(req.body?.reason))
    return res.status(200).json({ok:true,result,order_id:legacyOrderId,status,cancelled:status==='cancelled'})
  }catch(err){
    console.error('neon-stock-order-state',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
