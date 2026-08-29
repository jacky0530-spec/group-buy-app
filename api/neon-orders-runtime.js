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

async function existingOrder(sql,legacyId){
  const rows=await sql`SELECT id,legacy_id,total_amount,refund_amount,refunds FROM orders WHERE legacy_id=${text(legacyId)} LIMIT 1`
  if(!rows[0]) throw new Error('Neon 找不到訂單')
  return rows[0]
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
  const previousItems=await sql`SELECT line_no,product_id,spec_package,spec_flavor,spec_color,spec_size,qty,original_qty FROM order_items WHERE order_id=${orderId}`
  await sql`DELETE FROM order_items WHERE order_id=${orderId}`
  let lineNo=0
  for(const item of itemRows){
    lineNo++
    const legacyProductId=text(item.original_product_id||item.product_id||item.id).replace(/^stock:/,'')
    const productId=await productUuid(sql,legacyProductId)
    const spec=cleanSpec(item)
    const qty=Math.max(1,Math.trunc(num(item.qty)||1))
    const previous=previousItems.find(x=>Number(x.line_no)===lineNo&&text(x.product_id)===text(productId)&&text(x.spec_package)===spec.package&&text(x.spec_flavor)===spec.flavor&&text(x.spec_color)===spec.color&&text(x.spec_size)===spec.size)
    const suppliedOriginal=Math.max(1,Math.trunc(num(item.original_qty)||qty))
    const originalQty=previous?Math.max(1,Math.trunc(num(previous.original_qty??previous.qty)||qty)):suppliedOriginal
    const salePrice=num(item.sale_price??item.price)
    const costPrice=num(item.cost_price)
    await sql`
      INSERT INTO order_items (
        order_id,line_no,product_id,product_name,category,supplier,sale_price,cost_price,qty,original_qty,subtotal,cost_subtotal,note,
        spec_package,spec_flavor,spec_color,spec_size,fulfillment_type,arrived_qty,arrived_at,supplier_payment_term,
        supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at
      ) VALUES (
        ${orderId},${lineNo},${productId},${text(item.product_name||item.name)},${text(item.category)||'other'},${text(item.supplier)},
        ${salePrice},${costPrice},${qty},${originalQty},${num(item.subtotal||salePrice*qty)},${num(item.cost_subtotal||costPrice*qty)},${text(item.note)},
        ${spec.package},${spec.flavor},${spec.color},${spec.size},${fulfillment(item.fulfillment_type||orderFulfillment)},
        ${Math.max(0,Math.trunc(num(item.arrived_qty)))},${iso(item.arrived_at)},${text(item.supplier_payment_term)||'manual'},
        ${num(item.supplier_paid_amount)},${text(item.supplier_payment_status)||'unpaid'},${j(item.supplier_payment_refs)}::jsonb,
        ${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
      )
    `
  }
  return {id:legacyId,items:itemRows.length}
}

async function updatePayment(sql,legacyId,paymentStatus){
  await existingOrder(sql,legacyId)
  const allowed=['unpaid','paid','partial_refund','refunded']
  if(!allowed.includes(paymentStatus)) throw new Error('付款狀態不正確')
  const rows=await sql`UPDATE orders SET payment_status=${paymentStatus},updated_at=now() WHERE legacy_id=${text(legacyId)} RETURNING legacy_id AS id,payment_status,updated_at`
  return rows[0]
}

async function updatePayable(sql,legacyId,payableStatus){
  await existingOrder(sql,legacyId)
  const allowed=['unpaid','paid']
  if(!allowed.includes(payableStatus)) throw new Error('應付狀態不正確')
  const rows=await sql`
    UPDATE orders SET payable_status=${payableStatus},payable_paid_at=${payableStatus==='paid'?new Date().toISOString():null},updated_at=now()
    WHERE legacy_id=${text(legacyId)}
    RETURNING legacy_id AS id,payable_status,payable_paid_at,updated_at
  `
  return rows[0]
}

async function updateArchive(sql,legacyId,archived){
  await existingOrder(sql,legacyId)
  const rows=await sql`
    UPDATE orders SET archived=${archived===true},archived_at=${archived===true?new Date().toISOString():null},updated_at=now()
    WHERE legacy_id=${text(legacyId)}
    RETURNING legacy_id AS id,archived,archived_at,updated_at
  `
  return rows[0]
}

async function applyRefund(sql,legacyId,amount,note){
  const order=await existingOrder(sql,legacyId)
  const addAmount=num(amount)
  if(!(addAmount>0)) throw new Error('退款金額必須大於 0')
  const total=num(order.total_amount)
  const oldRefund=num(order.refund_amount)
  if(oldRefund+addAmount>total+0.001) throw new Error('累積退款金額不可超過訂單總額')
  const nextRefund=oldRefund+addAmount
  const paymentStatus=nextRefund>=total-0.001?'refunded':'partial_refund'
  const entry={amount:addAmount,note:text(note),at:new Date().toISOString()}
  const rows=await sql`
    UPDATE orders SET
      refund_amount=${nextRefund},payment_status=${paymentStatus},
      refunds=COALESCE(refunds,'[]'::jsonb) || ${JSON.stringify([entry])}::jsonb,updated_at=now()
    WHERE legacy_id=${text(legacyId)}
    RETURNING legacy_id AS id,refund_amount,payment_status,refunds,updated_at
  `
  return rows[0]
}

