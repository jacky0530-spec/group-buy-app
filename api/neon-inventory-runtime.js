import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package??row?.spec_package),flavor:text(s.flavor??row?.spec_flavor),color:text(s.color??row?.spec_color),size:text(s.size??row?.spec_size)}}

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('庫存同步僅限管理人員')
}

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

async function syncInventory(sql,row){
  const productId=await productUuid(sql,text(row.product_id))
  if(!productId) throw new Error('Neon 找不到庫存商品')
  const spec=cleanSpec(row)
  const rows=await sql`
    INSERT INTO stock_inventory (
      product_id,supplier,spec_package,spec_flavor,spec_color,spec_size,available_qty,adjustment_note,created_at,updated_at
    ) VALUES (
      ${productId},${text(row.supplier)},${spec.package},${spec.flavor},${spec.color},${spec.size},
      ${Math.max(0,Math.trunc(num(row.available_qty)))},${text(row.adjustment_note)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (product_id,spec_package,spec_flavor,spec_color,spec_size) DO UPDATE SET
      supplier=EXCLUDED.supplier,available_qty=EXCLUDED.available_qty,adjustment_note=EXCLUDED.adjustment_note,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  return rows[0]?.id||null
}

async function syncExtra(sql,row){
  const legacyId=text(row.id||row.legacy_id)
  const productId=await productUuid(sql,text(row.product_id))
  if(!legacyId||!productId) throw new Error('額外叫貨缺少對應商品或 ID')
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
  return legacyId
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const action=text(req.body?.action)
    if(action==='sync_inventory') return res.status(200).json({ok:true,id:await syncInventory(sql,req.body?.row||{})})
    if(action==='sync_extra') return res.status(200).json({ok:true,id:await syncExtra(sql,req.body?.row||{})})
    throw new Error('未知的庫存同步動作')
  }catch(err){
    console.error('neon-inventory-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
