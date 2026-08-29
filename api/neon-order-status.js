import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const cleanupDays=v=>Number(v)===30?30:14

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account||account.disabled||!['owner','staff'].includes(account.role)) throw new Error('權限不足')
  return account
}
function requireOwner(account){
  if(account?.role!=='owner') throw new Error('只有負責人可以永久刪除歷史訂單')
}

async function getOrder(sql,legacyId){
  const rows=await sql`
    SELECT id,legacy_id,status,payment_status,fulfillment_type,status_history
    FROM orders WHERE legacy_id=${text(legacyId)} LIMIT 1
  `
  if(!rows[0]) throw new Error('Neon 找不到訂單')
  return rows[0]
}

async function updateStatus(sql,legacyId,status,reason){
  if(!['pending','shipped','cancelled'].includes(status)) throw new Error('訂單狀態不正確')
  const order=await getOrder(sql,legacyId)
  if(order.fulfillment_type==='stock') throw new Error('現貨訂單狀態必須使用庫存交易流程')
  const event=JSON.stringify([{status,at:new Date().toISOString(),note:text(reason)}])
  if(status==='shipped'){
    const rows=await sql`
      UPDATE orders SET
        status='shipped',shipped_at=now(),cancelled_at=NULL,cancellation_reason='',
        payment_status=CASE WHEN payment_status IN ('partial_refund','refunded') THEN payment_status ELSE 'paid' END,
        status_history=COALESCE(status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
      WHERE id=${order.id}
      RETURNING legacy_id AS id,status,payment_status,shipped_at,cancelled_at,cancellation_reason,status_history,updated_at
    `
    return rows[0]
  }
  if(status==='cancelled'){
    const rows=await sql`
      UPDATE orders SET
        status='cancelled',cancelled_at=now(),cancellation_reason=${text(reason)},
        status_history=COALESCE(status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
      WHERE id=${order.id}
      RETURNING legacy_id AS id,status,payment_status,shipped_at,cancelled_at,cancellation_reason,status_history,updated_at
    `
    return rows[0]
  }
  const rows=await sql`
    UPDATE orders SET
      status='pending',shipped_at=NULL,cancelled_at=NULL,cancellation_reason='',
      status_history=COALESCE(status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
    WHERE id=${order.id}
    RETURNING legacy_id AS id,status,payment_status,shipped_at,cancelled_at,cancellation_reason,status_history,updated_at
  `
  return rows[0]
}

async function correctSupplierState(sql,legacyId,itemIndex,resetArrival){
  const hasItem=itemIndex!==undefined&&itemIndex!==null&&itemIndex!==''
  const lineNo=hasItem?Math.max(1,Math.trunc(num(itemIndex))+1):null
  const rows=await sql`SELECT correct_preorder_supplier_state(${text(legacyId)},${lineNo},${resetArrival===true}) AS result`
  return rows[0]?.result||{}
}

async function cleanupCandidates(sql,days){
  const takeDays=cleanupDays(days)
  const rows=await sql`
    SELECT
      o.legacy_id AS id,o.customer_name,o.order_date,o.shipped_at,o.archived,o.source,
      to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM') AS report_month,
      COUNT(oi.id)::int AS item_count,
      COALESCE(SUM(GREATEST(COALESCE(oi.qty,0),0)),0)::numeric AS qty,
      GREATEST(0,COALESCE(o.total_amount,0)-COALESCE(o.refund_amount,0))::numeric AS revenue,
      COALESCE(o.refund_amount,0)::numeric AS refund,
      COALESCE(SUM(COALESCE(oi.cost_price,0)*GREATEST(COALESCE(oi.qty,0),0)),0)::numeric AS cost,
      COALESCE(SUM(LEAST(
        COALESCE(oi.cost_price,0)*GREATEST(COALESCE(oi.qty,0),0),
        GREATEST(COALESCE(oi.supplier_paid_amount,0),0)
      )),0)::numeric AS supplier_paid,
      COUNT(*) OVER()::int AS total_count
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE o.status='shipped'
      AND o.shipped_at IS NOT NULL
      AND o.shipped_at <= now()-make_interval(days => ${takeDays})
      AND COALESCE(o.is_virtual,false)=false
      AND COALESCE(o.fulfillment_type,'preorder')='preorder'
    GROUP BY o.id
    HAVING COALESCE(SUM(GREATEST(COALESCE(oi.qty,0),0)),0)>0
    ORDER BY o.shipped_at ASC
    LIMIT 400`
  const mapped=rows.map(row=>{
    const cost=Number(row.cost||0),supplierPaid=Number(row.supplier_paid||0)
    const revenue=Number(row.revenue||0)
    return {
      id:row.id,customer_name:row.customer_name||'',order_date:row.order_date,shipped_at:row.shipped_at,
      archived:row.archived===true,source:row.source||'admin',report_month:row.report_month||'',
      item_count:Number(row.item_count||0),qty:Number(row.qty||0),revenue,refund:Number(row.refund||0),cost,
      profit:revenue-cost,supplier_paid:supplierPaid,supplier_outstanding:Math.max(0,cost-supplierPaid),
    }
  })
  return {rows:mapped,totalCount:rows.length?Number(rows[0].total_count||0):0,days:takeDays,limited:rows.length>=400}
}

