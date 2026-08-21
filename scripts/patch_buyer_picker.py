from pathlib import Path

p = Path('src/pages/PendingProductReport.jsx')
s = p.read_text(encoding='utf-8')

old = """  const [buyerSearch,setBuyerSearch] = useState('')\n  const [marking,setMarking] = useState(false)"""
new = """  const [buyerSearch,setBuyerSearch] = useState('')\n  const [selectedBuyerKey,setSelectedBuyerKey] = useState('')\n  const [marking,setMarking] = useState(false)"""
assert old in s
s = s.replace(old,new,1)

old = """  const buyerRows = useMemo(() => buildRows(sourceOrders,customerMap,null,effectiveArrivalView,shipmentView==='shipped'),[sourceOrders,customerMap,effectiveArrivalView,shipmentView])\n  const filteredBuyerRows = useMemo(() => buyerRows.filter(row => matchesBuyer(row,buyerSearch)),[buyerRows,buyerSearch])\n  const orderingSummary"""
new = """  const buyerRows = useMemo(() => buildRows(sourceOrders,customerMap,null,effectiveArrivalView,shipmentView==='shipped'),[sourceOrders,customerMap,effectiveArrivalView,shipmentView])\n  const buyerCandidates = useMemo(() => buyerRows.filter(row => matchesBuyer(row,buyerSearch)),[buyerRows,buyerSearch])\n  const filteredBuyerRows = useMemo(() => selectedBuyerKey ? buyerCandidates.filter(row => row.key === selectedBuyerKey) : buyerCandidates,[buyerCandidates,selectedBuyerKey])\n  const selectedBuyer = useMemo(() => buyerRows.find(row => row.key === selectedBuyerKey) || null,[buyerRows,selectedBuyerKey])\n  const orderingSummary"""
assert old in s
s = s.replace(old,new,1)

old = """  const reportLabel = mode === 'product' ? `${selectedProduct?.name || '未選商品'}｜${viewLabel}` : `${buyerSearch.trim() ? `買家：${buyerSearch.trim()}` : '全部買家'}｜${viewLabel}`"""
new = """  const reportLabel = mode === 'product' ? `${selectedProduct?.name || '未選商品'}｜${viewLabel}` : `${selectedBuyer ? `買家：${selectedBuyer.name}${selectedBuyer.phone_last2 ? `（末碼 ${selectedBuyer.phone_last2}）` : ''}` : buyerSearch.trim() ? `買家搜尋：${buyerSearch.trim()}` : '全部買家'}｜${viewLabel}`"""
assert old in s
s = s.replace(old,new,1)

old = """<button type=\"button\" onClick={() => { setShipmentView('pending'); setArrivalView('all') }}"""
new = """<button type=\"button\" onClick={() => { setShipmentView('pending'); setArrivalView('all'); setSelectedBuyerKey('') }}"""
assert old in s
s = s.replace(old,new,1)
old = """<button type=\"button\" onClick={() => setShipmentView('shipped')}"""
new = """<button type=\"button\" onClick={() => { setShipmentView('shipped'); setSelectedBuyerKey('') }}"""
assert old in s
s = s.replace(old,new,1)

old = """{mode === 'buyer' && <div className=\"card no-print\" style={{marginBottom:16}}><div className=\"card-header\" style={{fontWeight:800}}><UserSearch size={16}/>搜尋{statusLabel}買家</div><div className=\"card-body\"><div className=\"search-input-wrap\"><Search size={14}/><input autoFocus value={buyerSearch} onChange={e => setBuyerSearch(e.target.value)} placeholder=\"姓名／完整手機／手機末兩碼／Line／FB，例如 12\" style={{padding:'10px 10px 10px 34px',width:'100%'}}/></div></div></div>}"""
new = """{mode === 'buyer' && <div className=\"card no-print\" style={{marginBottom:16}}><div className=\"card-header\" style={{fontWeight:800}}><UserSearch size={16}/>搜尋{statusLabel}買家</div><div className=\"card-body\"><div className=\"search-input-wrap\"><Search size={14}/><input autoFocus value={buyerSearch} onChange={e => { setBuyerSearch(e.target.value); setSelectedBuyerKey('') }} placeholder=\"姓名／完整手機／手機末兩碼／Line／FB，例如 12\" style={{padding:'10px 10px 10px 34px',width:'100%'}}/></div>{buyerSearch.trim() && <div style={{marginTop:12}}><div style={{fontSize:12,fontWeight:800,color:'var(--text-secondary)',marginBottom:7}}>找到 {buyerCandidates.length} 位符合買家，請點選指定顯示：</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:8}}>{buyerCandidates.slice(0,30).map(c => <button type=\"button\" key={c.key} onClick={() => setSelectedBuyerKey(c.key)} style={{textAlign:'left',padding:'11px 12px',borderRadius:10,border:`2px solid ${selectedBuyerKey===c.key?'#7c3aed':'var(--border)'}`,background:selectedBuyerKey===c.key?'#f5f3ff':'var(--surface-2)',cursor:'pointer',fontFamily:'inherit'}}><div style={{fontWeight:900,color:selectedBuyerKey===c.key?'#6d28d9':'var(--text-primary)'}}>{c.name}{c.phone_last2 && <span className=\"badge badge-violet\" style={{marginLeft:6}}>末碼 {c.phone_last2}</span>}</div><div style={{fontSize:11,color:'var(--text-secondary)',marginTop:4}}>{[c.phone && `手機 ${c.phone}`,c.line_nick && `Line ${c.line_nick}`,c.fb_name && `FB ${c.fb_name}`].filter(Boolean).join(' ・ ') || '無其他辨識資料'}</div></button>)}</div>{selectedBuyerKey && <button type=\"button\" className=\"btn btn-sm btn-ghost\" style={{marginTop:9}} onClick={() => setSelectedBuyerKey('')}>顯示全部符合買家</button>}</div>}</div></div>}"""
assert old in s
s = s.replace(old,new,1)

p.write_text(s,encoding='utf-8')

lp=Path('src/components/Layout.jsx')
l=lp.read_text(encoding='utf-8')
assert "v2026.08.21.8" in l
lp.write_text(l.replace("v2026.08.21.8","v2026.08.21.9",1),encoding='utf-8')
