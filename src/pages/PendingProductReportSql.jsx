import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Boxes, Download, Layers3, PackageCheck, PackageSearch, PackageX, Printer, Search, Truck, Undo2, UserSearch } from 'lucide-react'
import { CustomersAPI, OrdersAPI, ProductsAPI } from '../lib/db'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'
import { useToast } from '../components/UI'

const PAGE_SIZE=250
const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`
const dateText=value=>value?new Date(value).toLocaleDateString('zh-TW'):'—'
const timeValue=value=>{const t=Date.parse(value||'');return Number.isFinite(t)?t:0}
const SPEC_STYLE={color:'#2563eb',fontWeight:900}
const COMBO_STYLE={color:'#1d4ed8',fontWeight:900}

function itemQty(item){return Math.max(0,Number(item?.qty||0))}
function arrivedQty(item){return Math.min(itemQty(item),Math.max(0,Number(item?.arrived_qty||0)))}
function missingQty(item){return Math.max(0,itemQty(item)-arrivedQty(item))}
function arrivalStatus(item){
  const qty=itemQty(item),arrived=arrivedQty(item)
  if(!arrived)return{key:'missing',label:'❌ 未到貨',color:'#dc2626'}
  if(arrived>=qty)return{key:'arrived',label:`✅ 已到貨 ${arrived}/${qty}`,color:'#059669'}
  return{key:'partial',label:`🟡 部分到貨 ${arrived}/${qty}`,color:'#b45309'}
}
function displayQty(item,view){if(view==='arrived')return arrivedQty(item);if(view==='missing')return missingQty(item);return itemQty(item)}
function specText(item){const s=item?.spec||{};return[s.package&&`組合：${s.package}`,s.flavor&&`口味：${s.flavor}`,s.color&&`顏色：${s.color}`,s.size&&`尺寸：${s.size}`].filter(Boolean).join('／')||'一般規格'}
function matchesProduct(item,product){return Boolean(item&&product&&((item.product_id||item.id)===product.id||(item.original_product_name||item.product_name||item.name)===product.name))}
function escapeCsv(value){return `"${String(value??'').replaceAll('"','""')}"`}
function downloadCsv(rows,filename){
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(escapeCsv).join(',')).join('\n')],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)
}
async function fetchAllOrders(params){
  const rows=[];let cursor=null;let guard=0
  do{
    const page=await OrdersAPI.searchPage({...params,pageSize:PAGE_SIZE,cursor})
    rows.push(...(page.rows||[]))
    cursor=page.hasMore?page.nextCursor:null
    guard++
  }while(cursor&&guard<100)
  return rows
}
function buildRows(orderRows,customerMap,product,arrivalView,shippedView){
  const groups=new Map()
  orderRows.forEach(order=>{
    const items=(order.items||[]).filter(item=>{
      if(product&&!matchesProduct(item,product))return false
      return shippedView?itemQty(item)>0:displayQty(item,arrivalView)>0
    })
    if(!items.length)return
    const customer=customerMap[order.customer_id]||{}
    const phone=String(order.customer_phone||customer.phone||'').trim()
    const last2=String(order.customer_phone_last2||getCustomerPhoneLast2(customer)||'').trim()
    const base=order.customer_id||`${order.customer_name||customer.name||''}|${phone||last2||''}`
    const key=`${base}|${order.archived===true?'archived':'active'}`
    const created=order.created_at||order.order_date||''
    if(!groups.has(key))groups.set(key,{key,customer_id:order.customer_id||'',name:order.customer_name||customer.name||'未命名客戶',phone,phone_last2:last2,line_nick:customer.line_nick||'',fb_name:customer.fb_name||'',latest_created_at:created,items:new Map(),total_qty:0,total_amount:0,total_ordered_qty:0,total_arrived_qty:0,total_missing_qty:0,order_ids:new Set(),real_order_ids:new Set(),virtual_order_ids:new Set(),has_virtual:false,all_virtual:true,archived:true})
    const group=groups.get(key)
    if(timeValue(created)>timeValue(group.latest_created_at))group.latest_created_at=created
    group.order_ids.add(order.id)
    if(order.is_virtual){group.virtual_order_ids.add(order.id);group.has_virtual=true}else{group.real_order_ids.add(order.id);group.all_virtual=false}
    if(order.archived!==true)group.archived=false
    items.forEach(item=>{
      const ordered=itemQty(item),arrived=arrivedQty(item),missing=missingQty(item),shown=shippedView?ordered:displayQty(item,arrivalView)
      const price=Number(item.sale_price??item.price??0),name=item.product_name||item.name||'未命名商品',note=String(item.note||'').trim(),spec=specText(item),status=arrivalStatus(item)
      const detailKey=[name,spec,price,note,status.key].join('|')
      if(!group.items.has(detailKey))group.items.set(detailKey,{product_name:name,spec,note,price,qty:0,ordered_qty:0,arrived_qty:0,missing_qty:0,amount:0,dates:new Set(),arrival_key:status.key,arrival_label:status.label,arrival_color:status.color,sources:[]})
      const detail=group.items.get(detailKey)
      detail.qty+=shown;detail.ordered_qty+=ordered;detail.arrived_qty+=arrived;detail.missing_qty+=missing;detail.amount+=price*shown;detail.dates.add(dateText(order.order_date));detail.sources.push({order_id:order.id,item_index:(order.items||[]).indexOf(item),qty:ordered,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual)})
      group.total_qty+=shown;group.total_amount+=price*shown;group.total_ordered_qty+=ordered;group.total_arrived_qty+=arrived;group.total_missing_qty+=missing
    })
  })
  return Array.from(groups.values()).map(group=>({...group,items:Array.from(group.items.values()).map(item=>({...item,dates:Array.from(item.dates)})),order_ids:Array.from(group.order_ids),real_order_ids:Array.from(group.real_order_ids),virtual_order_ids:Array.from(group.virtual_order_ids),order_count:group.order_ids.size,all_arrived:group.total_missing_qty===0})).sort((a,b)=>product?timeValue(b.latest_created_at)-timeValue(a.latest_created_at)||a.name.localeCompare(b.name,'zh-Hant'):a.name.localeCompare(b.name,'zh-Hant'))
}
function increment(map,key,qty){if(key)map.set(key,(map.get(key)||0)+qty)}
function mapRows(map){return Array.from(map.entries()).map(([label,qty])=>({label,qty})).sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant',{numeric:true}))}
function buildOrderingSummary(orderRows,product){
  if(!product)return{combos:[],packages:[],flavors:[],colors:[],sizes:[],totalQty:0,totalArrived:0,totalMissing:0,totalAmount:0,virtualQty:0}
  const combos=new Map(),packages=new Map(),flavors=new Map(),colors=new Map(),sizes=new Map();let totalQty=0,totalArrived=0,totalMissing=0,totalAmount=0,virtualQty=0
  orderRows.forEach(order=>(order.items||[]).filter(item=>matchesProduct(item,product)).forEach(item=>{
    const qty=itemQty(item);if(order.is_virtual){virtualQty+=qty;return}
    const s=item.spec||{},packageName=String(s.package||'').trim(),flavor=String(s.flavor||'').trim(),color=String(s.color||'').trim(),size=String(s.size||'').trim(),arrived=arrivedQty(item),missing=missingQty(item),price=Number(item.sale_price??item.price??0)
    const key=[packageName,flavor,color,size].join('|'),label=[packageName&&`組合：${packageName}`,flavor&&`口味：${flavor}`,color&&`顏色：${color}`,size&&`尺寸：${size}`].filter(Boolean).join('／')||'一般規格'
    if(!combos.has(key))combos.set(key,{label,packageName,flavor,color,size,qty:0,arrived:0,missing:0,amount:0})
    const row=combos.get(key);row.qty+=qty;row.arrived+=arrived;row.missing+=missing;row.amount+=price*qty
    increment(packages,packageName,qty);increment(flavors,flavor,qty);increment(colors,color,qty);increment(sizes,size,qty)
    totalQty+=qty;totalArrived+=arrived;totalMissing+=missing;totalAmount+=price*qty
  }))
  return{combos:Array.from(combos.values()).sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant',{numeric:true})),packages:mapRows(packages),flavors:mapRows(flavors),colors:mapRows(colors),sizes:mapRows(sizes),totalQty,totalArrived,totalMissing,totalAmount,virtualQty}
}
function matchesBuyer(row,search){const q=String(search||'').trim().toLowerCase();if(!q)return true;return[row.name,row.phone,row.phone_last2,row.line_nick,row.fb_name].some(v=>String(v||'').toLowerCase().includes(q))}
function DimensionSummary({title,rows}){if(!rows.length)return null;const combo=title==='組合小計';return <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}><div style={{background:combo?'#eff6ff':'var(--surface-2)',color:combo?'#1d4ed8':'inherit',padding:'9px 12px',fontSize:13,fontWeight:900}}>{title}</div><div style={{padding:'8px 12px'}}>{rows.map(row=><div key={row.label} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'5px 0',borderBottom:'1px dashed var(--border)'}}><span style={combo?COMBO_STYLE:SPEC_STYLE}>{row.label}</span><strong>{row.qty} 件</strong></div>)}</div></div>}

