import { neon } from '@neondatabase/serverless'

export default async function handler(req,res){
  if(req.method !== 'GET') return res.status(405).json({ok:false})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const sql = neon(process.env.DATABASE_URL)
    await sql`ALTER TABLE stock_purchase_extras ADD COLUMN IF NOT EXISTS legacy_id text`
    await sql`ALTER TABLE stock_purchase_extras ADD COLUMN IF NOT EXISTS product_name text NOT NULL DEFAULT ''`
    await sql`ALTER TABLE stock_purchase_extras ADD COLUMN IF NOT EXISTS spec_label text NOT NULL DEFAULT ''`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_purchase_extras_legacy_id ON stock_purchase_extras(legacy_id) WHERE legacy_id IS NOT NULL`
    await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS month text`
    await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier text NOT NULL DEFAULT ''`
    await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'shipping'`
    await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`
    await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS archived_at timestamptz`
    await sql`CREATE INDEX IF NOT EXISTS idx_expenses_month_active ON expenses(month,active)`
    await sql`CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier)`
    const columns = await sql`
      SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('stock_purchase_extras','expenses')
      AND column_name IN ('legacy_id','product_name','spec_label','month','supplier','type','active','archived_at')
      ORDER BY table_name,column_name
    `
    return res.status(200).json({ok:true,verified:columns.length})
  }catch(err){
    console.error('neon-schema-finalize-temp',err)
    return res.status(500).json({ok:false,error:String(err?.message||err)})
  }
}
