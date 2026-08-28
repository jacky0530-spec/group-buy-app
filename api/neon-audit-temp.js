import { neon } from '@neondatabase/serverless'

export default async function handler(req,res){
  if(req.method !== 'GET') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const sql = neon(process.env.DATABASE_URL)
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM accounts) AS accounts,
        (SELECT count(*)::int FROM customers) AS customers,
        (SELECT count(*)::int FROM products) AS products,
        (SELECT count(*)::int FROM orders) AS orders,
        (SELECT count(*)::int FROM order_items) AS order_items,
        (SELECT count(*)::int FROM helper_entries) AS helper_entries,
        (SELECT count(*)::int FROM stock_inventory) AS stock_inventory,
        (SELECT count(*)::int FROM supplier_payments) AS supplier_payments,
        (SELECT count(*)::int FROM supplier_payment_allocations) AS supplier_payment_allocations,
        (SELECT count(*)::int FROM orders WHERE customer_id IS NULL AND COALESCE(customer_name,'') <> '') AS orders_missing_customer_link,
        (SELECT count(*)::int FROM order_items WHERE product_id IS NULL AND COALESCE(product_name,'') <> '') AS items_missing_product_link
    `
    console.log('NEON_MIGRATION_AUDIT', JSON.stringify(rows[0]))
    return res.status(200).json({ok:true})
  }catch(err){
    console.error('NEON_MIGRATION_AUDIT_ERROR',err)
    return res.status(500).json({ok:false})
  }
}
