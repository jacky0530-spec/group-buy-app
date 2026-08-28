import { OrdersAPI } from './db'
import { neonOrderQuery } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-order-read-installed')

function withOriginalQtyLabels(rows=[]){
  return rows.map(order=>({
    ...order,
    items:(order.items||[]).map(item=>{
      const current=Number(item.qty||0)
      const original=Number(item.original_qty??current)
      if(order.is_virtual===true && original>0 && original!==current){
        const base=String(item.product_name||item.name||'')
        const label=`${base}〔原訂 ${original} → 實際 ${current}〕`
        return {...item,original_qty:original,original_product_name:base,product_name:label,name:label}
      }
      return {...item,original_qty:original}
    }),
  }))
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  OrdersAPI.list=async function(){
    const result=await neonOrderQuery('all')
    if(!Array.isArray(result?.rows)) throw new Error('Neon 訂單回傳格式錯誤')
    return withOriginalQtyLabels(result.rows)
  }

  OrdersAPI.listByDateRange=async function(startISO,endISO){
    const result=await neonOrderQuery('date_range',{startISO,endISO})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 日期區間訂單回傳格式錯誤')
    return withOriginalQtyLabels(result.rows)
  }

  OrdersAPI.listPage=async function({pageSize=100,cursor=null}={}){
    const neonCursor=cursor?.offset!=null?cursor:null
    if(cursor&&!neonCursor) throw new Error('目前 cursor 非 Neon 格式')
    const result=await neonOrderQuery('page',{pageSize,cursor:neonCursor})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 分頁訂單回傳格式錯誤')
    return {rows:withOriginalQtyLabels(result.rows),nextCursor:result.nextCursor||null,hasMore:result.hasMore===true}
  }
}
