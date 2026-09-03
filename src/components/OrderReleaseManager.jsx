import { useMemo, useState } from 'react'
import { Minus, PackageCheck, Plus, Search } from 'lucide-react'
import { OrdersAPI } from '../lib/db'
import { ConfirmDialog, useToast } from './UI'

const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`
const qty=value=>Math.max(0,Number(value||0))

function specText(item){
  const s=item?.spec||{}
  return [s.package&&`組合：${s.package}`,s.flavor&&`口味：${s.flavor}`,s.color&&`顏色：${s.color}`,s.size&&`尺寸：${s.size}`].filter(Boolean).join('／')||'一般規格'
}

async function fetchAllStatus(status){
  const rows=[]
  let cursor=null
  let guard=0
  do{
    const page=await OrdersAPI.searchPage({status,includeArchived:false,pageSize:250,cursor})
    rows.push(...(page.rows||[]))
    cursor=page.hasMore?page.nextCursor:null
    guard+=1
  }while(cursor&&guard<100)
  return rows
}

export default function OrderReleaseManager(){
  const toast=useToast()
  const [open,setOpen]=useState(false)
  const [loading,setLoading]=useState(false)
  const [orders,setOrders]=useState([])
  const [search,setSearch]=useState('')
  const [busy,setBusy]=useState('')
  const [confirm,setConfirm]=useState(null)
  const [drafts,setDrafts]=useState({})

  async function load(){
    setLoading(true)
    try{
      const [pending,shipped]=await Promise.all([fetchAllStatus('pending'),fetchAllStatus('shipped')])
      setOrders([...pending,...shipped])
      setDrafts({})
    }catch(err){toast('已到貨商品載入失敗：'+err.message,'error')}
    finally{setLoading(false)}
  }

  async function toggle(){
    if(open){setOpen(false);return}
    setOpen(true)
    await load()
  }

  const rows=useMemo(()=>{
    const q=search.trim().toLowerCase()
    const result=[]
    orders.forEach(order=>(order.items||[]).forEach((item,itemIndex)=>{
      const ordered=qty(item.qty),arrived=qty(item.arrived_qty),released=Math.min(ordered,qty(item.released_qty))
      if(!(ordered>0&&arrived>=ordered))return
      const values=[order.customer_name,order.customer_phone_last2,order.customer_phone,item.product_name,item.name,specText(item)]
      if(q&&!values.some(value=>String(value||'').toLowerCase().includes(q)))return
      result.push({order,item,itemIndex,ordered,released})
    }))
    return result.sort((a,b)=>{
      if(Boolean(a.released)!==Boolean(b.released))return a.released?-1:1
      return String(a.order.customer_name||'').localeCompare(String(b.order.customer_name||''),'zh-Hant',{numeric:true})
    })
  },[orders,search])

  function draftText(key,released){
    if(Object.prototype.hasOwnProperty.call(drafts,key))return String(drafts[key]??'')
    return String(released>0?released:1)
  }

  function draftQty(key,released,ordered){
    const parsed=Math.trunc(Number(draftText(key,released)))
    if(!Number.isFinite(parsed)||parsed<1)return 1
    return Math.min(ordered,parsed)
  }

  function setDraftQty(key,value,ordered){
    const next=Math.min(ordered,Math.max(1,Math.trunc(Number(value)||1)))
    setDrafts(prev=>({...prev,[key]:String(next)}))
  }

  function changeDraftText(key,value){
    const digits=String(value||'').replace(/\D/g,'').replace(/^0+/,'')
    setDrafts(prev=>({...prev,[key]:digits}))
  }

  function requestApply(order,item,itemIndex,ordered,released){
    const key=`${order.id}:${itemIndex}`
    const next=ordered===1?1:draftQty(key,released,ordered)
    if(next===released){toast('釋出數量沒有變更','warning');return}
    setConfirm({order,item,itemIndex,ordered,released,nextReleasedQty:next})
  }

  function requestCancel(order,item,itemIndex,ordered,released){
    if(released<=0)return
    setConfirm({order,item,itemIndex,ordered,released,nextReleasedQty:0})
  }

  async function applyRelease(){
    const target=confirm
    if(!target||busy)return
    const key=`${target.order.id}:${target.itemIndex}`
    setConfirm(null)
    setBusy(key)
    try{
      await OrdersAPI.setItemRelease(target.order.id,target.itemIndex,target.nextReleasedQty)
      if(target.nextReleasedQty>0){
        toast(`商品已釋出 ${target.nextReleasedQty}/${target.ordered}；取貨小計排除 ${target.nextReleasedQty} 件`)
      }else{
        toast('已取消釋出；商品恢復計入取貨小計')
      }
      await load()
    }catch(err){toast('商品釋出狀態更新失敗：'+err.message,'error')}
    finally{setBusy('')}
  }

  return <>
    {confirm&&<ConfirmDialog
      danger={confirm.nextReleasedQty>0}
      message={confirm.nextReleasedQty>0
        ? `確定將「${confirm.item.product_name||confirm.item.name||'商品'}」釋出 ${confirm.nextReleasedQty}/${confirm.ordered} 件？\n\n本次將從客戶取貨應收排除 ${money(Number(confirm.item.sale_price??confirm.item.price??0)*confirm.nextReleasedQty)}。\n\n此操作不會取消訂單，也不會改變原始銷售額、毛利、成本或供應商付款。`
        : `確定取消「${confirm.item.product_name||confirm.item.name||'商品'}」的已釋出狀態？\n\n取消後全部 ${confirm.ordered} 件會恢復計入客戶取貨應收小計。`}
      onCancel={()=>setConfirm(null)}
      onConfirm={applyRelease}
    />}
    <div className="card" style={{marginBottom:14,border:'1px solid #c4b5fd'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',padding:'12px 14px'}}>
        <div>
          <strong style={{display:'flex',alignItems:'center',gap:7}}><PackageCheck size={16}/>已到貨商品釋出</strong>
          <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>可整項或部分釋出；數量預設從 1 開始，可用 −／＋ 或直接輸入。原銷售額不變，只排除取貨應收。</div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={toggle} disabled={loading&&!open}>{open?'收合':'開啟'}{open&&!loading?`（${rows.length}）`:''}</button>
      </div>
      {open&&<div style={{borderTop:'1px solid var(--border)',padding:'12px 14px 14px'}}>
        <div className="search-input-wrap" style={{height:48,padding:'0 14px',display:'flex',alignItems:'center',gap:10,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',marginBottom:12}}>
          <Search size={20}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋客戶、末碼或商品名稱..." style={{flex:1,minWidth:0,height:'100%',border:0,outline:'none',background:'transparent',fontSize:16,padding:'0 4px'}}/>
          <span style={{fontSize:12,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{rows.length} 項</span>
        </div>
        {loading&&<div style={{padding:14,color:'var(--text-muted)'}}>讀取已到貨商品中...</div>}
        {!loading&&rows.length===0&&<div style={{padding:14,color:'var(--text-muted)'}}>目前沒有符合的已到貨商品。</div>}
        {!loading&&rows.map(({order,item,itemIndex,ordered,released})=>{
          const key=`${order.id}:${itemIndex}`
          const price=Number(item.sale_price??item.price??0)
          const draft=draftQty(key,released,ordered)
          const draftRaw=draftText(key,released)
          const excluded=price*released
          return <div key={key} style={{display:'grid',gridTemplateColumns:'minmax(150px,1fr) minmax(260px,2fr) auto minmax(132px,auto)',gap:10,alignItems:'center',padding:'10px 0',borderTop:'1px solid var(--border)'}}>
            <div><strong>{order.customer_name||'未命名客戶'}</strong>{order.customer_phone_last2&&<span className="badge badge-violet" style={{marginLeft:6}}>末碼 {order.customer_phone_last2}</span>}<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>{order.status==='shipped'?'已出貨訂單':'待出貨訂單'}</div></div>
            <div><strong>{item.product_name||item.name}</strong> ×{ordered}<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>{specText(item)}　原銷售 {money(price*ordered)}{released>0&&<>　<span style={{color:'#dc2626',fontWeight:900}}>目前排除 {money(excluded)}</span></>}</div></div>
            <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap',justifyContent:'flex-end'}}>
              {released>0?<span className="badge badge-rose" style={{color:'#dc2626',fontWeight:900}}>已釋出 {released}/{ordered}</span>:<span className="badge badge-emerald">已到貨 {qty(item.arrived_qty)}/{ordered}</span>}
              {ordered>1&&<div style={{display:'flex',alignItems:'center',gap:5}}>
                <button type="button" aria-label="釋出數量減一" onClick={()=>setDraftQty(key,draft-1,ordered)} disabled={draft<=1} style={{width:44,height:48,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',display:'grid',placeItems:'center'}}><Minus size={18}/></button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`釋出數量，最多 ${ordered} 件`}
                  value={draftRaw}
                  placeholder={`1～${ordered}`}
                  onFocus={e=>e.currentTarget.select()}
                  onChange={e=>changeDraftText(key,e.target.value)}
                  onBlur={()=>{if(!draftRaw)setDraftQty(key,1,ordered);else setDraftQty(key,draft,ordered)}}
                  style={{width:82,height:48,fontSize:18,fontWeight:900,textAlign:'center',padding:'0 8px',border:'2px solid #6366f1',borderRadius:10,background:'var(--surface)'}}
                />
                <button type="button" aria-label="釋出數量加一" onClick={()=>setDraftQty(key,draft+1,ordered)} disabled={draft>=ordered} style={{width:44,height:48,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',display:'grid',placeItems:'center'}}><Plus size={18}/></button>
                <span style={{fontSize:13,fontWeight:900}}>件</span>
                {draft!==ordered&&<button type="button" className="btn btn-sm btn-ghost" onClick={()=>setDraftQty(key,ordered,ordered)}>全部</button>}
              </div>}
            </div>
            <div style={{display:'flex',gap:7,justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button className="btn btn-sm btn-primary" disabled={Boolean(busy)||(released>0&&draft===released)} onClick={()=>requestApply(order,item,itemIndex,ordered,released)}>{busy===key?'處理中...':ordered===1?'標記已釋出':`套用釋出 ${draft} 件`}</button>
              {released>0&&<button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={()=>requestCancel(order,item,itemIndex,ordered,released)}>取消釋出</button>}
            </div>
          </div>
        })}
      </div>}
    </div>
  </>
}
