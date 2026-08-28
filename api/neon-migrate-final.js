import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken, verifyFirestoreOwner } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package??row?.spec_package),flavor:text(s.flavor??row?.spec_flavor),color:text(s.color??row?.spec_color),size:text(s.size??row?.spec_size)}}

async function productUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM products WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function inventoryUuid(sql,productId,spec){
  if(!productId)return null
  const rows=await sql`SELECT id FROM stock_inventory WHERE product_id=${productId} AND spec_package=${spec.package} AND spec_flavor=${spec.flavor} AND spec_color=${spec.color} AND spec_size=${spec.size} LIMIT 1`
  return rows[0]?.id||null
}

async function upsertExtras(sql,rows){
  let done=0,skipped=0
  for(const row of rows){
    const legacyId=text(row.id||row.legacy_id)
    const productId=await productUuid(sql,text(row.product_id))
    if(!legacyId||!productId){skipped++;continue}
    const spec=cleanSpec(row)
    const invId=await inventoryUuid(sql,productId,spec)
    const status=['ordered','received','cancelled'].includes(row.status)?row.status:(num(row.received_qty)>=num(row.ordered_qty)&&num(row.ordered_qty)>0?'received':'ordered')
    await sql`
      INSERT INTO stock_purchase_extras (
        legacy_id,product_id,product_name,supplier,spec_package,spec_flavor,spec_color,spec_size,spec_label,
        ordered_qty,received_qty,unit_cost,note,status,stock_inventory_id,received_at,created_at,updated_at
      ) VALUES (
        ${legacyId},${productId},${text(row.product_name)},${text(row.supplier)},${spec.package},${spec.flavor},${spec.color},${spec.size},${text(row.spec_label)},
        ${Math.max(1,Math.trunc(num(row.ordered_qty)||1))},${Math.max(0,Math.trunc(num(row.received_qty)))},${num(row.unit_cost)},${text(row.note)},${status},${invId},
        ${iso(row.received_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
      )
      ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
        product_id=EXCLUDED.product_id,product_name=EXCLUDED.product_name,supplier=EXCLUDED.supplier,
        spec_package=EXCLUDED.spec_package,spec_flavor=EXCLUDED.spec_flavor,spec_color=EXCLUDED.spec_color,spec_size=EXCLUDED.spec_size,spec_label=EXCLUDED.spec_label,
        ordered_qty=EXCLUDED.ordered_qty,received_qty=EXCLUDED.received_qty,unit_cost=EXCLUDED.unit_cost,note=EXCLUDED.note,status=EXCLUDED.status,
        stock_inventory_id=EXCLUDED.stock_inventory_id,received_at=EXCLUDED.received_at,updated_at=EXCLUDED.updated_at
    `
    done++
  }
  return {done,skipped}
}

async function upsertExpenses(sql,rows){
  let done=0,skipped=0
  for(const row of rows){
    const legacyId=text(row.id||row.legacy_id)
    if(!legacyId){skipped++;continue}
    const type=['shipping','other','discount'].includes(row.type)?row.type:'other'
    await sql`
      INSERT INTO expenses (legacy_id,month,supplier,type,amount,note,active,archived_at,created_at,updated_at)
      VALUES (${legacyId},${text(row.month)||null},${text(row.supplier)},${type},${Math.abs(num(row.amount))},${text(row.note)},${row.active!==false},${iso(row.archived_at)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()})
      ON CONFLICT (legacy_id) DO UPDATE SET
        month=EXCLUDED.month,supplier=EXCLUDED.supplier,type=EXCLUDED.type,amount=EXCLUDED.amount,note=EXCLUDED.note,
        active=EXCLUDED.active,archived_at=EXCLUDED.archived_at,updated_at=EXCLUDED.updated_at
    `
    done++
  }
  return {done,skipped}
}

async function counts(sql){
  const rows=await sql`SELECT
    (SELECT count(*)::int FROM stock_purchase_extras) AS stock_purchase_extras,
    (SELECT count(*)::int FROM expenses) AS expenses,
    (SELECT count(*)::int FROM stock_purchase_extras WHERE product_id IS NULL) AS extras_missing_product_link`
  return rows[0]
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    await verifyFirestoreOwner(auth)
    const sql=neon(process.env.DATABASE_URL)
    const action=text(req.body?.action)
    const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
    if(rows.length>250)throw new Error('單次最多 250 筆')
    let migrated
    if(action==='stock_purchase_extras')migrated=await upsertExtras(sql,rows)
    else if(action==='expenses')migrated=await upsertExpenses(sql,rows)
    else if(action==='counts')migrated=await counts(sql)
    else throw new Error('未知的搬移動作')
    return res.status(200).json({ok:true,action,migrated,counts:await counts(sql)})
  }catch(err){
    console.error('neon-migrate-final',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
