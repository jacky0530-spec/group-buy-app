from pathlib import Path

p=Path('src/pages/Orders.jsx')
s=p.read_text()
s=s.replace("const [filterProduct,setFilterProduct] = useState('all')", "const [filterProduct,setFilterProduct] = useState('')")
s=s.replace("const productMatch = filterProduct === 'all' || (o.items || []).some(i => (i.product_id || i.id) === filterProduct);", "const productKeyword = filterProduct.toLowerCase().trim(); const productMatch = !productKeyword || (o.items || []).some(i => (i.product_name || i.name || '').toLowerCase().includes(productKeyword));")
s=s.replace("  const sortedFilterProducts = [...products].sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant'))\n", "")
s=s.replace("const hasOrderFilters = filterProduct !== 'all' || filterDateFrom || filterDateTo", "const hasOrderFilters = filterProduct.trim() || filterDateFrom || filterDateTo")
s=s.replace("const productText = filterProduct === 'all' ? '全部商品' : (products.find(p => p.id === filterProduct)?.name || '指定商品')", "const productText = filterProduct.trim() ? `商品關鍵字「${filterProduct.trim()}」` : '全部商品'")
old='<select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={{minWidth:180}}><option value="all">📦 全部商品</option>{sortedFilterProducts.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>'
new='<div className="search-input-wrap" style={{flex:\'0 1 240px\',minWidth:200}}><Search size={14}/><input value={filterProduct} onChange={e=>setFilterProduct(e.target.value)} placeholder="搜尋商品名稱..." aria-label="搜尋商品篩選" style={{padding:\'8px 30px 8px 32px\',width:\'100%\'}}/>{filterProduct&&<button type="button" onClick={()=>setFilterProduct(\'\')} title="清除商品搜尋" aria-label="清除商品搜尋" style={{position:\'absolute\',right:7,top:\'50%\',transform:\'translateY(-50%)\',border:0,background:\'transparent\',cursor:\'pointer\',color:\'var(--text-muted)\',display:\'flex\',padding:2}}><X size={14}/></button>}</div>'
if old not in s:
    raise SystemExit('product select target not found')
s=s.replace(old,new)
s=s.replace("setFilterProduct('all');setFilterDateFrom('');setFilterDateTo('')", "setFilterProduct('');setFilterDateFrom('');setFilterDateTo('')")
p.write_text(s)

p=Path('src/components/Layout.jsx')
s=p.read_text().replace("v2026.08.23.10", "v2026.08.23.11")
p.write_text(s)
