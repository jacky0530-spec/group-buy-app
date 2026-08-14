import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, PackageSearch, Printer, Search, Users, Package, DollarSign, UserSearch, Boxes } from 'lucide-react'
import { CustomersAPI, OrdersAPI, ProductsAPI } from '../lib/db'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'

const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`
const dateText = value => value ? new Date(value).toLocaleDateString('zh-TW') : '—'

function specText(item) {
  const spec = item?.spec || {}
  return [
    spec.flavor && `口味：${spec.flavor}`,
    spec.color && `顏色：${spec.color}`,
    spec.size && `尺寸：${spec.size}`,
  ].filter(Boolean).join('／') || '一般規格'
}

function escapeCsv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

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
  const itemId = item.product_id || item.id
  const itemName = item.product_name || item.name
  return itemId === product.id || itemName === product.name
}

function buildPendingRows(pendingOrders, customerMap, selectedProduct = null) {
  const groups = new Map()

  pendingOrders.forEach(order => {
    const matches = (order.items || []).filter(item => !selectedProduct || matchesProduct(item, selectedProduct))
    if (!matches.length) return

    const customer = customerMap[order.customer_id] || {}
    const phone = String(order.customer_phone || customer.phone || '').trim()
    const last2 = String(order.customer_phone_last2 || getCustomerPhoneLast2(customer) || '').trim()
    const groupKey = order.customer_id || `${order.customer_name || customer.name || ''}|${phone || last2 || ''}`

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
        order_ids:new Set(),
      })
    }

    const group = groups.get(groupKey)
    group.order_ids.add(order.id)

    matches.forEach(item => {
      const qty = Number(item.qty || 0)
      const price = Number(item.sale_price ?? item.price ?? 0)
      const productName = item.product_name || item.name || '未命名商品'
      const note = String(item.note || '').trim()
      const spec = specText(item)
      const detailKey = [productName, spec, price, note].join('|')

      if (!group.items.has(detailKey)) {
        group.items.set(detailKey, {
          product_name:productName,
          spec,
          note,
          price,
          qty:0,
          amount:0,
          dates:new Set(),
        })
      }

      const detail = group.items.get(detailKey)
      detail.qty += qty
      detail.amount += price * qty
      detail.dates.add(dateText(order.order_date))
      group.total_qty += qty
      group.total_amount += price * qty
    })
  })

  return Array.from(groups.values()).map(group => ({
    ...group,
    items:Array.from(group.items.values()).map(item => ({ ...item, dates:Array.from(item.dates) })),
    order_count:group.order_ids.size,
  })).sort((a,b) => a.name.localeCompare(b.name, 'zh-Hant'))
}

function increment(map, key, qty) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + qty)
}

function mapToRows(map) {
  return Array.from(map.entries())
    .map(([label, qty]) => ({ label, qty }))
    .sort((a,b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric:true }))
}

function buildOrderingSummary(pendingOrders, selectedProduct) {
  if (!selectedProduct) return { combos:[], colors:[], sizes:[], flavors:[], totalQty:0, totalAmount:0 }

  const combos = new Map()
  const colors = new Map()
  const sizes = new Map()
  const flavors = new Map()
  let totalQty = 0
  let totalAmount = 0

  pendingOrders.forEach(order => {
    ;(order.items || []).filter(item => matchesProduct(item, selectedProduct)).forEach(item => {
      const spec = item.spec || {}
      const flavor = String(spec.flavor || '').trim()
      const color = String(spec.color || '').trim()
      const size = String(spec.size || '').trim()
      const qty = Number(item.qty || 0)
      const price = Number(item.sale_price ?? item.price ?? 0)
      const comboKey = [flavor, color, size].join('|')
      const comboLabel = [
        flavor && `口味：${flavor}`,
        color && `顏色：${color}`,
        size && `尺寸：${size}`,
      ].filter(Boolean).join('／') || '一般規格'

      if (!combos.has(comboKey)) combos.set(comboKey, { label:comboLabel, flavor, color, size, qty:0, amount:0 })
      const combo = combos.get(comboKey)
      combo.qty += qty
      combo.amount += price * qty

      increment(flavors, flavor, qty)
      increment(colors, color, qty)
      increment(sizes, size, qty)
      totalQty += qty
      totalAmount += price * qty
    })
  })

  return {
    combos:Array.from(combos.values()).sort((a,b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric:true })),
    colors:mapToRows(colors),
    sizes:mapToRows(sizes),
    flavors:mapToRows(flavors),
    totalQty,
    totalAmount,
  }
}

function matchesBuyer(row, search) {
  const q = String(search || '').trim().toLowerCase()
  if (!q) return true
  return [row.name, row.phone, row.phone_last2, row.line_nick, row.fb_name]
    .some(value => String(value || '').toLowerCase().includes(q))
}

function DimensionSummary({ title, rows }) {
  if (!rows.length) return null
  return <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
    <div style={{ background:'var(--surface-2)', padding:'9px 12px', fontSize:13, fontWeight:800 }}>{title}</div>
    <div style={{ padding:'8px 12px' }}>
      {rows.map(row => <div key={row.label} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'5px 0', borderBottom:'1px dashed var(--border)' }}><span>{row.label}</span><strong>{row.qty} 件</strong></div>)}
    </div>
  </div>
}

export default function PendingProductReport() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('product')
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [productBuyerSearch, setProductBuyerSearch] = useState('')
  const [buyerSearch, setBuyerSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [orderRows, productRows, customerRows] = await Promise.all([
        OrdersAPI.list(),
        ProductsAPI.list({ includeArchived:true }),
        CustomersAPI.list({ includeArchived:true }),
      ])
      setOrders(orderRows)
      setProducts(productRows)
      setCustomers(customerRows)
    } catch (err) {
      setError(`未出貨報表載入失敗：${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const pendingOrders = useMemo(
    () => orders.filter(order => order.status === 'pending' && order.archived !== true),
    [orders],
  )

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map(customer => [customer.id, customer])),
    [customers],
  )

  const productOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    const idsInPending = new Set()
    const namesInPending = new Set()
    pendingOrders.forEach(order => (order.items || []).forEach(item => {
      if (item.product_id || item.id) idsInPending.add(item.product_id || item.id)
      if (item.product_name || item.name) namesInPending.add(item.product_name || item.name)
    }))

    return products
      .filter(product => idsInPending.has(product.id) || namesInPending.has(product.name))
      .filter(product => !q || product.name.toLowerCase().includes(q))
      .sort((a,b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [products, pendingOrders, productSearch])

  const productRows = useMemo(
    () => selectedProduct ? buildPendingRows(pendingOrders, customerMap, selectedProduct) : [],
    [selectedProduct, pendingOrders, customerMap],
  )

  const filteredProductRows = useMemo(
    () => productRows.filter(row => matchesBuyer(row, productBuyerSearch)),
    [productRows, productBuyerSearch],
  )

  const buyerRows = useMemo(
    () => buildPendingRows(pendingOrders, customerMap),
    [pendingOrders, customerMap],
  )

  const filteredBuyerRows = useMemo(
    () => buyerRows.filter(row => matchesBuyer(row, buyerSearch)),
    [buyerRows, buyerSearch],
  )

  const orderingSummary = useMemo(
    () => buildOrderingSummary(pendingOrders, selectedProduct),
    [pendingOrders, selectedProduct],
  )

  const currentRows = mode === 'product' ? filteredProductRows : filteredBuyerRows
  const summary = useMemo(() => ({
    customers:currentRows.length,
    qty:currentRows.reduce((sum,row) => sum + row.total_qty, 0),
    amount:currentRows.reduce((sum,row) => sum + row.total_amount, 0),
  }), [currentRows])

  const canOutput = mode === 'product' ? Boolean(selectedProduct && currentRows.length) : Boolean(currentRows.length)
  const reportLabel = mode === 'product' ? (selectedProduct?.name || '未選商品') : (buyerSearch.trim() ? `買家搜尋：${buyerSearch.trim()}` : '全部未出貨買家')

  function exportCurrent() {
    if (!canOutput) return
    const rows = [['客戶','手機','手機末碼','Line','FB','商品','規格/口味','備註','訂購日期','數量','單價','小計']]
    currentRows.forEach(customer => {
      customer.items.forEach(item => rows.push([
        customer.name,
        customer.phone,
        customer.phone_last2,
        customer.line_nick,
        customer.fb_name,
        item.product_name,
        item.spec,
        item.note,
        item.dates.join('、'),
        item.qty,
        item.price,
        item.amount,
      ]))
    })

    if (mode === 'product') {
      rows.push([], ['團購訂貨彙總'], ['規格組合','數量','金額'])
      orderingSummary.combos.forEach(row => rows.push([row.label, row.qty, row.amount]))
      ;[
        ['口味小計', orderingSummary.flavors],
        ['顏色小計', orderingSummary.colors],
        ['尺寸小計', orderingSummary.sizes],
      ].forEach(([title, detailRows]) => {
        if (!detailRows.length) return
        rows.push([], [title,'數量'])
        detailRows.forEach(row => rows.push([row.label, row.qty]))
      })
      rows.push([], ['未出貨總件數', orderingSummary.totalQty], ['未出貨總金額', orderingSummary.totalAmount])
    }

    const filename = mode === 'product' ? `未出貨-${selectedProduct.name}.csv` : `未出貨-買家查詢${buyerSearch.trim() ? `-${buyerSearch.trim()}` : ''}.csv`
    downloadCsv(rows, filename)
  }

  function renderContact(customer) {
    return <>
      {customer.phone ? <div>{customer.phone}</div> : customer.phone_last2 ? <div>末碼 {customer.phone_last2}</div> : <div>—</div>}
      {customer.phone && customer.phone_last2 && <div style={{ color:'var(--text-muted)' }}>末碼 {customer.phone_last2}</div>}
      {customer.line_nick && <div style={{ color:'var(--text-muted)' }}>Line：{customer.line_nick}</div>}
      {customer.fb_name && <div style={{ color:'var(--text-muted)' }}>FB：{customer.fb_name}</div>}
    </>
  }

  function renderDetails(customer, showProductName) {
    return customer.items.map((item,index) => (
      <div key={`${customer.key}-${index}`} style={{ padding:'5px 0', borderBottom:index < customer.items.length - 1 ? '1px dashed var(--border)' : 'none' }}>
        {showProductName && <strong style={{ color:'var(--indigo)' }}>{item.product_name}　</strong>}
        <strong>{item.spec}</strong> ×{item.qty}　{money(item.price)}／件　<span style={{ fontWeight:700 }}>{money(item.amount)}</span>
        {item.note && <span style={{ color:'var(--text-secondary)' }}>　備註：{item.note}</span>}
        <div style={{ color:'var(--text-muted)', fontSize:11 }}>訂購：{item.dates.join('、')}</div>
      </div>
    ))
  }

  return (
    <div className="animate-fade">
      <div className="no-print" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800 }}>未出貨查詢報表</h2>
          <p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>依商品或買家查詢所有尚未出貨的訂購明細</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost" disabled={!canOutput} onClick={exportCurrent}><Download size={14}/>匯出 CSV</button>
          <button className="btn btn-primary" disabled={!canOutput} onClick={() => window.print()}><Printer size={14}/>列印</button>
        </div>
      </div>

      {error && <div className="no-print" style={{ background:'var(--rose-light)', color:'var(--rose)', padding:12, borderRadius:8, marginBottom:14 }}>{error}</div>}

      <div className="tabs no-print" style={{ marginBottom:16 }}>
        <button className={`tab ${mode === 'product' ? 'active' : ''}`} onClick={() => setMode('product')}>📦 依商品查詢</button>
        <button className={`tab ${mode === 'buyer' ? 'active' : ''}`} onClick={() => setMode('buyer')}>👥 依買家查詢</button>
      </div>

      {mode === 'product' && <div className="card no-print" style={{ marginBottom:16 }}>
        <div className="card-header" style={{ fontWeight:800 }}>挑選有未出貨訂單的商品</div>
        <div className="card-body">
          <div className="search-input-wrap" style={{ marginBottom:10 }}>
            <Search size={14}/>
            <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="搜尋商品..." style={{ padding:'8px 8px 8px 32px', width:'100%' }}/>
          </div>
          <div style={{ display:'flex', gap:7, flexWrap:'wrap', maxHeight:210, overflowY:'auto' }}>
            {loading && <span style={{ color:'var(--text-muted)' }}>讀取中...</span>}
            {!loading && productOptions.length === 0 && <span style={{ color:'var(--text-muted)' }}>目前沒有符合的未出貨商品</span>}
            {productOptions.map(product => <button key={product.id} className={`btn btn-sm ${selectedProduct?.id === product.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSelectedProduct(product)}>{product.name}{product.active === false ? '（已封存商品）' : ''}</button>)}
          </div>
        </div>
      </div>}

      {mode === 'buyer' && <div className="card no-print" style={{ marginBottom:16 }}>
        <div className="card-header" style={{ fontWeight:800 }}><UserSearch size={16}/>搜尋未出貨買家</div>
        <div className="card-body">
          <div className="search-input-wrap">
            <Search size={14}/>
            <input autoFocus value={buyerSearch} onChange={e => setBuyerSearch(e.target.value)} placeholder="姓名／完整手機／手機末兩碼／Line／FB，例如輸入 12" style={{ padding:'10px 10px 10px 34px', width:'100%' }}/>
          </div>
          <div style={{ color:'var(--text-muted)', fontSize:12, marginTop:8 }}>同一手機末兩碼若有多人，會分別顯示姓名與聯絡辨識資料供挑選。</div>
        </div>
      </div>}

      {(mode === 'buyer' || selectedProduct) && <>
        <div className="print-only" style={{ display:'none' }}>
          <h2 style={{ marginBottom:6 }}>未出貨查詢報表</h2>
          <div style={{ marginBottom:8 }}>{reportLabel}　列印日期：{new Date().toLocaleDateString('zh-TW')}</div>
          <div style={{ marginBottom:12, fontWeight:700 }}>共 {summary.customers} 位客戶／{summary.qty} 件／合計 {money(summary.amount)}</div>
          <table>
            <thead><tr><th>客戶</th><th>手機</th><th>商品 / 訂購明細</th><th>數量</th><th>小計</th></tr></thead>
            <tbody>{currentRows.map(customer => <tr key={`print-${customer.key}`}><td><strong>{customer.name}</strong></td><td>{customer.phone || (customer.phone_last2 ? `末碼 ${customer.phone_last2}` : '—')}</td><td>{customer.items.map((item,index) => <div key={`print-${customer.key}-${index}`}>{mode === 'buyer' && <strong>{item.product_name}　</strong>}{item.spec} ×{item.qty}　{money(item.price)}/件{item.note ? `　${item.note}` : ''}<br/><small>訂購：{item.dates.join('、')}</small></div>)}</td><td><strong>{customer.total_qty}</strong></td><td><strong>{money(customer.total_amount)}</strong></td></tr>)}</tbody>
            {currentRows.length > 0 && <tfoot><tr><td colSpan={3} style={{ textAlign:'right', fontWeight:800 }}>合計</td><td style={{ fontWeight:900 }}>{summary.qty}</td><td style={{ fontWeight:900 }}>{money(summary.amount)}</td></tr></tfoot>}
          </table>

          {mode === 'product' && orderingSummary.combos.length > 0 && <div style={{ marginTop:18 }}>
            <h3 style={{ marginBottom:8 }}>團購訂貨彙總</h3>
            <div style={{ marginBottom:8 }}>此商品全部未出貨訂單：{orderingSummary.totalQty} 件／{money(orderingSummary.totalAmount)}</div>
            <table>
              <thead><tr><th>規格組合</th><th>數量</th><th>金額</th></tr></thead>
              <tbody>{orderingSummary.combos.map(row => <tr key={`print-combo-${row.label}`}><td>{row.label}</td><td><strong>{row.qty}</strong></td><td>{money(row.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td style={{ textAlign:'right', fontWeight:800 }}>總計</td><td style={{ fontWeight:900 }}>{orderingSummary.totalQty}</td><td style={{ fontWeight:900 }}>{money(orderingSummary.totalAmount)}</td></tr></tfoot>
            </table>
          </div>}
        </div>

        <div className="no-print" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:12, marginBottom:16 }}>
          <div style={{ background:'var(--indigo-light)', borderRadius:10, padding:14, position:'relative' }}><div style={{ fontSize:12, fontWeight:700, color:'var(--indigo)' }}>未出貨客戶</div><strong style={{ fontSize:22, color:'var(--indigo)' }}>{summary.customers} 位</strong><Users size={25} style={{ position:'absolute', right:12, top:15, opacity:.25 }}/></div>
          <div style={{ background:'var(--amber-light)', borderRadius:10, padding:14, position:'relative' }}><div style={{ fontSize:12, fontWeight:700, color:'#b45309' }}>未出貨數量</div><strong style={{ fontSize:22, color:'#b45309' }}>{summary.qty} 件</strong><Package size={25} style={{ position:'absolute', right:12, top:15, opacity:.25 }}/></div>
          <div style={{ background:'var(--emerald-light)', borderRadius:10, padding:14, position:'relative' }}><div style={{ fontSize:12, fontWeight:700, color:'var(--emerald)' }}>訂購金額</div><strong style={{ fontSize:22, color:'var(--emerald)' }}>{money(summary.amount)}</strong><DollarSign size={25} style={{ position:'absolute', right:12, top:15, opacity:.25 }}/></div>
        </div>

        {mode === 'product' && <div className="search-input-wrap no-print" style={{ maxWidth:500, marginBottom:14 }}><Search size={14}/><input value={productBuyerSearch} onChange={e => setProductBuyerSearch(e.target.value)} placeholder="在此商品名單中搜尋姓名、手機、末兩碼、Line、FB..." style={{ padding:'8px 8px 8px 32px', width:'100%' }}/></div>}

        <div className="card no-print" style={{ marginBottom:16 }}>
          <div className="card-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <strong><PackageSearch size={15} style={{ verticalAlign:'middle', marginRight:6 }}/>{reportLabel}</strong>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>共 {summary.customers} 位／{summary.qty} 件／{money(summary.amount)}</span>
          </div>
          <div className="table-container">
            <table>
              <thead><tr><th>客戶</th><th>手機辨識</th><th>訂購明細</th><th>訂單數</th><th>數量</th><th>小計</th></tr></thead>
              <tbody>
                {!loading && currentRows.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:32, color:'var(--text-muted)' }}>{mode === 'product' ? '此商品目前沒有符合的未出貨客戶' : '找不到符合的未出貨買家'}</td></tr>}
                {currentRows.map(customer => <tr key={customer.key}><td style={{ fontWeight:800, minWidth:110 }}>{customer.name}</td><td style={{ minWidth:140, fontSize:12 }}>{renderContact(customer)}</td><td style={{ minWidth:320, fontSize:12 }}>{renderDetails(customer, mode === 'buyer')}</td><td>{customer.order_count}</td><td style={{ fontWeight:800 }}>{customer.total_qty}</td><td style={{ fontWeight:900, color:'var(--indigo)' }}>{money(customer.total_amount)}</td></tr>)}
              </tbody>
              {currentRows.length > 0 && <tfoot><tr><td colSpan={4} style={{ textAlign:'right', fontWeight:800 }}>合計</td><td style={{ fontWeight:900 }}>{summary.qty}</td><td style={{ fontWeight:900, color:'var(--indigo)' }}>{money(summary.amount)}</td></tr></tfoot>}
            </table>
          </div>
        </div>

        {mode === 'product' && orderingSummary.combos.length > 0 && <div className="card no-print">
          <div className="card-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <strong><Boxes size={16} style={{ verticalAlign:'middle', marginRight:7 }}/>團購訂貨彙總（供應商下單用）</strong>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>全部未出貨：{orderingSummary.totalQty} 件／{money(orderingSummary.totalAmount)}</span>
          </div>
          <div className="card-body">
            <div style={{ background:'var(--amber-light)', color:'#92400e', borderRadius:8, padding:'9px 11px', fontSize:12, marginBottom:14 }}>此區依「{selectedProduct.name}」全部未出貨訂單統計，不受上方客戶搜尋篩選影響，可直接作為向供應商下單的數量依據。</div>

            <div className="table-container" style={{ marginBottom:16 }}>
              <table>
                <thead><tr><th>規格組合</th><th>口味</th><th>顏色</th><th>尺寸</th><th>訂購數量</th><th>金額</th></tr></thead>
                <tbody>{orderingSummary.combos.map(row => <tr key={row.label}><td style={{ fontWeight:800 }}>{row.label}</td><td>{row.flavor || '—'}</td><td>{row.color || '—'}</td><td>{row.size || '—'}</td><td style={{ fontWeight:900, color:'var(--indigo)' }}>{row.qty} 件</td><td>{money(row.amount)}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={4} style={{ textAlign:'right', fontWeight:800 }}>總計</td><td style={{ fontWeight:900, color:'var(--indigo)' }}>{orderingSummary.totalQty} 件</td><td style={{ fontWeight:900 }}>{money(orderingSummary.totalAmount)}</td></tr></tfoot>
              </table>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12 }}>
              <DimensionSummary title="口味小計" rows={orderingSummary.flavors}/>
              <DimensionSummary title="顏色小計" rows={orderingSummary.colors}/>
              <DimensionSummary title="尺寸小計" rows={orderingSummary.sizes}/>
            </div>
          </div>
        </div>}
      </>}
    </div>
  )
}
