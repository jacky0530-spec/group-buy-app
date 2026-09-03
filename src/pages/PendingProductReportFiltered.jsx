import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import PendingProductReport from './PendingProductReportSql'
import { OrdersAPI, ProductsAPI } from '../lib/db'

const ARRIVAL_BUTTONS = {
  '全部待出貨': 'all',
  '已到貨可取貨': 'arrived',
  '尚未到貨': 'missing',
}

function money(value){
  return `NT$${Math.round(Number(value||0)).toLocaleString()}`
}

function releasedPickupPage(page,status=''){
  return {
    ...page,
    rows:(page?.rows||[]).map(order=>{
      const sourceItems=order.items||[]
      if(status==='shipped'){
        const activeItems=[]
        const releasedItems=[]
        sourceItems.forEach(item=>{
          const qty=Math.max(0,Number(item?.qty||0))
          const released=Math.min(qty,Math.max(0,Number(item?.released_qty||0)))
          if(!(qty>0&&released>0)){
            activeItems.push(item)
            return
          }
          const originalName=String(item.original_product_name||item.product_name||item.name||'商品')
          const originalPrice=Number(item.sale_price??item.price??0)
          const pickupQty=Math.max(0,qty-released)
          if(pickupQty>0){
            activeItems.push({
              ...item,
              original_product_name:originalName,
              product_name:originalName,
              name:originalName,
              qty:pickupQty,
              arrived_qty:Math.min(pickupQty,Math.max(0,Number(item.arrived_qty||pickupQty))),
              subtotal:originalPrice*pickupQty,
              pickup_original_qty:qty,
              pickup_released_qty:released,
            })
          }
          const releaseLabel=released>=qty
            ? `${originalName}　🟣 已釋出（原價 ${money(originalPrice)}／件，不計取貨小計）`
            : `${originalName}　🟣 已釋出 ${released}/${qty}（原價 ${money(originalPrice)}／件，不計取貨小計）`
          releasedItems.push({
            ...item,
            original_product_name:originalName,
            product_name:releaseLabel,
            name:releaseLabel,
            qty:released,
            arrived_qty:released,
            sale_price:0,
            price:0,
            subtotal:0,
            pickup_original_price:originalPrice,
            pickup_original_qty:qty,
            pickup_released_qty:released,
            pickup_release_marker:true,
          })
        })
        return {...order,items:[...activeItems,...releasedItems]}
      }
      return {
        ...order,
        items:sourceItems.map(item=>{
          const qty=Math.max(0,Number(item?.qty||0))
          const released=Math.min(qty,Math.max(0,Number(item?.released_qty||0)))
          if(!(qty>0&&released>0))return item
          const originalName=String(item.original_product_name||item.product_name||item.name||'商品')
          const originalPrice=Number(item.sale_price??item.price??0)
          const pickupQty=Math.max(0,qty-released)
          const pickupRate=qty>0?pickupQty/qty:0
          const label=released>=qty
            ? `${originalName}　🟣 已釋出（原價 ${money(originalPrice)}）`
            : `${originalName}　🟣 已釋出 ${released}/${qty}（原價 ${money(originalPrice)}）`
          return {
            ...item,
            original_product_name:originalName,
            product_name:label,
            name:label,
            pickup_original_price:originalPrice,
            pickup_released_qty:released,
            pickup_qty:pickupQty,
            sale_price:originalPrice*pickupRate,
            price:originalPrice*pickupRate,
            subtotal:originalPrice*pickupQty,
          }
        }),
      }
    }),
  }
}

function taipeiDateLabel(value) {
  const date = new Date(value || '')
  if (!Number.isFinite(date.getTime())) return '日期未記錄'
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const read = type => parts.find(part => part.type === type)?.value || ''
  return `${read('year')}/${read('month')}/${read('day')}`
}

