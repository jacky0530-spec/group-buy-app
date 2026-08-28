import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import PendingProductReport from './PendingProductReport'
import { ProductsAPI } from '../lib/db'

export default function PendingProductReportFiltered() {
  const [showArchivedProducts,setShowArchivedProducts] = useState(false)
  const reportRef = useRef(null)
  const originalListRef = useRef(ProductsAPI.list)

  // PendingProductReport 內部固定用 includeArchived:true 載入商品。
  // 因子元件 effect 可能早於父元件 effect 執行，這裡在 render 階段先安裝
  // 一個穩定 wrapper，確保子元件第一次 load 就套用目前的封存顯示設定。
  const originalList = originalListRef.current
  ProductsAPI.list = async (...args) => {
    const rows = await originalList(...args)
    return showArchivedProducts ? rows : (rows || []).filter(product => product.active !== false)
  }

  useEffect(() => () => {
    ProductsAPI.list = originalListRef.current
  },[])

  // 小幫手/訂單備註在出貨畫面一律用紅字提醒，避免「私」等重要註記被忽略。
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

  return <div ref={reportRef}>
    <div className="no-print" style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:10,marginBottom:10}}>
      <button
        type="button"
        className={`btn btn-sm ${showArchivedProducts?'btn-primary':'btn-ghost'}`}
        onClick={() => setShowArchivedProducts(v => !v)}
      >
        {showArchivedProducts ? <><ArchiveRestore size={13}/>隱藏封存商品</> : <><Archive size={13}/>顯示封存商品</>}
      </button>
      <span style={{fontSize:12,color:'var(--text-muted)'}}>
        {showArchivedProducts ? '目前包含已封存商品' : '封存商品預設隱藏'}
      </span>
    </div>
    <PendingProductReport key={showArchivedProducts?'with-archived-products':'active-products-only'} />
  </div>
}
