import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const json=(res,status,data)=>res.status(status).json(data)

async function requireNeonAccount(sql,auth){
  const rows=await sql`SELECT firebase_uid,role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('帳號權限無效')
  return account
}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireNeonAccount(sql,auth)
    const action=String(req.body?.action||'').trim()

    if(action==='ping') return json(res,200,{ok:true,role:account.role})

    if(action==='list_customers'){
      const includeArchived=req.body?.includeArchived===true
      const rows=includeArchived
        ? await sql`SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at FROM customers ORDER BY joined_at DESC`
        : await sql`SELECT legacy_id AS id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at FROM customers WHERE active<>false ORDER BY joined_at DESC`
      return json(res,200,{ok:true,rows})
    }

    if(action==='list_products'){
      const includeArchived=req.body?.includeArchived===true
      const rows=includeArchived
        ? await sql`SELECT legacy_id AS id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,active,created_at,archived_at,updated_at FROM products ORDER BY created_at DESC`
        : await sql`SELECT legacy_id AS id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,price_options,supplier_payment_term,active,created_at,archived_at,updated_at FROM products WHERE active<>false ORDER BY created_at DESC`
      return json(res,200,{ok:true,rows})
    }

    throw new Error('未知的 Neon runtime 動作')
  }catch(err){
    console.error('neon-runtime',err)
    return json(res,401,{ok:false,error:String(err?.message||err)})
  }
}
