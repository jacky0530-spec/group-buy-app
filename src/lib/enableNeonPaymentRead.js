import { SupplierPaymentsAPI } from './db'
import { neonPaymentsRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-payment-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  const firestoreList=SupplierPaymentsAPI.list
  SupplierPaymentsAPI.list=async function(){
    try{
      const result=await neonPaymentsRuntime('list')
      if(Array.isArray(result?.rows)) return result.rows
      throw new Error('Neon 付款回傳格式錯誤')
    }catch(err){
      console.error('[Neon read fallback] supplier payments',err)
      return firestoreList.apply(this,arguments)
    }
  }
}
