import { HelperAPI } from './helper'
import { neonHelperRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-helper-reads-installed')

function installNeonFirst(method,action,sorter=null){
  const firestoreMethod=HelperAPI[method]
  if(typeof firestoreMethod!=='function') return
  HelperAPI[method]=async function(...args){
    try{
      const result=await neonHelperRuntime(action)
      if(!Array.isArray(result?.rows)) throw new Error('Neon 回傳格式錯誤')
      const rows=[...result.rows]
      return sorter ? rows.sort(sorter) : rows
    }catch(err){
      console.error(`[Neon helper read fallback] ${method}`,err)
      return firestoreMethod.apply(this,args)
    }
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  installNeonFirst('catalog','catalog',(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  installNeonFirst('customers','customers',(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  installNeonFirst('myEntries','my_entries',(a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
  installNeonFirst('myPendingOrders','my_pending_orders',(a,b)=>String(b.order_date||b.created_at||'').localeCompare(String(a.order_date||a.created_at||'')))
}
