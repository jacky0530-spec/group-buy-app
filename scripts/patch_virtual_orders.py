from pathlib import Path

# --- db.js ---
p=Path('src/lib/db.js'); s=p.read_text()
# add order APIs before batchUpdateStatus
needle="  async batchUpdateStatus(ids, status) {"
insert="""  async updateVirtual(ids = [], isVirtual = false) {
    const targetIds = [...new Set((ids || []).filter(Boolean))]
    for (let i=0; i<targetIds.length; i+=400) {
      const batch = writeBatch(db)
      targetIds.slice(i,i+400).forEach(id => batch.update(doc(db,'orders',id), { is_virtual:Boolean(isVirtual), updated_at:now() }))
      await batch.commit()
    }
  },
  async updateItemQty(id, itemIndex, qty) {
    const nextQty = Number(qty)
    if (!Number.isInteger(nextQty) || nextQty < 1) throw new Error('訂購量至少為 1')
    const ref = doc(db,'orders',id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('找不到訂單')
    const data = snap.data()
    const items = [...(data.items || [])]
    if (!items[itemIndex]) throw new Error('找不到訂單商品')
    const item = { ...items[itemIndex] }
    const costPrice = Number(item.cost_price || 0)
    const paid = Math.max(0,Number(item.supplier_paid_amount || 0))
    const nextCost = costPrice * nextQty
    if (paid > nextCost + 0.01) throw new Error(`此品項已付供應商 ${paid} 元，數量不可降到已付款成本以下`)
    item.qty = nextQty
    item.subtotal = Number(item.sale_price ?? item.price ?? 0) * nextQty
    item.cost_subtotal = nextCost
    item.arrived_qty = Math.min(nextQty,Math.max(0,Number(item.arrived_qty || 0)))
    if (item.arrived_qty < nextQty) item.arrived_at = null
    if (paid > 0) item.supplier_payment_status = paid >= nextCost - 0.01 ? 'paid' : 'partial'
    items[itemIndex] = item
    const total_amount = items.reduce((sum,row)=>sum + Number(row.subtotal ?? Number(row.sale_price ?? row.price ?? 0)*Number(row.qty||0)),0)
    await updateDoc(ref,{ items,total_amount,updated_at:now() })
    return { items,total_amount }
  },
"""
if needle not in s: raise SystemExit('db batchUpdateStatus needle missing')
s=s.replace(needle,insert+needle,1)
# stats exclude virtual
s=s.replace("const activeOrders = orders.filter(o => o.status !== 'cancelled' && !o.archived)","const activeOrders = orders.filter(o => o.status !== 'cancelled' && !o.archived && !o.is_virtual)")
p.write_text(s)

