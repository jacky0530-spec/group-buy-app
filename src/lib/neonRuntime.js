import { auth } from './firebase'

const READ_INFLIGHT=Symbol.for('group-buy.neon-read-inflight')
const READ_CACHE=Symbol.for('group-buy.neon-read-cache')
const readInflight=globalThis[READ_INFLIGHT]||(globalThis[READ_INFLIGHT]=new Map())
const readCache=globalThis[READ_CACHE]||(globalThis[READ_CACHE]=new Map())
const READ_CACHE_TTL_MS=10000

const READ_ACTIONS={
  '/api/neon-order-query':new Set(['all','date_range','page','query','summary','customer_directory','correction_candidates','report_product_catalog','report_data','report_product_buyers']),
  '/api/neon-runtime':new Set(['ping','stock_search','list_customers','list_products','list_orders','list_expenses','expense_month']),
  '/api/neon-orders-runtime':new Set(['release_states','pickup_states']),
  '/api/neon-helper-runtime':new Set(['catalog','search_catalog','product_deadlines','customers','search_customers','my_entries','my_pending_orders','duplicate_pending']),
  '/api/neon-helper-admin':new Set(['all','home_dashboard','dashboard','product_query','product_duplicate','stock_query','stock_support']),
}

function readKey(path,body={}){
  const action=String(body?.action||'')
  if(path==='/api/neon-helper-admin') return `${path}|${JSON.stringify(body)}`
  if(READ_ACTIONS[path]?.has(action)) return `${path}|${JSON.stringify(body)}`
  return ''
}

function pruneReadCache(now=Date.now()){
  for(const [key,value] of readCache){
    if(now-Number(value?.at||0)>READ_CACHE_TTL_MS) readCache.delete(key)
  }
  if(readCache.size<=200)return
  for(const key of readCache.keys()){
    readCache.delete(key)
    if(readCache.size<=160)break
  }
}

async function performAuthedPost(path,body={}){
  const user=auth.currentUser
  if(!user) throw new Error('尚未登入，無法同步 Neon')
  const token=await user.getIdToken()
  const response=await fetch(path,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify(body),
  })
  const data=await response.json().catch(()=>({}))
  if(!response.ok||!data.ok) throw new Error(data.error||`Neon API 錯誤 ${response.status}`)
  return data
}

async function postAuthed(path,body={}){
  const key=readKey(path,body)
  if(!key){
    readCache.clear()
    return performAuthedPost(path,body)
  }
  const now=Date.now()
  const hit=readCache.get(key)
  if(hit&&now-Number(hit.at||0)<READ_CACHE_TTL_MS)return hit.data
  if(readInflight.has(key)) return readInflight.get(key)
  const promise=performAuthedPost(path,body)
    .then(data=>{
      readCache.set(key,{at:Date.now(),data})
      pruneReadCache()
      return data
    })
    .finally(()=>readInflight.delete(key))
  readInflight.set(key,promise)
  return promise
}

export async function neonRuntime(action,payload={}){
  return postAuthed('/api/neon-runtime',{action,...payload})
}

export async function neonOrderQuery(action,payload={}){
  return postAuthed('/api/neon-order-query',{action,...payload})
}

export async function neonOrdersRuntime(action,payload={}){
  return postAuthed('/api/neon-orders-runtime',{action,...payload})
}

export async function neonOrderEditRuntime(payload={}){
  return postAuthed('/api/neon-order-edit',payload)
}

export async function neonPaymentsRuntime(action,payload={}){
  return postAuthed('/api/neon-payments-runtime',{action,...payload})
}

export async function neonHelperRuntime(action,payload={}){
  return postAuthed('/api/neon-helper-runtime',{action,...payload})
}

export async function neonHelperAdminRuntime(payload={}){
  return postAuthed('/api/neon-helper-admin',payload)
}

export async function neonInventoryRuntime(action,payload={}){
  return postAuthed('/api/neon-inventory-runtime',{action,...payload})
}

export async function neonAccountsRuntime(action,payload={}){
  return postAuthed('/api/neon-accounts-runtime',{action,...payload})
}

export async function neonStockOrderState(payload={}){
  return postAuthed('/api/neon-stock-order-state',payload)
}

export async function bestEffortNeonSync(action,row){
  try{
    return await neonRuntime(action,{row})
  }catch(err){
    console.error(`[Neon dual-write] ${action} failed`,err)
    return null
  }
}

export async function bestEffortNeonCustomersSync(rows=[]){
  try{
    for(let i=0;i<rows.length;i+=200){
      await neonRuntime('sync_customers',{rows:rows.slice(i,i+200)})
    }
    return rows.length
  }catch(err){
    console.error('[Neon dual-write] bulk customer sync failed',err)
    return null
  }
}

export async function bestEffortNeonOrderSync(row){
  try{
    return await neonOrdersRuntime('sync',{row})
  }catch(err){
    console.error('[Neon dual-write] order sync failed',err)
    return null
  }
}

export async function bestEffortNeonOrderDelete(ids){
  try{
    return await neonOrdersRuntime('delete',{ids})
  }catch(err){
    console.error('[Neon dual-write] order delete failed',err)
    return null
  }
}

export async function bestEffortNeonPaymentSync(row){
  try{
    return await neonPaymentsRuntime('sync',{row})
  }catch(err){
    console.error('[Neon dual-write] supplier payment sync failed',err)
    return null
  }
}

export async function bestEffortNeonHelperSync(row){
  try{
    return await neonHelperRuntime('sync',{row})
  }catch(err){
    console.error('[Neon dual-write] helper entry sync failed',err)
    return null
  }
}

export async function bestEffortNeonHelpersSync(rows){
  try{
    return await neonHelperRuntime('sync_many',{rows})
  }catch(err){
    console.error('[Neon dual-write] helper entries sync failed',err)
    return null
  }
}

export async function bestEffortNeonInventorySync(row){
  try{
    return await neonInventoryRuntime('sync_inventory',{row})
  }catch(err){
    console.error('[Neon dual-write] inventory sync failed',err)
    return null
  }
}

export async function bestEffortNeonExtraSync(row){
  try{
    return await neonInventoryRuntime('sync_extra',{row})
  }catch(err){
    console.error('[Neon dual-write] extra purchase sync failed',err)
    return null
  }
}

export async function bestEffortNeonStockConsume(payload){
  try{
    return await neonInventoryRuntime('consume_stock',payload)
  }catch(err){
    console.error('[Neon dual-write] stock consume failed',err)
    return null
  }
}

export async function bestEffortNeonStockSet(payload){
  try{
    return await neonInventoryRuntime('set_stock',payload)
  }catch(err){
    console.error('[Neon dual-write] stock adjustment failed',err)
    return null
  }
}

export async function bestEffortNeonExtraReceive(payload){
  try{
    return await neonInventoryRuntime('receive_extra',payload)
  }catch(err){
    console.error('[Neon dual-write] extra purchase receive failed',err)
    return null
  }
}

export async function bestEffortNeonStockOrderState(payload){
  try{
    return await neonStockOrderState(payload)
  }catch(err){
    console.error('[Neon dual-write] stock order state sync failed',err)
    return null
  }
}
