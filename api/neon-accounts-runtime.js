import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const role=v=>['owner','staff','helper'].includes(v)?v:'staff'

async function requireOwner(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(account.role!=='owner') throw new Error('只有負責人可以管理帳號')
}

async function syncAccount(sql,row){
  const uid=text(row?.id||row?.firebase_uid)
  if(!uid) throw new Error('帳號缺少 Firebase UID')
  await sql`
    INSERT INTO accounts (firebase_uid,email,display_name,role,disabled,created_at,updated_at)
    VALUES (
      ${uid},${text(row.email).toLowerCase()||null},${text(row.display_name)},${role(row.role)},${row.disabled===true},
      ${iso(row.created_at)||new Date().toISOString()},${new Date().toISOString()}
    )
    ON CONFLICT (firebase_uid) DO UPDATE SET
      email=EXCLUDED.email,display_name=EXCLUDED.display_name,role=EXCLUDED.role,
      disabled=EXCLUDED.disabled,updated_at=EXCLUDED.updated_at
  `
  return uid
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireOwner(sql,auth)
    const action=text(req.body?.action)
    if(action==='sync') return res.status(200).json({ok:true,id:await syncAccount(sql,req.body?.row||{})})
    if(action==='list'){
      const rows=await sql`SELECT firebase_uid AS id,email,display_name,role,disabled,created_at,updated_at FROM accounts ORDER BY created_at ASC`
      return res.status(200).json({ok:true,rows})
    }
    throw new Error('未知的帳號動作')
  }catch(err){
    console.error('neon-accounts-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
