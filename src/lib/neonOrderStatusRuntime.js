import { auth } from './firebase'

export async function neonOrderStatusRuntime(action,payload={}){
  const user=auth.currentUser
  if(!user) throw new Error('尚未登入，無法更新訂單狀態')
  const token=await user.getIdToken()
  const response=await fetch('/api/neon-order-status',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({action,...payload}),
  })
  const data=await response.json().catch(()=>({}))
  if(!response.ok||!data.ok) throw new Error(data.error||`Neon API 錯誤 ${response.status}`)
  return data
}
