import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const num=v=>Number.isFinite(Number(v))?Number(v):0
const cleanupDays=v=>{
  if(v===undefined||v===null||v==='') return 60
  const days=Math.trunc(Number(v))
  if(!Number.isFinite(days)||days<14||days>3650) throw new Error('歷史清理天數需介於 14～3650 天')
  return days
}
const incomingId=()=>`incoming-${Date.now()}-${Math.random().toString(36).slice(2,8)}`

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account||account.disabled||!['owner','staff'].includes(account.role)) throw new Error('權限不足')
  return account
}
function requireOwner(account){
  if(account?.role!=='owner') throw new Error('只有負責人可以永久刪除歷史訂單')
}

async function ensureIncomingSchema(sql){
  await sql`
    CREATE TABLE IF NOT EXISTS incoming_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      legacy_id text NOT NULL UNIQUE,
      supplier text NOT NULL,
      expected_date date,
      status text NOT NULL DEFAULT 'planned',
      note text NOT NULL DEFAULT '',
      created_by_uid text NOT NULL DEFAULT '',
      created_by_name text NOT NULL DEFAULT '',
      payment_id uuid REFERENCES supplier_payments(id) ON DELETE SET NULL,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT incoming_batches_status_chk CHECK (status IN ('planned','receiving','completed','cancelled'))
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS incoming_batch_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id uuid NOT NULL REFERENCES incoming_batches(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name text NOT NULL DEFAULT '',
      spec_package text NOT NULL DEFAULT '',
      spec_flavor text NOT NULL DEFAULT '',
      spec_color text NOT NULL DEFAULT '',
      spec_size text NOT NULL DEFAULT '',
      expected_qty numeric NOT NULL DEFAULT 0,
      received_qty numeric NOT NULL DEFAULT 0,
      unit_cost numeric NOT NULL DEFAULT 0,
      note text NOT NULL DEFAULT '',
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT incoming_batch_items_expected_qty_chk CHECK (expected_qty >= 0),
      CONSTRAINT incoming_batch_items_received_qty_chk CHECK (received_qty >= 0),
      CONSTRAINT incoming_batch_items_unit_cost_chk CHECK (unit_cost >= 0),
      CONSTRAINT incoming_batch_items_unique_spec UNIQUE (batch_id,product_id,spec_package,spec_flavor,spec_color,spec_size)
    )`
  await sql`CREATE INDEX IF NOT EXISTS incoming_batches_status_expected_idx ON incoming_batches(status,expected_date,created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS incoming_batches_supplier_status_idx ON incoming_batches(supplier,status,created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS incoming_batch_items_batch_sort_idx ON incoming_batch_items(batch_id,sort_order,created_at)`
  await sql`CREATE INDEX IF NOT EXISTS incoming_batch_items_product_idx ON incoming_batch_items(product_id)`
}

async function incomingSelfTest(sql){
  await ensureIncomingSchema(sql)
  const sample=await sql`
    SELECT p.id AS product_uuid,p.legacy_id AS product_id,p.name AS product_name,oi.supplier,
      oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,oi.cost_price,
      GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))::numeric AS remaining_qty
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    JOIN products p ON p.id=oi.product_id
    WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false
      AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      AND GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))>0
    ORDER BY o.order_date ASC,oi.line_no ASC LIMIT 1`
  const s=sample[0]
  if(!s) return {schema:true,sample:false,testRowsCleared:true}
  const legacy=`__incoming_selftest__${Date.now()}`
  const batch=await sql`
    INSERT INTO incoming_batches(legacy_id,supplier,expected_date,status,note,created_by_uid,created_by_name)
    VALUES(${legacy},${s.supplier||'測試供應商'},CURRENT_DATE,'planned','一次性自我測試','system-selftest','system-selftest') RETURNING id`
  await sql`
    INSERT INTO incoming_batch_items(batch_id,product_id,product_name,spec_package,spec_flavor,spec_color,spec_size,expected_qty,received_qty,unit_cost,note,sort_order)
    VALUES(${batch[0].id},${s.product_uuid},${s.product_name},${s.spec_package||''},${s.spec_flavor||''},${s.spec_color||''},${s.spec_size||''},1,0,${num(s.cost_price)},'一次性自我測試',0)`
  await sql`UPDATE incoming_batch_items SET received_qty=1,updated_at=now() WHERE batch_id=${batch[0].id}`
  const check=await sql`SELECT COUNT(*)::int AS items,COALESCE(SUM(received_qty),0)::numeric AS received FROM incoming_batch_items WHERE batch_id=${batch[0].id}`
  await sql`DELETE FROM incoming_batches WHERE id=${batch[0].id}`
  const remaining=await sql`SELECT COUNT(*)::int AS count FROM incoming_batches WHERE legacy_id LIKE '__incoming_selftest__%'`
  return {schema:true,sample:true,product:s.product_name,items:Number(check[0]?.items||0),received:Number(check[0]?.received||0),testRowsCleared:Number(remaining[0]?.count||0)===0}
}

