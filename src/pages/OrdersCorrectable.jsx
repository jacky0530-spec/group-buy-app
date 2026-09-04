import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Search, WalletCards } from 'lucide-react'
import { OrdersAPI } from '../lib/db'
import { useToast } from '../components/UI'
import Orders from './OrdersFast'

const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`
const qty=value=>Math.max(0,Number(value||0))

function CorrectionPanel({ onChanged }) {
  const toast=useToast()
  const [orders,setOrders]=useState([])
  const [loading,setLoading]=useState(false)
  const [open,setOpen]=useState(false)
  const [busy,setBusy]=useState('')
  const [productSearch,setProductSearch]=useState('')
  const requestRef=useRef(0)

  const load=useCallback(async(searchTerm='')=>{
    const requestId=++requestRef.current
    const q=String(searchTerm||'').trim()
    setLoading(true)
    try{
      let rows=[]
      if(q&&typeof OrdersAPI.searchPage==='function'){
        // V48：有商品關鍵字時直接走 Neon SQL 搜尋全部訂單，再由下方候選規則篩出可更正品項；
        // 不再先受「最新 500 筆更正候選」上限截斷。
        let cursor=null
        let hasMore=true
        let page=0
        while(hasMore&&page<8){
          const result=await OrdersAPI.searchPage({search:q,includeArchived:false,pageSize:250,cursor})
          rows.push(...(Array.isArray(result?.rows)?result.rows:[]))
          cursor=result?.nextCursor||null
          hasMore=result?.hasMore===true&&Boolean(cursor)
          page+=1
        }
      }else{
        rows=typeof OrdersAPI.listCorrectionCandidates==='function'
          ? await OrdersAPI.listCorrectionCandidates({pageSize:500})
          : await OrdersAPI.list()
      }
      if(requestId===requestRef.current)setOrders(rows)
    }
    catch(err){if(requestId===requestRef.current)toast('更正資料載入失敗：'+err.message,'error')}
    finally{if(requestId===requestRef.current)setLoading(false)}
  },[toast])

  const candidates=useMemo(()=>orders.filter(order=>
    order.fulfillment_type!=='stock' && order.status!=='cancelled' && order.archived!==true &&
    (order.items||[]).some(item=>qty(item.arrived_qty)>0 || qty(item.supplier_paid_amount)>0)
  ),[orders])

  const visibleCandidates=useMemo(()=>{
    const q=productSearch.trim().toLowerCase()
    if(!q)return candidates
    return candidates.filter(order=>(order.items||[]).some(item=>
      (qty(item.arrived_qty)>0 || qty(item.supplier_paid_amount)>0) &&
      String(item.product_name||item.name||'').toLowerCase().includes(q)
    ))
  },[candidates,productSearch])

  useEffect(()=>{
    if(!open)return undefined
    const timer=setTimeout(()=>load(productSearch.trim()),productSearch.trim()?300:0)
    return()=>clearTimeout(timer)
  },[load,open,productSearch])

  function toggleOpen(){
    setOpen(value=>!value)
  }

  async function correctItem(order,itemIndex,resetArrival){
    const item=(order.items||[])[itemIndex]
    if(!item)return
    const label=item.product_name||item.name||'商品'
    const message=resetArrival
      ? `確定將「${label}」改為未到貨？\n\n若此品項已有供應商付款，系統會同步撤銷該品項的付款分攤並保留更正紀錄。`
      : `確定將「${label}」的供應商付款改為未付款？\n\n只會撤銷這個品項的付款分攤；同一筆匯款若還包含其他商品，其他分攤會保留。`
    if(!window.confirm(message))return
    const key=`${order.id}:${itemIndex}:${resetArrival?'arrival':'payment'}`
    setBusy(key)
    try{
      const result=await OrdersAPI.correctSupplierState(order.id,{item_index:itemIndex,reset_arrival:resetArrival})
      toast(resetArrival
        ? `↩️ 已改為未到貨，並撤銷相關供應商付款 ${money(result?.removed_payment||0)}`
        : `↩️ 已改為供應商未付款，撤銷 ${money(result?.removed_payment||0)}`,'warning')
      await load(productSearch.trim()); onChanged()
    }catch(err){toast('更正失敗：'+err.message,'error')}
    finally{setBusy('')}
  }

  async function correctOrderPayment(order){
    if(!window.confirm(`確定將「${order.customer_name||'此客戶'}」這張訂單的供應商付款全部改為未付款？\n\n系統會撤銷此訂單所有品項的付款分攤，但不會改動到貨狀態。`))return
    const key=`${order.id}:all-payment`
    setBusy(key)
    try{
      const result=await OrdersAPI.correctSupplierState(order.id,{reset_arrival:false})
      toast(`↩️ 整張訂單已改為供應商未付款，撤銷 ${money(result?.removed_payment||0)}`,'warning')
      await load(productSearch.trim()); onChanged()
    }catch(err){toast('更正失敗：'+err.message,'error')}
    finally{setBusy('')}
  }

  return <div className="card" style={{marginBottom:14,border:'1px solid #fed7aa'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',padding:'11px 14px'}}>
      <div><strong style={{display:'flex',alignItems:'center',gap:7}}><RotateCcw size={15}/>到貨／供應商付款更正</strong><div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>只提供預購訂單更正；輸入商品名稱時直接查 Neon 全部符合訂單，不受最近 500 筆限制。</div></div>
      <button className="btn btn-sm btn-ghost" disabled={loading&&!open} onClick={toggleOpen}>{loading&&!open?'載入中...':open?'收合':'開啟更正'} {!loading&&candidates.length>0&&`(${candidates.length})`}</button>
    </div>
    {open&&<div style={{borderTop:'1px solid var(--border)',padding:'10px 14px 14px'}}>
      <div className="search-input-wrap" style={{marginBottom:12,height:48,padding:'0 14px',display:'flex',alignItems:'center',gap:10,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)'}}><Search size={20}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="搜尋商品名稱..." style={{flex:1,minWidth:0,height:'100%',border:0,outline:'none',background:'transparent',fontSize:16,padding:'0 4px'}}/><span style={{fontSize:12,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{loading?'Neon 搜尋中...':`${visibleCandidates.length} 筆`}</span></div>
      {loading&&<div style={{padding:12,color:'var(--text-muted)'}}>載入中...</div>}
      {!loading&&candidates.length===0&&<div style={{padding:12,color:'var(--text-muted)'}}>{productSearch.trim()?'查無符合此商品名稱的可更正訂單。':'目前沒有需要更正的預購訂單。'}</div>}
      {!loading&&candidates.length>0&&visibleCandidates.length===0&&<div style={{padding:12,color:'var(--text-muted)'}}>查無符合此商品名稱的更正訂單。</div>}
      {!loading&&visibleCandidates.map(order=>{
        const paid=(order.items||[]).reduce((sum,item)=>sum+qty(item.supplier_paid_amount),0)
        return <div key={order.id} style={{border:'1px solid var(--border)',borderRadius:9,padding:10,marginTop:8,background:'var(--surface-2)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <div><strong>{order.customer_name||'未命名客戶'}</strong>{paid>0&&<span className="badge badge-emerald" style={{marginLeft:7}}>供應商已付 {money(paid)}</span>}</div>
            {paid>0&&<button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={()=>correctOrderPayment(order)}><WalletCards size={12}/>{busy===`${order.id}:all-payment`?'處理中...':'整單改未付款'}</button>}
          </div>
          <div style={{marginTop:7}}>{(order.items||[]).map((item,index)=>{
            const arrived=qty(item.arrived_qty),ordered=qty(item.qty),itemPaid=qty(item.supplier_paid_amount)
            if(arrived<=0&&itemPaid<=0)return null
            return <div key={index} style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',padding:'6px 0',borderTop:index?'1px dashed var(--border)':'none',fontSize:12}}>
              <span style={{flex:'1 1 260px'}}>{item.product_name||item.name} ×{ordered}</span>
              <span className={`badge ${arrived>0?'badge-emerald':'badge-rose'}`}>{arrived>0?`已到貨 ${arrived}/${ordered}`:'未到貨'}</span>
              {itemPaid>0&&<span className="badge badge-emerald">已付 {money(itemPaid)}</span>}
              {itemPaid>0&&<button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={()=>correctItem(order,index,false)}>{busy===`${order.id}:${index}:payment`?'處理中...':'改未付款'}</button>}
              {arrived>0&&<button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={()=>correctItem(order,index,true)}>{busy===`${order.id}:${index}:arrival`?'處理中...':'改未到貨'}</button>}
            </div>
          })}</div>
        </div>
      })}
    </div>}
  </div>
}

export default function OrdersCorrectable(){
  const [refreshKey,setRefreshKey]=useState(0)
  return <>
    <CorrectionPanel onChanged={()=>setRefreshKey(v=>v+1)}/>
    <Orders key={refreshKey}/>
  </>
}
