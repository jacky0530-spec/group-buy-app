import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'
import { getCachedAccount } from '../server/accountAccessCache.js'

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await getCachedAccount(sql,auth.uid)
    if(!account || account.disabled===true){
      return res.status(200).json({ok:true,allowed:false,role:null,account:null})
    }
    if(!['owner','staff','helper'].includes(account.role)){
      return res.status(200).json({ok:true,allowed:false,role:null,account:null})
    }
    return res.status(200).json({
      ok:true,
      allowed:true,
      role:account.role,
      account:{
        id:account.firebase_uid,
        email:account.email||'',
        display_name:account.display_name||'',
        role:account.role,
        disabled:false,
        created_at:account.created_at,
        updated_at:account.updated_at,
      },
    })
  }catch(err){
    console.error('neon-auth-profile',err)
    return res.status(500).json({ok:false,error:'Account access check failed'})
  }
}
