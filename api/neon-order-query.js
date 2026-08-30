import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const int=(v,d=0)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):d

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const a=rows[0]
  if(!a||a.disabled||!['owner','staff'].includes(a.role)) throw new Error('權限不足')
}

async function hydrate(sql,orders){
  if(!orders.length)return []
  const ids=orders.map(o=>o.neon_id)
  const items=await sql`
    SELECT oi.order_id,p.legacy_id AS product_id,oi.product_name,oi.category,oi.supplier,oi.sale_price,oi.cost_price,
      oi.qty,oi.original_qty,oi.subtotal,oi.cost_subtotal,oi.note,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size,
      oi.fulfillment_type,oi.arrived_qty,oi.arrived_at,oi.supplier_payment_term,oi.supplier_paid_amount,
      oi.supplier_payment_status,oi.supplier_payment_refs,oi.created_at,oi.updated_at,oi.line_no
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
    WHERE oi.order_id = ANY(${ids}::uuid[])
    ORDER BY oi.order_id,oi.line_no
  `
  const map=new Map()
  for(const i of items){
    if(!map.has(i.order_id))map.set(i.order_id,[])
    map.get(i.order_id).push({
      id:i.product_id||'',product_id:i.product_id||'',name:i.product_name,product_name:i.product_name,
      category:i.category,supplier:i.supplier,price:Number(i.sale_price||0),sale_price:Number(i.sale_price||0),cost_price:Number(i.cost_price||0),
      qty:Number(i.qty||0),original_qty:Number(i.original_qty??i.qty??0),subtotal:Number(i.subtotal||0),cost_subtotal:Number(i.cost_subtotal||0),note:i.note||'',
      spec:{package:i.spec_package||'',flavor:i.spec_flavor||'',color:i.spec_color||'',size:i.spec_size||''},
      fulfillment_type:i.fulfillment_type,arrived_qty:Number(i.arrived_qty||0),arrived_at:i.arrived_at,
      supplier_payment_term:i.supplier_payment_term,supplier_paid_amount:Number(i.supplier_paid_amount||0),
      supplier_payment_status:i.supplier_payment_status,supplier_payment_refs:i.supplier_payment_refs||[],created_at:i.created_at,updated_at:i.updated_at,
    })
  }
  return orders.map(({neon_id,total_count,...o})=>({...o,total_amount:Number(o.total_amount||0),refund_amount:Number(o.refund_amount||0),items:map.get(neon_id)||[]}))
}

