from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label} not found')
    return text.replace(old, new, 1)

# db.js
p = Path('src/lib/db.js')
s = p.read_text()
s = replace_once(s, "'cancelled_at','refunded_at','archived_at',", "'cancelled_at','refunded_at','archived_at','payable_paid_at',", 'db time fields')
s = replace_once(s, "supplier: product.supplier || '',\n    qty: quantity,", "supplier: product.supplier || '',\n    supplier_payment_term: product.supplier_payment_term || 'manual',\n    qty: quantity,", 'snapshot payment term')
old = """  async updateArrival(id, items) {\n    const normalizedItems = Array.isArray(items) ? items : []\n    const allArrived = normalizedItems.length > 0 && normalizedItems.every(item => {\n      const qty = Math.max(0, Number(item?.qty || 0))\n      const arrived = Math.max(0, Number(item?.arrived_qty || 0))\n      return qty > 0 && arrived >= qty\n    })\n    const patch = { items:normalizedItems, updated_at:now() }\n    if (allArrived) patch.payable_status = 'paid'\n    await updateDoc(doc(db,'orders',id), patch)\n    return { allArrived, payable_status:allArrived ? 'paid' : null }\n  },"""
new = """  async updateArrival(id, items) {\n    const normalizedItems = Array.isArray(items) ? items : []\n    const allArrived = normalizedItems.length > 0 && normalizedItems.every(item => {\n      const qty = Math.max(0, Number(item?.qty || 0))\n      const arrived = Math.max(0, Number(item?.arrived_qty || 0))\n      return qty > 0 && arrived >= qty\n    })\n    await updateDoc(doc(db,'orders',id), { items:normalizedItems, updated_at:now() })\n    return { allArrived }\n  },"""
s = replace_once(s, old, new, 'updateArrival')
s = replace_once(s, "  async updatePayable(id, payable_status) {\n    await updateDoc(doc(db,'orders',id), { payable_status, updated_at:now() })\n  },", "  async updatePayable(id, payable_status) {\n    await updateDoc(doc(db,'orders',id), { payable_status, payable_paid_at:payable_status === 'paid' ? now() : null, updated_at:now() })\n  },", 'updatePayable')
p.write_text(s)

# Products.jsx
p = Path('src/pages/Products.jsx')
s = p.read_text()
s = replace_once(s, "supplier:'',note:'',spec_mode", "supplier:'',supplier_payment_term:'manual',note:'',spec_mode", 'empty supplier term')
s = replace_once(s, "category:p.category||'other',supplier:p.supplier||'',note:p.note||''", "category:p.category||'other',supplier:p.supplier||'',supplier_payment_term:p.supplier_payment_term||'manual',note:p.note||''", 'edit supplier term')
s = replace_once(s, "category:form.category,supplier:form.supplier.trim(),note:form.note.trim()", "category:form.category,supplier:form.supplier.trim(),supplier_payment_term:form.supplier_payment_term||'manual',note:form.note.trim()", 'save supplier term')
old = "<td style={{color:'var(--text-secondary)',fontSize:13}}>{p.supplier||'—'}</td>"
new = "<td style={{color:'var(--text-secondary)',fontSize:13}}><div>{p.supplier||'—'}</div><div style={{fontSize:10,marginTop:3,color:'var(--text-muted)'}}>{p.supplier_payment_term==='order'?'訂貨即付款':p.supplier_payment_term==='arrival'?'到貨後付款':'手動付款'}</div></td>"
s = replace_once(s, old, new, 'product supplier cell')
old = "<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><div className=\"form-group\"><label>供應商</label><input value={form.supplier} onChange={e=>setForm(p=>({...p,supplier:e.target.value}))}/></div><div className=\"form-group\"><label>備註</label><input value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))}/></div></div>"
new = "<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><div className=\"form-group\"><label>供應商</label><input value={form.supplier} onChange={e=>setForm(p=>({...p,supplier:e.target.value}))}/></div><div className=\"form-group\"><label>備註</label><input value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))}/></div></div><div className=\"form-group\"><label>供應商付款條件</label><select value={form.supplier_payment_term||'manual'} onChange={e=>setForm(p=>({...p,supplier_payment_term:e.target.value}))} style={{width:'100%'}}><option value=\"order\">訂貨即付款</option><option value=\"arrival\">到貨後付款</option><option value=\"manual\">手動付款</option></select><div style={{fontSize:11,color:'var(--text-muted)',marginTop:5}}>付款條件只用來提醒操作；實際匯款仍需按「付款完成」確認，避免到貨狀態誤當成已付款。</div></div>"
s = replace_once(s, old, new, 'supplier form')
p.write_text(s)

