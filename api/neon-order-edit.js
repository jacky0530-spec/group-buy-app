import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const cleanSpec=row=>{const s=row?.spec||{};return{package:text(s.package),flavor:text(s.flavor),color:text(s.color),size:text(s.size)}}
const sameSpec=(a,b)=>['package','flavor','color','size'].every(k=>text(a?.[k])===text(b?.[k]))
const nowISO=()=>new Date().toISOString()

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

async function resolvedItemCost(sql,productId,spec,suppliedCost){
  const direct=Math.max(0,num(suppliedCost))
  if(direct>0)return direct
  if(!productId)return 0
  const rows=await sql`SELECT cost,price_options FROM products WHERE id=${productId} LIMIT 1`
  const product=rows[0]||{}
  const options=Array.isArray(product.price_options)?product.price_options:[]
  const packageLabel=text(spec?.package)
  const option=packageLabel?options.find(row=>text(row?.label)===packageLabel):null
  const optionCost=Math.max(0,num(option?.cost))
  if(optionCost>0)return optionCost
  return Math.max(0,num(product.cost))
}

async function customerUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM customers WHERE legacy_id=${text(legacyId)} LIMIT 1`
  return rows[0]?.id||null
}

async function validateNewOrder(sql,row,index=0){
  const id=text(row?.id)
  if(!id) throw new Error(`第 ${index+1} 筆缺少訂單 ID`)
  const items=Array.isArray(row?.items)?row.items:[]
  if(!items.length) throw new Error(`第 ${index+1} 筆訂單至少需要一個品項`)
  if(row.customer_id&&!await customerUuid(sql,row.customer_id)) throw new Error(`第 ${index+1} 筆找不到對應客戶`)
  for(let i=0;i<items.length;i++){
    const legacyProduct=text(items[i].original_product_id||items[i].product_id||items[i].id).replace(/^stock:/,'')
    if(!legacyProduct||!await productUuid(sql,legacyProduct)) throw new Error(`第 ${index+1} 筆第 ${i+1} 項找不到對應商品`)
  }
}

async function insertItems(sql,orderId,items,{preserve=[]}={}){
  for(let i=0;i<items.length;i++){
    const item=items[i]
    const old=preserve[i]
    const legacyProduct=text(item.original_product_id||item.product_id||item.id).replace(/^stock:/,'')
    const productId=await productUuid(sql,legacyProduct)
    if(!productId) throw new Error(`第 ${i+1} 項找不到對應商品`)
    const spec=cleanSpec(item)
    const qty=Math.max(1,Math.trunc(num(item.qty)||1))
    const sale=num(item.sale_price??item.price)
    const cost=await resolvedItemCost(sql,productId,spec,item.cost_price)
    const same=old&&text(old.product_id)===legacyProduct&&sameSpec(spec,{package:old.spec_package,flavor:old.spec_flavor,color:old.spec_color,size:old.spec_size})
    const originalQty=same?Math.max(1,Math.trunc(num(old.original_qty??old.qty)||qty)):qty
    const paid=same?Math.max(0,num(old.supplier_paid_amount)):0
    const paidStatus=paid>0?(paid>=cost*qty-0.01?'paid':'partial'):'unpaid'
    const refs=paid>0?(old?.supplier_payment_refs||[]):[]
    const arrived=Math.min(qty,Math.max(0,Math.trunc(num(item.arrived_qty??old?.arrived_qty))))
    const arrivedAt=arrived>=qty?(item.arrived_at||old?.arrived_at||nowISO()):null
    await sql`
      INSERT INTO order_items (
        order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,original_qty,subtotal,cost_subtotal,note,
        spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,arrived_qty,arrived_at,supplier_payment_term,
        supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at
      ) VALUES (
        ${orderId},${i+1},${productId},${text(item.product_name||item.name)},${text(item.category)||'other'},${text(item.supplier)},
        ${sale},${cost},${qty},${originalQty},${sale*qty},${cost*qty},${text(item.note)},${spec.package},${spec.flavor},${spec.color},${spec.size},'preorder',
        ${arrived},${arrivedAt},${text(item.supplier_payment_term)||'manual'},${paid},${paidStatus},${JSON.stringify(refs)}::jsonb,now(),now()
      )
    `
  }
}

async function createOrder(sql,row){
  const id=text(row?.id)
  const items=Array.isArray(row?.items)?row.items:[]
  const customerId=await customerUuid(sql,row.customer_id)
  const total=items.reduce((s,i)=>s+num(i.subtotal||num(i.sale_price??i.price)*Math.max(1,Math.trunc(num(i.qty)||1))),0)
  const created=row.created_at||nowISO()
  const orderDate=row.order_date||created
  const history=Array.isArray(row.status_history)&&row.status_history.length?row.status_history:[{status:row.status||'pending',at:created,note:'建立訂單'}]
  const upserted=await sql`
    INSERT INTO orders (
      legacy_id,customer_id,customer_name,customer_phone,customer_phone_last2,total_amount,status,payment_status,payable_status,
      refund_amount,is_virtual,source,fulfillment_type,note,created_by_uid,created_by_name,order_date,status_history,refunds,archived,created_at,updated_at
    ) VALUES (
      ${id},${customerId},${text(row.customer_name)},${text(row.customer_phone)},${text(row.customer_phone_last2)},${total},
      ${['pending','shipped','cancelled'].includes(row.status)?row.status:'pending'},${text(row.payment_status)||'unpaid'},${text(row.payable_status)||'unpaid'},
      ${num(row.refund_amount)},${row.is_virtual===true},${text(row.source)||'admin'},'preorder',${text(row.note)},${text(row.created_by_uid)},${text(row.created_by_name)},
      ${orderDate},${JSON.stringify(history)}::jsonb,${JSON.stringify(row.refunds||[])}::jsonb,${row.archived===true},${created},${row.updated_at||created}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,customer_phone=EXCLUDED.customer_phone,
      customer_phone_last2=EXCLUDED.customer_phone_last2,total_amount=EXCLUDED.total_amount,status=EXCLUDED.status,
      payment_status=EXCLUDED.payment_status,payable_status=EXCLUDED.payable_status,refund_amount=EXCLUDED.refund_amount,
      is_virtual=EXCLUDED.is_virtual,source=EXCLUDED.source,note=EXCLUDED.note,order_date=EXCLUDED.order_date,
      status_history=EXCLUDED.status_history,refunds=EXCLUDED.refunds,archived=EXCLUDED.archived,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const orderId=upserted[0]?.id
  if(!orderId) throw new Error(`訂單 ${id} 建立失敗`)
  const current=await sql`
    SELECT oi.line_no,p.legacy_id AS product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,
           oi.qty,oi.original_qty,oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs,oi.arrived_qty,oi.arrived_at
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
    WHERE oi.order_id=${orderId} ORDER BY oi.line_no
  `
  await sql`DELETE FROM order_items WHERE order_id=${orderId}`
  await insertItems(sql,orderId,items,{preserve:current})
  return {id,total_amount:total,items:items.length,order_date:orderDate,created_at:created}
}

