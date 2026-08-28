import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account||account.disabled||!['owner','staff'].includes(account.role)) throw new Error('權限不足')
  return account
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

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const action=text(req.body?.action)
    if(action==='meta'){
      const order=await getOrder(sql,req.body?.id)
      return res.status(200).json({ok:true,result:{id:order.legacy_id,fulfillment_type:order.fulfillment_type,status:order.status}})
    }
    if(action==='update'){
      return res.status(200).json({ok:true,result:await updateStatus(sql,req.body?.id,text(req.body?.status),req.body?.reason)})
    }
    throw new Error('未知的訂單狀態動作')
  }catch(err){
    console.error('neon-order-status',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
