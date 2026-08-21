import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, PackageSearch, Printer, Search, Users, Package, DollarSign, UserSearch, Boxes, PackageCheck, PackageX, Layers3 } from 'lucide-react'
import { CustomersAPI, OrdersAPI, ProductsAPI } from '../lib/db'
import { useToast } from '../components/UI'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'

const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`
const dateText = value => value ? new Date(value).toLocaleDateString('zh-TW') : '—'
const SPEC_STYLE = { color:'#dc2626', fontWeight:900 }

function itemQty(item) { return Math.max(0, Number(item?.qty || 0)) }
function arrivedQty(item) { return Math.min(itemQty(item), Math.max(0, Number(item?.arrived_qty || 0))) }
function missingQty(item) { return Math.max(0, itemQty(item) - arrivedQty(item)) }
function arrivalStatus(item) {
  const qty = itemQty(item); const arrived = arrivedQty(item)
  if (!arrived) return { key:'missing', label:'❌ 未到貨', color:'#dc2626' }
  if (arrived >= qty) return { key:'arrived', label:`✅ 已到貨 ${arrived}/${qty}`, color:'#059669' }
  return { key:'partial', label:`🟡 部分到貨 ${arrived}/${qty}`, color:'#b45309' }
}
function displayQtyForMode(item, arrivalView) {
  if (arrivalView === 'arrived') return arrivedQty(item)
  if (arrivalView === 'missing') return missingQty(item)
  return itemQty(item)
}
function specText(item) {
  const spec = item?.spec || {}
  return [spec.flavor && `口味：${spec.flavor}`, spec.color && `顏色：${spec.color}`, spec.size && `尺寸：${spec.size}`].filter(Boolean).join('／') || '一般規格'
}
function escapeCsv(value) { return `"${String(value ?? '').replaceAll('"','""')}"` }
function downloadCsv(rows, filename) {
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(escapeCsv).join(',')).join('\n')], { type:'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download=filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
}
function matchesProduct(item, product) {
  if (!item || !product) return false
  return (item.product_id || item.id) === product.id || (item.product_name || item.name) === product.name
}