export default function PendingProductReportSql(){
  const toast=useToast()
  const [products,setProducts]=useState([]),[customers,setCustomers]=useState([]),[orders,setOrders]=useState([]),[catalogLoading,setCatalogLoading]=useState(true),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [mode,setMode]=useState('buyer'),[shipmentView,setShipmentView]=useState('shipped'),[arrivalView,setArrivalView]=useState('all'),[productSearch,setProductSearch]=useState(''),[selectedProduct,setSelectedProduct]=useState(null),[productBuyerSearch,setProductBuyerSearch]=useState(''),[buyerSearch,setBuyerSearch]=useState(''),[selectedBuyerKey,setSelectedBuyerKey]=useState(''),[showArchived,setShowArchived]=useState(false),[marking,setMarking]=useState(false),[shippingKey,setShippingKey]=useState(''),[archivingKey,setArchivingKey]=useState('')
  const [shipmentProductKeys,setShipmentProductKeys]=useState(null)
  const [shipmentCatalogLoading,setShipmentCatalogLoading]=useState(false)
  const querySeq=useRef(0)

  useEffect(()=>{let active=true;(async()=>{setCatalogLoading(true);setError('');try{const[p,c]=await Promise.all([ProductsAPI.list({includeArchived:true}),CustomersAPI.list({includeArchived:true})]);if(active){setProducts(p);setCustomers(c)}}catch(err){if(active)setError(`出貨報表目錄載入失敗：${err.message}`)}finally{if(active)setCatalogLoading(false)}})();return()=>{active=false}},[])

  useEffect(()=>{
    let active=true
    ;(async()=>{
      setShipmentCatalogLoading(true)
      try{
        const rows=await fetchAllOrders({status:shipmentView,includeArchived:shipmentView==='shipped'&&showArchived})
        const ids=new Set(),names=new Set()
        rows.forEach(order=>(order.items||[]).forEach(item=>{
          if(itemQty(item)<=0)return
          const id=item.product_id||item.id
          const name=item.original_product_name||item.product_name||item.name
          if(id)ids.add(id)
          if(name)names.add(name)
        }))
        if(active)setShipmentProductKeys({ids,names})
      }catch(err){
        const label=shipmentView==='shipped'?'已出貨':'待出貨'
        if(active){setShipmentProductKeys({ids:new Set(),names:new Set()});setError(`${label}商品目錄 SQL 查詢失敗：${err.message}`)}
      }finally{if(active)setShipmentCatalogLoading(false)}
    })()
    return()=>{active=false}
  },[shipmentView,showArchived])

  const queryOrders=useCallback(async()=>{
    const seq=++querySeq.current
    if(mode==='product'&&!selectedProduct){setOrders([]);setLoading(false);return}
    if(mode==='buyer'&&!buyerSearch.trim()){setOrders([]);setLoading(false);return}
    setLoading(true);setError('')
    try{
      const directProductId=mode==='product'&&selectedProduct&&shipmentProductKeys?.ids?.has(selectedProduct.id)
      const rows=await fetchAllOrders({
        status:shipmentView,
        productId:directProductId?(selectedProduct?.id||''):'',
        search:mode==='buyer'?buyerSearch.trim():(mode==='product'&&!directProductId?(selectedProduct?.name||''):''),
        includeArchived:shipmentView==='shipped'&&showArchived,
      })
      if(seq===querySeq.current)setOrders(rows)
    }catch(err){if(seq===querySeq.current)setError(`出貨報表 SQL 查詢失敗：${err.message}`)}finally{if(seq===querySeq.current)setLoading(false)}
  },[mode,selectedProduct,buyerSearch,shipmentView,showArchived,shipmentProductKeys])

  useEffect(()=>{const timer=setTimeout(queryOrders,mode==='buyer'?280:0);return()=>clearTimeout(timer)},[queryOrders,mode])

  const customerMap=useMemo(()=>Object.fromEntries(customers.map(c=>[c.id,c])),[customers])
  const productOptions=useMemo(()=>{
    const q=productSearch.trim().toLowerCase()
    return products
      .filter(p=>Boolean(shipmentProductKeys&&(shipmentProductKeys.ids.has(p.id)||shipmentProductKeys.names.has(p.name))))
      .filter(p=>!q||String(p.name||'').toLowerCase().includes(q))
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
      .slice(0,250)
  },[products,productSearch,shipmentProductKeys])
  const effectiveArrivalView=shipmentView==='shipped'?'all':arrivalView
  const sourceOrders=useMemo(()=>orders.filter(order=>order.status===shipmentView&&(shipmentView!=='shipped'||showArchived||order.archived!==true)),[orders,shipmentView,showArchived])
  const productRows=useMemo(()=>selectedProduct?buildRows(sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView==='shipped'):[],[sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView])
  const filteredProductRows=useMemo(()=>productRows.filter(row=>matchesBuyer(row,productBuyerSearch)),[productRows,productBuyerSearch])
  const buyerRows=useMemo(()=>buildRows(sourceOrders,customerMap,null,effectiveArrivalView,shipmentView==='shipped'),[sourceOrders,customerMap,effectiveArrivalView,shipmentView])
  const buyerCandidates=useMemo(()=>buyerRows.filter(row=>matchesBuyer(row,buyerSearch)),[buyerRows,buyerSearch])
  const currentRows=mode==='product'?filteredProductRows:(selectedBuyerKey?buyerCandidates.filter(row=>row.key===selectedBuyerKey):buyerCandidates)
  const selectedBuyer=useMemo(()=>buyerRows.find(row=>row.key===selectedBuyerKey)||null,[buyerRows,selectedBuyerKey])
  const orderingSummary=useMemo(()=>buildOrderingSummary(sourceOrders,selectedProduct),[sourceOrders,selectedProduct])
  const summary=useMemo(()=>({customers:currentRows.length,qty:currentRows.reduce((sum,row)=>sum+row.total_qty,0),amount:currentRows.reduce((sum,row)=>sum+row.total_amount,0)}),[currentRows])
  const canOutput=mode==='product'?Boolean(selectedProduct&&currentRows.length):Boolean(currentRows.length)
  const statusLabel=shipmentView==='shipped'?'已出貨':'待出貨'
  const viewLabel=shipmentView==='shipped'?'已出貨':arrivalView==='arrived'?'已到貨可取貨':arrivalView==='missing'?'尚未到貨':'全部待出貨'
  const reportLabel=mode==='product'?`${selectedProduct?.name||'未選商品'}｜${viewLabel}`:`${selectedBuyer?`買家：${selectedBuyer.name}${selectedBuyer.phone_last2?`（末碼 ${selectedBuyer.phone_last2}）`:''}`:buyerSearch.trim()?`買家搜尋：${buyerSearch.trim()}`:'尚未搜尋買家'}｜${viewLabel}`
  const supplierName=String(selectedProduct?.supplier||'').trim()||'未設定'

  async function refresh(){await queryOrders()}
  async function markSelectedProductArrived(){
    if(!selectedProduct||marking||shipmentView!=='pending')return
    setMarking(true)
    try{const changed=sourceOrders.filter(order=>!order.is_virtual&&(order.items||[]).some(item=>matchesProduct(item,selectedProduct)&&missingQty(item)>0)),now=new Date().toISOString();await Promise.all(changed.map(order=>OrdersAPI.updateArrival(order.id,(order.items||[]).map(item=>matchesProduct(item,selectedProduct)?{...item,arrived_qty:itemQty(item),arrived_at:now}:item))));toast(`「${selectedProduct.name}」已更新到貨 ✓`);await refresh()}catch(err){toast('批次到貨失敗：'+err.message,'error')}finally{setMarking(false)}
  }
  async function changeRowShipment(row,nextStatus){const ids=nextStatus==='shipped'?(row.real_order_ids||[]):(row.order_ids||[]);if(!ids.length||shippingKey)return;const key=`${row.key}-${nextStatus}`;setShippingKey(key);try{await OrdersAPI.batchUpdateStatus(ids,nextStatus);toast(nextStatus==='shipped'?`✅ ${row.name} 已出貨`:`↩️ ${row.name} 已恢復待出貨`);await refresh()}catch(err){toast('更新出貨狀態失敗：'+err.message,'error')}finally{setShippingKey('')}}
  async function changeRowArchive(row,next){if(!row.order_ids?.length||archivingKey)return;if(next&&!window.confirm(`確定要封存 ${row.name} 的 ${row.order_ids.length} 筆已出貨訂單？`))return;const key=`${row.key}-${next?'archive':'restore'}`;setArchivingKey(key);try{await Promise.all(row.order_ids.map(id=>next?OrdersAPI.archive(id):OrdersAPI.unarchive(id)));toast(next?'訂單已封存':'已解除封存');await refresh()}catch(err){toast(`${next?'封存':'解除封存'}失敗：${err.message}`,'error')}finally{setArchivingKey('')}}
  async function setVirtualState(row,isVirtual){const ids=isVirtual?(row.real_order_ids||[]):(row.virtual_order_ids||[]);if(!ids.length)return;try{await OrdersAPI.updateVirtual(ids,isVirtual);toast(isVirtual?'已改為虛擬訂單':'✅ 已轉為正式訂單');await refresh()}catch(err){toast('訂單類型更新失敗：'+err.message,'error')}}
  async function changeSourceQty(source,value){const qty=Number(value);if(!Number.isInteger(qty)||qty<1||qty===Number(source.qty))return;try{await OrdersAPI.updateItemQty(source.order_id,source.item_index,qty);toast(`訂購量已更新為 ${qty} ✓`);await refresh()}catch(err){toast('修改訂購量失敗：'+err.message,'error')}}
  function exportCurrent(){if(!canOutput)return;const rows=[['出貨狀態','客戶','手機','末兩碼','Line','FB','商品','規格','到貨狀態','訂購量','已到貨','未到貨','本檢視數量','單價','小計']];currentRows.forEach(c=>c.items.forEach(item=>rows.push([statusLabel,c.name,c.phone,c.phone_last2,c.line_nick,c.fb_name,item.product_name,item.spec,item.arrival_label,item.ordered_qty,item.arrived_qty,item.missing_qty,item.qty,item.price,item.amount])));downloadCsv(rows,`${statusLabel}-${mode==='product'?(selectedProduct?.name||'商品'):'買家'}-${viewLabel}.csv`)}
  function renderContact(c){return <>{c.phone?<div>{c.phone}</div>:c.phone_last2?<div>末碼 {c.phone_last2}</div>:<div>—</div>}{c.line_nick&&<div style={{color:'var(--text-muted)'}}>Line：{c.line_nick}</div>}{c.fb_name&&<div style={{color:'var(--text-muted)'}}>FB：{c.fb_name}</div>}</>}
  function renderDetails(c,showProduct){return c.items.map((item,index)=><div key={`${c.key}-${index}`} style={{padding:'7px 0',borderBottom:index<c.items.length-1?'1px dashed var(--border)':'none'}}>{showProduct&&<strong style={{color:'var(--indigo)'}}>{item.product_name}　</strong>}<span style={SPEC_STYLE}>{item.spec}</span> ×<strong>{item.qty}</strong>{shipmentView==='pending'?<>　<span style={{fontWeight:800,color:item.arrival_color}}>{item.arrival_label}</span></>:<span style={{fontWeight:800,color:'var(--emerald)'}}>　✅ 已出貨</span>}　{money(item.price)}／件{item.note&&<span style={{color:'var(--rose)',fontWeight:900}}>　備註：{item.note}</span>}<div style={{color:'var(--text-muted)',fontSize:11}}>訂購：{item.dates.join('、')}</div>{shipmentView==='pending'&&item.sources.map(source=><div key={`${source.order_id}-${source.item_index}`} style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginTop:5,padding:'5px 7px',borderRadius:7,background:source.is_virtual?'#fff1f2':'#f8fafc'}}><span className={`badge ${source.is_virtual?'badge-rose':'badge-gray'}`}>{source.is_virtual?'⚠ 虛擬':'正式'}</span><span style={{fontSize:11}}>訂購量</span><input type="number" min="1" defaultValue={source.qty} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>changeSourceQty(source,e.target.value)} style={{width:72,padding:'6px',fontWeight:900,textAlign:'center'}}/></div>)}</div>)}
  const modeCardStyle=active=>({flex:1,minWidth:220,borderRadius:14,padding:'14px 16px',cursor:'pointer',textAlign:'left',border:`2px solid ${active?'var(--indigo)':'var(--border)'}`,background:active?'var(--indigo-light)':'var(--surface)',fontFamily:'inherit'})

  return <div className="animate-fade">
    <div className="no-print" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:20}}><div><h2 style={{fontSize:22,fontWeight:800}}>出貨查詢報表</h2><p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>SQL 篩選版：只顯示目前狀態下實際有數量的商品或買家</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-ghost" disabled={!canOutput} onClick={exportCurrent}><Download size={14}/>匯出 CSV</button><button className="btn btn-primary" disabled={!canOutput} onClick={()=>window.print()}><Printer size={14}/>列印</button></div></div>
    {error&&<div className="no-print" style={{background:'var(--rose-light)',color:'var(--rose)',padding:12,borderRadius:8,marginBottom:14}}>{error}</div>}
    <div className="no-print" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginBottom:14}}><button type="button" onClick={()=>{setShipmentView('shipped');setSelectedBuyerKey('');setSelectedProduct(null);setProductSearch('');setProductBuyerSearch('');setOrders([])}} style={{borderRadius:12,padding:'12px 16px',border:`2px solid ${shipmentView==='shipped'?'#059669':'var(--border)'}`,background:shipmentView==='shipped'?'#ecfdf5':'var(--surface)',fontWeight:900,color:shipmentView==='shipped'?'#047857':'var(--text-secondary)'}}><PackageCheck size={16}/> 已出貨查詢</button><button type="button" onClick={()=>{setShipmentView('pending');setArrivalView('all');setShowArchived(false);setSelectedBuyerKey('');setSelectedProduct(null);setProductSearch('');setProductBuyerSearch('');setOrders([])}} style={{borderRadius:12,padding:'12px 16px',border:`2px solid ${shipmentView==='pending'?'#d97706':'var(--border)'}`,background:shipmentView==='pending'?'#fff7ed':'var(--surface)',fontWeight:900,color:shipmentView==='pending'?'#b45309':'var(--text-secondary)'}}><Truck size={16}/> 待出貨訂單</button></div>
    {shipmentView==='shipped'&&<div className="no-print" style={{display:'flex',justifyContent:'flex-end',gap:10,alignItems:'center',marginBottom:14}}><button className={`btn btn-sm ${showArchived?'btn-primary':'btn-ghost'}`} onClick={()=>{setShowArchived(v=>!v);setSelectedBuyerKey('');setSelectedProduct(null);setProductBuyerSearch('');setOrders([])}}>{showArchived?<><ArchiveRestore size={13}/>隱藏封存</>:<><Archive size={13}/>顯示封存</>}</button></div>}
    <div className="no-print" style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14}}><button type="button" style={modeCardStyle(mode==='buyer')} onClick={()=>{setMode('buyer');setSelectedProduct(null)}}><div style={{fontSize:16,fontWeight:900}}>👥 依買家查詢</div><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:4}}>輸入後才送 SQL 搜尋</div></button><button type="button" style={modeCardStyle(mode==='product')} onClick={()=>{setMode('product');setSelectedBuyerKey('')}}><div style={{fontSize:16,fontWeight:900}}>📦 依商品查詢</div><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:4}}>只顯示此狀態下有數量的商品</div></button></div>
    {shipmentView==='pending'&&<div className="no-print" style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:16}}><button className={`btn btn-sm ${arrivalView==='all'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('all')}><Layers3 size={13}/>全部待出貨</button><button className={`btn btn-sm ${arrivalView==='arrived'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('arrived')}><PackageCheck size={13}/>已到貨可取貨</button><button className={`btn btn-sm ${arrivalView==='missing'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('missing')}><PackageX size={13}/>尚未到貨</button></div>}

    {mode==='product'&&<div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}>挑選有{statusLabel}訂單的商品</div><div className="card-body"><div className="search-input-wrap" style={{marginBottom:10}}><Search size={14}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder={`搜尋${statusLabel}商品...`} style={{padding:'8px 8px 8px 32px',width:'100%'}}/></div><div style={{display:'flex',gap:7,flexWrap:'wrap',maxHeight:210,overflowY:'auto'}}>{(catalogLoading||shipmentCatalogLoading)&&<span>讀取{statusLabel}商品中...</span>}{!catalogLoading&&!shipmentCatalogLoading&&productOptions.length===0&&<span style={{color:'var(--text-muted)'}}>目前沒有符合的{statusLabel}商品</span>}{!catalogLoading&&!shipmentCatalogLoading&&productOptions.map(product=><button key={product.id} className={`btn btn-sm ${selectedProduct?.id===product.id?'btn-primary':'btn-ghost'}`} onClick={()=>setSelectedProduct(product)}>{product.name}{product.active===false?'（已封存）':''}</button>)}</div>{selectedProduct&&<div style={{marginTop:10,fontSize:12,color:'var(--text-muted)'}}>目前只從 Neon SQL 查詢「{selectedProduct.name}」的{statusLabel}訂單。</div>}{shipmentView==='pending'&&selectedProduct&&orderingSummary.totalMissing>0&&<button className="btn btn-ghost btn-sm" style={{marginTop:10}} disabled={marking} onClick={markSelectedProductArrived}><PackageCheck size={13}/>{marking?'更新中...':`此商品全部到貨（尚欠 ${orderingSummary.totalMissing} 件）`}</button>}</div></div>}
    {mode==='buyer'&&<div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}><UserSearch size={16}/>搜尋{statusLabel}買家</div><div className="card-body"><div className="search-input-wrap"><Search size={14}/><input autoFocus value={buyerSearch} onChange={e=>{setBuyerSearch(e.target.value);setSelectedBuyerKey('')}} placeholder="姓名／手機／末兩碼／Line／FB" style={{padding:'10px 10px 10px 34px',width:'100%'}}/></div>{!buyerSearch.trim()&&<div style={{marginTop:10,fontSize:12,color:'var(--text-muted)'}}>請輸入搜尋文字；空白時不下載任何訂單資料。</div>}{buyerSearch.trim()&&!loading&&<div style={{marginTop:12,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:8}}>{buyerCandidates.slice(0,30).map(c=><button type="button" key={c.key} onClick={()=>setSelectedBuyerKey(c.key)} style={{textAlign:'left',padding:'11px 12px',borderRadius:10,border:`2px solid ${selectedBuyerKey===c.key?'#7c3aed':'var(--border)'}`,background:selectedBuyerKey===c.key?'#f5f3ff':'var(--surface-2)'}}><strong>{c.name}</strong>{c.phone_last2&&<span className="badge badge-violet" style={{marginLeft:6}}>末碼 {c.phone_last2}</span>}<div style={{fontSize:11,color:'var(--text-secondary)',marginTop:4}}>{[c.phone,c.line_nick&&`Line ${c.line_nick}`,c.fb_name&&`FB ${c.fb_name}`].filter(Boolean).join(' ・ ')||'無其他辨識資料'}</div></button>)}</div>}</div></div>}

    {(mode==='product'?selectedProduct:buyerSearch.trim())&&<>
      <div className="no-print" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:16}}><div style={{background:'var(--indigo-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'var(--indigo)'}}>{viewLabel}客戶</div><strong style={{fontSize:22,color:'var(--indigo)'}}>{summary.customers} 位</strong></div><div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'#b45309'}}>本檢視數量</div><strong style={{fontSize:22,color:'#b45309'}}>{summary.qty} 件</strong></div><div style={{background:'var(--emerald-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'var(--emerald)'}}>本檢視金額</div><strong style={{fontSize:22,color:'var(--emerald)'}}>{money(summary.amount)}</strong></div></div>
      {mode==='product'&&<div className="search-input-wrap no-print" style={{maxWidth:500,marginBottom:14}}><Search size={14}/><input value={productBuyerSearch} onChange={e=>setProductBuyerSearch(e.target.value)} placeholder="在此商品結果中搜尋買家..." style={{padding:'8px 8px 8px 32px',width:'100%'}}/></div>}
      <div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><PackageSearch size={15}/> {reportLabel}</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>{loading?'SQL 查詢中...':`共 ${summary.customers} 位／${summary.qty} 件`}</span></div><div className="table-container"><table><thead><tr><th>客戶</th><th>手機辨識</th><th>訂購／到貨明細</th><th>訂單數</th><th>數量</th><th>小計</th><th>出貨操作</th></tr></thead><tbody>{loading&&<tr><td colSpan={7} style={{textAlign:'center',padding:32}}>Neon SQL 查詢中...</td></tr>}{!loading&&currentRows.length===0&&<tr><td colSpan={7} style={{textAlign:'center',padding:32,color:'var(--text-muted)'}}>目前沒有符合資料</td></tr>}{!loading&&currentRows.map(c=>{const actionKey=`${c.key}-${shipmentView==='pending'?'shipped':'pending'}`,mixed=c.has_virtual&&!c.all_virtual;return <tr key={c.key} style={{opacity:c.archived?.62:1,background:c.archived?'#f8fafc':c.all_virtual?'#fff1f2':mixed?'#fffbeb':undefined}}><td style={{fontWeight:800,minWidth:120}}>{c.name}{c.all_virtual&&<span className="badge badge-rose" style={{marginLeft:6}}>⚠ 全部虛擬</span>}{mixed&&<span className="badge badge-amber" style={{marginLeft:6}}>正式＋虛擬</span>}{c.archived&&<span className="badge badge-gray" style={{marginLeft:6}}>已封存</span>}<div style={{fontSize:11,marginTop:4,color:shipmentView==='shipped'?'var(--emerald)':c.all_arrived?'var(--emerald)':'#b45309'}}>{shipmentView==='shipped'?'✅ 已出貨':c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td><td style={{minWidth:140,fontSize:12}}>{renderContact(c)}</td><td style={{minWidth:340,fontSize:12}}>{renderDetails(c,mode==='buyer')}</td><td>{c.order_count}</td><td style={{fontWeight:800}}>{c.total_qty}</td><td style={{fontWeight:900,color:'var(--indigo)'}}>{money(c.total_amount)}</td><td style={{minWidth:130}}>{shipmentView==='pending'?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{c.has_virtual&&<button className="btn btn-sm" style={{background:'#e11d48',color:'white'}} onClick={()=>setVirtualState(c,false)}>✓ 轉正式</button>}<button className="btn btn-sm btn-primary" disabled={Boolean(shippingKey)||!c.real_order_ids.length} onClick={()=>changeRowShipment(c,'shipped')}><Truck size={13}/>{shippingKey===actionKey?'更新中...':'標記已出貨'}</button></div>:<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{!c.archived&&<button className="btn btn-sm btn-ghost" disabled={Boolean(shippingKey)} onClick={()=>changeRowShipment(c,'pending')}><Undo2 size={13}/>恢復待出貨</button>}{c.archived?<button className="btn btn-sm btn-ghost" disabled={Boolean(archivingKey)} onClick={()=>changeRowArchive(c,false)}><ArchiveRestore size={13}/>解除封存</button>:<button className="btn btn-sm btn-ghost" disabled={Boolean(archivingKey)} onClick={()=>changeRowArchive(c,true)}><Archive size={13}/>封存訂單</button>}</div>}</td></tr>})}</tbody></table></div></div>
      {mode==='product'&&shipmentView==='pending'&&orderingSummary.combos.length>0&&<div className="card no-print"><div className="card-header"><strong><Boxes size={16}/> 團購訂貨／到貨彙總</strong><div style={{fontSize:13,color:'#2563eb',fontWeight:900,marginTop:5}}>供應廠商：{supplierName}</div></div><div className="card-body"><div className="table-container" style={{marginBottom:16}}><table><thead><tr><th>規格組合</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(row=><tr key={row.label}><td><span style={row.packageName?COMBO_STYLE:SPEC_STYLE}>{row.label}</span></td><td><strong>{row.qty}</strong></td><td>{row.arrived}</td><td>{row.missing}</td></tr>)}</tbody></table></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}><DimensionSummary title="組合小計" rows={orderingSummary.packages}/><DimensionSummary title="口味小計" rows={orderingSummary.flavors}/><DimensionSummary title="顏色小計" rows={orderingSummary.colors}/><DimensionSummary title="尺寸小計" rows={orderingSummary.sizes}/></div></div></div>}
      <div className="print-only" style={{display:'none'}}><h2>{statusLabel}查詢報表</h2><div>{reportLabel}　列印日期：{new Date().toLocaleDateString('zh-TW')}</div><div>共 {summary.customers} 位／{summary.qty} 件／{money(summary.amount)}</div>{currentRows.map(c=><div key={`print-${c.key}`} style={{marginTop:10}}><strong>{c.name}</strong>　{c.phone||c.phone_last2}<div>{c.items.map((item,i)=><div key={i}>{mode==='buyer'&&<strong>{item.product_name}　</strong>}{item.spec} × {item.qty}</div>)}</div></div>)}</div>
    </>}
  </div>
}