# --- Orders.jsx ---
p=Path('src/pages/Orders.jsx'); s=p.read_text()
s=s.replace("const [cartItems,setCartItems] = useState([]); const [prodSearch,setProdSearch] = useState(''); const [prodOpen,setProdOpen] = useState(false); const [orderNote,setOrderNote] = useState(''); const [saving,setSaving] = useState(false)","const [cartItems,setCartItems] = useState([]); const [prodSearch,setProdSearch] = useState(''); const [prodOpen,setProdOpen] = useState(false); const [orderNote,setOrderNote] = useState(''); const [formVirtual,setFormVirtual] = useState(false); const [saving,setSaving] = useState(false)")
s=s.replace("function openAdd() { setEditId(null); setFormCustomer(null); setCartItems([]); setOrderNote(''); setCustSearch(''); setProdSearch(''); setShowForm(true) }","function openAdd() { setEditId(null); setFormCustomer(null); setCartItems([]); setOrderNote(''); setFormVirtual(false); setCustSearch(''); setProdSearch(''); setShowForm(true) }")
s=s.replace("setOrderNote(o.note || ''); setShowForm(true) }","setOrderNote(o.note || ''); setFormVirtual(Boolean(o.is_virtual)); setShowForm(true) }",1)
s=s.replace("customer_phone:formCustomer.phone || '',items,total_amount:items.reduce((s,i) => s+i.subtotal,0),note:orderNote.trim() }","customer_phone:formCustomer.phone || '',items,total_amount:items.reduce((s,i) => s+i.subtotal,0),note:orderNote.trim(),is_virtual:formVirtual }")
# stats formal + virtual
s=s.replace("const pendingCount = visibleOrders.filter(o => o.status === 'pending').length; const shippedCount = visibleOrders.filter(o => o.status === 'shipped').length\n  const outstanding = visibleOrders.filter(o => o.status !== 'cancelled' && o.payment_status === 'unpaid').reduce((s,o) => s+effectiveOrderAmount(o),0)","const pendingCount = visibleOrders.filter(o => o.status === 'pending' && !o.is_virtual).length; const shippedCount = visibleOrders.filter(o => o.status === 'shipped' && !o.is_virtual).length; const virtualCount = visibleOrders.filter(o => o.status !== 'cancelled' && o.is_virtual).length\n  const outstanding = visibleOrders.filter(o => o.status !== 'cancelled' && !o.is_virtual && o.payment_status === 'unpaid').reduce((s,o) => s+effectiveOrderAmount(o),0)")
# add virtual stat card after shipped
old="<div style={{ background:'var(--emerald-light)',borderRadius:10,padding:14 }}><div style={{ fontSize:12,color:'var(--emerald)',fontWeight:700 }}>已出貨</div><strong style={{ fontSize:22,color:'var(--emerald)' }}>{shippedCount}</strong></div>"
new=old+"<div style={{ background:'#fff1f2',borderRadius:10,padding:14,border:'1px solid #fecdd3' }}><div style={{ fontSize:12,color:'#be123c',fontWeight:800 }}>⚠ 虛擬訂單</div><strong style={{ fontSize:22,color:'#be123c' }}>{virtualCount}</strong></div>"
if old not in s: raise SystemExit('orders shipped stat missing')
s=s.replace(old,new,1)
# row style & badge
s=s.replace("return <tr key={o.id} style={{ opacity:archived ? .5 : 1 }}>","return <tr key={o.id} style={{ opacity:archived ? .5 : 1,background:o.is_virtual?'#fff1f2':undefined }}>")
s=s.replace("{o.customer_name}{phoneLast2 &&","{o.customer_name}{o.is_virtual&&<span className=\"badge badge-rose\" style={{marginLeft:6,fontWeight:900}}>⚠ 虛擬</span>}{phoneLast2 &&",1)
# form virtual toggle before order note
old="{cartItems.length > 0 && <div style={{ textAlign:'right',fontSize:18,fontWeight:900,color:'var(--indigo)',margin:'12px 0' }}>合計：NT${total.toLocaleString()}</div>}<div className=\"form-group\"><label>訂單備註</label>"
new="{cartItems.length > 0 && <div style={{ textAlign:'right',fontSize:18,fontWeight:900,color:'var(--indigo)',margin:'12px 0' }}>合計：NT${total.toLocaleString()}</div>}<label style={{display:'flex',alignItems:'flex-start',gap:10,padding:'12px 14px',marginBottom:12,border:'2px solid #fb7185',background:formVirtual?'#fff1f2':'#fff',borderRadius:10,cursor:'pointer'}}><input type=\"checkbox\" checked={formVirtual} onChange={e=>setFormVirtual(e.target.checked)} style={{marginTop:3}}/><span><strong style={{color:'#be123c'}}>⚠ 設為虛擬訂單</strong><div style={{fontSize:11,color:'var(--text-secondary)',marginTop:3}}>客戶尚未完全確認；不計入實際訂貨量、供應商付款與正式財務報表。確定成交後可改回正式訂單。</div></span></label><div className=\"form-group\"><label>訂單備註</label>"
if old not in s: raise SystemExit('orders note block missing')
s=s.replace(old,new,1)
p.write_text(s)

