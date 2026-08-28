import { SupplierPaymentsAPI } from './db'
import { neonPaymentsRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-payment-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  SupplierPaymentsAPI.list=async function(){
    const result=await neonPaymentsRuntime('list')
    if(!Array.isArray(result?.rows)) throw new Error('Neon 付款回傳格式錯誤')
    return result.rows
  }
}
