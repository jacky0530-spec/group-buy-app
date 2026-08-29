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
