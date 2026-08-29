import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import PendingProductReport from './PendingProductReportSql'
import { ProductsAPI } from '../lib/db'

export default function PendingProductReportFiltered() {
  const [showArchivedProducts,setShowArchivedProducts] = useState(false)
  const [filterReady,setFilterReady] = useState(false)
  const reportRef = useRef(null)
  const originalListRef = useRef(ProductsAPI.list)
  const qtyTimersRef = useRef(new Map())

  // 報表內部固定以 includeArchived:true 載入商品目錄。
  // 先安裝過濾器，再掛載報表，避免父子 effect 執行順序造成第一次載入仍出現封存商品。
  useEffect(() => {
    const originalList = originalListRef.current
    ProductsAPI.list = async (...args) => {
      const rows = await originalList(...args)
      return showArchivedProducts ? rows : (rows || []).filter(product => product.active !== false)
    }
    setFilterReady(true)
    return () => {
      ProductsAPI.list = originalList
    }
  },[showArchivedProducts])

  function toggleArchivedProducts() {
    setFilterReady(false)
    setShowArchivedProducts(v => !v)
  }

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
    {filterReady && <PendingProductReport key={showArchivedProducts?'with-archived-products':'active-products-only'} />}
  </div>
}
