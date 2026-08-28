import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const rows=await sql`
      SELECT h.legacy_id AS id,h.payload,h.created_by_uid,h.created_by_name,c.legacy_id AS customer_id,
        h.customer_name,h.customer_phone_last2,h.total_amount,h.is_virtual,h.note,h.status,
        o.legacy_id AS converted_order_id,h.direct_order,h.converted_at,h.created_at,h.updated_at
      FROM helper_entries h
      LEFT JOIN customers c ON c.id=h.customer_id
      LEFT JOIN orders o ON o.id=h.converted_order_id
      ORDER BY h.created_at DESC
    `
    return res.status(200).json({
      ok:true,
      rows:rows.map(row=>({
        ...(row.payload||{}),
        id:row.id,
        created_by_uid:row.created_by_uid,
        created_by_name:row.created_by_name,
        customer_id:row.customer_id,
        customer_name:row.customer_name,
        customer_phone_last2:row.customer_phone_last2,
        total_amount:Number(row.total_amount||0),
        is_virtual:row.is_virtual===true,
        note:row.note||'',
        status:row.status,
        converted_order_id:row.converted_order_id,
        direct_order:row.direct_order,
        converted_at:row.converted_at,
        created_at:row.created_at,
        updated_at:row.updated_at,
      }))
    })
  }catch(err){
    console.error('neon-helper-admin',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
