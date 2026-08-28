import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package),flavor:text(s.flavor),color:text(s.color),size:text(s.size)}}
const sameSpec=(a,b)=>['package','flavor','color','size'].every(k=>text(a?.[k])===text(b?.[k]))

async function requireStaff(sql,uid){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${uid} LIMIT 1`
  const a=rows[0]
  if(!a||a.disabled||!['owner','staff'].includes(a.role)) throw new Error('權限不足')
}

async function productUuid(sql,legacyId){
  const id=text(legacyId).replace(/^stock:/,'')
  if(!id)return null
  const rows=await sql`SELECT id FROM products WHERE legacy_id=${id} LIMIT 1`
  return rows[0]?.id||null
}

async function customerUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM customers WHERE legacy_id=${text(legacyId)} LIMIT 1`
  return rows[0]?.id||null
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth.uid)
    const id=text(req.body?.id)
    const data=req.body?.data||{}
    if(!id) throw new Error('缺少訂單 ID')
    const orders=await sql`SELECT id,fulfillment_type FROM orders WHERE legacy_id=${id} LIMIT 1`
    const order=orders[0]
    if(!order) throw new Error('Neon 找不到訂單')
    if(order.fulfillment_type==='stock') throw new Error('現貨訂單不可使用一般編輯流程')

    const incoming=Array.isArray(data.items)?data.items:[]
    if(!incoming.length) throw new Error('訂單至少需要一個品項')
    const current=await sql`
      SELECT oi.line_no,p.legacy_id AS product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,
             oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs,oi.arrived_qty,oi.arrived_at
      FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
      WHERE oi.order_id=${order.id} ORDER BY oi.line_no
    `

    for(const old of current){
      const paid=Math.max(0,num(old.supplier_paid_amount))
      if(paid<=0) continue
      const next=incoming[Number(old.line_no)-1]
      if(!next) throw new Error(`第 ${old.line_no} 項已有供應商付款，不可刪除`)
      const nextProduct=text(next.original_product_id||next.product_id||next.id).replace(/^stock:/,'')
      const oldSpec={package:old.spec_package,flavor:old.spec_flavor,color:old.spec_color,size:old.spec_size}
      if(nextProduct!==text(old.product_id)||!sameSpec(cleanSpec(next),oldSpec)) throw new Error(`第 ${old.line_no} 項已有供應商付款，不可更換商品或規格`)
      const nextCost=num(next.cost_price)*Math.max(1,Math.trunc(num(next.qty)||1))
      if(paid>nextCost+0.01) throw new Error(`第 ${old.line_no} 項已付供應商 ${paid} 元，修改後成本不可低於已付款金額`)
    }

    const customerId=await customerUuid(sql,data.customer_id)
    const total=incoming.reduce((s,i)=>s+num(i.subtotal||num(i.sale_price??i.price)*Math.max(1,Math.trunc(num(i.qty)||1))),0)
    await sql`
      UPDATE orders SET customer_id=${customerId},customer_name=${text(data.customer_name)},customer_phone=${text(data.customer_phone)},
        customer_phone_last2=${text(data.customer_phone_last2)},total_amount=${total},note=${text(data.note)},
        is_virtual=${data.is_virtual===true},updated_at=now()
      WHERE id=${order.id}
    `

    await sql`DELETE FROM order_items WHERE order_id=${order.id}`
    for(let i=0;i<incoming.length;i++){
      const item=incoming[i]
      const old=current[i]
      const productId=await productUuid(sql,item.original_product_id||item.product_id||item.id)
      const spec=cleanSpec(item)
      const qty=Math.max(1,Math.trunc(num(item.qty)||1))
      const sale=num(item.sale_price??item.price)
      const cost=num(item.cost_price)
      const paid=old&&text(old.product_id)===text(item.original_product_id||item.product_id||item.id).replace(/^stock:/,'')&&sameSpec(spec,{package:old.spec_package,flavor:old.spec_flavor,color:old.spec_color,size:old.spec_size})?Math.max(0,num(old.supplier_paid_amount)):0
      const paidStatus=paid>0?(paid>=cost*qty-0.01?'paid':'partial'):'unpaid'
      const refs=paid>0?(old?.supplier_payment_refs||[]):[]
      const arrived=Math.min(qty,Math.max(0,Math.trunc(num(item.arrived_qty??old?.arrived_qty))))
      const arrivedAt=arrived>=qty?(item.arrived_at||old?.arrived_at||new Date().toISOString()):null
      await sql`
        INSERT INTO order_items (
          order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,subtotal,cost_subtotal,note,
          spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,arrived_qty,arrived_at,supplier_payment_term,
          supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at
        ) VALUES (
          ${order.id},${i+1},${productId},${text(item.product_name||item.name)},${text(item.category)||'other'},${text(item.supplier)},
          ${sale},${cost},${qty},${sale*qty},${cost*qty},${text(item.note)},${spec.package},${spec.flavor},${spec.color},${spec.size},'preorder',
          ${arrived},${arrivedAt},${text(item.supplier_payment_term)||'manual'},${paid},${paidStatus},${JSON.stringify(refs)}::jsonb,now(),now()
        )
      `
    }
    return res.status(200).json({ok:true,result:{id,total_amount:total,items:incoming.length}})
  }catch(err){
    console.error('neon-order-edit',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
