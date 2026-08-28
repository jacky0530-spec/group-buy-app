import { OrdersAPI } from './db'
import { neonRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-order-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  const firestoreList=OrdersAPI.list
  OrdersAPI.list=async function(){
    try{
      const result=await neonRuntime('list_orders')
      if(Array.isArray(result?.rows)) return result.rows
      throw new Error('Neon 訂單回傳格式錯誤')
    }catch(err){
      console.error('[Neon read fallback] orders',err)
      return firestoreList.apply(this,arguments)
    }
  }
}