# --- Products.jsx ---
p=Path('src/pages/Products.jsx'); s=p.read_text()
s=s.replace("const[batchBuyers,setBatchBuyers]=useState([]);const[custSearch,setCustSearch]", "const[batchBuyers,setBatchBuyers]=useState([]);const[batchVirtual,setBatchVirtual]=useState(false);const[custSearch,setCustSearch]")
s=s.replace("function openAdd(){resetForm();setEditId(null);setBatchBuyers([]);setShowModal(true)}", "function openAdd(){resetForm();setEditId(null);setBatchBuyers([]);setBatchVirtual(false);setShowModal(true)}")
s=s.replace("setEditId(p.id);setBatchBuyers([]);setShowModal(true)}", "setEditId(p.id);setBatchBuyers([]);setBatchVirtual(false);setShowModal(true)}",1)
s=s.replace("total_amount:items.reduce((s,i)=>s+i.subtotal,0),note:''}})", "total_amount:items.reduce((s,i)=>s+i.subtotal,0),note:'',is_virtual:batchVirtual}})")
needle="<div style={{borderTop:'1.5px solid var(--border)',paddingTop:16,marginTop:4}}><div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🛒 一鍵批次開單（選填）</div>"
replacement=needle+"<label style={{display:'flex',gap:9,alignItems:'flex-start',padding:'10px 12px',border:'2px solid #fb7185',background:batchVirtual?'#fff1f2':'#fff',borderRadius:10,marginBottom:10,cursor:'pointer'}}><input type=\"checkbox\" checked={batchVirtual} onChange={e=>setBatchVirtual(e.target.checked)} style={{marginTop:3}}/><span><strong style={{color:'#be123c'}}>⚠ 本次批次開單全部設為虛擬訂單</strong><div style={{fontSize:11,color:'var(--text-secondary)',marginTop:2}}>虛擬數量會另外顯示，但不列入實際向廠商訂貨與付款。</div></span></label>"
if needle not in s: raise SystemExit('products batch section missing')
s=s.replace(needle,replacement,1)
p.write_text(s)

# --- SupplierPayments.jsx ---
p=Path('src/pages/SupplierPayments.jsx'); s=p.read_text()
s=s.replace("orders.filter(o=>o.status!=='cancelled'&&!o.archived).flatMap", "orders.filter(o=>o.status!=='cancelled'&&!o.archived&&!o.is_virtual).flatMap")
s=s.replace("orders.filter(o=>o.status!=='cancelled').flatMap", "orders.filter(o=>o.status!=='cancelled'&&!o.is_virtual).flatMap")
p.write_text(s)

# --- Reports.jsx ---
p=Path('src/pages/Reports.jsx'); s=p.read_text()
s=s.replace("const validOrders=orders.filter(o=>o.status!=='cancelled'),shippedOrders=validOrders.filter(o=>o.status==='shipped'),cancelledOrders=orders.filter(o=>o.status==='cancelled')", "const validOrders=orders.filter(o=>o.status!=='cancelled'&&!o.is_virtual),shippedOrders=validOrders.filter(o=>o.status==='shipped'),cancelledOrders=orders.filter(o=>o.status==='cancelled'&&!o.is_virtual),virtualOrders=orders.filter(o=>o.status!=='cancelled'&&o.is_virtual)")
s=s.replace("{loading?'讀取中...':`${orders.length} 筆訂單／${periodExpenses.length} 筆其他費用`}", "{loading?'讀取中...':`${validOrders.length} 筆正式訂單／${virtualOrders.length} 筆虛擬訂單／${periodExpenses.length} 筆其他費用`}")
p.write_text(s)

