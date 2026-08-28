import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const bool=v=>v===true
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const j=v=>JSON.stringify(v??[])
const fulfillment=v=>v==='stock'?'stock':'preorder'
const orderStatus=v=>['pending','shipped','cancelled'].includes(v)?v:'pending'
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package??row?.spec_package),flavor:text(s.flavor??row?.spec_flavor),color:text(s.color??row?.spec_color),size:text(s.size??row?.spec_size)}}

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('權限不足')
  return account
}

function requireStaff(account){
  if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
}

function requireOwnHelperOrder(account,auth,row){
  if(account.role!=='helper') return
  if(text(row?.source)!=='helper' || text(row?.created_by_uid)!==auth.uid) throw new Error('只能同步自己建立的小幫手訂單')
}

async function customerUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM customers WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function productUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM products WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function helperUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM helper_entries WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function syncOrder(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('訂單缺少 legacy id')
  const customerId=await customerUuid(sql,text(row.customer_id))
  const helperEntryId=await helperUuid(sql,text(row.helper_entry_id))
  const itemRows=Array.isArray(row.items)?row.items:[]
  const orderFulfillment=fulfillment(row.fulfillment_type||(itemRows.length&&itemRows.every(i=>i.fulfillment_type==='stock')?'stock':'preorder'))
  const inserted=await sql`
    INSERT INTO orders (
      legacy_id,customer_id,customer_name,customer_phone,customer_phone_last2,total_amount,status,payment_status,
      payable_status,refund_amount,is_virtual,source,fulfillment_type,note,helper_entry_id,created_by_uid,created_by_name,
      order_date,shipped_at,cancelled_at,cancellation_reason,archived,archived_at,status_history,refunds,created_at,updated_at
    ) VALUES (
      ${legacyId},${customerId},${text(row.customer_name)},${text(row.customer_phone)},${text(row.customer_phone_last2)},${num(row.total_amount)},
      ${orderStatus(row.status)},${text(row.payment_status)||'unpaid'},${text(row.payable_status)||'unpaid'},${num(row.refund_amount)},${bool(row.is_virtual)},
      ${text(row.source)||'admin'},${orderFulfillment},${text(row.note)},${helperEntryId},${text(row.created_by_uid)},${text(row.created_by_name)},
      ${iso(row.order_date)||iso(row.created_at)||new Date().toISOString()},${iso(row.shipped_at)},${iso(row.cancelled_at)},${text(row.cancellation_reason)},
      ${bool(row.archived)},${iso(row.archived_at)},${j(row.status_history)}::jsonb,${j(row.refunds)}::jsonb,
      ${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,customer_phone=EXCLUDED.customer_phone,
      customer_phone_last2=EXCLUDED.customer_phone_last2,total_amount=EXCLUDED.total_amount,status=EXCLUDED.status,
      payment_status=EXCLUDED.payment_status,payable_status=EXCLUDED.payable_status,refund_amount=EXCLUDED.refund_amount,
      is_virtual=EXCLUDED.is_virtual,source=EXCLUDED.source,fulfillment_type=EXCLUDED.fulfillment_type,note=EXCLUDED.note,
      helper_entry_id=EXCLUDED.helper_entry_id,created_by_uid=EXCLUDED.created_by_uid,created_by_name=EXCLUDED.created_by_name,
      order_date=EXCLUDED.order_date,shipped_at=EXCLUDED.shipped_at,cancelled_at=EXCLUDED.cancelled_at,
      cancellation_reason=EXCLUDED.cancellation_reason,archived=EXCLUDED.archived,archived_at=EXCLUDED.archived_at,
      status_history=EXCLUDED.status_history,refunds=EXCLUDED.refunds,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const orderId=inserted[0]?.id
  if(!orderId) throw new Error('Neon 訂單同步失敗')
  await sql`DELETE FROM order_items WHERE order_id=${orderId}`
  let lineNo=0
  for(const item of itemRows){
    lineNo++
    const legacyProductId=text(item.original_product_id||item.product_id||item.id).replace(/^stock:/,'')
    const productId=await productUuid(sql,legacyProductId)
    const spec=cleanSpec(item)
    const qty=Math.max(1,Math.trunc(num(item.qty)||1))
    const salePrice=num(item.sale_price??item.price)
    const costPrice=num(item.cost_price)
    await sql`
      INSERT INTO order_items (
        order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,subtotal,cost_subtotal,note,
        spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,arrived_qty,arrived_at,supplier_payment_term,
        supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at
      ) VALUES (
        ${orderId},${lineNo},${productId},${text(item.product_name||item.name)},${text(item.category)||'other'},${text(item.supplier)},
        ${salePrice},${costPrice},${qty},${num(item.subtotal||salePrice*qty)},${num(item.cost_subtotal||costPrice*qty)},${text(item.note)},
        ${spec.package},${spec.flavor},${spec.color},${spec.size},${fulfillment(item.fulfillment_type||orderFulfillment)},
        ${Math.max(0,Math.trunc(num(item.arrived_qty)))},${iso(item.arrived_at)},${text(item.supplier_payment_term)||'manual'},
        ${num(item.supplier_paid_amount)},${text(item.supplier_payment_status)||'unpaid'},${j(item.supplier_payment_refs)}::jsonb,
        ${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
      )
    `
  }
  return {id:legacyId,items:itemRows.length}
}

async function deleteOrders(sql,ids){
  let deleted=0
  for(const legacyId of [...new Set(ids.map(text).filter(Boolean))]){
    const rows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyId} LIMIT 1`
    const orderId=rows[0]?.id
    if(!orderId) continue
    await sql`UPDATE helper_entries SET converted_order_id=NULL,updated_at=${new Date().toISOString()} WHERE converted_order_id=${orderId}`
    await sql`DELETE FROM supplier_payment_allocations WHERE order_id=${orderId}`
    await sql`DELETE FROM order_items WHERE order_id=${orderId}`
    await sql`DELETE FROM orders WHERE id=${orderId}`
    deleted++
  }
  return deleted
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireAccount(sql,auth)
    const action=text(req.body?.action)
    if(action==='sync'){
      const row=req.body?.row||{}
      requireOwnHelperOrder(account,auth,row)
      const result=await syncOrder(sql,row)
      return res.status(200).json({ok:true,result})
    }
    if(action==='delete'){
      requireStaff(account)
      const ids=Array.isArray(req.body?.ids)?req.body.ids:[]
      if(ids.length>400) throw new Error('單次最多刪除 400 筆')
      return res.status(200).json({ok:true,deleted:await deleteOrders(sql,ids)})
    }
    throw new Error('未知的訂單同步動作')
  }catch(err){
    console.error('neon-orders-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
