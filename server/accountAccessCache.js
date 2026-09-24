const CACHE_KEY=Symbol.for('group-buy.server-account-cache')
const cache=globalThis[CACHE_KEY]||(globalThis[CACHE_KEY]=new Map())
const DEFAULT_TTL_MS=30000

function prune(now){
  if(cache.size<=200)return
  for(const [key,value] of cache){
    if(now-Number(value?.at||0)>DEFAULT_TTL_MS) cache.delete(key)
  }
  if(cache.size<=200)return
  for(const key of cache.keys()){
    cache.delete(key)
    if(cache.size<=160)break
  }
}

export async function getCachedAccount(sql,uid,{ttlMs=DEFAULT_TTL_MS}={}){
  const key=String(uid||'').trim()
  if(!key)return null
  const now=Date.now()
  const hit=cache.get(key)
  if(hit&&now-Number(hit.at||0)<ttlMs)return hit.account||null
  const rows=await sql`
    SELECT firebase_uid,email,display_name,role,disabled,created_at,updated_at
    FROM accounts
    WHERE firebase_uid=${key}
    LIMIT 1`
  const account=rows[0]||null
  cache.set(key,{at:now,account})
  prune(now)
  return account
}

export function clearCachedAccount(uid){
  const key=String(uid||'').trim()
  if(key)cache.delete(key)
  else cache.clear()
}