async function cleanupDelete(sql,ids,days){
  const target=[...new Set((Array.isArray(ids)?ids:[]).map(text).filter(Boolean))]
  if(!target.length) throw new Error('沒有選取要刪除的訂單')
  if(target.length>400) throw new Error('單次最多永久刪除 400 筆')
  const takeDays=cleanupDays(days)

  const gateSql=()=>sql`
    SELECT COUNT(*)::int AS count
    FROM orders o
    WHERE o.legacy_id=ANY(${target}::text[])
      AND o.status='shipped'
      AND o.shipped_at IS NOT NULL
      AND o.shipped_at <= now()-make_interval(days => ${takeDays})
      AND COALESCE(o.is_virtual,false)=false
      AND COALESCE(o.fulfillment_type,'preorder')='preorder'`
  const precheck=await gateSql()
  if(Number(precheck[0]?.count||0)!==target.length) throw new Error('部分訂單不再符合歷史清理條件，請重新整理後再試')

  const tx=await sql.transaction([
    sql`SELECT id FROM orders WHERE legacy_id=ANY(${target}::text[]) FOR UPDATE`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      UPDATE helper_entries h SET converted_order_id=NULL,updated_at=now()
      FROM eligible e,gate g WHERE g.ok AND h.converted_order_id=e.id
      RETURNING h.id`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      DELETE FROM supplier_payment_allocations a
      USING eligible e,gate g WHERE g.ok AND a.order_id=e.id
      RETURNING a.id`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      DELETE FROM order_items i
      USING eligible e,gate g WHERE g.ok AND i.order_id=e.id
      RETURNING i.id`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      DELETE FROM orders o
      USING eligible e,gate g WHERE g.ok AND o.id=e.id
      RETURNING o.legacy_id AS id`,
  ])
  const deleted=tx[4]||[]
  if(deleted.length!==target.length) throw new Error('部分訂單狀態已變更，整批未刪除，請重新整理後再試')
  return {deleted:deleted.length,ids:deleted.map(row=>row.id),days:takeDays}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireStaff(sql,auth)
    const action=text(req.body?.action)
    if(action==='meta'){
      const order=await getOrder(sql,req.body?.id)
      return res.status(200).json({ok:true,result:{id:order.legacy_id,fulfillment_type:order.fulfillment_type,status:order.status}})
    }
    if(action==='update'){
      return res.status(200).json({ok:true,result:await updateStatus(sql,req.body?.id,text(req.body?.status),req.body?.reason)})
    }
    if(action==='correct_supplier_state'){
      return res.status(200).json({ok:true,result:await correctSupplierState(sql,req.body?.id,req.body?.item_index,req.body?.reset_arrival)})
    }
    if(action==='cleanup_candidates'){
      requireOwner(account)
      return res.status(200).json({ok:true,result:await cleanupCandidates(sql,req.body?.days)})
    }
    if(action==='cleanup_delete'){
      requireOwner(account)
      return res.status(200).json({ok:true,result:await cleanupDelete(sql,req.body?.ids,req.body?.days)})
    }
    throw new Error('未知的訂單狀態動作')
  }catch(err){
    console.error('neon-order-status',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
