import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
}

async function orderUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM orders WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function syncPayment(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('付款缺少 legacy id')
  const paymentRows=await sql`
    INSERT INTO supplier_payments (legacy_id,supplier,payment_date,amount,note,voided,voided_at,void_reason,created_at,updated_at)
    VALUES (
      ${legacyId},${text(row.supplier)||'未指定供應商'},${text(row.payment_date)||new Date().toISOString().slice(0,10)},
      ${Math.max(0,num(row.amount))},${text(row.note)},${row.voided===true},${iso(row.voided_at)},${text(row.void_reason)},
      ${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()}
    )
    ON CONFLICT (legacy_id) DO UPDATE SET
      supplier=EXCLUDED.supplier,payment_date=EXCLUDED.payment_date,amount=EXCLUDED.amount,note=EXCLUDED.note,
      voided=EXCLUDED.voided,voided_at=EXCLUDED.voided_at,void_reason=EXCLUDED.void_reason,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const paymentId=paymentRows[0]?.id
  if(!paymentId) throw new Error('Neon 付款同步失敗')
  await sql`DELETE FROM supplier_payment_allocations WHERE payment_id=${paymentId}`
  let allocations=0
  for(const allocation of (row.allocations||[])){
    const orderId=await orderUuid(sql,text(allocation.order_id))
    let orderItemId=null
    if(orderId){
      const lineNo=Math.max(1,Math.trunc(num(allocation.item_index))+1)
      const itemRows=await sql`SELECT id FROM order_items WHERE order_id=${orderId} AND line_no=${lineNo} LIMIT 1`
      orderItemId=itemRows[0]?.id||null
    }
    await sql`
      INSERT INTO supplier_payment_allocations (payment_id,order_id,order_item_id,customer_name,product_name,supplier,amount,created_at)
      VALUES (
        ${paymentId},${orderId},${orderItemId},${text(allocation.customer_name)},${text(allocation.product_name)},
        ${text(allocation.supplier||row.supplier)},${Math.max(0,num(allocation.amount))},${iso(row.created_at)||new Date().toISOString()}
      )
    `
    allocations++
  }
  return {id:legacyId,allocations}
}

async function buildAllocations(sql,lines,totalAmount,supplier){
  const requested=(Array.isArray(lines)?lines:[]).map((line,seq)=>({
    seq,order_id:text(line.order_id),item_index:Math.max(0,Math.trunc(num(line.item_index))),
    customer_name:text(line.customer_name),product_name:text(line.product_name),supplier:text(line.supplier||supplier),
  })).filter(line=>line.order_id)
  if(!requested.length) throw new Error('請選擇付款明細')
  const rows=await sql`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(requested)}::jsonb)
      AS r(seq int,order_id text,item_index int,customer_name text,product_name text,supplier text)
    )
    SELECT r.seq,r.order_id,r.item_index,r.customer_name,r.product_name,r.supplier,
      o.id::text AS order_uuid,oi.id::text AS item_uuid,
      (oi.cost_price*oi.qty)::numeric AS cost_total,COALESCE(oi.supplier_paid_amount,0)::numeric AS paid
    FROM requested r
    JOIN orders o ON o.legacy_id=r.order_id
    JOIN order_items oi ON oi.order_id=o.id AND oi.line_no=r.item_index+1
    ORDER BY r.seq
  `
  let remaining=totalAmount
  const allocations=[]
  for(const row of rows){
    if(remaining<=0.001) break
    const outstanding=Math.max(0,num(row.cost_total)-num(row.paid))
    if(outstanding<=0.001) continue
    const amount=Math.min(outstanding,remaining)
    allocations.push({
      order_id:row.order_id,item_index:Number(row.item_index),order_uuid:row.order_uuid,item_uuid:row.item_uuid,
      customer_name:row.customer_name||'',product_name:row.product_name||'',supplier:row.supplier||supplier,amount,
    })
    remaining-=amount
  }
  if(!allocations.length||remaining>0.01) throw new Error('付款金額超過目前可分配的待付款金額')
  return allocations
}

async function createPayment(sql,body){
  const legacyId=text(body?.id)
  const supplier=text(body?.supplier)
  const paymentDate=text(body?.payment_date)||new Date().toISOString().slice(0,10)
  const amount=num(body?.amount)
  const note=text(body?.note)
  if(!legacyId) throw new Error('缺少付款 ID')
  if(!supplier) throw new Error('請選擇供應商')
  if(!(amount>0)) throw new Error('付款金額必須大於 0')

  const exists=await sql`SELECT 1 FROM supplier_payments WHERE legacy_id=${legacyId} LIMIT 1`
  if(exists.length) {
    const current=await sql`SELECT legacy_id AS id,amount FROM supplier_payments WHERE legacy_id=${legacyId} LIMIT 1`
    return {id:current[0].id,amount:Number(current[0].amount||0),replayed:true,allocations:[]}
  }

  const allocations=await buildAllocations(sql,body?.lines,amount,supplier)
  const refs=JSON.stringify([legacyId])
  const result=await sql`
    WITH a AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(allocations)}::jsonb)
      AS x(order_id text,item_index int,order_uuid text,item_uuid text,customer_name text,product_name text,supplier text,amount numeric)
    ), current_items AS (
      SELECT a.*,oi.cost_price*oi.qty AS cost_total,COALESCE(oi.supplier_paid_amount,0) AS old_paid
      FROM a JOIN order_items oi ON oi.id=a.item_uuid::uuid AND oi.order_id=a.order_uuid::uuid
    ), validation AS (
      SELECT COUNT(*) AS matched_count,COALESCE(SUM(amount),0) AS allocated,
        COALESCE(BOOL_AND(amount>0 AND amount<=GREATEST(0,cost_total-old_paid)+0.01),false) AS ok
      FROM current_items
    ), payment AS (
      INSERT INTO supplier_payments (legacy_id,supplier,payment_date,amount,note,voided,created_at,updated_at)
      SELECT ${legacyId},${supplier},${paymentDate},${amount},${note},false,now(),now()
      FROM validation
      WHERE ok AND matched_count=${allocations.length} AND ABS(allocated-${amount})<=0.01
      RETURNING id
    ), inserted_allocations AS (
      INSERT INTO supplier_payment_allocations (payment_id,order_id,order_item_id,customer_name,product_name,supplier,amount,created_at)
      SELECT p.id,c.order_uuid::uuid,c.item_uuid::uuid,c.customer_name,c.product_name,c.supplier,c.amount,now()
      FROM current_items c CROSS JOIN payment p
      RETURNING id
    ), aggregated AS (
      SELECT item_uuid,SUM(amount) AS paid_delta FROM current_items GROUP BY item_uuid
    ), updated_items AS (
      UPDATE order_items oi SET
        supplier_paid_amount=LEAST(oi.cost_price*oi.qty,COALESCE(oi.supplier_paid_amount,0)+g.paid_delta),
        supplier_payment_status=CASE
          WHEN COALESCE(oi.supplier_paid_amount,0)+g.paid_delta>=oi.cost_price*oi.qty-0.01 THEN 'paid'
          WHEN COALESCE(oi.supplier_paid_amount,0)+g.paid_delta>0 THEN 'partial'
          ELSE 'unpaid' END,
        supplier_payment_refs=CASE
          WHEN COALESCE(oi.supplier_payment_refs,'[]'::jsonb) @> ${refs}::jsonb THEN COALESCE(oi.supplier_payment_refs,'[]'::jsonb)
          ELSE COALESCE(oi.supplier_payment_refs,'[]'::jsonb) || ${refs}::jsonb END,
        updated_at=now()
      FROM aggregated g CROSS JOIN payment p
      WHERE oi.id=g.item_uuid::uuid
      RETURNING oi.id::text AS item_uuid,oi.supplier_paid_amount,oi.supplier_payment_status,oi.supplier_payment_refs
    )
    SELECT p.id::text AS payment_uuid,
      (SELECT COUNT(*) FROM inserted_allocations)::int AS allocation_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'item_uuid',u.item_uuid,'supplier_paid_amount',u.supplier_paid_amount,
        'supplier_payment_status',u.supplier_payment_status,'supplier_payment_refs',u.supplier_payment_refs
      )) FROM updated_items u),'[]'::jsonb) AS updated_items
    FROM payment p
  `
  if(!result.length) throw new Error('付款資料已變動，請重新整理後再試')
  return {id:legacyId,amount,allocation_count:Number(result[0].allocation_count||0),allocations,updated_items:result[0].updated_items||[]}
}

async function listPayments(sql){
  const payments=await sql`
    SELECT id AS neon_id,legacy_id AS id,supplier,payment_date,amount,note,voided,voided_at,void_reason,created_at,updated_at
    FROM supplier_payments
    WHERE voided<>true
    ORDER BY created_at DESC
  `
  const allocations=await sql`
    SELECT a.payment_id,o.legacy_id AS order_id,COALESCE(oi.line_no,1)-1 AS item_index,
      a.customer_name,a.product_name,a.supplier,a.amount
    FROM supplier_payment_allocations a
    LEFT JOIN orders o ON o.id=a.order_id
    LEFT JOIN order_items oi ON oi.id=a.order_item_id
    ORDER BY a.created_at ASC
  `
  const byPayment=new Map()
  for(const row of allocations){
    if(!byPayment.has(row.payment_id)) byPayment.set(row.payment_id,[])
    byPayment.get(row.payment_id).push({
      order_id:row.order_id||'',item_index:Number(row.item_index||0),customer_name:row.customer_name||'',
      product_name:row.product_name||'',supplier:row.supplier||'',amount:Number(row.amount||0),
    })
  }
  return payments.map(({neon_id,...row})=>({
    ...row,amount:Number(row.amount||0),allocations:byPayment.get(neon_id)||[],
  }))
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const action=text(req.body?.action)
    if(action==='sync') return res.status(200).json({ok:true,result:await syncPayment(sql,req.body?.row||{})})
    if(action==='create') return res.status(200).json({ok:true,result:await createPayment(sql,req.body||{})})
    if(action==='list') return res.status(200).json({ok:true,rows:await listPayments(sql)})
    throw new Error('未知的付款同步動作')
  }catch(err){
    console.error('neon-payments-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
