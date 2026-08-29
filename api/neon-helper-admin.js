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
    if(action==='all') return res.status(200).json({ok:true,rows:await listAll(sql)})
    throw new Error('未知的小幫手管理查詢')
  }catch(err){
    console.error('neon-helper-admin',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
