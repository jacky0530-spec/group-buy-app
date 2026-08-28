import { auth } from './firebase'

export async function neonRuntime(action,payload={}){
  const user=auth.currentUser
  if(!user) throw new Error('尚未登入，無法同步 Neon')
  const token=await user.getIdToken()
  const response=await fetch('/api/neon-runtime',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({action,...payload}),
  })
  const data=await response.json().catch(()=>({}))
  if(!response.ok||!data.ok) throw new Error(data.error||`Neon API 錯誤 ${response.status}`)
  return data
}

export async function bestEffortNeonSync(action,row){
  try{
    return await neonRuntime(action,{row})
  }catch(err){
    console.error(`[Neon dual-write] ${action} failed`,err)
    return null
  }
}
