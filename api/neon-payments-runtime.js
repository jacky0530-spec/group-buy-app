import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
}

async function orderUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function syncPayment(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('付款缺少 legacy id')
  const paymentRows=await sql`
    INSERT INTO supplier_payments (legacy_id,supplier,payment_date,amount,note,voided,voided_at,void_reason,created_at,updated_at)
    VALUES (
      ${legacyId},${text(row.supplier)||'未指定供應商'},${text(row.payment_date)||new Date().toISOString().slice(0,10)},
      ${Math.max(0,num(row.amount))},${text(row.note)},${row.voided===true},${iso(row.voided_at)},${text(row.void_reason)},
      ${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      supplier=EXCLUDED.supplier,payment_date=EXCLUDED.payment_date,amount=EXCLUDED.amount,note=EXCLUDED.note,
      voided=EXCLUDED.voided,voided_at=EXCLUDED.voided_at,void_reason=EXCLUDED.void_reason,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const paymentId=paymentRows[0]?.id
  if(!paymentId) throw new Error('Neon 付款同步失敗')
  await sql`DELETE FROM supplier_payment_allocations WHERE payment_id=${paymentId}`
  let allocations=0
  for(const allocation of (row.allocations||[])){
    const orderId=await orderUuid(sql,text(allocation.order_id))
    let orderItemId=null
    if(orderId){
      const lineNo=Math.max(1,Math.trunc(num(allocation.item_index))+1)
      const itemRows=await sql`SELECT id FROM order_items WHERE order_id=${orderId} AND line_no=${lineNo} LIMIT 1`
      orderItemId=itemRows[0]?.id||null
    }
    await sql`
      INSERT INTO supplier_payment_allocations (payment_id,order_id,order_item_id,customer_name,product_name,supplier,amount,created_at)
      VALUES (
        ${paymentId},${orderId},${orderItemId},${text(allocation.customer_name)},${text(allocation.product_name)},
        ${text(allocation.supplier||row.supplier)},${Math.max(0,num(allocation.amount))},${iso(row.created_at)||new Date().toISOString()}
      )
    `
    allocations++
  }
  return {id:legacyId,allocations}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    if(text(req.body?.action)!=='sync') throw new Error('未知的付款同步動作')
    return res.status(200).json({ok:true,result:await syncPayment(sql,req.body?.row||{})})
  }catch(err){
    console.error('neon-payments-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
