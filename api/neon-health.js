import { neon } from '@neondatabase/serverless'

export default async function handler(req,res){
  if(req.method !== 'GET') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  const databaseConfigured = Boolean(process.env.DATABASE_URL)
  const firebaseProjectConfigured = Boolean(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID)
  if(!databaseConfigured){
    return res.status(200).json({ok:false,database_configured:false,firebase_project_configured:firebaseProjectConfigured,database_reachable:false})
  }
  try{
    const sql = neon(process.env.DATABASE_URL)
    const rows = await sql`SELECT current_database() AS database, 1 AS ping`
    return res.status(200).json({ok:true,database_configured:true,firebase_project_configured:firebaseProjectConfigured,database_reachable:rows[0]?.ping===1,database:rows[0]?.database || null})
  }catch(err){
    return res.status(200).json({ok:false,database_configured:true,firebase_project_configured:firebaseProjectConfigured,database_reachable:false,error:err?.message || 'database connection failed'})
  }
}
