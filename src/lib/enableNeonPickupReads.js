import { OrdersAPI } from './db'
import { neonOrdersRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-pickup-reads-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  const originalSearchPage=OrdersAPI.searchPage.bind(OrdersAPI)
  OrdersAPI.searchPage=async function(params={}){
    const page=await originalSearchPage(params)
    const rows=Array.isArray(page?.rows)?page.rows:[]
    const ids=[...new Set(rows.map(row=>String(row?.id||'').trim()).filter(Boolean))]
    if(!ids.length)return page
    const states=await neonOrdersRuntime('pickup_states',{ids})
    const map=new Map()
    ;(states?.rows||[]).forEach(state=>{
      map.set(`${state.id}:${Number(state.line_no)-1}`,state)
    })
    return {
      ...page,
      rows:rows.map(order=>({
        ...order,
        items:(order.items||[]).map((item,index)=>{
          const state=map.get(`${order.id}:${index}`)
          return state?{
            ...item,
            picked_up_qty:Number(state.picked_up_qty||0),
            picked_up_at:state.picked_up_at||null,
            picked_up_by_uid:state.picked_up_by_uid||'',
          }:item
        }),
      })),
    }
  }
}
