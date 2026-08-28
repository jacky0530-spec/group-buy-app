import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const json=(res,status,data)=>res.status(status).json(data)
const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const j=v=>JSON.stringify(v??[])

async function requireNeonAccount(sql,auth){
  const rows=await sql`SELECT firebase_uid,role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('帳號權限無效')
  return account
}

function requireStaff(account){
  if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
}

async function syncCustomer(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('客戶缺少 legacy id')
  await sql`
    INSERT INTO customers (legacy_id,name,phone,phone_last2,line_nick,fb_name,note,active,joined_at,archived_at,updated_at)
    VALUES (
      ${legacyId},${text(row.name)||'未命名客戶'},${text(row.phone)},${text(row.phone_last2)},${text(row.line_nick)},${text(row.fb_name)},${text(row.note)},
      ${row.active!==false},${iso(row.joined_at)||new Date().toISOString()},${iso(row.archived_at)},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      name=EXCLUDED.name,phone=EXCLUDED.phone,phone_last2=EXCLUDED.phone_last2,line_nick=EXCLUDED.line_nick,
      fb_name=EXCLUDED.fb_name,note=EXCLUDED.note,active=EXCLUDED.active,joined_at=EXCLUDED.joined_at,
      archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at
  `
  return legacyId
}

async function syncProduct(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('商品缺少 legacy id')
  await sql`
    INSERT INTO products (
      legacy_id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,
      price_options,supplier_payment_term,active,created_at,archived_at,updated_at
    ) VALUES (
      ${legacyId},${text(row.name)||'未命名商品'},${text(row.category)||'other'},${text(row.supplier)},${num(row.price)},${num(row.cost)},
      ${text(row.pricing_mode)||((row.price_options||[]).length?'options':'single')},${text(row.spec_mode)||'none'},
      ${j(row.spec_colors)}::jsonb,${j(row.spec_sizes)}::jsonb,${j(row.spec_flavors)}::jsonb,${j(row.price_options)}::jsonb,
      ${text(row.supplier_payment_term)||'manual'},${row.active!==false},${iso(row.created_at)||new Date().toISOString()},${iso(row.archived_at)},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      name=EXCLUDED.name,category=EXCLUDED.category,supplier=EXCLUDED.supplier,price=EXCLUDED.price,cost=EXCLUDED.cost,
      pricing_mode=EXCLUDED.pricing_mode,spec_mode=EXCLUDED.spec_mode,spec_colors=EXCLUDED.spec_colors,spec_sizes=EXCLUDED.spec_sizes,
      spec_flavors=EXCLUDED.spec_flavors,price_options=EXCLUDED.price_options,supplier_payment_term=EXCLUDED.supplier_payment_term,
      active=EXCLUDED.active,created_at=EXCLUDED.created_at,archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at
  `
  return legacyId
}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireNeonAccount(sql,auth)
    const action=text(req.body?.action)

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

    if(action==='sync_customer'){
      requireStaff(account)
      const id=await syncCustomer(sql,req.body?.row||{})
      return json(res,200,{ok:true,id})
    }

    if(action==='sync_product'){
      requireStaff(account)
      const id=await syncProduct(sql,req.body?.row||{})
      return json(res,200,{ok:true,id})
    }

    throw new Error('未知的 Neon runtime 動作')
  }catch(err){
    console.error('neon-runtime',err)
    return json(res,401,{ok:false,error:String(err?.message||err)})
  }
}
