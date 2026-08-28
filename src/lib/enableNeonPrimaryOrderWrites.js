import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { OrdersAPI } from './db'
import { neonOrderEditRuntime, neonOrdersRuntime } from './neonRuntime'
import { neonOrderStatusRuntime } from './neonOrderStatusRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-order-writes-installed')
const nowISO=()=>new Date().toISOString()

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

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

function installPreorderCreate(){
  const legacyCreate=OrdersAPI.create
  if(typeof legacyCreate!=='function') return
  OrdersAPI.create=async function(data={}){
    if(data.fulfillment_type==='stock') return legacyCreate.apply(this,[data])
    const id=randomLegacyId()
    const createdAt=nowISO()
    const status=data.status||'pending'
    const row={
      ...data,
      id,
      status,
      payment_status:data.payment_status||'unpaid',
      payable_status:data.payable_status||'unpaid',
      refund_amount:Number(data.refund_amount||0),
      refunds:Array.isArray(data.refunds)?data.refunds:[],
      status_history:Array.isArray(data.status_history)&&data.status_history.length?data.status_history:[{status,at:createdAt,note:'建立訂單'}],
      fulfillment_type:'preorder',
      order_date:createdAt,
      created_at:createdAt,
      updated_at:createdAt,
    }
    const primary=await neonOrderEditRuntime({action:'create',row})
    try{
      const ts=Timestamp.now()
      await setDoc(doc(db,'orders',id),{
        ...data,
        status:row.status,
        payment_status:row.payment_status,
        payable_status:row.payable_status,
        refund_amount:row.refund_amount,
        refunds:row.refunds,
        status_history:row.status_history,
        fulfillment_type:'preorder',
        order_date:ts,
        created_at:ts,
        updated_at:ts,
      })
    }catch(err){
      console.error('[Firestore mirror] OrdersAPI.create failed after Neon success',err)
    }
    return {id,...data,...row, ...(primary?.result||{})}
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
    const primary=await neonOrderEditRuntime({action:'edit',id,data})
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
  installPreorderCreate()
  installPreorderStatus()
  installPreorderEdit()
}