async function incomingCandidates(sql,supplier){
  await ensureIncomingSchema(sql)
  const supplierName=text(supplier)
  if(!supplierName){
    const rows=await sql`
      SELECT oi.supplier,COUNT(DISTINCT (oi.product_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size))::int AS product_count,
        COALESCE(SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))),0)::numeric AS remaining_qty,
        COALESCE(SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))*COALESCE(oi.cost_price,0)),0)::numeric AS remaining_cost
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false AND COALESCE(o.fulfillment_type,'preorder')='preorder'
        AND GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))>0 AND COALESCE(oi.supplier,'')<>''
      GROUP BY oi.supplier ORDER BY remaining_qty DESC,oi.supplier ASC`
    return {suppliers:rows.map(r=>({supplier:r.supplier,product_count:Number(r.product_count||0),remaining_qty:Number(r.remaining_qty||0),remaining_cost:Number(r.remaining_cost||0)})),rows:[]}
  }
  const rows=await sql`
    SELECT p.legacy_id AS product_id,p.name AS product_name,oi.supplier,
      COALESCE(oi.spec_package,'') AS spec_package,COALESCE(oi.spec_flavor,'') AS spec_flavor,
      COALESCE(oi.spec_color,'') AS spec_color,COALESCE(oi.spec_size,'') AS spec_size,
      COALESCE(SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))),0)::numeric AS remaining_qty,
      CASE WHEN SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0)))>0 THEN
        SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))*COALESCE(oi.cost_price,0))/SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))) ELSE 0 END::numeric AS unit_cost,
      COUNT(DISTINCT o.id)::int AS order_count
    FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
    WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      AND oi.supplier=${supplierName} AND GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))>0
    GROUP BY p.legacy_id,p.name,oi.supplier,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size
    ORDER BY p.name ASC,oi.spec_package ASC,oi.spec_flavor ASC,oi.spec_color ASC,oi.spec_size ASC`
  return {suppliers:[],rows:rows.map(r=>({...r,remaining_qty:Number(r.remaining_qty||0),unit_cost:Number(r.unit_cost||0),order_count:Number(r.order_count||0)}))}
}

async function incomingList(sql,status){
  await ensureIncomingSchema(sql)
  const filter=text(status)
  const rows=await sql`
    SELECT b.legacy_id AS id,b.supplier,b.expected_date,b.status,b.note,b.created_by_name,b.completed_at,b.created_at,b.updated_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id',bi.id::text,'product_id',p.legacy_id,'product_name',bi.product_name,
        'spec_package',bi.spec_package,'spec_flavor',bi.spec_flavor,'spec_color',bi.spec_color,'spec_size',bi.spec_size,
        'expected_qty',bi.expected_qty,'received_qty',bi.received_qty,'unit_cost',bi.unit_cost,'note',bi.note,'sort_order',bi.sort_order
      ) ORDER BY bi.sort_order,bi.created_at) FILTER (WHERE bi.id IS NOT NULL),'[]'::jsonb) AS items
    FROM incoming_batches b
    LEFT JOIN incoming_batch_items bi ON bi.batch_id=b.id LEFT JOIN products p ON p.id=bi.product_id
    WHERE (${filter}='' OR b.status=${filter})
    GROUP BY b.id ORDER BY CASE b.status WHEN 'receiving' THEN 1 WHEN 'planned' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,b.expected_date NULLS LAST,b.created_at DESC LIMIT 200`
  return rows.map(r=>({...r,items:Array.isArray(r.items)?r.items.map(i=>({...i,expected_qty:Number(i.expected_qty||0),received_qty:Number(i.received_qty||0),unit_cost:Number(i.unit_cost||0)})):[]}))
}

