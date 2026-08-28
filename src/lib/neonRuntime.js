import { auth } from './firebase'

async function postAuthed(path,body={}){
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

export async function neonRuntime(action,payload={}){
  return postAuthed('/api/neon-runtime',{action,...payload})
}

export async function neonOrdersRuntime(action,payload={}){
  return postAuthed('/api/neon-orders-runtime',{action,...payload})
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
