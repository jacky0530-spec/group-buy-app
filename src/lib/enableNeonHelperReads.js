import { HelperAPI } from './helper'
import { neonHelperRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-helper-reads-installed')

function rowsOf(result){
  if(!Array.isArray(result?.rows)) throw new Error('Neon 回傳格式錯誤')
  return [...result.rows]
}

function installNeonOnly(method,action,sorter=null,{filter=null}={}){
  HelperAPI[method]=async function(){
    let rows=rowsOf(await neonHelperRuntime(action))
    if(typeof filter==='function') rows=rows.filter(filter)
    return sorter?rows.sort(sorter):rows
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  installNeonOnly('catalog','catalog',(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'),{filter:row=>row.shipped_out!==true})
  installNeonOnly('customers','customers',(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))

  HelperAPI.searchCatalog=async function(q='',limit=30){
    let rows=rowsOf(await neonHelperRuntime('search_catalog',{q:String(q||''),limit}))
    rows=rows.filter(row=>row.shipped_out!==true)
    return rows.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  }

  HelperAPI.searchCustomers=async function(q='',limit=20){
    const rows=rowsOf(await neonHelperRuntime('search_customers',{q:String(q||''),limit}))
    return rows.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
  }

  HelperAPI.myEntries=async function(_uid,limit=20){
    const rows=rowsOf(await neonHelperRuntime('my_entries',{limit}))
    return rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
  }

  HelperAPI.checkPendingDuplicates=async function(rows=[]){
    const list=Array.isArray(rows)?rows:[]
    if(!list.length)return[]
    const output=[]
    for(let i=0;i<list.length;i+=100){
      output.push(...rowsOf(await neonHelperRuntime('duplicate_pending',{rows:list.slice(i,i+100)})))
    }
    return output
  }

  installNeonOnly('myPendingOrders','my_pending_orders',(a,b)=>String(b.order_date||b.created_at||'').localeCompare(String(a.order_date||a.created_at||'')))
}