# --- PendingProductReport.jsx ---
p=Path('src/pages/PendingProductReport.jsx'); s=p.read_text()
# group virtual metadata
s=s.replace("order_ids:new Set(),\n        archived:true,", "order_ids:new Set(),\n        real_order_ids:new Set(),\n        virtual_order_ids:new Set(),\n        has_virtual:false,\n        all_virtual:true,\n        archived:true,")
s=s.replace("group.order_ids.add(order.id)\n    if (order.archived !== true) group.archived = false", "group.order_ids.add(order.id)\n    if (order.is_virtual) { group.virtual_order_ids.add(order.id); group.has_virtual = true } else { group.real_order_ids.add(order.id); group.all_virtual = false }\n    if (order.archived !== true) group.archived = false")
# detail sources
s=s.replace("arrival_color:status.color,\n        })", "arrival_color:status.color,\n          sources:[],\n        })",1)
s=s.replace("detail.dates.add(dateText(order.order_date))\n      group.total_qty", "detail.dates.add(dateText(order.order_date))\n      detail.sources.push({ order_id:order.id,item_index:(order.items || []).indexOf(item),qty:ordered,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual) })\n      group.total_qty")
s=s.replace("order_ids:Array.from(group.order_ids),\n    order_count", "order_ids:Array.from(group.order_ids),\n    real_order_ids:Array.from(group.real_order_ids),\n    virtual_order_ids:Array.from(group.virtual_order_ids),\n    order_count")
# replace buildOrderingSummary wholesale
start=s.index('function buildOrderingSummary('); end=s.index('function matchesBuyer(',start)
newfunc="""function buildOrderingSummary(orderRows, selectedProduct) {
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
"""
s=s[:start]+newfunc+s[end:]
# don't mark virtual arrival in product batch
s=s.replace("const changed = sourceOrders.filter(order => (order.items || []).some(item => matchesProduct(item,selectedProduct) && missingQty(item)>0));", "const changed = sourceOrders.filter(order => !order.is_virtual && (order.items || []).some(item => matchesProduct(item,selectedProduct) && missingQty(item)>0));")
# change shipment uses only real ids when shipping
s=s.replace("if (!row.order_ids?.length || shippingKey) return\n    const key", "const targetIds = nextStatus === 'shipped' ? (row.real_order_ids || []) : (row.order_ids || [])\n    if (!targetIds.length || shippingKey) return\n    const key")
s=s.replace("await OrdersAPI.batchUpdateStatus(row.order_ids,nextStatus)\n      toast(nextStatus === 'shipped' ? `✅ ${row.name} 的 ${row.order_ids.length} 筆訂單已出貨", "await OrdersAPI.batchUpdateStatus(targetIds,nextStatus)\n      toast(nextStatus === 'shipped' ? `✅ ${row.name} 的 ${targetIds.length} 筆正式訂單已出貨")
# the above replacement may damage template tail; fix exact known text if present
s=s.replace("並自動標記已收款` : `↩️ ${row.name} 的 ${row.order_ids.length} 筆訂單已恢復待出貨`)", "並自動標記已收款` : `↩️ ${row.name} 的 ${targetIds.length} 筆訂單已恢復待出貨`)")
# add functions before renderContact
needle="  function renderContact(c) {"
insert="""  async function setVirtualState(row,isVirtual) {
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

"""
if needle not in s: raise SystemExit('renderContact missing')
s=s.replace(needle,insert+needle,1)
# replace renderDetails function
start=s.index('  function renderDetails('); end=s.index('\n\n  const modeCardStyle',start)
newrender="""  function renderDetails(c,showProduct) { return c.items.map((item,index) => <div key={`${c.key}-${index}`} style={{padding:'7px 0',borderBottom:index<c.items.length-1?'1px dashed var(--border)':'none'}}>{showProduct && <strong style={{color:'var(--indigo)'}}>{item.product_name}　</strong>}<span style={specDisplayStyle(item.spec)}>{item.spec}</span> ×<strong>{item.qty}</strong>{shipmentView === 'pending' ? <>　<span style={{fontWeight:800,color:item.arrival_color}}>{item.arrival_label}</span>{arrivalView==='all' && item.arrival_key==='partial' && <span>（尚欠 {item.missing_qty}）</span>}</> : <span style={{fontWeight:800,color:'var(--emerald)'}}>　✅ 已出貨</span>}　{money(item.price)}／件{item.note && <span style={{color:'var(--text-secondary)'}}>　備註：{item.note}</span>}<div style={{color:'var(--text-muted)',fontSize:11}}>訂購：{item.dates.join('、')}</div>{shipmentView==='pending'&&item.sources?.map((source,i)=><div key={`${source.order_id}-${source.item_index}`} style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginTop:5,padding:'5px 7px',borderRadius:7,background:source.is_virtual?'#fff1f2':'#f8fafc'}}><span className={`badge ${source.is_virtual?'badge-rose':'badge-gray'}`}>{source.is_virtual?'⚠ 虛擬':'正式'}</span><span style={{fontSize:10,color:'var(--text-muted)'}}>{source.date}</span><span style={{fontSize:11}}>訂購量</span><input type="number" min="1" defaultValue={source.qty} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>changeSourceQty(source,e.target.value)} style={{width:70,padding:'5px 7px',fontWeight:900,textAlign:'center'}}/><span style={{fontSize:10,color:'var(--text-muted)'}}>離開欄位即儲存</span></div>)}</div>) }
"""
s=s[:start]+newrender+s[end:]
# row virtual styling / labels / operation
old="return <tr key={c.key} style={{opacity:c.archived?.62:1,background:c.archived?'#f8fafc':undefined}}><td style={{fontWeight:800,minWidth:120}}>{c.name}{c.archived&&<span className=\"badge badge-gray\" style={{marginLeft:6}}>已封存</span>}<div style={{fontSize:11,marginTop:4,color:c.archived?'#64748b':shipmentView==='shipped'?'var(--emerald)':c.all_arrived?'var(--emerald)':'#b45309'}}>{c.archived?'📦 已封存':shipmentView==='shipped'?'✅ 已出貨':c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td>"
new="return <tr key={c.key} style={{opacity:c.archived?.62:1,background:c.archived?'#f8fafc':c.has_virtual?'#fff1f2':undefined,boxShadow:c.has_virtual?'inset 5px 0 #e11d48':undefined}}><td style={{fontWeight:800,minWidth:120}}>{c.name}{c.has_virtual&&<span className=\"badge badge-rose\" style={{marginLeft:6,fontWeight:900}}>⚠ 虛擬訂單</span>}{c.archived&&<span className=\"badge badge-gray\" style={{marginLeft:6}}>已封存</span>}<div style={{fontSize:11,marginTop:4,color:c.has_virtual?'#be123c':c.archived?'#64748b':shipmentView==='shipped'?'var(--emerald)':c.all_arrived?'var(--emerald)':'#b45309'}}>{c.archived?'📦 已封存':c.all_virtual?'⚠ 虛擬數量不計入實際訂貨':c.has_virtual?'⚠ 含虛擬訂單，虛擬數量已排除訂貨':shipmentView==='shipped'?'✅ 已出貨':c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td>"
if old not in s: raise SystemExit('pending row header missing')
s=s.replace(old,new,1)
# replace pending shipment button segment
old="{shipmentView==='pending' ? <button className=\"btn btn-sm btn-primary\" disabled={Boolean(shippingKey)} onClick={() => changeRowShipment(c,'shipped')}><Truck size={13}/>{shippingKey===actionKey?'更新中...':'標記已出貨'}</button> :"
new="{shipmentView==='pending' ? <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{c.has_virtual&&<button className=\"btn btn-sm\" style={{background:'#e11d48',color:'white'}} onClick={()=>setVirtualState(c,false)}>✓ 轉正式</button>}<button className=\"btn btn-sm btn-primary\" disabled={Boolean(shippingKey)||!c.real_order_ids?.length} onClick={() => changeRowShipment(c,'shipped')}><Truck size={13}/>{!c.real_order_ids?.length?'先轉正式':shippingKey===actionKey?'更新中...':'標記已出貨'}</button></div> :"
if old not in s: raise SystemExit('pending ship button missing')
s=s.replace(old,new,1)
# ordering summary header and warning
s=s.replace("訂購 {orderingSummary.totalQty}／已到 {orderingSummary.totalArrived}／未到 {orderingSummary.totalMissing}", "實際應訂 {orderingSummary.totalQty}／虛擬 {orderingSummary.virtualQty}／已到 {orderingSummary.totalArrived}／未到 {orderingSummary.totalMissing}")
needle="<div className=\"card-body\"><div className=\"table-container\" style={{marginBottom:16}}>"
replacement="<div className=\"card-body\">{orderingSummary.virtualQty>0&&<div style={{background:'#fff1f2',border:'1px solid #fda4af',color:'#9f1239',padding:'10px 12px',borderRadius:9,marginBottom:12,fontSize:12,fontWeight:800}}>⚠ 虛擬訂單共 {orderingSummary.virtualQty} 件，僅供參考，已自動排除「實際應訂數量」與下方規格訂貨彙總。</div>}<div className=\"table-container\" style={{marginBottom:16}}>"
# replace only first occurrence after ordering summary card: use rfind before end
idx=s.find(needle,s.find('團購訂貨／到貨彙總'))
if idx<0: raise SystemExit('ordering card body missing')
s=s[:idx]+s[idx:].replace(needle,replacement,1)
p.write_text(s)

# --- Layout version ---
p=Path('src/components/Layout.jsx'); s=p.read_text()
import re
s=re.sub(r"const APP_VERSION = 'v[^']+'", "const APP_VERSION = 'v2026.08.23.12'", s, count=1)
p.write_text(s)
