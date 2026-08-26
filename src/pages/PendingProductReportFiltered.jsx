import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import PendingProductReport from './PendingProductReport'
import { ProductsAPI } from '../lib/db'

export default function PendingProductReportFiltered() {
  const [showArchivedProducts,setShowArchivedProducts] = useState(false)
  const originalListRef = useRef(null)

  if (!originalListRef.current) originalListRef.current = ProductsAPI.list

  // 出貨報表原本會用 includeArchived:true 載入全部商品。
  // 在此頁預設排除 active===false 的封存商品；需要查舊資料時可手動顯示。
  ProductsAPI.list = async (...args) => {
    const rows = await originalListRef.current(...args)
    return showArchivedProducts ? rows : (rows || []).filter(product => product.active !== false)
  }

  useEffect(() => () => {
    if (originalListRef.current) ProductsAPI.list = originalListRef.current
  },[])

  return <>
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
  </>
}