async function incomingCreate(sql,body,auth){
  await ensureIncomingSchema(sql)
  const supplier=text(body?.supplier)
  const items=(Array.isArray(body?.items)?body.items:[]).map((i,index)=>({
    product_id:text(i.product_id),product_name:text(i.product_name),spec_package:text(i.spec_package),spec_flavor:text(i.spec_flavor),
    spec_color:text(i.spec_color),spec_size:text(i.spec_size),expected_qty:Math.max(0,Math.trunc(num(i.expected_qty))),unit_cost:Math.max(0,num(i.unit_cost)),note:text(i.note),sort_order:index,
  })).filter(i=>i.product_id&&i.expected_qty>0)
  if(!supplier) throw new Error('請選擇供應商')
  if(!items.length) throw new Error('請至少選擇一項即將到貨商品')
  if(items.length>100) throw new Error('單一到貨批次最多 100 種商品')
  const id=incomingId()
  const rows=await sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
      AS x(product_id text,product_name text,spec_package text,spec_flavor text,spec_color text,spec_size text,expected_qty numeric,unit_cost numeric,note text,sort_order int)
    ), valid AS (
      SELECT i.*,p.id AS product_uuid,p.name AS current_name
      FROM input i JOIN products p ON p.legacy_id=i.product_id
    ), gate AS (SELECT COUNT(*)::int=${items.length}::int AS ok FROM valid),
    b AS (
      INSERT INTO incoming_batches(legacy_id,supplier,expected_date,status,note,created_by_uid,created_by_name)
      SELECT ${id},${supplier},NULLIF(${text(body?.expected_date)},'')::date,'planned',${text(body?.note)},${auth.uid},${text(body?.created_by_name)} FROM gate WHERE ok RETURNING id,legacy_id
    ), ins AS (
      INSERT INTO incoming_batch_items(batch_id,product_id,product_name,spec_package,spec_flavor,spec_color,spec_size,expected_qty,received_qty,unit_cost,note,sort_order)
      SELECT b.id,v.product_uuid,COALESCE(NULLIF(v.product_name,''),v.current_name),v.spec_package,v.spec_flavor,v.spec_color,v.spec_size,v.expected_qty,0,v.unit_cost,v.note,v.sort_order
      FROM valid v CROSS JOIN b RETURNING id
    )
    SELECT b.legacy_id AS id,(SELECT COUNT(*) FROM ins)::int AS item_count FROM b`
  if(!rows.length) throw new Error('部分商品已不存在，請重新整理後再試')
  return {id:rows[0].id,item_count:Number(rows[0].item_count||0)}
}

async function incomingSave(sql,body){
  await ensureIncomingSchema(sql)
  const id=text(body?.id)
  const items=(Array.isArray(body?.items)?body.items:[]).map(i=>({id:text(i.id),received_qty:Math.max(0,Math.trunc(num(i.received_qty))),expected_qty:Math.max(0,Math.trunc(num(i.expected_qty)))})).filter(i=>i.id)
  if(!id) throw new Error('缺少到貨批次 ID')
  const rows=await sql`
    WITH input AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS x(id text,received_qty numeric,expected_qty numeric)),
    b AS (SELECT id FROM incoming_batches WHERE legacy_id=${id} AND status IN ('planned','receiving') FOR UPDATE),
    u AS (
      UPDATE incoming_batch_items bi SET received_qty=LEAST(GREATEST(0,i.received_qty),GREATEST(0,i.expected_qty)),expected_qty=GREATEST(0,i.expected_qty),updated_at=now()
      FROM input i,b WHERE bi.batch_id=b.id AND bi.id=NULLIF(i.id,'')::uuid RETURNING bi.id
    ), ub AS (UPDATE incoming_batches SET status='receiving',note=${text(body?.note)},expected_date=NULLIF(${text(body?.expected_date)},'')::date,updated_at=now() WHERE id IN (SELECT id FROM b) RETURNING id)
    SELECT (SELECT COUNT(*) FROM u)::int AS updated,(SELECT COUNT(*) FROM ub)::int AS batch_updated`
  if(!rows.length||Number(rows[0].batch_updated||0)!==1) throw new Error('批次不存在或已完成')
  return {updated:Number(rows[0].updated||0)}
}

async function incomingComplete(sql,body){
  await ensureIncomingSchema(sql)
  const id=text(body?.id)
  if(!id) throw new Error('缺少到貨批次 ID')
  const rows=await sql`
    WITH b AS (
      SELECT id,legacy_id,supplier FROM incoming_batches WHERE legacy_id=${id} AND status IN ('planned','receiving') FOR UPDATE
    ), bi AS (
      SELECT i.id AS batch_item_id,i.product_id,i.product_name,i.spec_package,i.spec_flavor,i.spec_color,i.spec_size,i.received_qty,
        COALESCE(SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))),0)::numeric AS available_qty
      FROM incoming_batch_items i CROSS JOIN b
      LEFT JOIN order_items oi ON oi.product_id=i.product_id AND oi.supplier=b.supplier
        AND COALESCE(oi.spec_package,'')=COALESCE(i.spec_package,'') AND COALESCE(oi.spec_flavor,'')=COALESCE(i.spec_flavor,'')
        AND COALESCE(oi.spec_color,'')=COALESCE(i.spec_color,'') AND COALESCE(oi.spec_size,'')=COALESCE(i.spec_size,'')
      LEFT JOIN orders o ON o.id=oi.order_id AND o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      WHERE i.batch_id=b.id AND i.received_qty>0 AND (oi.id IS NULL OR o.id IS NOT NULL)
      GROUP BY i.id
    ), valid AS (
      SELECT NOT EXISTS(SELECT 1 FROM bi WHERE received_qty>available_qty) AS ok,
        COALESCE((SELECT SUM(received_qty) FROM bi),0)::numeric AS requested
    ), candidates AS (
      SELECT bi.batch_item_id,oi.id AS order_item_id,o.legacy_id AS order_id,oi.line_no-1 AS item_index,
        GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))::numeric AS remaining,
        COALESCE(SUM(GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))) OVER(
          PARTITION BY bi.batch_item_id ORDER BY o.order_date ASC,o.created_at ASC,oi.line_no ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)::numeric AS before_qty,
        bi.received_qty
      FROM bi
      JOIN order_items oi ON oi.product_id=bi.product_id
        AND COALESCE(oi.spec_package,'')=COALESCE(bi.spec_package,'') AND COALESCE(oi.spec_flavor,'')=COALESCE(bi.spec_flavor,'')
        AND COALESCE(oi.spec_color,'')=COALESCE(bi.spec_color,'') AND COALESCE(oi.spec_size,'')=COALESCE(bi.spec_size,'')
      JOIN orders o ON o.id=oi.order_id CROSS JOIN b
      WHERE oi.supplier=b.supplier AND o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false
        AND COALESCE(o.fulfillment_type,'preorder')='preorder' AND GREATEST(0,oi.qty-COALESCE(oi.arrived_qty,0))>0
    ), alloc AS (
      SELECT *,GREATEST(0,LEAST(remaining,received_qty-before_qty))::numeric AS alloc_qty FROM candidates
    ), u AS (
      UPDATE order_items oi SET arrived_qty=LEAST(oi.qty,COALESCE(oi.arrived_qty,0)+a.alloc_qty),
        arrived_at=CASE WHEN COALESCE(oi.arrived_qty,0)+a.alloc_qty>=oi.qty THEN COALESCE(oi.arrived_at,now()) ELSE oi.arrived_at END,updated_at=now()
      FROM alloc a,valid v WHERE v.ok AND a.alloc_qty>0 AND oi.id=a.order_item_id
      RETURNING oi.id
    ), affected AS (
      SELECT jsonb_agg(jsonb_build_object('order_id',a.order_id,'item_index',a.item_index,'qty',a.alloc_qty) ORDER BY a.order_id,a.item_index) AS rows,
        COALESCE(SUM(a.alloc_qty),0)::numeric AS allocated FROM alloc a WHERE a.alloc_qty>0
    ), done AS (
      UPDATE incoming_batches SET status='completed',completed_at=now(),updated_at=now()
      WHERE id IN (SELECT id FROM b) AND (SELECT ok FROM valid) AND (SELECT allocated FROM affected)=(SELECT requested FROM valid)
      RETURNING id
    )
    SELECT (SELECT ok FROM valid) AS valid,(SELECT requested FROM valid)::numeric AS requested,
      COALESCE((SELECT allocated FROM affected),0)::numeric AS allocated,COALESCE((SELECT rows FROM affected),'[]'::jsonb) AS affected,
      (SELECT COUNT(*) FROM done)::int AS completed`
  const r=rows[0]
  if(!r||r.valid!==true) throw new Error('本批實收數量超過目前訂單尚未到貨數量，請重新整理後調整')
  if(Number(r.completed||0)!==1||Math.abs(Number(r.requested||0)-Number(r.allocated||0))>0.001) throw new Error('到貨分配資料已變動，批次未完成，請重新整理後再試')
  const affected=Array.isArray(r.affected)?r.affected:[]
  for(const a of affected){
    try{await correctSupplierState(sql,a.order_id,a.item_index,false)}catch(err){console.error('incoming-correct-supplier-state',a,err)}
  }
  return {completed:true,requested:Number(r.requested||0),allocated:Number(r.allocated||0),affected}
}

async function incomingShipReady(sql,body){
  const ids=[...new Set((Array.isArray(body?.order_ids)?body.order_ids:[]).map(text).filter(Boolean))]
  if(!ids.length) return {requested:0,shipped:0,waiting:0,ids:[]}
  if(ids.length>400) throw new Error('單次最多自動批次出貨 400 張訂單')
  const reason=text(body?.reason)||'即將到貨批次全額付款後自動批次出貨'
  const event=JSON.stringify([{status:'shipped',at:new Date().toISOString(),note:reason}])
  const rows=await sql`
    WITH eligible AS (
      SELECT o.id,o.legacy_id
      FROM orders o
      WHERE o.legacy_id=ANY(${ids}::text[])
        AND o.status='pending'
        AND COALESCE(o.is_virtual,false)=false
        AND COALESCE(o.fulfillment_type,'preorder')='preorder'
        AND EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id=o.id AND COALESCE(oi.qty,0)>0
        )
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id=o.id
            AND COALESCE(oi.arrived_qty,0)<COALESCE(oi.qty,0)
        )
      FOR UPDATE
    ), shipped AS (
      UPDATE orders o SET
        status='shipped',shipped_at=now(),cancelled_at=NULL,cancellation_reason='',
        payment_status=CASE WHEN o.payment_status IN ('partial_refund','refunded') THEN o.payment_status ELSE 'paid' END,
        status_history=COALESCE(o.status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
      FROM eligible e
      WHERE o.id=e.id
      RETURNING o.legacy_id AS id
    )
    SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) AS ids,COUNT(*)::int AS shipped FROM shipped`
  const shippedIds=Array.isArray(rows[0]?.ids)?rows[0].ids:[]
  return {requested:ids.length,shipped:Number(rows[0]?.shipped||0),waiting:Math.max(0,ids.length-shippedIds.length),ids:shippedIds}
}

async function getOrder(sql,legacyId){
  const rows=await sql`
    SELECT id,legacy_id,status,payment_status,fulfillment_type,status_history
    FROM orders WHERE legacy_id=${text(legacyId)} LIMIT 1
  `
  if(!rows[0]) throw new Error('Neon 找不到訂單')
  return rows[0]
}

async function updateStatus(sql,legacyId,status,reason){
  if(!['pending','shipped','cancelled'].includes(status)) throw new Error('訂單狀態不正確')
  const order=await getOrder(sql,legacyId)
  if(order.fulfillment_type==='stock') throw new Error('現貨訂單狀態必須使用庫存交易流程')
  const event=JSON.stringify([{status,at:new Date().toISOString(),note:text(reason)}])
  if(status==='shipped'){
    const rows=await sql`
      UPDATE orders SET
        status='shipped',shipped_at=now(),cancelled_at=NULL,cancellation_reason='',
        payment_status=CASE WHEN payment_status IN ('partial_refund','refunded') THEN payment_status ELSE 'paid' END,
        status_history=COALESCE(status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
      WHERE id=${order.id}
      RETURNING legacy_id AS id,status,payment_status,shipped_at,cancelled_at,cancellation_reason,status_history,updated_at
    `
    return rows[0]
  }
  if(status==='cancelled'){
    const rows=await sql`
      UPDATE orders SET
        status='cancelled',cancelled_at=now(),cancellation_reason=${text(reason)},
        status_history=COALESCE(status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
      WHERE id=${order.id}
      RETURNING legacy_id AS id,status,payment_status,shipped_at,cancelled_at,cancellation_reason,status_history,updated_at
    `
    return rows[0]
  }
  const rows=await sql`
    UPDATE orders SET
      status='pending',shipped_at=NULL,cancelled_at=NULL,cancellation_reason='',
      status_history=COALESCE(status_history,'[]'::jsonb)||${event}::jsonb,updated_at=now()
    WHERE id=${order.id}
    RETURNING legacy_id AS id,status,payment_status,shipped_at,cancelled_at,cancellation_reason,status_history,updated_at
  `
  return rows[0]
}

async function correctSupplierState(sql,legacyId,itemIndex,resetArrival){
  const hasItem=itemIndex!==undefined&&itemIndex!==null&&itemIndex!==''
  const lineNo=hasItem?Math.max(1,Math.trunc(num(itemIndex))+1):null
  const rows=await sql`SELECT correct_preorder_supplier_state(${text(legacyId)},${lineNo},${resetArrival===true}) AS result`
  return rows[0]?.result||{}
}

async function cleanupCandidates(sql,days){
  const takeDays=cleanupDays(days)
  const rows=await sql`
    SELECT
      o.legacy_id AS id,o.customer_name,o.order_date,o.shipped_at,o.archived,o.source,
      to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM') AS report_month,
      COUNT(oi.id)::int AS item_count,
      COALESCE(SUM(GREATEST(COALESCE(oi.qty,0),0)),0)::numeric AS qty,
      GREATEST(0,COALESCE(o.total_amount,0)-COALESCE(o.refund_amount,0))::numeric AS revenue,
      COALESCE(o.refund_amount,0)::numeric AS refund,
      COALESCE(SUM(COALESCE(oi.cost_price,0)*GREATEST(COALESCE(oi.qty,0),0)),0)::numeric AS cost,
      COALESCE(SUM(LEAST(
        COALESCE(oi.cost_price,0)*GREATEST(COALESCE(oi.qty,0),0),
        GREATEST(COALESCE(oi.supplier_paid_amount,0),0)
      )),0)::numeric AS supplier_paid,
      COUNT(*) OVER()::int AS total_count
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE o.status='shipped'
      AND o.shipped_at IS NOT NULL
      AND o.shipped_at <= now()-make_interval(days => ${takeDays})
      AND COALESCE(o.is_virtual,false)=false
      AND COALESCE(o.fulfillment_type,'preorder')='preorder'
    GROUP BY o.id
    HAVING COALESCE(SUM(GREATEST(COALESCE(oi.qty,0),0)),0)>0
    ORDER BY o.shipped_at ASC
    LIMIT 400`
  const mapped=rows.map(row=>{
    const cost=Number(row.cost||0),supplierPaid=Number(row.supplier_paid||0)
    const revenue=Number(row.revenue||0)
    return {
      id:row.id,customer_name:row.customer_name||'',order_date:row.order_date,shipped_at:row.shipped_at,
      archived:row.archived===true,source:row.source||'admin',report_month:row.report_month||'',
      item_count:Number(row.item_count||0),qty:Number(row.qty||0),revenue,refund:Number(row.refund||0),cost,
      profit:revenue-cost,supplier_paid:supplierPaid,supplier_outstanding:Math.max(0,cost-supplierPaid),
    }
  })
  return {rows:mapped,totalCount:rows.length?Number(rows[0].total_count||0):0,days:takeDays,limited:rows.length>=400}
}

async function cleanupDelete(sql,ids,days){
  const target=[...new Set((Array.isArray(ids)?ids:[]).map(text).filter(Boolean))]
  if(!target.length) throw new Error('沒有選取要刪除的訂單')
  if(target.length>400) throw new Error('單次最多永久刪除 400 筆')
  const takeDays=cleanupDays(days)

  const gateSql=()=>sql`
    SELECT COUNT(*)::int AS count
    FROM orders o
    WHERE o.legacy_id=ANY(${target}::text[])
      AND o.status='shipped'
      AND o.shipped_at IS NOT NULL
      AND o.shipped_at <= now()-make_interval(days => ${takeDays})
      AND COALESCE(o.is_virtual,false)=false
      AND COALESCE(o.fulfillment_type,'preorder')='preorder'`
  const precheck=await gateSql()
  if(Number(precheck[0]?.count||0)!==target.length) throw new Error('部分訂單不再符合歷史清理條件，請重新整理後再試')

  const tx=await sql.transaction([
    sql`SELECT id FROM orders WHERE legacy_id=ANY(${target}::text[]) FOR UPDATE`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      UPDATE helper_entries h SET converted_order_id=NULL,updated_at=now()
      FROM eligible e,gate g WHERE g.ok AND h.converted_order_id=e.id
      RETURNING h.id`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      DELETE FROM supplier_payment_allocations a
      USING eligible e,gate g WHERE g.ok AND a.order_id=e.id
      RETURNING a.id`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      DELETE FROM order_items i
      USING eligible e,gate g WHERE g.ok AND i.order_id=e.id
      RETURNING i.id`,
    sql`
      WITH eligible AS (
        SELECT o.id FROM orders o
        WHERE o.legacy_id=ANY(${target}::text[])
          AND o.status='shipped' AND o.shipped_at IS NOT NULL
          AND o.shipped_at <= now()-make_interval(days => ${takeDays})
          AND COALESCE(o.is_virtual,false)=false
          AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      ), gate AS (SELECT COUNT(*)::int=${target.length}::int AS ok FROM eligible)
      DELETE FROM orders o
      USING eligible e,gate g WHERE g.ok AND o.id=e.id
      RETURNING o.legacy_id AS id`,
  ])
  const deleted=tx[4]||[]
  if(deleted.length!==target.length) throw new Error('部分訂單狀態已變更，整批未刪除，請重新整理後再試')
  return {deleted:deleted.length,ids:deleted.map(row=>row.id),days:takeDays}
}

