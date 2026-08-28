import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const j=v=>JSON.stringify(v??{})

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('權限不足')
  return account
}

async function customerUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM customers WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function orderUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function syncEntry(sql,auth,account,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('小幫手紀錄缺少 legacy id')
  if(account.role==='helper' && text(row.created_by_uid)!==auth.uid) throw new Error('只能同步自己的小幫手紀錄')
  const customerId=await customerUuid(sql,text(row.customer_id))
  const convertedOrderId=await orderUuid(sql,text(row.converted_order_id))
  const result=await sql`
    INSERT INTO helper_entries (
      legacy_id,created_by_uid,created_by_name,customer_id,customer_name,customer_phone_last2,total_amount,
      is_virtual,note,status,converted_order_id,direct_order,payload,converted_at,created_at,updated_at
    ) VALUES (
      ${legacyId},${text(row.created_by_uid)},${text(row.created_by_name)},${customerId},${text(row.customer_name)},${text(row.customer_phone_last2)},
      ${num(row.total_amount)},${row.is_virtual===true},${text(row.note)},${text(row.status)||'converted'},${convertedOrderId},${row.direct_order!==false},
      ${j(row)}::jsonb,${iso(row.converted_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      created_by_uid=EXCLUDED.created_by_uid,created_by_name=EXCLUDED.created_by_name,customer_id=EXCLUDED.customer_id,
      customer_name=EXCLUDED.customer_name,customer_phone_last2=EXCLUDED.customer_phone_last2,total_amount=EXCLUDED.total_amount,
      is_virtual=EXCLUDED.is_virtual,note=EXCLUDED.note,status=EXCLUDED.status,converted_order_id=EXCLUDED.converted_order_id,
      direct_order=EXCLUDED.direct_order,payload=EXCLUDED.payload,converted_at=EXCLUDED.converted_at,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const entryId=result[0]?.id
  if(entryId&&convertedOrderId) await sql`UPDATE orders SET helper_entry_id=${entryId},updated_at=${new Date().toISOString()} WHERE id=${convertedOrderId}`
  return legacyId
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireAccount(sql,auth)
    const action=text(req.body?.action)
    if(action==='sync') return res.status(200).json({ok:true,id:await syncEntry(sql,auth,account,req.body?.row||{})})
    if(action==='sync_many'){
      const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
      if(rows.length>200) throw new Error('單次最多同步 200 筆')
      let done=0
      for(const row of rows){await syncEntry(sql,auth,account,row);done++}
      return res.status(200).json({ok:true,done})
    }
    throw new Error('未知的小幫手同步動作')
  }catch(err){
    console.error('neon-helper-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
