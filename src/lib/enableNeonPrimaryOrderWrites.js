import { OrdersAPI } from './db'
import { neonOrderEditRuntime, neonOrdersRuntime } from './neonRuntime'
import { neonOrderStatusRuntime } from './neonOrderStatusRuntime'

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

function installPreorderStatus(){
  const firestoreOrStockFlow=OrdersAPI.updateStatus
  if(typeof firestoreOrStockFlow!=='function') return
  OrdersAPI.updateStatus=async function(id,status,options={}){
    const meta=await neonOrderStatusRuntime('meta',{id})
    if(meta?.result?.fulfillment_type==='stock'){
      return firestoreOrStockFlow.apply(this,[id,status,options])
    }
    const primary=await neonOrderStatusRuntime('update',{id,status,reason:options?.reason||''})
    try{
      await firestoreOrStockFlow.apply(this,[id,status,options])
    }catch(err){
      console.error('[Firestore mirror] preorder status failed after Neon success',err)
    }
    return primary?.result
  }
}

function installPreorderEdit(){
  const firestoreOrStockFlow=OrdersAPI.update
  if(typeof firestoreOrStockFlow!=='function') return
  OrdersAPI.update=async function(id,data){
    const meta=await neonOrderStatusRuntime('meta',{id})
    if(meta?.result?.fulfillment_type==='stock'){
      return firestoreOrStockFlow.apply(this,[id,data])
    }
    const primary=await neonOrderEditRuntime({id,data})
    try{
      await firestoreOrStockFlow.apply(this,[id,data])
    }catch(err){
      console.error('[Firestore mirror] preorder edit failed after Neon success',err)
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
  install('updateArrival','update_arrival',(_id,items)=>({items}))
  install('updateItemQty','update_item_qty',(_id,item_index,qty)=>({item_index,qty}))
  installPreorderStatus()
  installPreorderEdit()
}
