import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const int=(v,d=0)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):d

async function requireStaff(sql,auth){
  const rows=await sql`SELECT role,disabled FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
}

function mapEntry(row){
  return {
    ...(row.payload||{}),
    id:row.id,
    created_by_uid:row.created_by_uid,
    created_by_name:row.created_by_name,
    customer_id:row.customer_id,
    customer_name:row.customer_name,
    customer_phone_last2:row.customer_phone_last2,
    total_amount:Number(row.total_amount||0),
    is_virtual:row.is_virtual===true,
    note:row.note||'',
    status:row.status,
    converted_order_id:row.converted_order_id,
    direct_order:row.direct_order,
    converted_at:row.converted_at,
    created_at:row.created_at,
    updated_at:row.updated_at,
  }
}

async function listAll(sql){
  const rows=await sql`
    SELECT h.legacy_id AS id,h.payload,h.created_by_uid,h.created_by_name,c.legacy_id AS customer_id,
      h.customer_name,h.customer_phone_last2,h.total_amount,h.is_virtual,h.note,h.status,
      o.legacy_id AS converted_order_id,h.direct_order,h.converted_at,h.created_at,h.updated_at
    FROM helper_entries h
    LEFT JOIN customers c ON c.id=h.customer_id
    LEFT JOIN orders o ON o.id=h.converted_order_id
    ORDER BY h.created_at DESC
  `
  return rows.map(mapEntry)
}

async function helperDashboard(sql,body){
  const month=text(body?.month)
  const query=text(body?.search).toLowerCase()
  const pageSize=Math.min(250,Math.max(20,int(body?.pageSize,100)))
  const offset=Math.max(0,int(body?.offset,0))
  const [stats,rows]=await Promise.all([
    sql`
      SELECT
        COALESCE(NULLIF(h.created_by_uid,''),'name:'||COALESCE(NULLIF(h.created_by_name,''),'unknown')) AS key,
        COALESCE(h.created_by_uid,'') AS uid,
        COALESCE(NULLIF(h.created_by_name,''),'小幫手') AS name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE h.status='converted')::int AS converted,
        COUNT(*) FILTER (WHERE h.status NOT IN ('converted','cancelled'))::int AS pending,
        COUNT(*) FILTER (WHERE h.status='cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE COALESCE(h.is_virtual,false)=true)::int AS virtual,
        COUNT(*) FILTER (WHERE COALESCE(h.is_virtual,false)=false)::int AS formal
      FROM helper_entries h
      WHERE (${month}='' OR to_char(h.created_at AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month})
      GROUP BY 1,2,3
      ORDER BY total DESC,name ASC
    `,
    sql`
      SELECT h.legacy_id AS id,h.payload,h.created_by_uid,h.created_by_name,c.legacy_id AS customer_id,
        h.customer_name,h.customer_phone_last2,h.total_amount,h.is_virtual,h.note,h.status,
        o.legacy_id AS converted_order_id,h.direct_order,h.converted_at,h.created_at,h.updated_at,
        COUNT(*) OVER()::int AS total_count
      FROM helper_entries h
      LEFT JOIN customers c ON c.id=h.customer_id
      LEFT JOIN orders o ON o.id=h.converted_order_id
      WHERE (${month}='' OR to_char(h.created_at AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month})
        AND (${query}='' OR
          POSITION(${query} IN LOWER(COALESCE(h.created_by_name,'')))>0 OR
          POSITION(${query} IN LOWER(COALESCE(h.customer_name,'')))>0 OR
          POSITION(${query} IN LOWER(COALESCE(h.customer_phone_last2,'')))>0 OR
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(h.items,h.payload->'items','[]'::jsonb)) AS item
            WHERE POSITION(${query} IN LOWER(COALESCE(item->>'product_name',item->>'name','')))>0
          )
        )
      ORDER BY h.created_at DESC
      OFFSET ${offset} LIMIT ${pageSize}
    `,
  ])
  const totalCount=rows.length?Number(rows[0].total_count||0):0
  return {
    stats:stats.map(r=>({...r,total:Number(r.total||0),converted:Number(r.converted||0),pending:Number(r.pending||0),cancelled:Number(r.cancelled||0),virtual:Number(r.virtual||0),formal:Number(r.formal||0)})),
    rows:rows.map(({total_count,...row})=>mapEntry(row)),
    totalCount,
    hasMore:offset+rows.length<totalCount,
  }
}

async function productQuery(sql,body){
  const includeArchived=body?.includeArchived===true
  const query=text(body?.search).toLowerCase()
  const category=text(body?.category)
  const pageSize=Math.min(250,Math.max(20,int(body?.pageSize,100)))
  const offset=Math.max(0,int(body?.offset,0))
  const rows=await sql`
    SELECT legacy_id AS id,name,category,supplier,price,cost,pricing_mode,spec_mode,spec_colors,spec_sizes,spec_flavors,
      price_options,supplier_payment_term,active,created_at,archived_at,updated_at,COUNT(*) OVER()::int AS total_count
    FROM products
    WHERE (${includeArchived}::boolean OR active<>false)
      AND (${category}='' OR ${category}='all' OR category=${category})
      AND (${query}='' OR POSITION(${query} IN LOWER(COALESCE(name,'')))>0 OR POSITION(${query} IN LOWER(COALESCE(supplier,'')))>0)
    ORDER BY created_at DESC
    OFFSET ${offset} LIMIT ${pageSize}
  `
  const totalCount=rows.length?Number(rows[0].total_count||0):0
  return {
    rows:rows.map(({total_count,...r})=>({...r,price:Number(r.price||0),cost:Number(r.cost||0)})),
    totalCount,
    hasMore:offset+rows.length<totalCount,
  }
}

async function productDuplicate(sql,body){
  const name=text(body?.name)
  const excludeId=text(body?.excludeId)
  if(!name)return false
  const rows=await sql`
    SELECT 1 FROM products
    WHERE active<>false AND name=${name} AND (${excludeId}='' OR legacy_id<>${excludeId})
    LIMIT 1
  `
  return rows.length>0
}

function stockSpecLabel(row){
  return [
    row.spec_package&&`組合：${row.spec_package}`,
    row.spec_flavor&&`口味：${row.spec_flavor}`,
    row.spec_color&&`顏色：${row.spec_color}`,
    row.spec_size&&`尺寸：${row.spec_size}`,
  ].filter(Boolean).join('／')||'一般規格'
}

function mapStock(row){
  const spec={package:row.spec_package||'',flavor:row.spec_flavor||'',color:row.spec_color||'',size:row.spec_size||''}
  const key=[spec.package,spec.flavor,spec.color,spec.size].join('|')||'default'
  return {
    neon_id:row.neon_id,
    id:`${row.product_id}__${encodeURIComponent(key)}`,
    product_id:row.product_id,
    product_name:row.product_name||'',
    supplier:row.supplier||'',
    spec,
    spec_label:stockSpecLabel(row),
    available_qty:Number(row.available_qty||0),
    adjustment_note:row.adjustment_note||'',
    created_at:row.created_at,
    updated_at:row.updated_at,
  }
}

async function stockQuery(sql,body){
  const query=text(body?.search).toLowerCase()
  const pageSize=Math.min(250,Math.max(20,int(body?.pageSize,100)))
  const offset=Math.max(0,int(body?.offset,0))
  const rows=await sql`
    SELECT s.id::text AS neon_id,p.legacy_id AS product_id,p.name AS product_name,s.supplier,
      s.spec_package,s.spec_flavor,s.spec_color,s.spec_size,s.available_qty,s.adjustment_note,s.created_at,s.updated_at,
      COUNT(*) OVER()::int AS total_count,
      COALESCE(SUM(s.available_qty) OVER(),0) AS total_qty
    FROM stock_inventory s
    JOIN products p ON p.id=s.product_id
    WHERE p.active<>false
      AND (${query}='' OR
        POSITION(${query} IN LOWER(COALESCE(p.name,'')))>0 OR
        POSITION(${query} IN LOWER(COALESCE(s.supplier,'')))>0 OR
        POSITION(${query} IN LOWER(COALESCE(s.spec_package,'')))>0 OR
        POSITION(${query} IN LOWER(COALESCE(s.spec_flavor,'')))>0 OR
        POSITION(${query} IN LOWER(COALESCE(s.spec_color,'')))>0 OR
        POSITION(${query} IN LOWER(COALESCE(s.spec_size,'')))>0)
    ORDER BY p.name ASC,s.spec_package ASC,s.spec_flavor ASC,s.spec_color ASC,s.spec_size ASC
    OFFSET ${offset} LIMIT ${pageSize}
  `
  const totalCount=rows.length?Number(rows[0].total_count||0):0
  const totalQty=rows.length?Number(rows[0].total_qty||0):0
  return {
    rows:rows.map(({total_count,total_qty,...row})=>mapStock(row)),
    totalCount,
    totalQty,
    hasMore:offset+rows.length<totalCount,
  }
}

async function stockSupport(sql,body){
  const movementLimit=Math.min(200,Math.max(20,int(body?.movementLimit,100)))
  const [extras,movements]=await Promise.all([
    sql`
      SELECT e.legacy_id AS id,p.legacy_id AS product_id,e.product_name,e.supplier,
        e.spec_package,e.spec_flavor,e.spec_color,e.spec_size,e.spec_label,
        e.ordered_qty,e.received_qty,e.unit_cost,e.note,e.status,e.received_at,e.created_at,e.updated_at
      FROM stock_purchase_extras e
      JOIN products p ON p.id=e.product_id
      WHERE e.status='ordered' AND e.ordered_qty>e.received_qty
      ORDER BY e.created_at DESC
      LIMIT 200
    `,
    sql`
      SELECT it.id,p.legacy_id AS product_id,p.name AS product_name,it.qty_change,it.balance_after,it.transaction_type,
        o.legacy_id AS order_id,e.legacy_id AS extra_id,it.note,it.created_by_uid,it.created_at
      FROM inventory_transactions it
      JOIN stock_inventory s ON s.id=it.inventory_id
      JOIN products p ON p.id=s.product_id
      LEFT JOIN orders o ON o.id=it.order_id
      LEFT JOIN stock_purchase_extras e ON e.id=it.extra_purchase_id
      ORDER BY it.created_at DESC
      LIMIT ${movementLimit}
    `,
  ])
  return {
    extras:extras.map(r=>({
      id:r.id,product_id:r.product_id,product_name:r.product_name||'',supplier:r.supplier||'',
      spec:{package:r.spec_package||'',flavor:r.spec_flavor||'',color:r.spec_color||'',size:r.spec_size||''},
      spec_label:r.spec_label||'',ordered_qty:Number(r.ordered_qty||0),received_qty:Number(r.received_qty||0),
      unit_cost:Number(r.unit_cost||0),note:r.note||'',status:r.status,received_at:r.received_at,created_at:r.created_at,updated_at:r.updated_at,
    })),
    movements:movements.map(r=>({...r,qty_change:Number(r.qty_change||0),balance_after:Number(r.balance_after||0)})),
  }
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    await requireStaff(sql,auth)
    const action=text(req.body?.action)||'all'
    if(action==='dashboard') return res.status(200).json({ok:true,...await helperDashboard(sql,req.body||{})})
    if(action==='product_query') return res.status(200).json({ok:true,...await productQuery(sql,req.body||{})})
    if(action==='product_duplicate') return res.status(200).json({ok:true,duplicate:await productDuplicate(sql,req.body||{})})
    if(action==='stock_query') return res.status(200).json({ok:true,...await stockQuery(sql,req.body||{})})
    if(action==='stock_support') return res.status(200).json({ok:true,...await stockSupport(sql,req.body||{})})
    if(action==='all') return res.status(200).json({ok:true,rows:await listAll(sql)})
    throw new Error('未知的小幫手管理查詢')
  }catch(err){
    console.error('neon-helper-admin',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
