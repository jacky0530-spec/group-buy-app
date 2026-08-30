import { neon } from '@neondatabase/serverless'
import { verifyFirebaseIdToken } from '../server/firebaseToken.js'

const text=v=>String(v??'').trim()
const iso=v=>{if(!v)return null;if(typeof v==='string')return v;if(v?.seconds)return new Date(Number(v.seconds)*1000).toISOString();return null}
const role=v=>['owner','staff','helper'].includes(v)?v:'staff'
const BACKUP_OWNER_EMAIL='jacky0530@gmail.com'

async function requireAccount(sql,auth){
  const rows=await sql`SELECT role,disabled,email FROM accounts WHERE firebase_uid=${auth.uid} LIMIT 1`
  const account=rows[0]
  if(!account) throw new Error('Neon 找不到登入帳號')
  if(account.disabled) throw new Error('帳號已停用')
  if(!['owner','staff','helper'].includes(account.role)) throw new Error('帳號權限無效')
  return account
}

function requireOwner(account){
  if(account.role!=='owner') throw new Error('只有負責人可以管理帳號')
}

function requireBackupOwner(account,auth){
  const accountEmail=text(account?.email).toLowerCase()
  const tokenEmail=text(auth?.email).toLowerCase()
  if(account?.role!=='owner'||accountEmail!==BACKUP_OWNER_EMAIL||tokenEmail!==BACKUP_OWNER_EMAIL){
    throw new Error('只有指定系統擁有者可以存取備份／移轉中心')
  }
}

async function syncAccount(sql,row){
  const uid=text(row?.id||row?.firebase_uid)
  if(!uid) throw new Error('帳號缺少 Firebase UID')
  await sql`
    INSERT INTO accounts (firebase_uid,email,display_name,role,disabled,created_at,updated_at)
    VALUES (
      ${uid},${text(row.email).toLowerCase()||null},${text(row.display_name)},${role(row.role)},${row.disabled===true},
      ${iso(row.created_at)||new Date().toISOString()},${new Date().toISOString()}
    )
    ON CONFLICT (firebase_uid) DO UPDATE SET
      email=EXCLUDED.email,display_name=EXCLUDED.display_name,role=EXCLUDED.role,
      disabled=EXCLUDED.disabled,updated_at=EXCLUDED.updated_at
  `
  return uid
}

async function backupOverview(sql){
  const [tables,columns,constraints,indexes,triggers,functions,views,enums,sequences,sequenceOwners,metrics]=await Promise.all([
    sql`SELECT tablename AS table_name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
    sql`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position,
      character_maximum_length,numeric_precision,numeric_scale,datetime_precision,
      is_identity,identity_generation,is_generated,generation_expression
      FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    sql`SELECT c.conname AS constraint_name,c.contype AS constraint_type,cl.relname AS table_name,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' ORDER BY cl.relname,c.conname`,
    sql`SELECT tablename AS table_name,indexname AS index_name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    sql`SELECT c.relname AS table_name,t.tgname AS trigger_name,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    sql`SELECT p.proname AS function_name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname`,
    sql`SELECT viewname AS view_name,definition FROM pg_views WHERE schemaname='public' ORDER BY viewname`,
    sql`SELECT t.typname AS type_name,array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname`,
    sql`SELECT sequencename AS sequence_name,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value
      FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`,
    sql`SELECT s.relname AS sequence_name,t.relname AS table_name,a.attname AS column_name
      FROM pg_class s
      JOIN pg_namespace ns ON ns.oid=s.relnamespace
      JOIN pg_depend d ON d.objid=s.oid AND d.deptype IN ('a','i')
      JOIN pg_class t ON t.oid=d.refobjid
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
      WHERE ns.nspname='public' AND s.relkind='S' ORDER BY s.relname`,
    sql`SELECT
      (SELECT COUNT(*)::int FROM accounts) AS accounts,
      (SELECT COUNT(*)::int FROM customers) AS customers,
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM orders) AS orders,
      (SELECT COUNT(*)::int FROM order_items) AS order_items,
      (SELECT COUNT(*)::int FROM helper_entries) AS helper_entries,
      (SELECT COUNT(*)::int FROM stock_inventory) AS stock_inventory,
      (SELECT COUNT(*)::int FROM inventory_transactions) AS inventory_transactions,
      (SELECT COUNT(*)::int FROM stock_purchase_extras) AS stock_purchase_extras,
      (SELECT COUNT(*)::int FROM supplier_payments) AS supplier_payments,
      (SELECT COUNT(*)::int FROM supplier_payment_allocations) AS supplier_payment_allocations,
      (SELECT COUNT(*)::int FROM expenses) AS expenses,
      (SELECT COUNT(*)::int FROM incoming_batches) AS incoming_batches,
      (SELECT COUNT(*)::int FROM incoming_batch_items) AS incoming_batch_items,
      (SELECT COALESCE(SUM(GREATEST(0,COALESCE(total_amount,0)-COALESCE(refund_amount,0))),0) FROM orders WHERE status IS DISTINCT FROM 'cancelled') AS order_net_total,
      (SELECT COALESCE(SUM(amount),0) FROM supplier_payments) AS supplier_payment_total,
      (SELECT COALESCE(SUM(available_qty),0) FROM stock_inventory) AS stock_available_total
    `,
  ])
  return {
    generated_at:new Date().toISOString(),
    database_engine:'PostgreSQL',
    tables:tables.map(r=>r.table_name),
    columns,
    constraints,
    indexes,
    triggers,
    functions,
    views,
    enums,
    sequences,
    sequence_owners:sequenceOwners,
    metrics:metrics[0]||{},
    export_tables:['accounts','customers','products','orders','order_items','helper_entries','stock_inventory','inventory_transactions','stock_purchase_extras','supplier_payments','supplier_payment_allocations','expenses','incoming_batches','incoming_batch_items'],
    secret_policy:'Secrets are intentionally excluded. Keep DATABASE_URL / Firebase private keys / access tokens outside Git.'
  }
}

