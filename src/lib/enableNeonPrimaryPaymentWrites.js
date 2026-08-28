import { SupplierPaymentsAPI } from './db'
import { neonPaymentsRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-payment-writes-installed')

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  SupplierPaymentsAPI.list=async function(){
    const result=await neonPaymentsRuntime('list')
    if(!Array.isArray(result?.rows)) throw new Error('Neon 付款回傳格式錯誤')
    return result.rows
  }

  SupplierPaymentsAPI.createPayment=async function(request={}){
    const supplier=String(request.supplier||'').trim()
    const amount=Number(request.amount||0)
    if(!supplier) throw new Error('請選擇供應商')
    if(!(amount>0)) throw new Error('付款金額必須大於 0')
    if(!Array.isArray(request.lines)||!request.lines.length) throw new Error('請選擇付款明細')
    const id=randomLegacyId()
    const response=await neonPaymentsRuntime('create',{
      id,supplier,payment_date:request.payment_date||new Date().toISOString().slice(0,10),amount,
      note:String(request.note||'').trim(),lines:request.lines,
    })
    const result=response?.result||{}
    return {id,amount,allocation_count:Number(result.allocation_count||result.allocations?.length||0)}
  }
}
