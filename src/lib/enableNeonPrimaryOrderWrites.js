import { OrdersAPI } from './db'
import { neonOrdersRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-order-writes-installed')

function install(method,action,payload){
  const firestoreMirror=OrdersAPI[method]
  if(typeof firestoreMirror!=='function') return
  OrdersAPI[method]=async function(...args){
    const id=args[0]
    const primary=await neonOrdersRuntime(action,{id,...payload(...args)})
    try{
      await firestoreMirror.apply(this,args)
    }catch(err){
      console.error(`[Firestore mirror] OrdersAPI.${method} failed after Neon success`,err)
    }
    return primary?.result
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  install('updatePayment','update_payment',(_id,payment_status)=>({payment_status}))
  install('updatePayable','update_payable',(_id,payable_status)=>({payable_status}))
  install('archive','archive',()=>({}))
  install('unarchive','unarchive',()=>({}))
  install('applyRefund','apply_refund',(_id,{amount,note='' }={})=>({amount,note}))
  install('clearRefunds','clear_refunds',()=>({}))
}