# Orders.jsx
p = Path('src/pages/Orders.jsx')
s = p.read_text()
s = replace_once(s, "const PAYABLE_CFG = { unpaid:{ label:'供應商未付款',badge:'badge-amber' }, paid:{ label:'供應商已付款',badge:'badge-emerald' } }", "const PAYABLE_CFG = { unpaid:{ label:'供應商未付款',badge:'badge-amber' }, paid:{ label:'供應商已付款',badge:'badge-emerald' } }\nconst PAYMENT_TERM_LABEL = { order:'訂貨即付款', arrival:'到貨後付款', manual:'手動付款' }", 'payment labels')
s = replace_once(s, "supplier:item.snapshot.supplier ?? item.product.supplier ?? '',", "supplier:item.snapshot.supplier ?? item.product.supplier ?? '',\n    supplier_payment_term:item.snapshot.supplier_payment_term ?? item.product.supplier_payment_term ?? 'manual',", 'cart snapshot term')
s = replace_once(s, "supplier:item.supplier || '',spec_mode:'none'", "supplier:item.supplier || '',supplier_payment_term:item.supplier_payment_term||'manual',spec_mode:'none'", 'snapshot fallback term')
s = replace_once(s, "      const result = await OrdersAPI.updateArrival(order.id,items)\n      setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items,...(result.allArrived ? { payable_status:'paid' } : {}) } : o))", "      await OrdersAPI.updateArrival(order.id,items)\n      setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items } : o))", 'single arrival unlink')
s = replace_once(s, "      await OrdersAPI.updateArrival(order.id,items); setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items,payable_status:'paid' } : o)); toast('此訂單商品已全部到貨，供應商款已自動標記付款完成 ✓')", "      await OrdersAPI.updateArrival(order.id,items); setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items } : o)); toast('📦 此訂單商品已全部到貨；供應商付款仍依實際匯款狀態另外確認 ✓')", 'mark all arrival unlink')
s = replace_once(s, "      setOrders(prev => prev.map(order => itemMap[order.id] ? { ...order,items:itemMap[order.id],payable_status:'paid' } : order))\n      toast(`📦 ${targets.length} 筆選取訂單已全部到貨，供應商款已自動標記付款完成 ✓`)", "      setOrders(prev => prev.map(order => itemMap[order.id] ? { ...order,items:itemMap[order.id] } : order))\n      toast(`📦 ${targets.length} 筆選取訂單已全部到貨；供應商付款狀態不會自動變更 ✓`)", 'batch arrival unlink')
s = replace_once(s, "<p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>全部到貨→自動供應商付款完成；已出貨→自動已收款；兩者仍可手動調整</p>", "<p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>到貨與供應商付款分開管理；實際匯款才標記付款完成。已出貨仍自動同步已收款。</p>", 'orders subtitle')
s = replace_once(s, "title=\"將選取訂單全部到貨，並自動標記供應商付款完成；之後仍可手動調整\"", "title=\"將選取訂單全部標記到貨；不會變更供應商付款狀態\"", 'batch title')
old = "<td><span className={`badge ${acfg.badge}`}>{acfg.label}</span>{!archived && o.status !== 'cancelled' && <button className=\"btn btn-sm btn-ghost\" style={{ marginTop:4,fontSize:11 }} onClick={() => togglePayable(o)}><WalletCards size={10}/>{o.payable_status === 'paid' ? '取消付款' : '付款完成'}</button>}</td>"
new = "<td><span className={`badge ${acfg.badge}`}>{acfg.label}</span><div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>付款條件：{(()=>{const terms=[...new Set((o.items||[]).map(i=>i.supplier_payment_term||'manual'))];return terms.length===1?(PAYMENT_TERM_LABEL[terms[0]]||'手動付款'):'多種條件'})()}</div>{o.payable_status==='paid'&&o.payable_paid_at&&<div style={{fontSize:10,color:'var(--emerald)',marginTop:2}}>付款日：{new Date(o.payable_paid_at).toLocaleDateString('zh-TW')}</div>}{!archived && o.status !== 'cancelled' && <button className=\"btn btn-sm btn-ghost\" style={{ marginTop:4,fontSize:11 }} onClick={() => togglePayable(o)}><WalletCards size={10}/>{o.payable_status === 'paid' ? '取消付款' : '付款完成'}</button>}</td>"
s = replace_once(s, old, new, 'payable cell')
p.write_text(s)

