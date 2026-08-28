import { doc, setDoc, Timestamp, writeBatch } from 'firebase/firestore'
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

function normalizedNewRow(data,id,createdAt,note='建立訂單'){
  const status=data.status||'pending'
  return {
    ...data,
    id,
    status,
    payment_status:data.payment_status||'unpaid',
    payable_status:data.payable_status||'unpaid',
    refund_amount:Number(data.refund_amount||0),
    refunds:Array.isArray(data.refunds)?data.refunds:[],
    status_history:Array.isArray(data.status_history)&&data.status_history.length?data.status_history:[{status,at:createdAt,note}],
    fulfillment_type:'preorder',
    order_date:createdAt,
    created_at:createdAt,
    updated_at:createdAt,
  }
}

async function neonCreateManyWithRetry(rows){
  let lastErr
  for(let attempt=0;attempt<2;attempt++){
    try{return await neonOrderEditRuntime({action:'create_many',rows})}
    catch(err){lastErr=err;if(attempt===0) await new Promise(r=>setTimeout(r,350))}
  }
  throw lastErr
}

function firestorePayload(row,ts){
  const {id,order_date,created_at,updated_at,...rest}=row
  return {...rest,order_date:ts,created_at:ts,updated_at:ts}
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
    const row=normalizedNewRow(data,id,createdAt,'建立訂單')
    const primary=await neonOrderEditRuntime({action:'create',row})
    try{
      const ts=Timestamp.now()
      await setDoc(doc(db,'orders',id),firestorePayload(row,ts))
    }catch(err){
      console.error('[Firestore mirror] OrdersAPI.create failed after Neon success',err)
    }
    return {id,...data,...row,...(primary?.result||{})}
  }
}

function installPreorderBatchCreate(){
  const legacyBatchCreate=OrdersAPI.batchCreate
  if(typeof legacyBatchCreate!=='function') return
  OrdersAPI.batchCreate=async function(orderPayloads=[]){
    if(!Array.isArray(orderPayloads)||!orderPayloads.length) return []
    if(orderPayloads.some(row=>row?.fulfillment_type==='stock')) return legacyBatchCreate.apply(this,[orderPayloads])
    if(orderPayloads.length>250) throw new Error('單次最多匯入 250 筆訂單，請分批匯入')
    const createdAt=nowISO()
    const rows=orderPayloads.map(data=>normalizedNewRow(data,randomLegacyId(),createdAt,'批次建立訂單'))
    const primary=await neonCreateManyWithRetry(rows)
    try{
      for(let offset=0;offset<rows.length;offset+=400){
        const batch=writeBatch(db)
        const ts=Timestamp.now()
        rows.slice(offset,offset+400).forEach(row=>batch.set(doc(db,'orders',row.id),firestorePayload(row,ts)))
        await batch.commit()
      }
    }catch(err){
      console.error('[Firestore mirror] OrdersAPI.batchCreate failed after Neon success',err)
    }
    const byId=new Map((primary?.rows||[]).map(r=>[r.id,r]))
    return rows.map(row=>({id:row.id,...row,...(byId.get(row.id)||{})}))
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
  installPreorderBatchCreate()
  installPreorderStatus()
  installPreorderEdit()
}
