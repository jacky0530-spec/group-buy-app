import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, PackageSearch, Printer, Search, UserSearch, Boxes, PackageCheck, PackageX, Layers3, Truck, Undo2, Archive, ArchiveRestore } from 'lucide-react'
import { CustomersAPI, OrdersAPI, ProductsAPI } from '../lib/db'
import { useToast } from '../components/UI'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'

const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`
const dateText = value => value ? new Date(value).toLocaleDateString('zh-TW') : '—'
const SPEC_STYLE = { color:'#2563eb', fontWeight:900 }
const COMBO_STYLE = { color:'#1d4ed8', fontWeight:900 }
const specDisplayStyle = () => SPEC_STYLE

function itemQty(item) { return Math.max(0, Number(item?.qty || 0)) }
function arrivedQty(item) { return Math.min(itemQty(item), Math.max(0, Number(item?.arrived_qty || 0))) }
function missingQty(item) { return Math.max(0, itemQty(item) - arrivedQty(item)) }
function arrivalStatus(item) {
  const qty = itemQty(item)
  const arrived = arrivedQty(item)
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
  return [
    spec.package && `組合：${spec.package}`,
    spec.flavor && `口味：${spec.flavor}`,
    spec.color && `顏色：${spec.color}`,
    spec.size && `尺寸：${spec.size}`,
  ].filter(Boolean).join('／') || '一般規格'
}
function escapeCsv(value) { return `"${String(value ?? '').replaceAll('"','""')}"` }
function downloadCsv(rows, filename) {
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(escapeCsv).join(',')).join('\n')], { type:'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
function matchesProduct(item, product) {
  if (!item || !product) return false
  return (item.product_id || item.id) === product.id || (item.product_name || item.name) === product.name
}
function buildRows(orderRows, customerMap, selectedProduct = null, arrivalView = 'all', shippedView = false) {
  const groups = new Map()
  orderRows.forEach(order => {
    const matches = (order.items || []).filter(item => {
      if (selectedProduct && !matchesProduct(item, selectedProduct)) return false
      if (shippedView) return itemQty(item) > 0
      return displayQtyForMode(item, arrivalView) > 0
    })
    if (!matches.length) return

    const customer = customerMap[order.customer_id] || {}
    const phone = String(order.customer_phone || customer.phone || '').trim()
    const last2 = String(order.customer_phone_last2 || getCustomerPhoneLast2(customer) || '').trim()
    const baseGroupKey = order.customer_id || `${order.customer_name || customer.name || ''}|${phone || last2 || ''}`
    const groupKey = `${baseGroupKey}|${order.archived === true ? 'archived' : 'active'}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key:groupKey,
        customer_id:order.customer_id || '',
        name:order.customer_name || customer.name || '未命名客戶',
        phone,
        phone_last2:last2,
        line_nick:customer.line_nick || '',
        fb_name:customer.fb_name || '',
        items:new Map(),
        total_qty:0,
        total_amount:0,
        total_ordered_qty:0,
        total_arrived_qty:0,
        total_missing_qty:0,
        order_ids:new Set(),
        real_order_ids:new Set(),
        virtual_order_ids:new Set(),
        has_virtual:false,
        all_virtual:true,
        archived:true,
      })
    }

    const group = groups.get(groupKey)
    group.order_ids.add(order.id)
    if (order.is_virtual) { group.virtual_order_ids.add(order.id); group.has_virtual = true } else { group.real_order_ids.add(order.id); group.all_virtual = false }
    if (order.archived !== true) group.archived = false

    matches.forEach(item => {
      const ordered = itemQty(item)
      const arrived = arrivedQty(item)
      const missing = missingQty(item)
      const shown = shippedView ? ordered : displayQtyForMode(item, arrivalView)
      const price = Number(item.sale_price ?? item.price ?? 0)
      const productName = item.product_name || item.name || '未命名商品'
      const note = String(item.note || '').trim()
      const spec = specText(item)
      const status = arrivalStatus(item)
      const detailKey = [productName, spec, price, note, status.key].join('|')

      if (!group.items.has(detailKey)) {
        group.items.set(detailKey, {
          product_name:productName,
          spec,
          note,
          price,
          qty:0,
          ordered_qty:0,
          arrived_qty:0,
          missing_qty:0,
          amount:0,
          dates:new Set(),
          arrival_key:status.key,
          arrival_label:status.label,
          arrival_color:status.color,
          sources:[],
        })
      }
      const detail = group.items.get(detailKey)
      detail.qty += shown
      detail.ordered_qty += ordered
      detail.arrived_qty += arrived
      detail.missing_qty += missing
      detail.amount += price * shown
      detail.dates.add(dateText(order.order_date))
      detail.sources.push({ order_id:order.id,item_index:(order.items || []).indexOf(item),qty:ordered,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual) })
      group.total_qty += shown
      group.total_amount += price * shown
      group.total_ordered_qty += ordered
      group.total_arrived_qty += arrived
      group.total_missing_qty += missing
    })
  })

  return Array.from(groups.values()).map(group => ({
    ...group,
    items:Array.from(group.items.values()).map(item => ({ ...item, dates:Array.from(item.dates) })),
    order_ids:Array.from(group.order_ids),
    real_order_ids:Array.from(group.real_order_ids),
    virtual_order_ids:Array.from(group.virtual_order_ids),
    order_count:group.order_ids.size,
    all_arrived:group.total_missing_qty === 0,
  })).sort((a,b) => a.name.localeCompare(b.name,'zh-Hant'))
}
function increment(map,key,qty) { if (key) map.set(key,(map.get(key) || 0) + qty) }
function mapToRows(map) {
  return Array.from(map.entries()).map(([label,qty]) => ({ label,qty })).sort((a,b) => a.label.localeCompare(b.label,'zh-Hant',{ numeric:true }))
}
function buildOrderingSummary(orderRows, selectedProduct) {
  if (!selectedProduct) return { combos:[],packages:[],colors:[],sizes:[],flavors:[],totalQty:0,totalArrived:0,totalMissing:0,totalAmount:0,virtualQty:0 }
  const combos = new Map(), packages = new Map(), colors = new Map(), sizes = new Map(), flavors = new Map()
  let totalQty=0, totalArrived=0, totalMissing=0, totalAmount=0, virtualQty=0
  orderRows.forEach(order => (order.items || []).filter(item => matchesProduct(item, selectedProduct)).forEach(item => {
    const qty = itemQty(item)
    if (order.is_virtual) { virtualQty += qty; return }
    const spec = item.spec || {}
    const packageName = String(spec.package || '').trim(), flavor = String(spec.flavor || '').trim(), color = String(spec.color || '').trim(), size = String(spec.size || '').trim()
    const arrived = arrivedQty(item), missing = missingQty(item), price = Number(item.sale_price ?? item.price ?? 0)
    const comboKey = [packageName,flavor,color,size].join('|')
    const comboLabel = [packageName && `組合：${packageName}`,flavor && `口味：${flavor}`,color && `顏色：${color}`,size && `尺寸：${size}`].filter(Boolean).join('／') || '一般規格'
    if (!combos.has(comboKey)) combos.set(comboKey,{ label:comboLabel,packageName,flavor,color,size,qty:0,arrived:0,missing:0,amount:0 })
    const combo = combos.get(comboKey)
    combo.qty += qty; combo.arrived += arrived; combo.missing += missing; combo.amount += price * qty
    increment(packages,packageName,qty); increment(flavors,flavor,qty); increment(colors,color,qty); increment(sizes,size,qty)
    totalQty += qty; totalArrived += arrived; totalMissing += missing; totalAmount += price * qty
  }))
  return { combos:Array.from(combos.values()).sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant',{numeric:true})),packages:mapToRows(packages),colors:mapToRows(colors),sizes:mapToRows(sizes),flavors:mapToRows(flavors),totalQty,totalArrived,totalMissing,totalAmount,virtualQty }
}
function matchesBuyer(row,search) {
  const q = String(search || '').trim().toLowerCase()
  if (!q) return true
  return [row.name,row.phone,row.phone_last2,row.line_nick,row.fb_name].some(v => String(v || '').toLowerCase().includes(q))
}
function DimensionSummary({ title,rows }) {
  if (!rows.length) return null
  const isCombo = title === '組合小計'
  const rowStyle = isCombo ? COMBO_STYLE : SPEC_STYLE
  return <div style={{ border:'1px solid var(--border)',borderRadius:10,overflow:'hidden' }}><div style={{ background:isCombo?'#eff6ff':'var(--surface-2)',color:isCombo?'#1d4ed8':'inherit',padding:'9px 12px',fontSize:13,fontWeight:900 }}>{title}</div><div style={{ padding:'8px 12px' }}>{rows.map(row => <div key={row.label} style={{ display:'flex',justifyContent:'space-between',gap:12,padding:'5px 0',borderBottom:'1px dashed var(--border)' }}><span style={rowStyle}>{row.label}</span><strong>{row.qty} 件</strong></div>)}</div></div>
}

export default function PendingProductReport() {
  const toast = useToast()
  const [orders,setOrders] = useState([])
  const [products,setProducts] = useState([])
  const [customers,setCustomers] = useState([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [mode,setMode] = useState('product')
  const [shipmentView,setShipmentView] = useState('pending')
  const [arrivalView,setArrivalView] = useState('all')
  const [productSearch,setProductSearch] = useState('')
  const [selectedProduct,setSelectedProduct] = useState(null)
  const [productBuyerSearch,setProductBuyerSearch] = useState('')
  const [buyerSearch,setBuyerSearch] = useState('')
  const [selectedBuyerKey,setSelectedBuyerKey] = useState('')
  const [marking,setMarking] = useState(false)
  const [shippingKey,setShippingKey] = useState('')
  const [showArchived,setShowArchived] = useState(false)
  const [archivingKey,setArchivingKey] = useState('')

  const load = useCallback(async() => {
    setLoading(true); setError('')
    try {
      const [orderRows,productRows,customerRows] = await Promise.all([OrdersAPI.list(),ProductsAPI.list({ includeArchived:true }),CustomersAPI.list({ includeArchived:true })])
      setOrders(orderRows); setProducts(productRows); setCustomers(customerRows)
    } catch(err) { setError(`出貨報表載入失敗：${err.message}`) }
    finally { setLoading(false) }
  },[])
  useEffect(() => { load() },[load])

  const sourceOrders = useMemo(() => orders.filter(order => {
    if (order.status !== shipmentView) return false
    if (shipmentView !== 'shipped') return order.archived !== true
    return showArchived ? true : order.archived !== true
  }),[orders,shipmentView,showArchived])
  const customerMap = useMemo(() => Object.fromEntries(customers.map(c => [c.id,c])),[customers])
  const productOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase(); const ids = new Set(), names = new Set()
    sourceOrders.forEach(order => (order.items || []).forEach(item => { if (item.product_id || item.id) ids.add(item.product_id || item.id); if (item.product_name || item.name) names.add(item.product_name || item.name) }))
    return products.filter(p => ids.has(p.id) || names.has(p.name)).filter(p => !q || p.name.toLowerCase().includes(q)).sort((a,b) => a.name.localeCompare(b.name,'zh-Hant'))
  },[products,sourceOrders,productSearch])

  const effectiveArrivalView = shipmentView === 'shipped' ? 'all' : arrivalView
  const productRows = useMemo(() => selectedProduct ? buildRows(sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView==='shipped') : [],[selectedProduct,sourceOrders,customerMap,effectiveArrivalView,shipmentView])
  const filteredProductRows = useMemo(() => productRows.filter(row => matchesBuyer(row,productBuyerSearch)),[productRows,productBuyerSearch])
  const buyerRows = useMemo(() => buildRows(sourceOrders,customerMap,null,effectiveArrivalView,shipmentView==='shipped'),[sourceOrders,customerMap,effectiveArrivalView,shipmentView])
  const buyerCandidates = useMemo(() => buyerRows.filter(row => matchesBuyer(row,buyerSearch)),[buyerRows,buyerSearch])
  const filteredBuyerRows = useMemo(() => selectedBuyerKey ? buyerCandidates.filter(row => row.key === selectedBuyerKey) : buyerCandidates,[buyerCandidates,selectedBuyerKey])
  const selectedBuyer = useMemo(() => buyerRows.find(row => row.key === selectedBuyerKey) || null,[buyerRows,selectedBuyerKey])
  const orderingSummary = useMemo(() => buildOrderingSummary(sourceOrders,selectedProduct),[sourceOrders,selectedProduct])
  const currentRows = mode === 'product' ? filteredProductRows : filteredBuyerRows
  const summary = useMemo(() => ({ customers:currentRows.length,qty:currentRows.reduce((s,r) => s+r.total_qty,0),amount:currentRows.reduce((s,r) => s+r.total_amount,0) }),[currentRows])
  const canOutput = mode === 'product' ? Boolean(selectedProduct && currentRows.length) : Boolean(currentRows.length)
  const statusLabel = shipmentView === 'shipped' ? '已出貨' : '待出貨'
  const viewLabel = shipmentView === 'shipped' ? '已出貨' : arrivalView === 'arrived' ? '已到貨可取貨' : arrivalView === 'missing' ? '尚未到貨' : '全部待出貨'
  const reportLabel = mode === 'product' ? `${selectedProduct?.name || '未選商品'}｜${viewLabel}` : `${selectedBuyer ? `買家：${selectedBuyer.name}${selectedBuyer.phone_last2 ? `（末碼 ${selectedBuyer.phone_last2}）` : ''}` : buyerSearch.trim() ? `買家搜尋：${buyerSearch.trim()}` : '全部買家'}｜${viewLabel}`
  const supplierName = String(selectedProduct?.supplier || '').trim() || '未設定'

  async function markSelectedProductArrived() {
    if (!selectedProduct || marking || shipmentView !== 'pending') return
    setMarking(true)
    try {
      const changed = sourceOrders.filter(order => !order.is_virtual && (order.items || []).some(item => matchesProduct(item,selectedProduct) && missingQty(item)>0)); const now = new Date().toISOString()
      await Promise.all(changed.map(order => { const items=(order.items || []).map(item => matchesProduct(item,selectedProduct) ? { ...item,arrived_qty:itemQty(item),arrived_at:now } : item); return OrdersAPI.updateArrival(order.id,items) }))
      toast(`「${selectedProduct.name}」已更新到貨；供應商付款狀態維持獨立，不會自動變更 ✓`); await load()
    } catch(err) { toast('批次到貨失敗：'+err.message,'error') }
    finally { setMarking(false) }
  }

  async function changeRowShipment(row,nextStatus) {
    const targetIds = nextStatus === 'shipped' ? (row.real_order_ids || []) : (row.order_ids || [])
    if (!targetIds.length || shippingKey) return
    const key = `${row.key}-${nextStatus}`; setShippingKey(key)
    try {
      await OrdersAPI.batchUpdateStatus(targetIds,nextStatus)
      toast(nextStatus === 'shipped' ? `✅ ${row.name} 的 ${targetIds.length} 筆正式訂單已出貨並自動標記已收款` : `↩️ ${row.name} 的 ${targetIds.length} 筆訂單已恢復待出貨`)
      await load()
    } catch(err) { toast('更新出貨狀態失敗：'+err.message,'error') }
    finally { setShippingKey('') }
  }

  async function changeRowArchive(row,archiveNext) {
    if (!row.order_ids?.length || archivingKey) return
    if (archiveNext && !window.confirm(`確定要封存 ${row.name} 的 ${row.order_ids.length} 筆已出貨訂單？\n封存後預設不會顯示，但可從「顯示封存」查回。`)) return
    const key = `${row.key}-${archiveNext?'archive':'restore'}`
    setArchivingKey(key)
    try {
      await Promise.all(row.order_ids.map(id => archiveNext ? OrdersAPI.archive(id) : OrdersAPI.unarchive(id)))
      toast(archiveNext ? `📦 ${row.name} 的 ${row.order_ids.length} 筆訂單已封存` : `↩️ ${row.name} 的 ${row.order_ids.length} 筆訂單已解除封存`)
      await load()
    } catch(err) { toast(`${archiveNext?'封存':'解除封存'}失敗：${err.message}`,'error') }
    finally { setArchivingKey('') }
  }

  function exportCurrent() {
    if (!canOutput) return
    const rows = [['出貨狀態','客戶','手機','手機末兩碼','Line','FB','商品','規格/口味','到貨狀態','訂購量','已到貨','未到貨','本檢視數量','單價','本檢視小計']]
    currentRows.forEach(c => c.items.forEach(item => rows.push([statusLabel,c.name,c.phone,c.phone_last2,c.line_nick,c.fb_name,item.product_name,item.spec,item.arrival_label,item.ordered_qty,item.arrived_qty,item.missing_qty,item.qty,item.price,item.amount])))
    if (mode === 'product' && shipmentView === 'pending') { rows.push([],['團購訂貨彙總'],['供應廠商',supplierName],['規格組合','訂購','已到','未到','金額']); orderingSummary.combos.forEach(r => rows.push([r.label,r.qty,r.arrived,r.missing,r.amount])) }
    downloadCsv(rows,`${statusLabel}-${mode === 'product' ? selectedProduct.name : '買家'}-${viewLabel}.csv`)
  }

  async function setVirtualState(row,isVirtual) {
    const ids = isVirtual ? (row.real_order_ids || []) : (row.virtual_order_ids || [])
    if (!ids.length) return
    try { await OrdersAPI.updateVirtual(ids,isVirtual); toast(isVirtual?'已改為虛擬訂單':'✅ 已轉為正式訂單，現在會計入實際訂貨與財務'); await load() }
    catch(err) { toast('訂單類型更新失敗：'+err.message,'error') }
  }
  async function changeSourceQty(source,value) {
    const qty = Number(value)
    if (!Number.isInteger(qty) || qty < 1 || qty === Number(source.qty)) return
    try { await OrdersAPI.updateItemQty(source.order_id,source.item_index,qty); toast(`訂購量已更新為 ${qty}，訂單與彙總同步完成 ✓`); await load() }
    catch(err) { toast('修改訂購量失敗：'+err.message,'error') }
  }

  function renderContact(c) { return <>{c.phone ? <div>{c.phone}</div> : c.phone_last2 ? <div>末碼 {c.phone_last2}</div> : <div>—</div>}{c.phone && c.phone_last2 && <div style={{color:'var(--text-muted)'}}>末碼 {c.phone_last2}</div>}{c.line_nick && <div style={{color:'var(--text-muted)'}}>Line：{c.line_nick}</div>}{c.fb_name && <div style={{color:'var(--text-muted)'}}>FB：{c.fb_name}</div>}</> }
  function renderDetails(c,showProduct) { return c.items.map((item,index) => <div key={`${c.key}-${index}`} style={{padding:'7px 0',borderBottom:index<c.items.length-1?'1px dashed var(--border)':'none'}}>{showProduct && <strong style={{color:'var(--indigo)'}}>{item.product_name}　</strong>}<span style={specDisplayStyle(item.spec)}>{item.spec}</span> ×<strong>{item.qty}</strong>{shipmentView === 'pending' ? <>　<span style={{fontWeight:800,color:item.arrival_color}}>{item.arrival_label}</span>{arrivalView==='all' && item.arrival_key==='partial' && <span>（尚欠 {item.missing_qty}）</span>}</> : <span style={{fontWeight:800,color:'var(--emerald)'}}>　✅ 已出貨</span>}　{money(item.price)}／件{item.note && <span style={{color:'var(--rose)',fontWeight:900}}>　備註：{item.note}</span>}<div style={{color:'var(--text-muted)',fontSize:11}}>訂購：{item.dates.join('、')}</div>{shipmentView==='pending'&&item.sources?.map(source=><div key={`${source.order_id}-${source.item_index}`} style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginTop:5,padding:'5px 7px',borderRadius:7,background:source.is_virtual?'#fff1f2':'#f8fafc'}}><span className={`badge ${source.is_virtual?'badge-rose':'badge-gray'}`}>{source.is_virtual?'⚠ 虛擬':'正式'}</span><span style={{fontSize:10,color:'var(--text-muted)'}}>{source.date}</span><span style={{fontSize:11}}>訂購量</span><input type="number" min="1" defaultValue={source.qty} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>changeSourceQty(source,e.target.value)} style={{width:70,padding:'5px 7px',fontWeight:900,textAlign:'center'}}/><span style={{fontSize:10,color:'var(--text-muted)'}}>離開欄位即儲存</span></div>)}</div>) }

  const modeCardStyle = active => ({ flex:1,minWidth:220,borderRadius:14,padding:'14px 16px',cursor:'pointer',textAlign:'left',border:`2px solid ${active ? 'var(--indigo)' : 'var(--border)'}`,background:active ? 'var(--indigo-light)' : 'var(--surface)',boxShadow:active ? '0 8px 22px rgba(79,70,229,.14)' : 'none',fontFamily:'inherit' })

  return <div className="animate-fade">
    <div className="no-print" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:20}}><div><h2 style={{fontSize:22,fontWeight:800}}>出貨查詢報表</h2><p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>出貨會自動同步已收款；到貨與供應商付款分開管理，實際匯款才標記付款完成</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-ghost" disabled={!canOutput} onClick={exportCurrent}><Download size={14}/>匯出 CSV</button><button className="btn btn-primary" disabled={!canOutput} onClick={() => window.print()}><Printer size={14}/>列印</button></div></div>
    {error && <div className="no-print" style={{background:'var(--rose-light)',color:'var(--rose)',padding:12,borderRadius:8,marginBottom:14}}>{error}</div>}

    <div className="no-print" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginBottom:14}}><button type="button" onClick={() => { setShipmentView('pending'); setArrivalView('all'); setSelectedBuyerKey(''); setShowArchived(false) }} style={{borderRadius:12,padding:'12px 16px',border:`2px solid ${shipmentView==='pending'?'#d97706':'var(--border)'}`,background:shipmentView==='pending'?'#fff7ed':'var(--surface)',fontWeight:900,color:shipmentView==='pending'?'#b45309':'var(--text-secondary)',cursor:'pointer',fontFamily:'inherit'}}><Truck size={16} style={{verticalAlign:'middle',marginRight:7}}/>待出貨訂單</button><button type="button" onClick={() => { setShipmentView('shipped'); setSelectedBuyerKey('') }} style={{borderRadius:12,padding:'12px 16px',border:`2px solid ${shipmentView==='shipped'?'#059669':'var(--border)'}`,background:shipmentView==='shipped'?'#ecfdf5':'var(--surface)',fontWeight:900,color:shipmentView==='shipped'?'#047857':'var(--text-secondary)',cursor:'pointer',fontFamily:'inherit'}}><PackageCheck size={16} style={{verticalAlign:'middle',marginRight:7}}/>已出貨查詢</button></div>{shipmentView==='shipped' && <div className="no-print" style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:10,margin:'-4px 0 14px'}}><button type="button" className={`btn btn-sm ${showArchived?'btn-primary':'btn-ghost'}`} onClick={()=>{setShowArchived(v=>!v);setSelectedBuyerKey('')}}>{showArchived?<><ArchiveRestore size={13}/>隱藏封存</>:<><Archive size={13}/>顯示封存</>}</button><span style={{fontSize:12,color:'var(--text-muted)'}}>{showArchived?'目前包含已封存訂單':'封存訂單預設隱藏'}</span></div>}

    <div className="no-print" style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14}}><button type="button" style={modeCardStyle(mode==='product')} onClick={() => setMode('product')}><div style={{fontSize:16,fontWeight:900,color:mode==='product'?'var(--indigo)':'var(--text-primary)'}}>📦 依商品查詢</div><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:4}}>挑商品查看客戶、規格與出貨狀態</div></button><button type="button" style={modeCardStyle(mode==='buyer')} onClick={() => setMode('buyer')}><div style={{fontSize:16,fontWeight:900,color:mode==='buyer'?'#7c3aed':'var(--text-primary)'}}>👥 依買家查詢</div><div style={{fontSize:12,color:'var(--text-secondary)',marginTop:4}}>用姓名、手機末兩碼、Line、FB 查詢</div></button></div>

    {shipmentView === 'pending' && <div className="no-print" style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:16}}><button className={`btn btn-sm ${arrivalView==='all'?'btn-primary':'btn-ghost'}`} onClick={() => setArrivalView('all')}><Layers3 size={13}/>全部待出貨</button><button className={`btn btn-sm ${arrivalView==='arrived'?'btn-primary':'btn-ghost'}`} onClick={() => setArrivalView('arrived')}><PackageCheck size={13}/>已到貨可取貨</button><button className={`btn btn-sm ${arrivalView==='missing'?'btn-primary':'btn-ghost'}`} onClick={() => setArrivalView('missing')}><PackageX size={13}/>尚未到貨</button></div>}

    {mode === 'product' && <div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}>挑選有{statusLabel}訂單的商品</div><div className="card-body"><div className="search-input-wrap" style={{marginBottom:10}}><Search size={14}/><input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder={`搜尋${statusLabel}商品...`} style={{padding:'8px 8px 8px 32px',width:'100%'}}/></div><div style={{display:'flex',gap:7,flexWrap:'wrap',maxHeight:210,overflowY:'auto'}}>{loading && <span style={{color:'var(--text-muted)'}}>讀取中...</span>}{!loading && productOptions.length===0 && <span style={{color:'var(--text-muted)'}}>目前沒有符合的{statusLabel}商品</span>}{productOptions.map(product => <button key={product.id} className={`btn btn-sm ${selectedProduct?.id===product.id?'btn-primary':'btn-ghost'}`} onClick={() => setSelectedProduct(product)}>{product.name}{product.active===false?'（已封存）':''}</button>)}</div>{shipmentView==='pending' && selectedProduct && orderingSummary.totalMissing>0 && <div style={{marginTop:12}}><button className="btn btn-ghost btn-sm" disabled={marking} onClick={markSelectedProductArrived}><PackageCheck size={13}/>{marking?'更新中...':`此商品全部到貨（尚欠 ${orderingSummary.totalMissing} 件）`}</button></div>}{shipmentView==='pending' && <div style={{marginTop:10,fontSize:12,color:'#92400e',background:'#fff7ed',padding:'8px 10px',borderRadius:8}}>提醒：目前「已出貨」是整張訂單狀態。從商品查詢標記某客戶已出貨時，該客戶此結果涉及的整張訂單會一起改為已出貨。</div>}</div></div>}

    {mode === 'buyer' && <div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{fontWeight:800}}><UserSearch size={16}/>搜尋{statusLabel}買家</div><div className="card-body"><div className="search-input-wrap"><Search size={14}/><input autoFocus value={buyerSearch} onChange={e => { setBuyerSearch(e.target.value); setSelectedBuyerKey('') }} placeholder="姓名／完整手機／手機末兩碼／Line／FB，例如 12" style={{padding:'10px 10px 10px 34px',width:'100%'}}/></div>{buyerSearch.trim() && <div style={{marginTop:12}}><div style={{fontSize:12,fontWeight:800,color:'var(--text-secondary)',marginBottom:7}}>找到 {buyerCandidates.length} 位符合買家，請點選指定顯示：</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:8}}>{buyerCandidates.slice(0,30).map(c => <button type="button" key={c.key} onClick={() => setSelectedBuyerKey(c.key)} style={{textAlign:'left',padding:'11px 12px',borderRadius:10,border:`2px solid ${selectedBuyerKey===c.key?'#7c3aed':'var(--border)'}`,background:selectedBuyerKey===c.key?'#f5f3ff':'var(--surface-2)',cursor:'pointer',fontFamily:'inherit'}}><div style={{fontWeight:900,color:selectedBuyerKey===c.key?'#6d28d9':'var(--text-primary)'}}>{c.name}{c.phone_last2 && <span className="badge badge-violet" style={{marginLeft:6}}>末碼 {c.phone_last2}</span>}</div><div style={{fontSize:11,color:'var(--text-secondary)',marginTop:4}}>{[c.phone && `手機 ${c.phone}`,c.line_nick && `Line ${c.line_nick}`,c.fb_name && `FB ${c.fb_name}`].filter(Boolean).join(' ・ ') || '無其他辨識資料'}</div></button>)}</div>{selectedBuyerKey && <button type="button" className="btn btn-sm btn-ghost" style={{marginTop:9}} onClick={() => setSelectedBuyerKey('')}>顯示全部符合買家</button>}</div>}</div></div>}

    {(mode==='buyer' || selectedProduct) && <><div className="print-only" style={{display:'none'}}><h2>{statusLabel}查詢報表</h2><div>{reportLabel}　列印日期：{new Date().toLocaleDateString('zh-TW')}</div><div style={{margin:'8px 0 12px',fontWeight:700}}>共 {summary.customers} 位／{summary.qty} 件／{money(summary.amount)}</div><table><thead><tr><th>客戶</th><th>手機</th><th>商品 / 明細</th><th>數量</th></tr></thead><tbody>{currentRows.map(c => <tr key={`p-${c.key}`}><td><strong>{c.name}</strong>{c.archived && <span style={{marginLeft:6,color:'#64748b',fontWeight:800}}>【已封存】</span>}</td><td>{c.phone || (c.phone_last2 ? `末碼 ${c.phone_last2}` : '—')}</td><td>{c.items.map((item,i) => <div key={i}>{mode==='buyer' && <strong>{item.product_name}　</strong>}<span style={specDisplayStyle(item.spec)}>{item.spec}</span> ×{item.qty}　<strong>{shipmentView==='shipped'?'✅ 已出貨':item.arrival_label}</strong></div>)}</td><td><strong>{c.total_qty}</strong></td></tr>)}</tbody></table>{mode==='product' && shipmentView==='pending' && orderingSummary.combos.length>0 && <><h3>團購訂貨／到貨彙總</h3><div style={{color:'#2563eb',fontWeight:900,margin:'4px 0 8px'}}>供應廠商：{supplierName}</div><table><thead><tr><th>規格</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(r => <tr key={r.label}><td><span style={r.packageName?COMBO_STYLE:SPEC_STYLE}>{r.label}</span></td><td>{r.qty}</td><td>{r.arrived}</td><td>{r.missing}</td></tr>)}</tbody></table></>}</div>

      <div className="no-print" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:16}}><div style={{background:'var(--indigo-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'var(--indigo)'}}>{viewLabel}客戶</div><strong style={{fontSize:22,color:'var(--indigo)'}}>{summary.customers} 位</strong></div><div style={{background:'var(--amber-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'#b45309'}}>本檢視數量</div><strong style={{fontSize:22,color:'#b45309'}}>{summary.qty} 件</strong></div><div style={{background:'var(--emerald-light)',borderRadius:10,padding:14}}><div style={{fontSize:12,fontWeight:700,color:'var(--emerald)'}}>本檢視金額</div><strong style={{fontSize:22,color:'var(--emerald)'}}>{money(summary.amount)}</strong></div></div>

      {mode==='product' && <div className="search-input-wrap no-print" style={{maxWidth:500,marginBottom:14}}><Search size={14}/><input value={productBuyerSearch} onChange={e => setProductBuyerSearch(e.target.value)} placeholder="搜尋姓名、手機、末兩碼、Line、FB..." style={{padding:'8px 8px 8px 32px',width:'100%'}}/></div>}

      <div className="card no-print" style={{marginBottom:16}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><PackageSearch size={15}/> {reportLabel}</strong><span style={{fontSize:12,color:'var(--text-muted)'}}>共 {summary.customers} 位／{summary.qty} 件</span></div><div className="table-container"><table><thead><tr><th>客戶</th><th>手機辨識</th><th>訂購／到貨明細</th><th>訂單數</th><th>數量</th><th>小計</th><th>出貨操作</th></tr></thead><tbody>{!loading && currentRows.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:32,color:'var(--text-muted)'}}>目前沒有符合「{viewLabel}」的資料</td></tr>}{currentRows.map(c => { const actionKey = `${c.key}-${shipmentView==='pending'?'shipped':'pending'}`; const mixedVirtual = c.has_virtual && !c.all_virtual; const rowBackground = c.archived ? '#f8fafc' : c.all_virtual ? '#fff1f2' : mixedVirtual ? '#fffbeb' : undefined; const rowShadow = c.all_virtual ? 'inset 5px 0 #e11d48' : mixedVirtual ? 'inset 5px 0 #f59e0b' : undefined; return <tr key={c.key} style={{opacity:c.archived?.62:1,background:rowBackground,boxShadow:rowShadow}}><td style={{fontWeight:800,minWidth:120}}>{c.name}{c.all_virtual&&<span className="badge badge-rose" style={{marginLeft:6,fontWeight:900}}>⚠ 全部虛擬</span>}{mixedVirtual&&<span className="badge badge-amber" style={{marginLeft:6,fontWeight:900}}>正式＋虛擬</span>}{c.archived&&<span className="badge badge-gray" style={{marginLeft:6}}>已封存</span>}<div style={{fontSize:11,marginTop:4,color:c.all_virtual?'#be123c':mixedVirtual?'#b45309':c.archived?'#64748b':shipmentView==='shipped'?'var(--emerald)':c.all_arrived?'var(--emerald)':'#b45309'}}>{c.archived?'📦 已封存':c.all_virtual?'⚠ 全部為虛擬訂單，不計入實際訂貨':mixedVirtual?'🟡 同一買家同時有正式與虛擬訂單；請以各商品明細的標籤為準':shipmentView==='shipped'?'✅ 已出貨':c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td><td style={{minWidth:140,fontSize:12}}>{renderContact(c)}</td><td style={{minWidth:340,fontSize:12}}>{renderDetails(c,mode==='buyer')}</td><td>{c.order_count}</td><td style={{fontWeight:800}}>{c.total_qty}</td><td style={{fontWeight:900,color:'var(--indigo)'}}>{money(c.total_amount)}</td><td style={{minWidth:130}}>{shipmentView==='pending' ? <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{c.has_virtual&&<button className="btn btn-sm" style={{background:'#e11d48',color:'white'}} onClick={()=>setVirtualState(c,false)}>{c.all_virtual?'✓ 全部轉正式':'✓ 剩餘虛擬轉正式'}</button>}<button className="btn btn-sm btn-primary" disabled={Boolean(shippingKey)||!c.real_order_ids?.length} onClick={() => changeRowShipment(c,'shipped')}><Truck size={13}/>{!c.real_order_ids?.length?'先轉正式':shippingKey===actionKey?'更新中...':'標記已出貨'}</button></div> : <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{!c.archived&&<button className="btn btn-sm btn-ghost" disabled={Boolean(shippingKey)} onClick={() => changeRowShipment(c,'pending')}><Undo2 size={13}/>{shippingKey===actionKey?'更新中...':'恢復待出貨'}</button>}{c.archived?<button className="btn btn-sm btn-ghost" disabled={Boolean(archivingKey)} onClick={() => changeRowArchive(c,false)}><ArchiveRestore size={13}/>{archivingKey===`${c.key}-restore`?'更新中...':'解除封存'}</button>:<button className="btn btn-sm btn-ghost" style={{color:'#64748b'}} disabled={Boolean(archivingKey)} onClick={() => changeRowArchive(c,true)}><Archive size={13}/>{archivingKey===`${c.key}-archive`?'封存中...':'封存訂單'}</button>}</div>}</td></tr> })}</tbody>{currentRows.length>0 && <tfoot><tr><td colSpan={4} style={{textAlign:'right',fontWeight:800}}>合計</td><td style={{fontWeight:900}}>{summary.qty}</td><td style={{fontWeight:900}}>{money(summary.amount)}</td><td/></tr></tfoot>}</table></div></div>

      {mode==='product' && shipmentView==='pending' && orderingSummary.combos.length>0 && <div className="card no-print"><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><div><strong><Boxes size={16}/> 團購訂貨／到貨彙總</strong><div style={{fontSize:14,color:'#2563eb',fontWeight:900,marginTop:5}}>供應廠商：{supplierName}</div></div><span style={{fontSize:12,color:'var(--text-muted)'}}>實際應訂 {orderingSummary.totalQty}／虛擬 {orderingSummary.virtualQty}／已到 {orderingSummary.totalArrived}／未到 {orderingSummary.totalMissing}</span></div><div className="card-body">{orderingSummary.virtualQty>0&&<div style={{background:'#fff1f2',border:'1px solid #fda4af',color:'#9f1239',padding:'10px 12px',borderRadius:9,marginBottom:12,fontSize:12,fontWeight:800}}>⚠ 虛擬訂單共 {orderingSummary.virtualQty} 件，僅供參考，已自動排除「實際應訂數量」與下方規格訂貨彙總。</div>}<div className="table-container" style={{marginBottom:16}}><table><thead><tr><th>規格組合</th><th>組合</th><th>口味</th><th>顏色</th><th>尺寸</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(r => <tr key={r.label}><td><span style={r.packageName?COMBO_STYLE:SPEC_STYLE}>{r.label}</span></td><td><span style={r.packageName?COMBO_STYLE:undefined}>{r.packageName||'—'}</span></td><td><span style={r.flavor?SPEC_STYLE:undefined}>{r.flavor||'—'}</span></td><td><span style={r.color?SPEC_STYLE:undefined}>{r.color||'—'}</span></td><td><span style={r.size?SPEC_STYLE:undefined}>{r.size||'—'}</span></td><td><strong>{r.qty}</strong></td><td style={{fontWeight:900,color:'var(--emerald)'}}>{r.arrived}</td><td style={{fontWeight:900,color:r.missing?'var(--rose)':'var(--text-muted)'}}>{r.missing}</td></tr>)}</tbody></table></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}><DimensionSummary title="組合小計" rows={orderingSummary.packages}/><DimensionSummary title="口味小計" rows={orderingSummary.flavors}/><DimensionSummary title="顏色小計" rows={orderingSummary.colors}/><DimensionSummary title="尺寸小計" rows={orderingSummary.sizes}/></div></div></div>}
    </>}
  </div>
}
