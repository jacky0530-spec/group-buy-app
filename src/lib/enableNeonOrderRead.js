import { OrdersAPI } from './db'
import { neonOrderQuery } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-order-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  OrdersAPI.list=async function(){
    const result=await neonOrderQuery('all')
    if(!Array.isArray(result?.rows)) throw new Error('Neon 訂單回傳格式錯誤')
    return result.rows
  }

  OrdersAPI.listByDateRange=async function(startISO,endISO){
    const result=await neonOrderQuery('date_range',{startISO,endISO})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 日期區間訂單回傳格式錯誤')
    return result.rows
  }

  OrdersAPI.listPage=async function({pageSize=100,cursor=null}={}){
    const neonCursor=cursor?.offset!=null?cursor:null
    if(cursor&&!neonCursor) throw new Error('目前 cursor 非 Neon 格式')
    const result=await neonOrderQuery('page',{pageSize,cursor:neonCursor})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 分頁訂單回傳格式錯誤')
    return {rows:result.rows,nextCursor:result.nextCursor||null,hasMore:result.hasMore===true}
  }
}
