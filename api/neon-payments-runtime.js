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

async function extraUuid(sql,legacyId){
  if(!legacyId)return null
  const rows=await sql`SELECT id FROM stock_purchase_extras WHERE legacy_id=${legacyId} LIMIT 1`
  return rows[0]?.id||null
}

async function syncPayment(sql,row){
  const legacyId=text(row?.id||row?.legacy_id)
  if(!legacyId) throw new Error('付款缺少 legacy id')
  const paymentRows=await sql`
    INSERT INTO supplier_payments (legacy_id,supplier,payment_date,amount,note,voided,voided_at,void_reason,created_at,updated_at)
    VALUES (${legacyId},${text(row.supplier)||'未指定供應商'},${text(row.payment_date)||new Date().toISOString().slice(0,10)},${Math.max(0,num(row.amount))},${text(row.note)},${row.voided===true},${iso(row.voided_at)},${text(row.void_reason)},${iso(row.created_at)||new Date().toISOString()},${iso(row.updated_at)||new Date().toISOString()})
    ON CONFLICT (legacy_id) DO UPDATE SET supplier=EXCLUDED.supplier,payment_date=EXCLUDED.payment_date,amount=EXCLUDED.amount,note=EXCLUDED.note,voided=EXCLUDED.voided,voided_at=EXCLUDED.voided_at,void_reason=EXCLUDED.void_reason,updated_at=EXCLUDED.updated_at
    RETURNING id
  `
  const paymentId=paymentRows[0]?.id
  if(!paymentId) throw new Error('Neon 付款同步失敗')
  await sql`DELETE FROM supplier_payment_allocations WHERE payment_id=${paymentId}`
  let allocations=0
  for(const allocation of (row.allocations||[])){
    const orderId=await orderUuid(sql,text(allocation.order_id))
    const extraId=await extraUuid(sql,text(allocation.extra_id))
    let orderItemId=null
    if(orderId){
      const lineNo=Math.max(1,Math.trunc(num(allocation.item_index))+1)
      const itemRows=await sql`SELECT id FROM order_items WHERE order_id=${orderId} AND line_no=${lineNo} LIMIT 1`
      orderItemId=itemRows[0]?.id||null
    }
    await sql`
      INSERT INTO supplier_payment_allocations (payment_id,order_id,order_item_id,extra_purchase_id,customer_name,product_name,supplier,amount,created_at)
      VALUES (${paymentId},${orderId},${orderItemId},${extraId},${text(allocation.customer_name)},${text(allocation.product_name)},${text(allocation.supplier||row.supplier)},${Math.max(0,num(allocation.amount))},${iso(row.created_at)||new Date().toISOString()})
    `
    allocations++
  }
  return {id:legacyId,allocations}
}

