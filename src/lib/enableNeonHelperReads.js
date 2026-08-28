import { HelperAPI } from './helper'
import { neonHelperRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-helper-reads-installed')

function installNeonOnly(method,action,sorter=null){
  HelperAPI[method]=async function(){
    const result=await neonHelperRuntime(action)
    if(!Array.isArray(result?.rows)) throw new Error('Neon 回傳格式錯誤')
    const rows=[...result.rows]
    return sorter?rows.sort(sorter):rows
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  installNeonOnly('catalog','catalog',(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  installNeonOnly('customers','customers',(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  installNeonOnly('myEntries','my_entries',(a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
  installNeonOnly('myPendingOrders','my_pending_orders',(a,b)=>String(b.order_date||b.created_at||'').localeCompare(String(a.order_date||a.created_at||'')))
}