async function clearRefunds(sql,legacyId){
  await existingOrder(sql,legacyId)
  const rows=await sql`
    UPDATE orders SET refund_amount=0,refunds='[]'::jsonb,payment_status='paid',updated_at=now()
    WHERE legacy_id=${text(legacyId)}
    RETURNING legacy_id AS id,refund_amount,payment_status,refunds,updated_at
  `
  return rows[0]
}

async function updateArrival(sql,legacyId,items){
  const order=await existingOrder(sql,legacyId)
  const current=await sql`SELECT line_no,qty FROM order_items WHERE order_id=${order.id} ORDER BY line_no`
  const incoming=Array.isArray(items)?items:[]
  if(current.length!==incoming.length) throw new Error('訂單品項數量不一致，請重新整理後再試')
  let allArrived=current.length>0
  for(let i=0;i<current.length;i++){
    const qty=Math.max(0,Math.trunc(num(current[i].qty)))
    const arrived=Math.min(qty,Math.max(0,Math.trunc(num(incoming[i]?.arrived_qty))))
    const arrivedAt=arrived>=qty&&qty>0?(iso(incoming[i]?.arrived_at)||new Date().toISOString()):null
    if(!(qty>0&&arrived>=qty)) allArrived=false
    await sql`UPDATE order_items SET arrived_qty=${arrived},arrived_at=${arrivedAt},updated_at=now() WHERE order_id=${order.id} AND line_no=${current[i].line_no}`
  }
  await sql`UPDATE orders SET updated_at=now() WHERE id=${order.id}`
  return {allArrived}
}

async function updateItemQty(sql,legacyId,itemIndex,qty){
  const order=await existingOrder(sql,legacyId)
  const nextQty=Math.trunc(num(qty))
  if(nextQty<1) throw new Error('訂購量至少為 1')
  const lineNo=Math.trunc(num(itemIndex))+1
  const rows=await sql`
    SELECT line_no,sale_price,cost_price,qty,arrived_qty,supplier_paid_amount,supplier_payment_status
    FROM order_items WHERE order_id=${order.id} AND line_no=${lineNo} LIMIT 1
  `
  const item=rows[0]
  if(!item) throw new Error('找不到訂單商品')
  const salePrice=num(item.sale_price)
  const costPrice=num(item.cost_price)
  const paid=Math.max(0,num(item.supplier_paid_amount))
  const nextCost=costPrice*nextQty
  if(paid>nextCost+0.01) throw new Error(`此品項已付供應商 ${paid} 元，數量不可降到已付款成本以下`)
  const arrived=Math.min(nextQty,Math.max(0,Math.trunc(num(item.arrived_qty))))
  const supplierStatus=paid>0?(paid>=nextCost-0.01?'paid':'partial'):(item.supplier_payment_status||'unpaid')
  await sql`
    UPDATE order_items SET qty=${nextQty},subtotal=${salePrice*nextQty},cost_subtotal=${nextCost},
      arrived_qty=${arrived},arrived_at=${arrived>=nextQty?new Date().toISOString():null},
      supplier_payment_status=${supplierStatus},updated_at=now()
    WHERE order_id=${order.id} AND line_no=${lineNo}
  `
  const totals=await sql`SELECT COALESCE(SUM(subtotal),0)::numeric AS total_amount FROM order_items WHERE order_id=${order.id}`
  const total=num(totals[0]?.total_amount)
  await sql`UPDATE orders SET total_amount=${total},updated_at=now() WHERE id=${order.id}`
  return {total_amount:total}
}

async function updateVirtual(sql,ids,isVirtual){
  const target=[...new Set((Array.isArray(ids)?ids:[]).map(text).filter(Boolean))]
  if(!target.length) return {updated:0}
  if(target.length>400) throw new Error('單次最多更新 400 筆')
  const rows=await sql`
    UPDATE orders
    SET is_virtual=${isVirtual===true},updated_at=now()
    WHERE legacy_id=ANY(${target}::text[])
    RETURNING legacy_id AS id
  `
  return {updated:rows.length,ids:rows.map(r=>r.id)}
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
    requireStaff(account)
    if(action==='update_payment') return res.status(200).json({ok:true,result:await updatePayment(sql,req.body?.id,req.body?.payment_status)})
    if(action==='update_payable') return res.status(200).json({ok:true,result:await updatePayable(sql,req.body?.id,req.body?.payable_status)})
    if(action==='archive') return res.status(200).json({ok:true,result:await updateArchive(sql,req.body?.id,true)})
    if(action==='unarchive') return res.status(200).json({ok:true,result:await updateArchive(sql,req.body?.id,false)})
    if(action==='apply_refund') return res.status(200).json({ok:true,result:await applyRefund(sql,req.body?.id,req.body?.amount,req.body?.note)})
    if(action==='clear_refunds') return res.status(200).json({ok:true,result:await clearRefunds(sql,req.body?.id)})
    if(action==='update_arrival') return res.status(200).json({ok:true,result:await updateArrival(sql,req.body?.id,req.body?.items)})
    if(action==='update_item_qty') return res.status(200).json({ok:true,result:await updateItemQty(sql,req.body?.id,req.body?.item_index,req.body?.qty)})
    if(action==='update_virtual') return res.status(200).json({ok:true,result:await updateVirtual(sql,req.body?.ids,req.body?.is_virtual)})
    if(action==='delete'){
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