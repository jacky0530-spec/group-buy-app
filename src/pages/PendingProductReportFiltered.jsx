import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import PendingProductReport from './PendingProductReportSql'
import { OrdersAPI, ProductsAPI } from '../lib/db'

const ARRIVAL_BUTTONS = {
  '全部待出貨': 'all',
  '已到貨可取貨': 'arrived',
  '尚未到貨': 'missing',
}

export default function PendingProductReportFiltered() {
  const [showArchivedProducts,setShowArchivedProducts] = useState(false)
  const [arrivalCatalogView,setArrivalCatalogView] = useState('all')
  const [filterReady,setFilterReady] = useState(false)
  const reportRef = useRef(null)
  const originalListRef = useRef(ProductsAPI.list)
  const originalSearchPageRef = useRef(OrdersAPI.searchPage)
  const qtyTimersRef = useRef(new Map())

  // 報表內部固定以 includeArchived:true 載入商品目錄。
  // 同時讓「全部待出貨 / 已到貨可取貨 / 尚未到貨」各自重建真正有數量的商品目錄。
  useEffect(() => {
    const originalList = originalListRef.current
    const originalSearchPage = originalSearchPageRef.current

    ProductsAPI.list = async (...args) => {
      const rows = await originalList(...args)
      return showArchivedProducts ? rows : (rows || []).filter(product => product.active !== false)
    }

    OrdersAPI.searchPage = async (params = {}) => {
      const page = await originalSearchPage(params)
      const isPendingCatalogQuery = params?.status === 'pending'
        && !params?.productId
        && !String(params?.search || '').trim()

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

  // 監聽到貨分頁；切換時重新掛載 SQL 報表，讓候選商品目錄與該分頁同步。
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

  // 報表重新掛載後，把內部 arrivalView 恢復到使用者剛選的分頁。
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

  // 小幫手/訂單備註在出貨畫面一律用紅字提醒。
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

  // V28：所有規格小計（組合／口味／顏色／尺寸）都維持原本「X 件」文字，只把件數靠近規格名稱。
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

  // 訂購量停止輸入約 450ms 後自動觸發同一個 focusout 儲存流程。
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