function buildPendingRows(pendingOrders, customerMap, selectedProduct = null, arrivalView = 'all') {
  const groups = new Map()
  pendingOrders.forEach(order => {
    const matches = (order.items || []).filter(item => {
      if (selectedProduct && !matchesProduct(item,selectedProduct)) return false
      return displayQtyForMode(item,arrivalView) > 0
    })
    if (!matches.length) return
    const customer = customerMap[order.customer_id] || {}
    const phone = String(order.customer_phone || customer.phone || '').trim()
    const last2 = String(order.customer_phone_last2 || getCustomerPhoneLast2(customer) || '').trim()
    const groupKey = order.customer_id || `${order.customer_name || customer.name || ''}|${phone || last2 || ''}`
    if (!groups.has(groupKey)) groups.set(groupKey,{ key:groupKey,customer_id:order.customer_id || '',name:order.customer_name || customer.name || '未命名客戶',phone,phone_last2:last2,line_nick:customer.line_nick || '',fb_name:customer.fb_name || '',items:new Map(),total_qty:0,total_amount:0,total_ordered_qty:0,total_arrived_qty:0,total_missing_qty:0,order_ids:new Set() })
    const group = groups.get(groupKey); group.order_ids.add(order.id)
    matches.forEach(item => {
      const ordered = itemQty(item); const arrived = arrivedQty(item); const missing = missingQty(item); const shown = displayQtyForMode(item,arrivalView); const price = Number(item.sale_price ?? item.price ?? 0); const productName = item.product_name || item.name || '未命名商品'; const note = String(item.note || '').trim(); const spec = specText(item); const status = arrivalStatus(item)
      const detailKey = [productName,spec,price,note,status.key].join('|')
      if (!group.items.has(detailKey)) group.items.set(detailKey,{ product_name:productName,spec,note,price,qty:0,ordered_qty:0,arrived_qty:0,missing_qty:0,amount:0,dates:new Set(),arrival_key:status.key,arrival_label:status.label,arrival_color:status.color })
      const detail=group.items.get(detailKey); detail.qty+=shown; detail.ordered_qty+=ordered; detail.arrived_qty+=arrived; detail.missing_qty+=missing; detail.amount+=price*shown; detail.dates.add(dateText(order.order_date)); group.total_qty+=shown; group.total_amount+=price*shown; group.total_ordered_qty+=ordered; group.total_arrived_qty+=arrived; group.total_missing_qty+=missing
    })
  })
  return Array.from(groups.values()).map(group => ({ ...group,items:Array.from(group.items.values()).map(item => ({ ...item,dates:Array.from(item.dates) })),order_count:group.order_ids.size,all_arrived:group.total_missing_qty===0 })).sort((a,b) => a.name.localeCompare(b.name,'zh-Hant'))
}
function increment(map,key,qty) { if (key) map.set(key,(map.get(key)||0)+qty) }
function mapToRows(map) { return Array.from(map.entries()).map(([label,qty]) => ({ label,qty })).sort((a,b) => a.label.localeCompare(b.label,'zh-Hant',{ numeric:true })) }
function buildOrderingSummary(pendingOrders, selectedProduct) {
  if (!selectedProduct) return { combos:[],colors:[],sizes:[],flavors:[],totalQty:0,totalArrived:0,totalMissing:0,totalAmount:0 }
  const combos=new Map(), colors=new Map(), sizes=new Map(), flavors=new Map(); let totalQty=0,totalArrived=0,totalMissing=0,totalAmount=0
  pendingOrders.forEach(order => (order.items || []).filter(item => matchesProduct(item,selectedProduct)).forEach(item => {
    const spec=item.spec || {}; const flavor=String(spec.flavor||'').trim(); const color=String(spec.color||'').trim(); const size=String(spec.size||'').trim(); const qty=itemQty(item); const arrived=arrivedQty(item); const missing=missingQty(item); const price=Number(item.sale_price ?? item.price ?? 0); const comboKey=[flavor,color,size].join('|'); const comboLabel=[flavor&&`口味：${flavor}`,color&&`顏色：${color}`,size&&`尺寸：${size}`].filter(Boolean).join('／') || '一般規格'
    if (!combos.has(comboKey)) combos.set(comboKey,{ label:comboLabel,flavor,color,size,qty:0,arrived:0,missing:0,amount:0 })
    const combo=combos.get(comboKey); combo.qty+=qty; combo.arrived+=arrived; combo.missing+=missing; combo.amount+=price*qty; increment(flavors,flavor,qty); increment(colors,color,qty); increment(sizes,size,qty); totalQty+=qty; totalArrived+=arrived; totalMissing+=missing; totalAmount+=price*qty
  }))
  return { combos:Array.from(combos.values()).sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant',{numeric:true})),colors:mapToRows(colors),sizes:mapToRows(sizes),flavors:mapToRows(flavors),totalQty,totalArrived,totalMissing,totalAmount }
}
function matchesBuyer(row,search) { const q=String(search||'').trim().toLowerCase(); if(!q)return true; return [row.name,row.phone,row.phone_last2,row.line_nick,row.fb_name].some(v=>String(v||'').toLowerCase().includes(q)) }
function DimensionSummary({ title,rows }) { if(!rows.length)return null; return <div style={{ border:'1px solid var(--border)',borderRadius:10,overflow:'hidden' }}><div style={{ background:'var(--surface-2)',padding:'9px 12px',fontSize:13,fontWeight:800 }}>{title}</div><div style={{ padding:'8px 12px' }}>{rows.map(row=><div key={row.label} style={{ display:'flex',justifyContent:'space-between',gap:12,padding:'5px 0',borderBottom:'1px dashed var(--border)' }}><span style={SPEC_STYLE}>{row.label}</span><strong>{row.qty} 件</strong></div>)}</div></div> }

export default function PendingProductReport() {
  const toast=useToast(); const [orders,setOrders]=useState([]); const [products,setProducts]=useState([]); const [customers,setCustomers]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [mode,setMode]=useState('product'); const [arrivalView,setArrivalView]=useState('all'); const [productSearch,setProductSearch]=useState(''); const [selectedProduct,setSelectedProduct]=useState(null); const [productBuyerSearch,setProductBuyerSearch]=useState(''); const [buyerSearch,setBuyerSearch]=useState(''); const [marking,setMarking]=useState(false)
  const load=useCallback(async()=>{ setLoading(true);setError('');try{const [orderRows,productRows,customerRows]=await Promise.all([OrdersAPI.list(),ProductsAPI.list({includeArchived:true}),CustomersAPI.list({includeArchived:true})]);setOrders(orderRows);setProducts(productRows);setCustomers(customerRows)}catch(err){setError(`未出貨報表載入失敗：${err.message}`)}finally{setLoading(false)}},[])
  useEffect(()=>{load()},[load])
  const pendingOrders=useMemo(()=>orders.filter(order=>order.status==='pending'&&order.archived!==true),[orders])
  const customerMap=useMemo(()=>Object.fromEntries(customers.map(c=>[c.id,c])),[customers])
  const productOptions=useMemo(()=>{const q=productSearch.trim().toLowerCase();const ids=new Set(),names=new Set();pendingOrders.forEach(order=>(order.items||[]).forEach(item=>{if(item.product_id||item.id)ids.add(item.product_id||item.id);if(item.product_name||item.name)names.add(item.product_name||item.name)}));return products.filter(p=>ids.has(p.id)||names.has(p.name)).filter(p=>!q||p.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'))},[products,pendingOrders,productSearch])
  const productRows=useMemo(()=>selectedProduct?buildPendingRows(pendingOrders,customerMap,selectedProduct,arrivalView):[],[selectedProduct,pendingOrders,customerMap,arrivalView])
  const filteredProductRows=useMemo(()=>productRows.filter(row=>matchesBuyer(row,productBuyerSearch)),[productRows,productBuyerSearch])
  const buyerRows=useMemo(()=>buildPendingRows(pendingOrders,customerMap,null,arrivalView),[pendingOrders,customerMap,arrivalView])
  const filteredBuyerRows=useMemo(()=>buyerRows.filter(row=>matchesBuyer(row,buyerSearch)),[buyerRows,buyerSearch])
  const orderingSummary=useMemo(()=>buildOrderingSummary(pendingOrders,selectedProduct),[pendingOrders,selectedProduct])
  const currentRows=mode==='product'?filteredProductRows:filteredBuyerRows
  const summary=useMemo(()=>({customers:currentRows.length,qty:currentRows.reduce((s,r)=>s+r.total_qty,0),amount:currentRows.reduce((s,r)=>s+r.total_amount,0)}),[currentRows])
  const canOutput=mode==='product'?Boolean(selectedProduct&&currentRows.length):Boolean(currentRows.length)
  const viewLabel=arrivalView==='arrived'?'已到貨可取貨':arrivalView==='missing'?'尚未到貨':'全部未出貨'
  const reportLabel=mode==='product'?`${selectedProduct?.name||'未選商品'}｜${viewLabel}`:`${buyerSearch.trim()?`買家：${buyerSearch.trim()}`:'全部買家'}｜${viewLabel}`

  async function markSelectedProductArrived() {
    if(!selectedProduct||marking)return; setMarking(true)
    try { const changed=pendingOrders.filter(order=>(order.items||[]).some(item=>matchesProduct(item,selectedProduct)&&missingQty(item)>0)); const now=new Date().toISOString(); await Promise.all(changed.map(order=>OrdersAPI.update(order.id,{items:(order.items||[]).map(item=>matchesProduct(item,selectedProduct)?{...item,arrived_qty:itemQty(item),arrived_at:now}:item)}))); toast(`「${selectedProduct.name}」已將 ${changed.length} 筆待出貨訂單標記為全部到貨 ✓`); await load() } catch(err){toast('批次到貨失敗：'+err.message,'error')} finally{setMarking(false)}
  }
  function exportCurrent(){if(!canOutput)return;const rows=[['客戶','手機','手機末兩碼','Line','FB','商品','規格/口味','到貨狀態','訂購量','已到貨','未到貨','本檢視數量','單價','本檢視小計']];currentRows.forEach(c=>c.items.forEach(item=>rows.push([c.name,c.phone,c.phone_last2,c.line_nick,c.fb_name,item.product_name,item.spec,item.arrival_label,item.ordered_qty,item.arrived_qty,item.missing_qty,item.qty,item.price,item.amount])));if(mode==='product'){rows.push([],['團購訂貨彙總'],['規格組合','訂購','已到','未到','金額']);orderingSummary.combos.forEach(r=>rows.push([r.label,r.qty,r.arrived,r.missing,r.amount]));rows.push([],['訂購總件數',orderingSummary.totalQty],['已到貨總件數',orderingSummary.totalArrived],['尚未到貨總件數',orderingSummary.totalMissing])}downloadCsv(rows,mode==='product'?`未出貨-${selectedProduct.name}-${viewLabel}.csv`:`未出貨-買家-${viewLabel}.csv`)}
  function renderContact(c){return <>{c.phone?<div>{c.phone}</div>:c.phone_last2?<div>末碼 {c.phone_last2}</div>:<div>—</div>}{c.phone&&c.phone_last2&&<div style={{color:'var(--text-muted)'}}>末碼 {c.phone_last2}</div>}{c.line_nick&&<div style={{color:'var(--text-muted)'}}>Line：{c.line_nick}</div>}{c.fb_name&&<div style={{color:'var(--text-muted)'}}>FB：{c.fb_name}</div>}</>}
  function renderDetails(c,showProduct){return c.items.map((item,index)=><div key={`${c.key}-${index}`} style={{padding:'6px 0',borderBottom:index<c.items.length-1?'1px dashed var(--border)':'none'}}>{showProduct&&<strong style={{color:'var(--indigo)'}}>{item.product_name}　</strong>}<span style={SPEC_STYLE}>{item.spec}</span> ×<strong>{item.qty}</strong>　<span style={{fontWeight:800,color:item.arrival_color}}>{item.arrival_label}</span>{arrivalView==='all'&&item.arrival_key==='partial'&&<span>（尚欠 {item.missing_qty}）</span>}　{money(item.price)}／件{item.note&&<span style={{color:'var(--text-secondary)'}}>　備註：{item.note}</span>}<div style={{color:'var(--text-muted)',fontSize:11}}>訂購：{item.dates.join('、')}</div></div>)}

  return <div className="animate-fade">
    <div className="no-print" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:20}}><div><h2 style={{fontSize:22,fontWeight:800}}>未出貨查詢報表</h2><p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>到貨與出貨分開管理，可直接查看可取貨或尚欠商品</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-ghost" disabled={!canOutput} onClick={exportCurrent}><Download size={14}/>匯出 CSV</button><button className="btn btn-primary" disabled={!canOutput} onClick={()=>window.print()}><Printer size={14}/>列印</button></div></div>
    {error&&<div className="no-print" style={{background:'var(--rose-light)',color:'var(--rose)',padding:12,borderRadius:8,marginBottom:14}}>{error}</div>}
    <div className="tabs no-print" style={{marginBottom:12}}><button className={`tab ${mode==='product'?'active':''}`} onClick={()=>setMode('product')}>📦 依商品查詢</button><button className={`tab ${mode==='buyer'?'active':''}`} onClick={()=>setMode('buyer')}>👥 依買家查詢</button></div>
    <div className="no-print" style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:16}}><button className={`btn btn-sm ${arrivalView==='all'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('all')}><Layers3 size={13}/>全部未出貨</button><button className={`btn btn-sm ${arrivalView==='arrived'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('arrived')}><PackageCheck size={13}/>已到貨可取貨</button><button className={`btn btn-sm ${arrivalView==='missing'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('missing')}><PackageX size={13}/>尚未到貨</button></div>

    {mode==='product'&&<div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}>挑選有未出貨訂單的商品</div><div className="card-body"><div className="search-input-wrap" style={{marginBottom:10}}><Search size={14}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="搜尋商品..." style={{padding:'8px 8px 8px 32px',width:'100%'}}/></div><div style={{display:'flex',gap:7,flexWrap:'wrap',maxHeight:210,overflowY:'auto'}}>{loading&&<span style={{color:'var(--text-muted)'}}>讀取中...</span>}{!loading&&productOptions.length===0&&<span style={{color:'var(--text-muted)'}}>目前沒有符合的未出貨商品</span>}{productOptions.map(product=><button key={product.id} className={`btn btn-sm ${selectedProduct?.id===product.id?'btn-primary':'btn-ghost'}`} onClick={()=>setSelectedProduct(product)}>{product.name}{product.active===false?'（已封存）':''}</button>)}</div>{selectedProduct&&orderingSummary.totalMissing>0&&<div style={{marginTop:12}}><button className="btn btn-ghost btn-sm" disabled={marking} onClick={markSelectedProductArrived}><PackageCheck size={13}/>{marking?'更新中...':`此商品全部到貨（尚欠 ${orderingSummary.totalMissing} 件）`}</button></div>}</div></div>}
    {mode==='buyer'&&<div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}><UserSearch size={16}/>搜尋未出貨買家</div><div className="card-body"><div className="search-input-wrap"><Search size={14}/><input autoFocus value={buyerSearch} onChange={e=>setBuyerSearch(e.target.value)} placeholder="姓名／完整手機／手機末兩碼／Line／FB，例如 12" style={{padding:'10px 10px 10px 34px',width:'100%'}}/></div></div></div>}

    {(mode==='buyer'||selectedProduct)&&<>
      <div className="print-only" style={{display:'none'}}><h2>未出貨查詢報表</h2><div>{reportLabel}　列印日期：{new Date().toLocaleDateString('zh-TW')}</div><div style={{margin:'8px 0 12px',fontWeight:700}}>共 {summary.customers} 位／本檢視 {summary.qty} 件／{money(summary.amount)}</div><table><thead><tr><th>客戶</th><th>手機</th><th>商品 / 明細</th><th>數量</th></tr></thead><tbody>{currentRows.map(c=><tr key={`p-${c.key}`}><td><strong>{c.name}</strong><br/><small>{c.all_arrived?'✅ 全部到齊':'⚠️ 尚有未到貨'}</small></td><td>{c.phone||(c.phone_last2?`末碼 ${c.phone_last2}`:'—')}</td><td>{c.items.map((item,i)=><div key={i}>{mode==='buyer'&&<strong>{item.product_name}　</strong>}<span style={SPEC_STYLE}>{item.spec}</span> ×{item.qty}　<strong style={{color:item.arrival_color}}>{item.arrival_label}</strong></div>)}</td><td><strong>{c.total_qty}</strong></td></tr>)}</tbody></table>{mode==='product'&&orderingSummary.combos.length>0&&<><h3>團購訂貨／到貨彙總</h3><table><thead><tr><th>規格</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(r=><tr key={r.label}><td><span style={SPEC_STYLE}>{r.label}</span></td><td>{r.qty}</td><td>{r.arrived}</td><td>{r.missing}</td></tr>)}</tbody></table></>}</div>

      <div className="no-print" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:16}}><div style={{background:'var(--indigo-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'var(--indigo)'}}>{viewLabel}客戶</div><strong style={{fontSize:22,color:'var(--indigo)'}}>{summary.customers} 位</strong></div><div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'#b45309'}}>本檢視數量</div><strong style={{fontSize:22,color:'#b45309'}}>{summary.qty} 件</strong></div><div style={{background:'var(--emerald-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'var(--emerald)'}}>本檢視金額</div><strong style={{fontSize:22,color:'var(--emerald)'}}>{money(summary.amount)}</strong></div></div>
      {mode==='product'&&<div className="search-input-wrap no-print" style={{maxWidth:500,marginBottom:14}}><Search size={14}/><input value={productBuyerSearch} onChange={e=>setProductBuyerSearch(e.target.value)} placeholder="搜尋姓名、手機、末兩碼、Line、FB..." style={{padding:'8px 8px 8px 32px',width:'100%'}}/></div>}
      <div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><PackageSearch size={15}/> {reportLabel}</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>共 {summary.customers} 位／{summary.qty} 件</span></div><div className="table-container"><table><thead><tr><th>客戶</th><th>手機辨識</th><th>訂購／到貨明細</th><th>訂單數</th><th>本檢視數量</th><th>小計</th></tr></thead><tbody>{!loading&&currentRows.length===0&&<tr><td colSpan={6} style={{textAlign:'center',padding:32,color:'var(--text-muted)'}}>目前沒有符合「{viewLabel}」的資料</td></tr>}{currentRows.map(c=><tr key={c.key}><td style={{fontWeight:800,minWidth:120}}>{c.name}<div style={{fontSize:11,marginTop:4,color:c.all_arrived?'var(--emerald)':'#b45309'}}>{c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td><td style={{minWidth:140,fontSize:12}}>{renderContact(c)}</td><td style={{minWidth:340,fontSize:12}}>{renderDetails(c,mode==='buyer')}</td><td>{c.order_count}</td><td style={{fontWeight:800}}>{c.total_qty}</td><td style={{fontWeight:900,color:'var(--indigo)'}}>{money(c.total_amount)}</td></tr>)}</tbody>{currentRows.length>0&&<tfoot><tr><td colSpan={4} style={{textAlign:'right',fontWeight:800}}>合計</td><td style={{fontWeight:900}}>{summary.qty}</td><td style={{fontWeight:900}}>{money(summary.amount)}</td></tr></tfoot>}</table></div></div>

      {mode==='product'&&orderingSummary.combos.length>0&&<div className="card no-print"><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><Boxes size={16}/> 團購訂貨／到貨彙總</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>訂購 {orderingSummary.totalQty}／已到 {orderingSummary.totalArrived}／未到 {orderingSummary.totalMissing}</span></div><div className="card-body"><div className="table-container" style={{marginBottom:16}}><table><thead><tr><th>規格組合</th><th>口味</th><th>顏色</th><th>尺寸</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(r=><tr key={r.label}><td><span style={SPEC_STYLE}>{r.label}</span></td><td><span style={r.flavor?SPEC_STYLE:undefined}>{r.flavor||'—'}</span></td><td><span style={r.color?SPEC_STYLE:undefined}>{r.color||'—'}</span></td><td><span style={r.size?SPEC_STYLE:undefined}>{r.size||'—'}</span></td><td><strong>{r.qty}</strong></td><td style={{fontWeight:900,color:'var(--emerald)'}}>{r.arrived}</td><td style={{fontWeight:900,color:r.missing?'var(--rose)':'var(--text-muted)'}}>{r.missing}</td></tr>)}</tbody></table></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}><DimensionSummary title="口味小計" rows={orderingSummary.flavors}/><DimensionSummary title="顏色小計" rows={orderingSummary.colors}/><DimensionSummary title="尺寸小計" rows={orderingSummary.sizes}/></div></div></div>}
    </>}
  </div>
}