export default async function handler(req,res){
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const sql=neon(process.env.DATABASE_URL)
    if(req.method==='GET'&&req.query?.incoming_bootstrap==='v13'){
      return res.status(200).json({ok:true,result:await incomingSelfTest(sql)})
    }
    if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
    const auth=await verifyFirebaseIdToken(req)
    const account=await requireStaff(sql,auth)
    const action=text(req.body?.action)
    if(action==='meta'){
      const order=await getOrder(sql,req.body?.id)
      return res.status(200).json({ok:true,result:{id:order.legacy_id,fulfillment_type:order.fulfillment_type,status:order.status}})
    }
    if(action==='update'){
      return res.status(200).json({ok:true,result:await updateStatus(sql,req.body?.id,text(req.body?.status),req.body?.reason)})
    }
    if(action==='correct_supplier_state'){
      return res.status(200).json({ok:true,result:await correctSupplierState(sql,req.body?.id,req.body?.item_index,req.body?.reset_arrival)})
    }
    if(action==='cleanup_candidates'){
      requireOwner(account)
      return res.status(200).json({ok:true,result:await cleanupCandidates(sql,req.body?.days)})
    }
    if(action==='cleanup_delete'){
      requireOwner(account)
      return res.status(200).json({ok:true,result:await cleanupDelete(sql,req.body?.ids,req.body?.days)})
    }
    if(action==='incoming_candidates') return res.status(200).json({ok:true,result:await incomingCandidates(sql,req.body?.supplier)})
    if(action==='incoming_list') return res.status(200).json({ok:true,result:await incomingList(sql,req.body?.status)})
    if(action==='incoming_create') return res.status(200).json({ok:true,result:await incomingCreate(sql,req.body||{},auth)})
    if(action==='incoming_save') return res.status(200).json({ok:true,result:await incomingSave(sql,req.body||{})})
    if(action==='incoming_complete') return res.status(200).json({ok:true,result:await incomingComplete(sql,req.body||{})})
    if(action==='incoming_ship_ready') return res.status(200).json({ok:true,result:await incomingShipReady(sql,req.body||{})})
    throw new Error('未知的訂單狀態動作')
  }catch(err){
    console.error('neon-order-status',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}