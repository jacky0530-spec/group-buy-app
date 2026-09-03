import { useMemo, useState } from 'react'
import { PackageCheck, RotateCcw, Search } from 'lucide-react'
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

  async function load(){
    setLoading(true)
    try{
      const [pending,shipped]=await Promise.all([fetchAllStatus('pending'),fetchAllStatus('shipped')])
      setOrders([...pending,...shipped])
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

  async function applyRelease(){
    const target=confirm
    if(!target||busy)return
    const key=`${target.order.id}:${target.itemIndex}`
    setConfirm(null)
    setBusy(key)
    try{
      await OrdersAPI.setItemRelease(target.order.id,target.itemIndex,target.nextReleased)
      toast(target.nextReleased?'商品已標記「已釋出」；取貨小計將不計此商品':'已取消釋出；商品恢復計入取貨小計')
      await load()
    }catch(err){toast('商品釋出狀態更新失敗：'+err.message,'error')}
    finally{setBusy('')}
  }

  return <>
    {confirm&&<ConfirmDialog
      danger={confirm.nextReleased}
      message={confirm.nextReleased
        ? `確定要釋出「${confirm.item.product_name||confirm.item.name||'商品'}」×${confirm.ordered}？\n\n此操作不會取消訂單，也不會改變銷售額與毛利；只會將此品項標記為「已釋出」，並從客戶取貨應收小計排除。`
        : `確定取消「${confirm.item.product_name||confirm.item.name||'商品'}」的已釋出狀態？\n\n取消後會恢復計入客戶取貨應收小計。`}
      onCancel={()=>setConfirm(null)}
      onConfirm={applyRelease}
    />}
    <div className="card" style={{marginBottom:14,border:'1px solid #c4b5fd'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',padding:'12px 14px'}}>
        <div>
          <strong style={{display:'flex',alignItems:'center',gap:7}}><PackageCheck size={16}/>已到貨商品釋出</strong>
          <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>久未取貨可針對單一商品標記已釋出；銷售額不變，只排除客戶取貨應收小計。</div>
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
          return <div key={key} style={{display:'grid',gridTemplateColumns:'minmax(150px,1fr) minmax(260px,2fr) auto auto',gap:10,alignItems:'center',padding:'10px 0',borderTop:'1px solid var(--border)'}}>
            <div><strong>{order.customer_name||'未命名客戶'}</strong>{order.customer_phone_last2&&<span className="badge badge-violet" style={{marginLeft:6}}>末碼 {order.customer_phone_last2}</span>}<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>{order.status==='shipped'?'已出貨訂單':'待出貨訂單'}</div></div>
            <div><strong>{item.product_name||item.name}</strong> ×{ordered}<div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>{specText(item)}　原銷售 {money(price*ordered)}</div></div>
            <div>{released>0?<span className="badge badge-violet">已釋出 {released}/{ordered}</span>:<span className="badge badge-emerald">已到貨 {qty(item.arrived_qty)}/{ordered}</span>}</div>
            <button className={`btn btn-sm ${released>0?'btn-ghost':'btn-primary'}`} disabled={Boolean(busy)} onClick={()=>setConfirm({order,item,itemIndex,ordered,nextReleased:released<=0})}>{busy===key?'處理中...':released>0?<><RotateCcw size={12}/>取消釋出</>:'標記已釋出'}</button>
          </div>
        })}
      </div>}
    </div>
  </>
}