async function backupExportTable(sql,name){
  // Backup correctness does not depend on row ordering. Do not assume every table
  // has created_at/updated_at; several legacy tables intentionally do not.
  switch(name){
    case 'accounts': return sql`SELECT * FROM accounts`
    case 'customers': return sql`SELECT * FROM customers`
    case 'products': return sql`SELECT * FROM products`
    case 'orders': return sql`SELECT * FROM orders`
    case 'order_items': return sql`SELECT * FROM order_items`
    case 'helper_entries': return sql`SELECT * FROM helper_entries`
    case 'stock_inventory': return sql`SELECT * FROM stock_inventory`
    case 'inventory_transactions': return sql`SELECT * FROM inventory_transactions`
    case 'stock_purchase_extras': return sql`SELECT * FROM stock_purchase_extras`
    case 'supplier_payments': return sql`SELECT * FROM supplier_payments`
    case 'supplier_payment_allocations': return sql`SELECT * FROM supplier_payment_allocations`
    case 'expenses': return sql`SELECT * FROM expenses`
    case 'incoming_batches': return sql`SELECT * FROM incoming_batches`
    case 'incoming_batch_items': return sql`SELECT * FROM incoming_batch_items`
    default: throw new Error('此資料表不在備份白名單')
  }
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method Not Allowed'})
  try{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
    const auth=await verifyFirebaseIdToken(req)
    const sql=neon(process.env.DATABASE_URL)
    const account=await requireAccount(sql,auth)
    const action=text(req.body?.action)
    if(action==='list'){
      if(!['owner','staff'].includes(account.role)) throw new Error('權限不足')
      const rows=await sql`SELECT firebase_uid AS id,email,display_name,role,disabled,created_at,updated_at FROM accounts ORDER BY created_at ASC`
      return res.status(200).json({ok:true,rows})
    }
    if(action==='sync'){
      requireOwner(account)
      return res.status(200).json({ok:true,id:await syncAccount(sql,req.body?.row||{})})
    }
    if(action==='backup_overview'){
      requireBackupOwner(account,auth)
      return res.status(200).json({ok:true,overview:await backupOverview(sql)})
    }
    if(action==='backup_export_table'){
      requireBackupOwner(account,auth)
      const table=text(req.body?.table)
      const rows=await backupExportTable(sql,table)
      return res.status(200).json({ok:true,table,generated_at:new Date().toISOString(),rows})
    }
    throw new Error('未知的帳號動作')
  }catch(err){
    console.error('neon-accounts-runtime',err)
    return res.status(400).json({ok:false,error:String(err?.message||err)})
  }
}