async function buildAllocations(sql,lines,totalAmount,supplier){
  const requested=(Array.isArray(lines)?lines:[]).map((line,seq)=>({
    seq,
    order_id:text(line.order_id),
    item_index:Math.max(0,Math.trunc(num(line.item_index))),
    extra_id:text(line.extra_id),
    customer_name:text(line.customer_name),
    product_name:text(line.product_name),
    supplier:text(line.supplier||supplier),
  })).filter(line=>line.order_id||line.extra_id)
  if(!requested.length) throw new Error('請選擇付款明細')

  const rows=await sql`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(requested)}::jsonb)
      AS r(seq int,order_id text,item_index int,extra_id text,customer_name text,product_name text,supplier text)
    ), order_rows AS (
      SELECT r.seq,'order'::text AS kind,r.order_id,r.item_index,''::text AS extra_id,r.customer_name,r.product_name,r.supplier,
        o.id::text AS order_uuid,oi.id::text AS item_uuid,NULL::text AS extra_uuid,
        (oi.cost_price*oi.qty)::numeric AS cost_total,COALESCE(oi.supplier_paid_amount,0)::numeric AS paid
      FROM requested r
      JOIN orders o ON o.legacy_id=r.order_id
      JOIN order_items oi ON oi.order_id=o.id AND oi.line_no=r.item_index+1
      WHERE COALESCE(r.extra_id,'')=''
    ), stock_rows AS (
      SELECT r.seq,'stock'::text AS kind,''::text AS order_id,0::int AS item_index,r.extra_id,'現貨進貨'::text AS customer_name,
        e.product_name,e.supplier,NULL::text AS order_uuid,NULL::text AS item_uuid,e.id::text AS extra_uuid,
        (e.unit_cost*e.ordered_qty)::numeric AS cost_total,COALESCE(e.supplier_paid_amount,0)::numeric AS paid
      FROM requested r
      JOIN stock_purchase_extras e ON e.legacy_id=r.extra_id
      JOIN products p ON p.id=e.product_id
      WHERE COALESCE(r.extra_id,'')<>'' AND COALESCE(p.supplier_payment_term,'manual')='manual' AND e.status<>'cancelled'
    )
    SELECT * FROM order_rows UNION ALL SELECT * FROM stock_rows ORDER BY seq
  `

  let remaining=totalAmount
  const allocations=[]
  for(const row of rows){
    if(remaining<=0.001) break
    const outstanding=Math.max(0,num(row.cost_total)-num(row.paid))
    if(outstanding<=0.001) continue
    const amount=Math.min(outstanding,remaining)
    allocations.push({
      kind:row.kind,order_id:row.order_id||'',item_index:Number(row.item_index||0),extra_id:row.extra_id||'',
      order_uuid:row.order_uuid||'',item_uuid:row.item_uuid||'',extra_uuid:row.extra_uuid||'',
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
  if(exists.length){
    const current=await sql`SELECT legacy_id AS id,amount FROM supplier_payments WHERE legacy_id=${legacyId} LIMIT 1`
    return {id:current[0].id,amount:Number(current[0].amount||0),replayed:true,allocations:[]}
  }

  const allocations=await buildAllocations(sql,body?.lines,amount,supplier)
  const result=await sql`
    WITH a AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(allocations)}::jsonb)
      AS x(kind text,order_id text,item_index int,extra_id text,order_uuid text,item_uuid text,extra_uuid text,customer_name text,product_name text,supplier text,amount numeric)
    ), current_allocations AS (
      SELECT a.*,
        CASE WHEN a.kind='order' THEN oi.cost_price*oi.qty ELSE e.unit_cost*e.ordered_qty END AS cost_total,
        CASE WHEN a.kind='order' THEN COALESCE(oi.supplier_paid_amount,0) ELSE COALESCE(e.supplier_paid_amount,0) END AS old_paid
      FROM a
      LEFT JOIN order_items oi ON a.kind='order' AND oi.id=a.item_uuid::uuid AND oi.order_id=a.order_uuid::uuid
      LEFT JOIN stock_purchase_extras e ON a.kind='stock' AND e.id=a.extra_uuid::uuid
      WHERE (a.kind='order' AND oi.id IS NOT NULL) OR (a.kind='stock' AND e.id IS NOT NULL)
    ), validation AS (
      SELECT COUNT(*) AS matched_count,COALESCE(SUM(amount),0) AS allocated,
        COALESCE(BOOL_AND(amount>0 AND amount<=GREATEST(0,cost_total-old_paid)+0.01),false) AS ok
      FROM current_allocations
    ), payment AS (
      INSERT INTO supplier_payments (legacy_id,supplier,payment_date,amount,note,voided,void_reason,created_at,updated_at)
      SELECT ${legacyId},${supplier},${paymentDate},${amount},${note},false,'',now(),now()
      FROM validation
      WHERE ok AND matched_count=${allocations.length} AND ABS(allocated-${amount})<=0.01
      RETURNING id,legacy_id
    ), inserted_allocations AS (
      INSERT INTO supplier_payment_allocations (payment_id,order_id,order_item_id,extra_purchase_id,customer_name,product_name,supplier,amount,created_at)
      SELECT p.id,
        CASE WHEN c.kind='order' THEN c.order_uuid::uuid ELSE NULL END,
        CASE WHEN c.kind='order' THEN c.item_uuid::uuid ELSE NULL END,
        CASE WHEN c.kind='stock' THEN c.extra_uuid::uuid ELSE NULL END,
        c.customer_name,c.product_name,c.supplier,c.amount,now()
      FROM current_allocations c CROSS JOIN payment p
      RETURNING id
    ), order_agg AS (
      SELECT item_uuid,SUM(amount) AS paid_delta FROM current_allocations WHERE kind='order' GROUP BY item_uuid
    ), stock_agg AS (
      SELECT extra_uuid,SUM(amount) AS paid_delta FROM current_allocations WHERE kind='stock' GROUP BY extra_uuid
    ), updated_items AS (
      UPDATE order_items oi SET
        supplier_paid_amount=LEAST(oi.cost_price*oi.qty,COALESCE(oi.supplier_paid_amount,0)+g.paid_delta),
        supplier_payment_status=CASE WHEN COALESCE(oi.supplier_paid_amount,0)+g.paid_delta>=oi.cost_price*oi.qty-0.01 THEN 'paid' ELSE 'partial' END,
        supplier_payment_refs=CASE WHEN COALESCE(oi.supplier_payment_refs,'[]'::jsonb) @> to_jsonb(ARRAY[${legacyId}]) THEN COALESCE(oi.supplier_payment_refs,'[]'::jsonb) ELSE COALESCE(oi.supplier_payment_refs,'[]'::jsonb)||to_jsonb(ARRAY[${legacyId}]) END,
        updated_at=now()
      FROM order_agg g CROSS JOIN payment p
      WHERE oi.id=g.item_uuid::uuid
      RETURNING oi.id
    ), updated_extras AS (
      UPDATE stock_purchase_extras e SET
        supplier_paid_amount=LEAST(e.unit_cost*e.ordered_qty,COALESCE(e.supplier_paid_amount,0)+g.paid_delta),
        supplier_payment_status=CASE WHEN COALESCE(e.supplier_paid_amount,0)+g.paid_delta>=e.unit_cost*e.ordered_qty-0.01 THEN 'paid' ELSE 'partial' END,
        supplier_payment_refs=CASE WHEN COALESCE(e.supplier_payment_refs,'[]'::jsonb) @> to_jsonb(ARRAY[${legacyId}]) THEN COALESCE(e.supplier_payment_refs,'[]'::jsonb) ELSE COALESCE(e.supplier_payment_refs,'[]'::jsonb)||to_jsonb(ARRAY[${legacyId}]) END,
        updated_at=now()
      FROM stock_agg g CROSS JOIN payment p
      WHERE e.id=g.extra_uuid::uuid
      RETURNING e.id
    )
    SELECT p.id::text AS payment_uuid,(SELECT COUNT(*) FROM inserted_allocations)::int AS allocation_count FROM payment p
  `
  if(!result.length) throw new Error('付款資料已變動，請重新整理後再試')

  await sql`
    UPDATE orders o SET payable_status=CASE WHEN NOT EXISTS (
      SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND COALESCE(oi.supplier_paid_amount,0)<COALESCE(oi.cost_price,0)*COALESCE(oi.qty,0)-0.01
    ) THEN 'paid' ELSE 'unpaid' END,
    payable_paid_at=CASE WHEN NOT EXISTS (
      SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND COALESCE(oi.supplier_paid_amount,0)<COALESCE(oi.cost_price,0)*COALESCE(oi.qty,0)-0.01
    ) THEN COALESCE(o.payable_paid_at,now()) ELSE NULL END,
    updated_at=now()
    WHERE o.id IN (SELECT DISTINCT order_uuid::uuid FROM jsonb_to_recordset(${JSON.stringify(allocations)}::jsonb) AS x(kind text,order_uuid text) WHERE kind='order' AND order_uuid<>'')
  `

  return {id:legacyId,amount,allocation_count:Number(result[0].allocation_count||0),allocations}
}

async function listPayments(sql){
  const payments=await sql`
    SELECT id AS neon_id,legacy_id AS id,supplier,payment_date,amount,note,voided,voided_at,void_reason,created_at,updated_at
    FROM supplier_payments WHERE voided<>true ORDER BY created_at DESC
  `
  const allocations=await sql`
    SELECT a.payment_id,o.legacy_id AS order_id,COALESCE(oi.line_no,1)-1 AS item_index,e.legacy_id AS extra_id,
      a.customer_name,a.product_name,a.supplier,a.amount
    FROM supplier_payment_allocations a
    LEFT JOIN orders o ON o.id=a.order_id
    LEFT JOIN order_items oi ON oi.id=a.order_item_id
    LEFT JOIN stock_purchase_extras e ON e.id=a.extra_purchase_id
    ORDER BY a.created_at ASC
  `
  const byPayment=new Map()
  for(const row of allocations){
    if(!byPayment.has(row.payment_id)) byPayment.set(row.payment_id,[])
    byPayment.get(row.payment_id).push({
      order_id:row.order_id||'',item_index:Number(row.item_index||0),extra_id:row.extra_id||'',customer_name:row.customer_name||'',
      product_name:row.product_name||'',supplier:row.supplier||'',amount:Number(row.amount||0),
    })
  }
  return payments.map(({neon_id,...row})=>({...row,amount:Number(row.amount||0),allocations:byPayment.get(neon_id)||[]}))
}

async function listStockPayables(sql){
  const rows=await sql`
    SELECT e.legacy_id AS extra_id,e.product_name,e.supplier,e.spec_label,e.ordered_qty,e.received_qty,e.unit_cost,e.status,e.created_at,
      COALESCE(e.supplier_paid_amount,0) AS supplier_paid_amount,COALESCE(e.supplier_payment_status,'unpaid') AS supplier_payment_status,
      COALESCE(p.supplier_payment_term,'manual') AS supplier_payment_term
    FROM stock_purchase_extras e
    JOIN products p ON p.id=e.product_id
    WHERE e.status<>'cancelled' AND COALESCE(p.supplier_payment_term,'manual')='manual'
      AND COALESCE(e.supplier_paid_amount,0)<e.unit_cost*e.ordered_qty-0.01
    ORDER BY e.created_at ASC
  `
  return rows.map(r=>({...r,ordered_qty:Number(r.ordered_qty||0),received_qty:Number(r.received_qty||0),unit_cost:Number(r.unit_cost||0),supplier_paid_amount:Number(r.supplier_paid_amount||0)}))
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
    if(action==='list_stock_payables') return res.status(200).json({ok:true,rows:await listStockPayables(sql)})
    throw new Error('未知的付款同步動作')
  }catch(err){
    console.error('neon-payments-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
