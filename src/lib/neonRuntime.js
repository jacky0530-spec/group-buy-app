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

export async function bestEffortNeonSync(action,row){
  try{
    return await neonRuntime(action,{row})
  }catch(err){
    console.error(`[Neon dual-write] ${action} failed`,err)
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