async function editOrder(sql,id,data){
  if(!id) throw new Error('缺少訂單 ID')
  const orders=await sql`SELECT id,fulfillment_type FROM orders WHERE legacy_id=${id} LIMIT 1`
  const order=orders[0]
  if(!order) throw new Error('Neon 找不到訂單')
  if(order.fulfillment_type==='stock') throw new Error('現貨訂單不可使用一般編輯流程')
  const incoming=Array.isArray(data.items)?data.items:[]
  if(!incoming.length) throw new Error('訂單至少需要一個品項')
  const current=await sql`
    SELECT oi.line_no,p.legacy_id AS product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,
           oi.qty,oi.original_qty,oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs,oi.arrived_qty,oi.arrived_at
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
    const nextSpec=cleanSpec(next)
    if(nextProduct!==text(old.product_id)||!sameSpec(nextSpec,oldSpec)) throw new Error(`第 ${old.line_no} 項已有供應商付款，不可更換商品或規格`)
    const nextProductId=await productUuid(sql,nextProduct)
    const nextUnitCost=await resolvedItemCost(sql,nextProductId,nextSpec,next.cost_price)
    const nextCost=nextUnitCost*Math.max(1,Math.trunc(num(next.qty)||1))
    if(paid>nextCost+0.01) throw new Error(`第 ${old.line_no} 項已付供應商 ${paid} 元，修改後成本不可低於已付款金額`)
  }
  const customerId=await customerUuid(sql,data.customer_id)
  if(data.customer_id&&!customerId) throw new Error('Neon 找不到客戶')
  const total=incoming.reduce((s,i)=>s+num(i.subtotal||num(i.sale_price??i.price)*Math.max(1,Math.trunc(num(i.qty)||1))),0)
  await sql`
    UPDATE orders SET customer_id=${customerId},customer_name=${text(data.customer_name)},customer_phone=${text(data.customer_phone)},
      customer_phone_last2=${text(data.customer_phone_last2)},total_amount=${total},note=${text(data.note)},
      is_virtual=${data.is_virtual===true},updated_at=now()
    WHERE id=${order.id}
  `
  await sql`DELETE FROM order_items WHERE order_id=${order.id}`
  await insertItems(sql,order.id,incoming,{preserve:current})
  return {id,total_amount:total,items:incoming.length}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth.uid)
    const action=text(req.body?.action)||'edit'
    if(action==='edit') return res.status(200).json({ok:true,result:await editOrder(sql,text(req.body?.id),req.body?.data||{})})
    if(action==='create'){
      const row=req.body?.row||{}
      await validateNewOrder(sql,row,0)
      return res.status(200).json({ok:true,result:await createOrder(sql,row)})
    }
    if(action==='create_many'){
      const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
      if(!rows.length) throw new Error('沒有可建立的訂單')
      if(rows.length>250) throw new Error('單次最多建立 250 筆訂單，請分批匯入')
      for(let i=0;i<rows.length;i++) await validateNewOrder(sql,rows[i],i)
      const created=[]
      for(const row of rows) created.push(await createOrder(sql,row))
      return res.status(200).json({ok:true,rows:created})
    }
    throw new Error('未知的預購訂單動作')
  }catch(err){
    console.error('neon-order-edit',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}