const baseSelect=sql=>sql`
  SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,
    o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,
    o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,
    o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id
  FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN helper_entries h ON h.id=o.helper_entry_id
  ORDER BY o.order_date DESC`

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const action=text(req.body?.action)||'all'
    let orders=[]
    if(action==='customer_directory'){
      const includeArchived=req.body?.includeArchived===true
      const rows=await sql`
        SELECT
          c.legacy_id AS id,c.name,c.phone,c.phone_last2,c.line_nick,c.fb_name,c.note,c.active,
          c.joined_at,c.archived_at,c.updated_at,
          COUNT(o.id) FILTER (
            WHERE o.status<>'cancelled' AND COALESCE(o.archived,false)=false
          )::int AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id=c.id
        WHERE (${includeArchived}::boolean OR c.active<>false)
        GROUP BY c.id
        ORDER BY c.joined_at DESC`
      return res.status(200).json({ok:true,rows:rows.map(r=>({...r,order_count:Number(r.order_count||0)}))})
    }
    if(action==='summary'){
      const rows=await sql`
        SELECT
          COUNT(*) FILTER (WHERE COALESCE(archived,false)=false)::int AS total_count,
          COUNT(*) FILTER (WHERE COALESCE(archived,false)=false AND status='pending' AND COALESCE(is_virtual,false)=false)::int AS pending_count,
          COUNT(*) FILTER (WHERE COALESCE(archived,false)=false AND status='shipped' AND COALESCE(is_virtual,false)=false)::int AS shipped_count,
          COUNT(*) FILTER (WHERE COALESCE(archived,false)=false AND status<>'cancelled' AND COALESCE(is_virtual,false)=true)::int AS virtual_count,
          COALESCE(SUM(GREATEST(0,total_amount-refund_amount)) FILTER (
            WHERE COALESCE(archived,false)=false AND status<>'cancelled' AND COALESCE(is_virtual,false)=false AND payment_status='unpaid'
          ),0) AS outstanding
        FROM orders`
      const row=rows[0]||{}
      return res.status(200).json({ok:true,summary:{
        totalCount:Number(row.total_count||0),pendingCount:Number(row.pending_count||0),shippedCount:Number(row.shipped_count||0),
        virtualCount:Number(row.virtual_count||0),outstanding:Number(row.outstanding||0),
      }})
    }
    if(action==='query'){
      const pageSize=Math.min(250,Math.max(1,int(req.body?.pageSize,100)))
      const offset=Math.max(0,int(req.body?.cursor?.offset,0))
      const search=text(req.body?.search).toLowerCase()
      const productId=text(req.body?.productId)
      const dateFrom=text(req.body?.dateFrom)
      const dateTo=text(req.body?.dateTo)
      const status=['pending','shipped','cancelled'].includes(text(req.body?.status))?text(req.body?.status):''
      const payment=['unpaid','paid','partial_refund','refunded'].includes(text(req.body?.payment))?text(req.body?.payment):''
      const includeArchived=req.body?.includeArchived===true
      orders=await sql`
        SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,
          o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,
          o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,
          o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id,
          COUNT(*) OVER()::int AS total_count
        FROM orders o
        LEFT JOIN customers c ON c.id=o.customer_id
        LEFT JOIN helper_entries h ON h.id=o.helper_entry_id
        WHERE (${includeArchived}::boolean OR COALESCE(o.archived,false)=false)
          AND (${status}='' OR o.status=${status})
          AND (${payment}='' OR o.payment_status=${payment})
          AND (NULLIF(${dateFrom},'')::date IS NULL OR (o.order_date AT TIME ZONE 'Asia/Taipei')::date >= NULLIF(${dateFrom},'')::date)
          AND (NULLIF(${dateTo},'')::date IS NULL OR (o.order_date AT TIME ZONE 'Asia/Taipei')::date <= NULLIF(${dateTo},'')::date)
          AND (${productId}='' OR EXISTS (
            SELECT 1 FROM order_items oi2 LEFT JOIN products p2 ON p2.id=oi2.product_id
            WHERE oi2.order_id=o.id AND p2.legacy_id=${productId}
          ))
          AND (${search}='' OR
            POSITION(${search} IN LOWER(COALESCE(o.customer_name,'')))>0 OR
            POSITION(${search} IN LOWER(COALESCE(o.customer_phone_last2,'')))>0 OR
            POSITION(${search} IN LOWER(COALESCE(o.customer_phone,'')))>0 OR
            POSITION(${search} IN LOWER(COALESCE(c.line_nick,'')))>0 OR
            POSITION(${search} IN LOWER(COALESCE(c.fb_name,'')))>0 OR
            POSITION(${search} IN LOWER(COALESCE(c.note,'')))>0 OR
            EXISTS (
              SELECT 1 FROM order_items oi3
              WHERE oi3.order_id=o.id AND POSITION(${search} IN LOWER(COALESCE(oi3.product_name,'')))>0
            )
          )
        ORDER BY o.order_date DESC
        OFFSET ${offset} LIMIT ${pageSize}`
      const totalCount=orders.length?Number(orders[0].total_count||0):0
      const rows=await hydrate(sql,orders)
      return res.status(200).json({ok:true,rows,totalCount,nextCursor:rows.length?{offset:offset+rows.length}:null,hasMore:offset+rows.length<totalCount})
    }
    if(action==='correction_candidates'){
      const pageSize=Math.min(500,Math.max(1,int(req.body?.pageSize,250)))
      orders=await sql`
        SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,
          o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,
          o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,
          o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id
        FROM orders o
        LEFT JOIN customers c ON c.id=o.customer_id
        LEFT JOIN helper_entries h ON h.id=o.helper_entry_id
        WHERE COALESCE(o.archived,false)=false
          AND o.status<>'cancelled'
          AND COALESCE(o.fulfillment_type,'preorder')<>'stock'
          AND EXISTS (
            SELECT 1 FROM order_items oi
            WHERE oi.order_id=o.id AND (COALESCE(oi.arrived_qty,0)>0 OR COALESCE(oi.supplier_paid_amount,0)>0)
          )
        ORDER BY o.order_date DESC
        LIMIT ${pageSize}`
      return res.status(200).json({ok:true,rows:await hydrate(sql,orders)})
    }
    if(action==='report_data'){
      const mode=['all','month','range'].includes(text(req.body?.mode))?text(req.body?.mode):'month'
      const month=text(req.body?.month)
      const start=text(req.body?.start)
      const end=text(req.body?.end)
      const periodClause=(alias='o')=>null
      void periodClause
      // V23：現貨正式開單已原子扣庫存，因此非取消現貨訂單於開單時即認列營收／成本；預購仍於 shipped 時認列。
      const [summaryRows,trendRows,topRows,catRows,supplierRows,monthlyRows]=await Promise.all([
        sql`
          WITH period_orders AS (
            SELECT o.* FROM orders o
            WHERE (
              ${mode}='all' OR
              (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR
              (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL
                AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date)
            )
          ), order_stats AS (
            SELECT
              COUNT(*) FILTER (WHERE status<>'cancelled' AND COALESCE(is_virtual,false)=false)::int AS formal_count,
              COUNT(*) FILTER (WHERE status<>'cancelled' AND COALESCE(is_virtual,false)=true)::int AS virtual_count,
              COALESCE(SUM(GREATEST(0,total_amount-refund_amount)) FILTER (WHERE status<>'cancelled' AND COALESCE(is_virtual,false)=false),0) AS order_value,
              COALESCE(SUM(total_amount) FILTER (WHERE (status='shipped' OR (status<>'cancelled' AND COALESCE(fulfillment_type,'preorder')='stock')) AND COALESCE(is_virtual,false)=false),0) AS shipped_gross_revenue,
              COALESCE(SUM(refund_amount) FILTER (WHERE (status='shipped' OR (status<>'cancelled' AND COALESCE(fulfillment_type,'preorder')='stock')) AND COALESCE(is_virtual,false)=false),0) AS shipped_refund_amount,
              COALESCE(SUM(GREATEST(0,total_amount-refund_amount)) FILTER (WHERE (status='shipped' OR (status<>'cancelled' AND COALESCE(fulfillment_type,'preorder')='stock')) AND COALESCE(is_virtual,false)=false),0) AS shipped_revenue,
              COALESCE(SUM(GREATEST(0,total_amount-refund_amount)) FILTER (WHERE status<>'cancelled' AND COALESCE(is_virtual,false)=false AND payment_status IN ('paid','partial_refund','refunded')),0) AS collected_amount,
              COALESCE(SUM(GREATEST(0,total_amount-refund_amount)) FILTER (WHERE status<>'cancelled' AND COALESCE(is_virtual,false)=false AND payment_status='unpaid'),0) AS outstanding_amount,
              COALESCE(SUM(refund_amount) FILTER (WHERE status<>'cancelled' AND COALESCE(is_virtual,false)=false),0) AS refund_amount,
              COALESCE(SUM(total_amount) FILTER (WHERE status='cancelled' AND COALESCE(is_virtual,false)=false),0) AS cancelled_amount
            FROM period_orders
          ), item_stats AS (
            SELECT
              COALESCE(SUM(COALESCE(oi.cost_price,p.cost,0)*oi.qty) FILTER (WHERE po.status='shipped' OR COALESCE(po.fulfillment_type,oi.fulfillment_type,'preorder')='stock'),0) AS shipped_cost,
              COALESCE(SUM(GREATEST(0,COALESCE(oi.cost_price,p.cost,0)*oi.qty-COALESCE(oi.supplier_paid_amount,0))),0) AS payable_outstanding,
              COALESCE(SUM(CASE WHEN COALESCE(oi.supplier_paid_amount,0)>0 AND COALESCE(oi.arrived_qty,0)<oi.qty THEN oi.supplier_paid_amount ELSE 0 END),0) AS paid_not_arrived,
              COALESCE(SUM(CASE WHEN oi.qty>0 AND COALESCE(oi.arrived_qty,0)>=oi.qty THEN GREATEST(0,COALESCE(oi.cost_price,p.cost,0)*oi.qty-COALESCE(oi.supplier_paid_amount,0)) ELSE 0 END),0) AS arrived_not_paid
            FROM period_orders po
            JOIN order_items oi ON oi.order_id=po.id
            LEFT JOIN products p ON p.id=oi.product_id
            WHERE po.status<>'cancelled' AND COALESCE(po.is_virtual,false)=false
          )
          SELECT * FROM order_stats CROSS JOIN item_stats`,
        sql`
          SELECT
            CASE WHEN ${mode}='all'
              THEN to_char(date_trunc('month',o.order_date AT TIME ZONE 'Asia/Taipei'),'YYYY/MM')||'月'
              ELSE to_char(o.order_date AT TIME ZONE 'Asia/Taipei','FMMM/FMDD') END AS date,
            CASE WHEN ${mode}='all'
              THEN to_char(date_trunc('month',o.order_date AT TIME ZONE 'Asia/Taipei'),'YYYY-MM')
              ELSE to_char((o.order_date AT TIME ZONE 'Asia/Taipei')::date,'YYYY-MM-DD') END AS sort_key,
            COALESCE(SUM(GREATEST(0,o.total_amount-o.refund_amount)),0) AS amount
          FROM orders o
          WHERE (o.status='shipped' OR (o.status<>'cancelled' AND COALESCE(o.fulfillment_type,'preorder')='stock')) AND COALESCE(o.is_virtual,false)=false
            AND (${mode}='all' OR (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date))
          GROUP BY 1,2 ORDER BY 2`,
        sql`
          SELECT COALESCE(p.legacy_id,oi.product_name) AS id,COALESCE(oi.product_name,p.name,'未命名商品') AS name,SUM(oi.qty)::numeric AS qty
          FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false
            AND (${mode}='all' OR (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date))
          GROUP BY 1,2 ORDER BY SUM(oi.qty) DESC LIMIT 8`,
        sql`
          SELECT COALESCE(NULLIF(oi.category,''),p.category,'other') AS category,COALESCE(SUM(COALESCE(oi.sale_price,0)*oi.qty),0) AS value
          FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false
            AND (${mode}='all' OR (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date))
          GROUP BY 1 ORDER BY 2 DESC`,
        sql`
          SELECT COALESCE(NULLIF(oi.supplier,''),'未指定供應商') AS supplier,
            COALESCE(SUM(COALESCE(oi.cost_price,p.cost,0)*oi.qty),0) AS total,
            COALESCE(SUM(GREATEST(0,COALESCE(oi.cost_price,p.cost,0)*oi.qty-COALESCE(oi.supplier_paid_amount,0))),0) AS outstanding
          FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false
            AND (${mode}='all' OR (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date))
          GROUP BY 1 ORDER BY 3 DESC`,
        sql`
          SELECT to_char(date_trunc('month',o.order_date AT TIME ZONE 'Asia/Taipei'),'YYYY-MM') AS month,
            COALESCE(SUM(GREATEST(0,o.total_amount-o.refund_amount)),0) AS revenue,
            COALESCE(SUM((SELECT COALESCE(SUM(COALESCE(oi.cost_price,p.cost,0)*oi.qty),0) FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id)),0) AS cost
          FROM orders o
          WHERE (o.status='shipped' OR (o.status<>'cancelled' AND COALESCE(o.fulfillment_type,'preorder')='stock')) AND COALESCE(o.is_virtual,false)=false
            AND (${mode}='all' OR (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date))
          GROUP BY 1 ORDER BY 1`
      ])
      const s=summaryRows[0]||{}
      return res.status(200).json({ok:true,report:{
        summary:{
          formalCount:Number(s.formal_count||0),virtualCount:Number(s.virtual_count||0),orderValue:Number(s.order_value||0),
          shippedGrossRevenue:Number(s.shipped_gross_revenue||0),shippedRefundAmount:Number(s.shipped_refund_amount||0),shippedRevenue:Number(s.shipped_revenue||0),
          shippedCost:Number(s.shipped_cost||0),collectedAmount:Number(s.collected_amount||0),outstandingAmount:Number(s.outstanding_amount||0),
          refundAmount:Number(s.refund_amount||0),cancelledAmount:Number(s.cancelled_amount||0),payableOutstanding:Number(s.payable_outstanding||0),
          paidNotArrived:Number(s.paid_not_arrived||0),arrivedNotPaid:Number(s.arrived_not_paid||0),
        },
        trend:trendRows.map(r=>({date:r.date,amount:Number(r.amount||0)})),
        topProducts:topRows.map(r=>({id:r.id,name:r.name,qty:Number(r.qty||0)})),
        categories:catRows.map(r=>({category:r.category,value:Number(r.value||0)})),
        suppliers:supplierRows.map(r=>({supplier:r.supplier,total:Number(r.total||0),outstanding:Number(r.outstanding||0)})),
        monthly:monthlyRows.map(r=>({month:r.month,revenue:Number(r.revenue||0),cost:Number(r.cost||0)})),
      }})
    }
    if(action==='report_product_buyers'){
      const mode=['all','month','range'].includes(text(req.body?.mode))?text(req.body?.mode):'month'
      const month=text(req.body?.month),start=text(req.body?.start),end=text(req.body?.end)
      const productId=text(req.body?.productId),productName=text(req.body?.productName)
      const rows=await sql`
        SELECT COALESCE(c.legacy_id,o.customer_name||'|'||COALESCE(o.customer_phone_last2,'')) AS customer_id,
          o.customer_name AS name,o.customer_phone_last2 AS phone_last2,
          SUM(oi.qty)::numeric AS qty,
          SUM(CASE WHEN o.status='pending' THEN oi.qty ELSE 0 END)::numeric AS pending,
          SUM(COALESCE(oi.sale_price,0)*oi.qty)::numeric AS total
        FROM orders o JOIN order_items oi ON oi.order_id=o.id
        LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN customers c ON c.id=o.customer_id
        WHERE o.status<>'cancelled' AND COALESCE(o.is_virtual,false)=false
          AND (${productId}='' OR p.legacy_id=${productId} OR (${productName}<>'' AND oi.product_name=${productName}))
          AND (${mode}='all' OR (${mode}='month' AND to_char(o.order_date AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}) OR (${mode}='range' AND NULLIF(${start},'')::date IS NOT NULL AND NULLIF(${end},'')::date IS NOT NULL AND (o.order_date AT TIME ZONE 'Asia/Taipei')::date BETWEEN NULLIF(${start},'')::date AND NULLIF(${end},'')::date))
        GROUP BY 1,2,3 ORDER BY SUM(oi.qty) DESC`
      return res.status(200).json({ok:true,rows:rows.map(r=>({customer_id:r.customer_id,name:r.name,phone_last2:r.phone_last2||'',qty:Number(r.qty||0),pending:Number(r.pending||0),total:Number(r.total||0)}))})
    }
    if(action==='all'){
      orders=await baseSelect(sql)
      return res.status(200).json({ok:true,rows:await hydrate(sql,orders)})
    }
    if(action==='date_range'){
      const start=text(req.body?.startISO),end=text(req.body?.endISO)
      orders=await sql`
        SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,
          o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,
          o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,
          o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id
        FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN helper_entries h ON h.id=o.helper_entry_id
        WHERE (${start||null}::timestamptz IS NULL OR o.order_date>=${start||null}::timestamptz)
          AND (${end||null}::timestamptz IS NULL OR o.order_date<=${end||null}::timestamptz)
        ORDER BY o.order_date DESC`
      return res.status(200).json({ok:true,rows:await hydrate(sql,orders)})
    }
    if(action==='page'){
      const pageSize=Math.min(250,Math.max(1,int(req.body?.pageSize,100)))
      const offset=Math.max(0,int(req.body?.cursor?.offset,0))
      orders=await sql`
        SELECT o.id AS neon_id,o.legacy_id AS id,c.legacy_id AS customer_id,o.customer_name,o.customer_phone,o.customer_phone_last2,
          o.total_amount,o.status,o.payment_status,o.payable_status,o.refund_amount,o.is_virtual,o.source,o.fulfillment_type,o.note,
          o.created_by_uid,o.created_by_name,o.order_date,o.shipped_at,o.cancelled_at,o.cancellation_reason,o.archived,o.archived_at,
          o.status_history,o.refunds,o.created_at,o.updated_at,h.legacy_id AS helper_entry_id
        FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN helper_entries h ON h.id=o.helper_entry_id
        ORDER BY o.order_date DESC OFFSET ${offset} LIMIT ${pageSize}`
      const rows=await hydrate(sql,orders)
      return res.status(200).json({ok:true,rows,nextCursor:rows.length?{offset:offset+rows.length}:null,hasMore:rows.length===pageSize})
    }
    throw new Error('未知的訂單查詢動作')
  }catch(err){
    console.error('neon-order-query',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
