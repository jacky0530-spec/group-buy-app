import { neon } from '@neondatabase/serverless'

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const sql=neon(process.env.DATABASE_URL)
    const rows=await sql`
      SELECT table_name,column_name,data_type,is_nullable,column_default
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name IN ('stock_inventory','inventory_transactions')
      ORDER BY table_name,ordinal_position
    `
    return res.status(200).json({ok:true,rows})
  }catch(err){
    return res.status(500).json({ok:false,error:String(err?.message||err)})
  }
}
