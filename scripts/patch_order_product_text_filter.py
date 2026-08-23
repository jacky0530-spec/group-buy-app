from pathlib import Path

p = Path('src/pages/Orders.jsx')
s = p.read_text()

s = s.replace("const [search,setSearch] = useState(''); const [filterStatus,setFilterStatus] = useState('all'); const [filterPayment,setFilterPayment] = useState('all'); const [filterProduct,setFilterProduct] = useState('all'); const [filterDateFrom,setFilterDateFrom] = useState(''); const [filterDateTo,setFilterDateTo] = useState(''); const [showArchived,setShowArchived] = useState(false); const [selected,setSelected] = useState([])", "const [search,setSearch] = useState(''); const [filterStatus,setFilterStatus] = useState('all'); const [filterPayment,setFilterPayment] = useState('all'); const [filterProduct,setFilterProduct] = useState('all'); const [filterProductSearch,setFilterProductSearch] = useState(''); const [filterProductOpen,setFilterProductOpen] = useState(false); const [filterDateFrom,setFilterDateFrom] = useState(''); const [filterDateTo,setFilterDateTo] = useState(''); const [showArchived,setShowArchived] = useState(false); const [selected,setSelected] = useState([])")

s = s.replace("const custRef = useRef(null); const prodRef = useRef(null)", "const custRef = useRef(null); const prodRef = useRef(null); const filterProdRef = useRef(null)")

s = s.replace("if (prodRef.current && !prodRef.current.contains(e.target)) setProdOpen(false)", "if (prodRef.current && !prodRef.current.contains(e.target)) setProdOpen(false); if (filterProdRef.current && !filterProdRef.current.contains(e.target)) setFilterProductOpen(false)")

s = s.replace("const sortedFilterProducts = [...products].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant'))\n  const hasOrderFilters = filterProduct !== 'all' || filterDateFrom || filterDateTo", "const sortedFilterProducts = [...products].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant'))\n  const matchedFilterProducts = sortedFilterProducts.filter(p => String(p.name || '').toLowerCase().includes(filterProductSearch.trim().toLowerCase())).slice(0,30)\n  const selectedFilterProductName = products.find(p => p.id === filterProduct)?.name || ''\n  const hasOrderFilters = filterProduct !== 'all' || filterDateFrom || filterDateTo")

old = "<select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={{minWidth:180}}><option value=\"all\">📦 全部商品</option>{sortedFilterProducts.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>"
new = "<div ref={filterProdRef} style={{position:'relative',flex:'0 1 260px',minWidth:220}}><div className=\"search-input-wrap\"><Search size={14}/><input value={filterProductOpen ? filterProductSearch : selectedFilterProductName} onFocus={()=>{setFilterProductOpen(true);setFilterProductSearch('')}} onChange={e=>{setFilterProductSearch(e.target.value);setFilterProductOpen(true)}} placeholder=\"📦 輸入商品名稱篩選...\" style={{padding:'8px 34px 8px 32px',width:'100%'}} />{filterProduct !== 'all' && <button type=\"button\" onClick={()=>{setFilterProduct('all');setFilterProductSearch('');setFilterProductOpen(false)}} title=\"清除商品篩選\" style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',border:'none',background:'transparent',cursor:'pointer',color:'var(--text-muted)',padding:2}}><X size={14}/></button>}</div>{filterProductOpen&&<div style={{position:'absolute',zIndex:30,top:'calc(100% + 4px)',left:0,right:0,maxHeight:300,overflowY:'auto',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,boxShadow:'0 10px 30px rgba(15,23,42,.14)'}}><button type=\"button\" onClick={()=>{setFilterProduct('all');setFilterProductSearch('');setFilterProductOpen(false)}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:'none',borderBottom:'1px solid var(--border)',background:filterProduct==='all'?'var(--indigo-light)':'transparent',cursor:'pointer',fontFamily:'inherit',fontWeight:800}}>📦 全部商品</button>{matchedFilterProducts.map(p=><button type=\"button\" key={p.id} onClick={()=>{setFilterProduct(p.id);setFilterProductSearch('');setFilterProductOpen(false)}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:'none',borderBottom:'1px solid var(--border)',background:filterProduct===p.id?'var(--indigo-light)':'transparent',cursor:'pointer',fontFamily:'inherit'}}>{p.name}</button>)}{matchedFilterProducts.length===0&&<div style={{padding:'12px',color:'var(--text-muted)',fontSize:12}}>找不到符合的商品</div>}</div>}</div>"
if old not in s:
    raise SystemExit('product select block not found')
s = s.replace(old,new)

s = s.replace("setFilterProduct('all');setFilterDateFrom('');setFilterDateTo('')", "setFilterProduct('all');setFilterProductSearch('');setFilterProductOpen(false);setFilterDateFrom('');setFilterDateTo('')")

p.write_text(s)

lp = Path('src/components/Layout.jsx')
ls = lp.read_text().replace("v2026.08.23.10", "v2026.08.23.11")
lp.write_text(ls)
