import { OrdersAPI } from './db'
import { neonOrderQuery } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-order-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  const firestoreList=OrdersAPI.list
  OrdersAPI.list=async function(){
    try{
      const result=await neonOrderQuery('all')
      if(Array.isArray(result?.rows)) return result.rows
      throw new Error('Neon 訂單回傳格式錯誤')
    }catch(err){
      console.error('[Neon read fallback] orders',err)
      return firestoreList.apply(this,arguments)
    }
  }

  if(typeof OrdersAPI.listByDateRange==='function'){
    const firestoreRange=OrdersAPI.listByDateRange
    OrdersAPI.listByDateRange=async function(startISO,endISO){
      try{
        const result=await neonOrderQuery('date_range',{startISO,endISO})
        if(Array.isArray(result?.rows)) return result.rows
        throw new Error('Neon 日期區間訂單回傳格式錯誤')
      }catch(err){
        console.error('[Neon read fallback] order date range',err)
        return firestoreRange.apply(this,arguments)
      }
    }
  }

  if(typeof OrdersAPI.listPage==='function'){
    const firestorePage=OrdersAPI.listPage
    OrdersAPI.listPage=async function({pageSize=100,cursor=null}={}){
      try{
        const neonCursor=cursor?.offset!=null ? cursor : null
        if(cursor && !neonCursor) throw new Error('目前 cursor 非 Neon 格式')
        const result=await neonOrderQuery('page',{pageSize,cursor:neonCursor})
        if(!Array.isArray(result?.rows)) throw new Error('Neon 分頁訂單回傳格式錯誤')
        return {rows:result.rows,nextCursor:result.nextCursor||null,hasMore:result.hasMore===true}
      }catch(err){
        console.error('[Neon read fallback] order page',err)
        if(cursor?.offset!=null) return firestorePage.call(this,{pageSize,cursor:null})
        return firestorePage.apply(this,arguments)
      }
    }
  }
}