# PendingProductReport.jsx
p = Path('src/pages/PendingProductReport.jsx')
s = p.read_text()
s = replace_once(s, "toast(`「${selectedProduct.name}」已更新到貨；整張訂單全部到貨者已自動標記供應商付款完成 ✓`)", "toast(`「${selectedProduct.name}」已更新到貨；供應商付款狀態維持獨立，不會自動變更 ✓`)", 'pending arrival toast')
s = replace_once(s, "<p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>報表標記已出貨會自動同步已收款；整張訂單全部到貨會自動同步供應商付款完成</p>", "<p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>出貨會自動同步已收款；到貨與供應商付款分開管理，實際匯款才標記付款完成</p>", 'pending report subtitle')
p.write_text(s)

# Reports.jsx
p = Path('src/pages/Reports.jsx')
s = p.read_text()
old = "const collectedAmount=validOrders.filter(o=>['paid','partial_refund','refunded'].includes(o.payment_status)).reduce((s,o)=>s+effectiveOrderAmount(o),0),outstandingAmount=validOrders.filter(o=>o.payment_status==='unpaid').reduce((s,o)=>s+effectiveOrderAmount(o),0),refundAmount=validOrders.reduce((s,o)=>s+Number(o.refund_amount||0),0),cancelledAmount=cancelledOrders.reduce((s,o)=>s+Number(o.total_amount||0),0),supplierPaidCost=validOrders.filter(o=>o.payable_status==='paid').reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),payableOutstanding=validOrders.filter(o=>o.payable_status!=='paid').reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),netCashFlow=collectedAmount-supplierPaidCost-expenseNet"
new = "const collectedAmount=validOrders.filter(o=>['paid','partial_refund','refunded'].includes(o.payment_status)).reduce((s,o)=>s+effectiveOrderAmount(o),0),outstandingAmount=validOrders.filter(o=>o.payment_status==='unpaid').reduce((s,o)=>s+effectiveOrderAmount(o),0),refundAmount=validOrders.reduce((s,o)=>s+Number(o.refund_amount||0),0),cancelledAmount=cancelledOrders.reduce((s,o)=>s+Number(o.total_amount||0),0),supplierPaidCost=validOrders.filter(o=>o.payable_status==='paid').reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),payableOutstanding=validOrders.filter(o=>o.payable_status!=='paid').reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),paidNotArrived=validOrders.filter(o=>o.payable_status==='paid'&&(o.items||[]).some(i=>Number(i.arrived_qty||0)<Number(i.qty||0))).reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),arrivedNotPaid=validOrders.filter(o=>o.payable_status!=='paid'&&(o.items||[]).length>0&&(o.items||[]).every(i=>Number(i.arrived_qty||0)>=Number(i.qty||0))).reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),netCashFlow=collectedAmount-supplierPaidCost-expenseNet"
s = replace_once(s, old, new, 'report finance metrics')
old = "[['應收帳款（未收款）',outstandingAmount,false],['應付商品成本',payableOutstanding,false],['已付供應商商品成本',supplierPaidCost,false],[adjustmentLabel,adjustmentDisplay,adjustmentIsDiscount],['現金流淨額',netCashFlow,false]]"
new = "[['應收帳款（未收款）',outstandingAmount,false],['應付商品成本',payableOutstanding,false],['已付供應商商品成本',supplierPaidCost,false],['已付未到貨',paidNotArrived,false],['到貨未付款',arrivedNotPaid,false],[adjustmentLabel,adjustmentDisplay,adjustmentIsDiscount],['現金流淨額',netCashFlow,false]]"
s = replace_once(s, old, new, 'finance cards')
old = "<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:16}}>"
new = "<div style={{background:'var(--amber-light)',border:'1px solid #fde68a',borderRadius:10,padding:'10px 12px',marginBottom:14,fontSize:12,color:'#92400e'}}>💡 供應商付款與到貨是兩條獨立流程：付款完成代表錢已實際匯出；到貨只代表商品收到。『已付未到貨』可用來追蹤預付／在途貨款，『到貨未付款』則代表尚欠廠商。</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:16}}>"
s = replace_once(s, old, new, 'finance explanation')
p.write_text(s)

# Layout version
p = Path('src/components/Layout.jsx')
s = p.read_text()
s = replace_once(s, "const APP_VERSION = 'v2026.08.23.6'", "const APP_VERSION = 'v2026.08.23.7'", 'version')
p.write_text(s)
