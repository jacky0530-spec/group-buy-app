import { OrdersAPI } from './db'
import { neonOrderEditRuntime, neonOrdersRuntime, neonStockOrderState } from './neonRuntime'
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
  return {...data,id,status,payment_status:data.payment_status||'unpaid',payable_status:data.payable_status||'unpaid',refund_amount:Number(data.refund_amount||0),refunds:Array.isArray(data.refunds)?data.refunds:[],status_history:Array.isArray(data.status_history)&&data.status_history.length?data.status_history:[{status,at:createdAt,note}],fulfillment_type:'preorder',order_date:createdAt,created_at:createdAt,updated_at:createdAt}
}

async function neonCreateManyWithRetry(rows){
  let lastErr
  for(let attempt=0;attempt<2;attempt++){
    try{return await neonOrderEditRuntime({action:'create_many',rows})}
    catch(err){lastErr=err;if(attempt===0)await new Promise(r=>setTimeout(r,350))}
  }
  throw lastErr
}

async function meta(id){return (await neonOrderStatusRuntime('meta',{id}))?.result||{}}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  OrdersAPI.create=async function(data={}){
    if(data.fulfillment_type==='stock') throw new Error('現貨訂單請由現貨開單功能建立')
    const id=randomLegacyId(),createdAt=nowISO(),row=normalizedNewRow(data,id,createdAt,'建立訂單')
    const primary=await neonOrderEditRuntime({action:'create',row})
    return {id,...row,...(primary?.result||{})}
  }

  OrdersAPI.batchCreate=async function(orderPayloads=[]){
    if(!Array.isArray(orderPayloads)||!orderPayloads.length)return[]
    if(orderPayloads.some(row=>row?.fulfillment_type==='stock'))throw new Error('批次新增不可混入現貨訂單')
    if(orderPayloads.length>250)throw new Error('單次最多匯入 250 筆訂單，請分批匯入')
    const createdAt=nowISO(),rows=orderPayloads.map(data=>normalizedNewRow(data,randomLegacyId(),createdAt,'批次建立訂單'))
    const primary=await neonCreateManyWithRetry(rows)
    const byId=new Map((primary?.rows||[]).map(r=>[r.id,r]))
    return rows.map(row=>({id:row.id,...row,...(byId.get(row.id)||{})}))
  }

  OrdersAPI.update=async function(id,data={}){
    const m=await meta(id)
    if(m.fulfillment_type==='stock')throw new Error('現貨訂單內容請使用現貨專用功能修改')
    return (await neonOrderEditRuntime({action:'edit',id,data}))?.result
  }

  OrdersAPI.updateStatus=async function(id,status,options={}){
    const m=await meta(id)
    if(m.fulfillment_type==='stock'){
      return (await neonStockOrderState({order_id:id,status,reason:options?.reason||''}))?.result
    }
    return (await neonOrderStatusRuntime('update',{id,status,reason:options?.reason||''}))?.result
  }

  OrdersAPI.updatePayment=async (id,payment_status)=> (await neonOrdersRuntime('update_payment',{id,payment_status}))?.result
  OrdersAPI.updatePayable=async (id,payable_status)=> (await neonOrdersRuntime('update_payable',{id,payable_status}))?.result
  OrdersAPI.archive=async id=> (await neonOrdersRuntime('archive',{id}))?.result
  OrdersAPI.unarchive=async id=> (await neonOrdersRuntime('unarchive',{id}))?.result
  OrdersAPI.applyRefund=async (id,{amount,note=''}={})=> (await neonOrdersRuntime('apply_refund',{id,amount,note}))?.result
  OrdersAPI.clearRefunds=async id=> (await neonOrdersRuntime('clear_refunds',{id}))?.result
  OrdersAPI.correctSupplierState=async (id,{item_index=null,reset_arrival=false}={})=> (await neonOrderStatusRuntime('correct_supplier_state',{id,item_index,reset_arrival}))?.result
  OrdersAPI.updateArrival=async function(id,items){
    return (await neonOrdersRuntime('update_arrival',{id,items}))?.result
  }

  OrdersAPI.setItemRelease=async function(id,item_index,released=true){
    return (await neonOrdersRuntime('set_item_release',{id,item_index,released:Boolean(released)}))?.result
  }

  OrdersAPI.updateItemQty=async function(id,item_index,qty){
    const m=await meta(id)
    if(m.fulfillment_type==='stock'){
      return (await neonStockOrderState({action:'resize_item',order_id:id,item_index,qty}))?.result
    }
    return (await neonOrdersRuntime('update_item_qty',{id,item_index,qty}))?.result
  }

  OrdersAPI.batchUpdateStatus=async function(ids=[],status){
    const target=[...new Set((ids||[]).filter(Boolean))]
    for(const id of target) await OrdersAPI.updateStatus(id,status,{reason:'批次更新'})
    return {updated:target.length}
  }

  OrdersAPI.updateVirtual=async function(ids=[],isVirtual=false){
    const target=[...new Set((ids||[]).filter(Boolean))]
    if(!target.length)return{updated:0}
    return (await neonOrdersRuntime('update_virtual',{ids:target,is_virtual:Boolean(isVirtual)}))?.result||{updated:0}
  }

  OrdersAPI.bulkHardDelete=async function(ids=[]){
    const target=[...new Set((ids||[]).filter(Boolean))]
    if(!target.length)return{deleted:0,adjusted_payments:0,voided_payments:0}
    const result=await neonOrdersRuntime('delete',{ids:target})
    return {deleted:Number(result?.deleted||0),adjusted_payments:0,voided_payments:0}
  }
}
