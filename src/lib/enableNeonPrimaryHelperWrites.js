import { HelperAPI } from './helper'
import { neonHelperAdminRuntime, neonHelperRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-helper-writes-installed')

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

function directPayload(data={}){
  return {
    order_id:randomLegacyId(),
    entry_id:randomLegacyId(),
    customer_id:data.customer_id,
    items:Array.isArray(data.items)?data.items:[],
    note:String(data.note||''),
    is_virtual:data.is_virtual===true,
    created_by_name:String(data.created_by_name||''),
    created_at:new Date().toISOString(),
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  HelperAPI.createDirectEntry=async function(data={}){
    const payload=directPayload(data)
    const response=await neonHelperRuntime('create_direct',payload)
    return response?.result||{entry_id:payload.entry_id,order_id:payload.order_id}
  }

  HelperAPI.createDirectEntries=async function(entries=[]){
    const list=Array.isArray(entries)?entries:[]
    let created=0
    for(let i=0;i<list.length;i+=100){
      const rows=list.slice(i,i+100).map(directPayload)
      const response=await neonHelperRuntime('create_direct_many',{rows})
      created+=Array.isArray(response?.rows)?response.rows.length:rows.length
    }
    return created
  }

  HelperAPI.updateMyPendingOrder=async function(uid,orderId,data={}){
    const current=(await neonHelperRuntime('my_pending_orders'))?.rows||[]
    const order=current.find(row=>row.id===orderId)
    if(!order) throw new Error('找不到可修改的未出貨訂單')
    const payload={
      order_id:orderId,
      entry_id:order.helper_entry_id,
      customer_id:order.customer_id,
      items:Array.isArray(data.items)?data.items:order.items||[],
      note:String(data.note??order.note??''),
      is_virtual:data.is_virtual==null?order.is_virtual:data.is_virtual===true,
      created_by_name:String(order.created_by_name||''),
    }
    await neonHelperRuntime('update_pending',payload)
    return true
  }

  HelperAPI.updateEntry=async function(id,data={}){
    const rows=(await neonHelperAdminRuntime())?.rows||[]
    const current=rows.find(row=>row.id===id)
    if(!current) throw new Error('Neon 找不到小幫手紀錄')
    await neonHelperRuntime('sync',{row:{...current,...data,id,updated_at:new Date().toISOString()}})
    return true
  }

  HelperAPI.syncCatalog=async function(products=[]){
    return Array.isArray(products)?products.length:0
  }
}
