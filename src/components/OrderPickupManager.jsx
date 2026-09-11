import { useMemo, useState } from 'react'
import { Minus, PackageCheck, Plus, Search } from 'lucide-react'
import { OrdersAPI } from '../lib/db'
import { ConfirmDialog, useToast } from './UI'

const qty=value=>Math.max(0,Math.trunc(Number(value)||0))
const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`

function specText(item){
  const s=item?.spec||{}
  return [s.package&&`組合：${s.package}`,s.flavor&&`口味：${s.flavor}`,s.color&&`顏色：${s.color}`,s.size&&`尺寸：${s.size}`].filter(Boolean).join('／')||'一般規格'
}

async function fetchMatchingPending(search){
  const rows=[]
  let cursor=null
  let guard=0
  do{
    const page=await OrdersAPI.searchPage({status:'pending',includeArchived:false,search,pageSize:250,cursor})
    rows.push(...(page.rows||[]))
    cursor=page.hasMore?page.nextCursor:null
    guard+=1
  }while(cursor&&guard<30)
  return rows
}

export default function OrderPickupManager({onChanged}){
  const toast=useToast()
  const [open,setOpen]=useState(true)
  const [search,setSearch]=useState('')
  const [orders,setOrders]=useState([])
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState('')
  const [confirm,setConfirm]=useState(null)
  const [drafts,setDrafts]=useState({})

  async function load(){
    const q=search.trim()
    if(!q){setOrders([]);toast('請先輸入客戶姓名、末碼或商品名稱','warning');return}
    setLoading(true)
    try{
      setOrders(await fetchMatchingPending(q))
      setDrafts({})
    }catch(err){toast('取貨資料載入失敗：'+err.message,'error')}
    finally{setLoading(false)}
  }

  const rows=useMemo(()=>{
    const result=[]
    orders.forEach(order=>{
      if(order.is_virtual||order.fulfillment_type==='stock'||order.archived===true)return
      ;(order.items||[]).forEach((item,itemIndex)=>{
        const ordered=qty(item.qty)
        const arrived=Math.min(ordered,qty(item.arrived_qty))
        const released=Math.min(ordered,qty(item.released_qty))
        const picked=Math.min(Math.max(0,ordered-released),qty(item.picked_up_qty))
        const maxPickup=Math.min(arrived,Math.max(0,ordered-released))
        if(!(ordered>0&&maxPickup>0))return
        result.push({order,item,itemIndex,ordered,arrived,released,picked,maxPickup})
      })
    })
    return result.sort((a,b)=>{
      if((a.picked>=a.maxPickup)!==(b.picked>=b.maxPickup))return a.picked>=a.maxPickup?1:-1
      return String(a.order.customer_name||'').localeCompare(String(b.order.customer_name||''),'zh-Hant',{numeric:true})
    })
  },[orders])

  function keyOf(order,itemIndex){return `${order.id}:${itemIndex}`}
  function draftValue(row){
    const key=keyOf(row.order,row.itemIndex)
    if(Object.prototype.hasOwnProperty.call(drafts,key))return String(drafts[key]??'')
    return String(row.picked>0?row.picked:Math.min(1,row.maxPickup))
  }
  function normalizedDraft(row){
    const value=Math.trunc(Number(draftValue(row)))
    if(!Number.isFinite(value))return row.picked
    return Math.max(0,Math.min(row.maxPickup,value))
  }
  function setDraft(row,value){
    const key=keyOf(row.order,row.itemIndex)
    const next=Math.max(0,Math.min(row.maxPickup,Math.trunc(Number(value)||0)))
    setDrafts(prev=>({...prev,[key]:String(next)}))
  }
  function changeDraft(row,value){
    const key=keyOf(row.order,row.itemIndex)
    const digits=String(value||'').replace(/\D/g,'')
    setDrafts(prev=>({...prev,[key]:digits}))
  }
  function request(row,next){
    if(next===row.picked){toast('已取貨數量沒有變更','warning');return}
    setConfirm({...row,nextPicked:next})
  }
  async function apply(){
    const row=confirm
    if(!row||busy)return
    const key=keyOf(row.order,row.itemIndex)
    setConfirm(null);setBusy(key)
    try{
      await OrdersAPI.setItemPickup(row.order.id,row.itemIndex,row.nextPicked)
      toast(row.nextPicked>0?`✅ 已取貨 ${row.nextPicked}/${row.ordered} 件`:'↩️ 已取消此品項取貨標記')
      await load()
      onChanged?.()
    }catch(err){toast('更新已取貨狀態失敗：'+err.message,'error')}
    finally{setBusy('')}
  }

  return <>
    {confirm&&<ConfirmDialog
      message={confirm.nextPicked>0
        ? `確定將「${confirm.item.product_name||confirm.item.name||'商品'}」標記已取貨 ${confirm.nextPicked}/${confirm.ordered} 件？\n\n只有已到貨商品可取貨；此操作不修改原始銷售額、成本、供應商付款或庫存資料。`
        : `確定取消「${confirm.item.product_name||confirm.item.name||'商品'}」的已取貨標記？\n\n取消後會重新出現在未出貨報表。`}
      onCancel={()=>setConfirm(null)}
      onConfirm={apply}
    />}
    <div className="card no-print" style={{marginBottom:16,border:'1px solid #86efac'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',padding:'12px 14px'}}>
        <div>
          <strong style={{display:'flex',alignItems:'center',gap:7}}><PackageCheck size={17}/>品項取貨管理</strong>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>同一張訂單可逐尺寸／規格標記已取貨；已取貨品項會從下方未出貨報表扣除，只留下尚未取貨或未到貨項目。</div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setOpen(v=>!v)}>{open?'收合':'開啟'}</button>
      </div>
      {open&&<div style={{borderTop:'1px solid var(--border)',padding:'12px 14px 14px'}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
          <div className="search-input-wrap" style={{flex:'1 1 340px',height:48,padding:'0 14px',display:'flex',alignItems:'center',gap:10,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)'}}>
            <Search size={20}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')load()}} placeholder="搜尋客戶姓名／手機末碼／商品名稱..." style={{flex:1,minWidth:0,height:'100%',border:0,outline:'none',background:'transparent',fontSize:16,padding:'0 4px'}}/>
          </div>
          <button type="button" className="btn btn-primary" style={{height:48,minWidth:92}} disabled={loading} onClick={load}>{loading?'查詢中...':'查詢'}</button>
        </div>
        {!loading&&search.trim()&&rows.length===0&&<div style={{padding:14,color:'var(--text-muted)'}}>沒有可標記取貨的已到貨品項。</div>}
        {!loading&&rows.map(row=>{
          const key=keyOf(row.order,row.itemIndex)
          const draft=normalizedDraft(row)
          const raw=draftValue(row)
          const done=row.picked>=row.maxPickup
          const price=Number(row.item.sale_price??row.item.price??0)
          return <div key={key} style={{display:'grid',gridTemplateColumns:'minmax(140px,1fr) minmax(280px,2fr) minmax(210px,auto) minmax(130px,auto)',gap:10,alignItems:'center',padding:'11px 0',borderTop:'1px solid var(--border)',opacity:done ? .72 : 1}}>
            <div><strong>{row.order.customer_name||'未命名客戶'}</strong>{row.order.customer_phone_last2&&<span className="badge badge-violet" style={{marginLeft:6}}>末碼 {row.order.customer_phone_last2}</span>}<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>待出貨正式訂單</div></div>
            <div><strong>{row.item.product_name||row.item.name}</strong> ×{row.ordered}<div style={{fontSize:12,color:'#2563eb',fontWeight:800,marginTop:3}}>{specText(row.item)}</div><div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>已到 {row.arrived}/{row.ordered}　已釋出 {row.released}　已取貨 {row.picked}　未取貨 {Math.max(0,row.ordered-row.released-row.picked)}　{money(price)}/件</div></div>
            <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button type="button" aria-label="取貨數量減一" onClick={()=>setDraft(row,draft-1)} disabled={draft<=0||Boolean(busy)} style={{width:44,height:48,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',display:'grid',placeItems:'center'}}><Minus size={18}/></button>
              <input type="text" inputMode="numeric" value={raw} onFocus={e=>e.currentTarget.select()} onChange={e=>changeDraft(row,e.target.value)} onBlur={()=>setDraft(row,draft)} aria-label={`已取貨數量，最多 ${row.maxPickup} 件`} style={{width:78,height:48,fontSize:18,fontWeight:900,textAlign:'center',padding:'0 8px',border:'2px solid #16a34a',borderRadius:10,background:'var(--surface)'}}/>
              <button type="button" aria-label="取貨數量加一" onClick={()=>setDraft(row,draft+1)} disabled={draft>=row.maxPickup||Boolean(busy)} style={{width:44,height:48,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',display:'grid',placeItems:'center'}}><Plus size={18}/></button>
              <span style={{fontSize:12,fontWeight:800}}>最多 {row.maxPickup}</span>
            </div>
            <div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button type="button" className="btn btn-sm btn-primary" disabled={Boolean(busy)||draft===row.picked} onClick={()=>request(row,draft)}>{busy===key?'處理中...':done?'修改取貨':'標記已取貨'}</button>
              {row.picked>0&&<button type="button" className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={()=>request(row,0)}>取消取貨</button>}
            </div>
          </div>
        })}
      </div>}
    </div>
  </>
}