function shippedTimestamp(order) {
  const value = order?.shipped_at || order?.updated_at || order?.order_date || order?.created_at || ''
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function productNameOfItem(item) {
  return String(item?.original_product_name || item?.product_name || item?.name || '').trim()
}

export default function PendingProductReportFiltered() {
  const [showArchivedProducts,setShowArchivedProducts] = useState(false)
  const [arrivalCatalogView,setArrivalCatalogView] = useState('all')
  const [filterReady,setFilterReady] = useState(false)
  const reportRef = useRef(null)
  const originalListRef = useRef(ProductsAPI.list)
  const originalSearchPageRef = useRef(OrdersAPI.searchPage)
  const qtyTimersRef = useRef(new Map())
  const shippedProductDatesRef = useRef(new Map())

  // 報表內部固定以 includeArchived:true 載入商品目錄。
  // 同時讓「全部待出貨 / 已到貨可取貨 / 尚未到貨」各自重建真正有數量的商品目錄。
  // V43/V44：已出貨商品依出貨日期分組；V45：已釋出品項仍顯示，但排除取貨應收小計。
  useEffect(() => {
    const originalList = originalListRef.current
    const originalSearchPage = originalSearchPageRef.current

    ProductsAPI.list = async (...args) => {
      const rows = await originalList(...args)
      return showArchivedProducts ? rows : (rows || []).filter(product => product.active !== false)
    }

    OrdersAPI.searchPage = async (params = {}) => {
      const page = releasedPickupPage(await originalSearchPage(params),params?.status)
      const isPendingCatalogQuery = params?.status === 'pending'
        && !params?.productId
        && !String(params?.search || '').trim()
      const isShippedCatalogQuery = params?.status === 'shipped'
        && !params?.productId
        && !String(params?.search || '').trim()

      if (isShippedCatalogQuery) {
        const offset = Number(params?.cursor?.offset || 0)
        if (!offset) shippedProductDatesRef.current = new Map()
        const dateMap = shippedProductDatesRef.current
        ;(page?.rows || []).forEach(order => {
          const time = shippedTimestamp(order)
          const label = taipeiDateLabel(order?.shipped_at || order?.updated_at || order?.order_date || order?.created_at)
          ;(order.items || []).forEach(item => {
            if (Math.max(0, Number(item?.qty || 0)) <= 0) return
            const name = productNameOfItem(item)
            if (!name) return
            const previous = dateMap.get(name)
            if (!previous || time > previous.time) dateMap.set(name,{ time,label })
          })
        })
      }

      if (!isPendingCatalogQuery || arrivalCatalogView === 'all') return page

      const rows = (page?.rows || []).map(order => {
        const items = (order.items || []).filter(item => {
          const qty = Math.max(0, Number(item?.qty || 0))
          const arrived = Math.min(qty, Math.max(0, Number(item?.arrived_qty || 0)))
          if (arrivalCatalogView === 'arrived') return arrived > 0
          return qty - arrived > 0
        })
        return items.length ? { ...order, items } : null
      }).filter(Boolean)

      return { ...page, rows }
    }

    setFilterReady(true)
    return () => {
      ProductsAPI.list = originalList
      OrdersAPI.searchPage = originalSearchPage
    }
  },[showArchivedProducts,arrivalCatalogView])

  function toggleArchivedProducts() {
    setFilterReady(false)
    setShowArchivedProducts(v => !v)
  }

  useEffect(() => {
    const root = reportRef.current
    if (!root) return undefined
    const onClick = event => {
      const button = event.target.closest('button')
      if (!button) return
      const next = ARRIVAL_BUTTONS[String(button.textContent || '').trim()]
      if (!next || next === arrivalCatalogView) return
      setFilterReady(false)
      setArrivalCatalogView(next)
    }
    root.addEventListener('click',onClick,true)
    return () => root.removeEventListener('click',onClick,true)
  },[arrivalCatalogView])

  useEffect(() => {
    if (!filterReady || arrivalCatalogView === 'all') return undefined
    const timer = window.setTimeout(() => {
      const root = reportRef.current
      if (!root) return
      const label = arrivalCatalogView === 'arrived' ? '已到貨可取貨' : '尚未到貨'
      const button = Array.from(root.querySelectorAll('button')).find(el => String(el.textContent || '').trim() === label)
      button?.click()
    },0)
    return () => window.clearTimeout(timer)
  },[filterReady,arrivalCatalogView])

  // V44：已出貨商品候選清單依「最近一次實際出貨日」由舊到新排列，日期較遠（較早）的商品優先顯示。
  useEffect(() => {
    const root = reportRef.current
    if (!root) return undefined

    const enhanceShippedCatalog = () => {
      const header = Array.from(root.querySelectorAll('.card-header')).find(el => String(el.textContent || '').trim() === '挑選有已出貨訂單的商品')
      const card = header?.closest('.card')
      const body = card?.querySelector('.card-body')
      if (!body) return
      const list = Array.from(body.children).find(el => el instanceof HTMLElement && el.style.display === 'flex' && el.style.flexWrap === 'wrap')
      if (!list) return

      list.querySelectorAll('[data-shipped-date-divider="1"]').forEach(el => el.remove())
      const buttons = Array.from(list.children).filter(el => el instanceof HTMLButtonElement)
      buttons.forEach(button => { button.style.order = '' })
      if (!buttons.length) return

      const groups = new Map()
      buttons.forEach(button => {
        const name = String(button.textContent || '').replace(/（已封存）\s*$/,'').trim()
        const info = shippedProductDatesRef.current.get(name) || { time:0,label:'日期未記錄' }
        if (!groups.has(info.label)) groups.set(info.label,{ label:info.label,time:info.time,buttons:[] })
        const group = groups.get(info.label)
        group.time = Math.max(group.time,info.time)
        group.buttons.push({button,name})
      })

      const orderedGroups = Array.from(groups.values()).sort((a,b) => {
        if (a.label === '日期未記錄') return 1
        if (b.label === '日期未記錄') return -1
        return a.time - b.time || a.label.localeCompare(b.label,'zh-Hant')
      })

      orderedGroups.forEach((group,index) => {
        const baseOrder = index * 1000
        const divider = document.createElement('div')
        divider.dataset.shippedDateDivider = '1'
        divider.style.order = String(baseOrder)
        divider.style.flexBasis = '100%'
        divider.style.width = '100%'
        divider.style.display = 'flex'
        divider.style.alignItems = 'center'
        divider.style.gap = '10px'
        divider.style.margin = index === 0 ? '2px 0 7px' : '10px 0 7px'
        divider.style.color = '#64748b'
        divider.style.fontSize = '12px'
        divider.style.fontWeight = '800'

        const leftLine = document.createElement('span')
        leftLine.style.flex = '1'
        leftLine.style.borderTop = '1px solid #cbd5e1'
        const label = document.createElement('strong')
        label.textContent = group.label === '日期未記錄' ? '出貨日期未記錄' : `出貨日期 ${group.label}`
        label.style.whiteSpace = 'nowrap'
        label.style.color = '#475569'
        const rightLine = document.createElement('span')
        rightLine.style.flex = '1'
        rightLine.style.borderTop = '1px solid #cbd5e1'
        divider.append(leftLine,label,rightLine)
        list.appendChild(divider)

        group.buttons
          .sort((a,b) => a.name.localeCompare(b.name,'zh-Hant',{numeric:true}))
          .forEach(({button},buttonIndex) => {
            button.style.order = String(baseOrder + 1 + buttonIndex)
          })
      })
    }

    enhanceShippedCatalog()
    const observer = new MutationObserver(() => {
      observer.disconnect()
      enhanceShippedCatalog()
      observer.observe(root,{ childList:true,subtree:true })
    })
    observer.observe(root,{ childList:true,subtree:true })
    return () => {
      observer.disconnect()
      root.querySelectorAll('[data-shipped-date-divider="1"]').forEach(el => el.remove())
      root.querySelectorAll('button').forEach(button => {
        if (button.style.order) button.style.order = ''
      })
    }
  },[filterReady,showArchivedProducts])

  useEffect(() => {
    const root = reportRef.current
    if (!root) return undefined
    const highlightNotes = () => {
      root.querySelectorAll('span').forEach(el => {
        if (String(el.textContent || '').trim().startsWith('備註：')) {
          el.style.color = '#dc2626'
          el.style.fontWeight = '800'
        }
      })
    }
    highlightNotes()
    const observer = new MutationObserver(highlightNotes)
    observer.observe(root,{ childList:true,subtree:true,characterData:true })
    return () => observer.disconnect()
  },[])

  useEffect(() => {
    const root = reportRef.current
    if (!root) return undefined
    const alignDimensionSummaries = () => {
      const titles = Array.from(root.querySelectorAll('div')).filter(el => ['組合小計','口味小計','顏色小計','尺寸小計'].includes(String(el.textContent || '').trim()))
      titles.forEach(title => {
        const body = title.nextElementSibling
        if (!body) return
        Array.from(body.children).forEach(row => {
          if (!(row instanceof HTMLElement)) return
          row.style.justifyContent = 'flex-start'
          row.style.alignItems = 'center'
          row.style.gap = '20px'
        })
      })
    }
    alignDimensionSummaries()
    const observer = new MutationObserver(alignDimensionSummaries)
    observer.observe(root,{ childList:true,subtree:true })
    return () => observer.disconnect()
  },[])

  useEffect(() => {
    const root = reportRef.current
    if (!root) return undefined
    const timers = qtyTimersRef.current

    const bindQtyInputs = () => {
      root.querySelectorAll('input[type="number"]').forEach(input => {
        if (input.dataset.pendingQtyAutosave === '1') return
        const row = input.parentElement
        if (!row || !String(row.textContent || '').includes('訂購量')) return
        input.dataset.pendingQtyAutosave = '1'
        const onInput = () => {
          const previous = timers.get(input)
          if (previous) window.clearTimeout(previous)
          const timer = window.setTimeout(() => {
            timers.delete(input)
            if (!input.isConnected) return
            input.dispatchEvent(new FocusEvent('focusout',{ bubbles:true,relatedTarget:null }))
          },450)
          timers.set(input,timer)
        }
        input.addEventListener('input',onInput)
        input.__pendingQtyAutosaveCleanup = () => input.removeEventListener('input',onInput)
      })
    }

    bindQtyInputs()
    const observer = new MutationObserver(bindQtyInputs)
    observer.observe(root,{ childList:true,subtree:true })
    return () => {
      observer.disconnect()
      timers.forEach(timer => window.clearTimeout(timer))
      timers.clear()
      root.querySelectorAll('input[data-pending-qty-autosave="1"]').forEach(input => {
        input.__pendingQtyAutosaveCleanup?.()
      })
    }
  },[])

  return <div ref={reportRef}>
    <div className="no-print" style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:10,marginBottom:10}}>
      <button
        type="button"
        className={`btn btn-sm ${showArchivedProducts?'btn-primary':'btn-ghost'}`}
        onClick={toggleArchivedProducts}
      >
        {showArchivedProducts ? <><ArchiveRestore size={13}/>隱藏封存商品</> : <><Archive size={13}/>顯示封存商品</>}
      </button>
      <span style={{fontSize:12,color:'var(--text-muted)'}}>
        {showArchivedProducts ? '目前包含已封存商品' : '封存商品預設隱藏'}
      </span>
    </div>
    {filterReady && <PendingProductReport key={`${showArchivedProducts?'with-archived-products':'active-products-only'}-${arrivalCatalogView}`} />}
  </div>
}
