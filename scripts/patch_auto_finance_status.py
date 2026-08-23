from pathlib import Path

p = Path('src/lib/db.js')
s = p.read_text()
old = """  async update(id, data) {\n    await updateDoc(doc(db,'orders',id), { ...data, updated_at:now() })\n  },\n  async updateStatus(id, status, { reason = '' } = {}) {\n    const patch = {\n      status,\n      updated_at:now(),\n      status_history:arrayUnion({ status, at:nowISO(), note:reason || '' }),\n    }\n    if (status === 'shipped') {\n      patch.shipped_at = now(); patch.cancelled_at = null; patch.cancellation_reason = ''\n    } else if (status === 'cancelled') {\n      patch.cancelled_at = now(); patch.cancellation_reason = reason || ''\n    } else if (status === 'pending') {\n      patch.shipped_at = null; patch.cancelled_at = null; patch.cancellation_reason = ''\n    }\n    await updateDoc(doc(db,'orders',id), patch)\n  },\n"""
new = """  async update(id, data) {\n    await updateDoc(doc(db,'orders',id), { ...data, updated_at:now() })\n  },\n  async updateArrival(id, items) {\n    const normalizedItems = Array.isArray(items) ? items : []\n    const allArrived = normalizedItems.length > 0 && normalizedItems.every(item => {\n      const qty = Math.max(0, Number(item?.qty || 0))\n      const arrived = Math.max(0, Number(item?.arrived_qty || 0))\n      return qty > 0 && arrived >= qty\n    })\n    const patch = { items:normalizedItems, updated_at:now() }\n    if (allArrived) patch.payable_status = 'paid'\n    await updateDoc(doc(db,'orders',id), patch)\n    return { allArrived, payable_status:allArrived ? 'paid' : null }\n  },\n  async updateStatus(id, status, { reason = '' } = {}) {\n    const ref = doc(db,'orders',id)\n    const patch = {\n      status,\n      updated_at:now(),\n      status_history:arrayUnion({ status, at:nowISO(), note:reason || '' }),\n    }\n    if (status === 'shipped') {\n      const snap = await getDoc(ref)\n      const currentPayment = snap.exists() ? snap.data().payment_status : 'unpaid'\n      patch.shipped_at = now(); patch.cancelled_at = null; patch.cancellation_reason = ''\n      if (!['partial_refund','refunded'].includes(currentPayment)) patch.payment_status = 'paid'\n    } else if (status === 'cancelled') {\n      patch.cancelled_at = now(); patch.cancellation_reason = reason || ''\n    } else if (status === 'pending') {\n      patch.shipped_at = null; patch.cancelled_at = null; patch.cancellation_reason = ''\n    }\n    await updateDoc(ref, patch)\n  },\n"""
if old not in s:
    raise SystemExit('db update/status block not found')
s = s.replace(old, new, 1)
old = """  async batchUpdateStatus(ids, status) {\n    const batch = writeBatch(db)\n    ids.forEach(id => {\n      const patch = { status, updated_at:now(), status_history:arrayUnion({ status, at:nowISO(), note:'批次更新' }) }\n      if (status === 'shipped') patch.shipped_at = now()\n      batch.update(doc(db,'orders',id),patch)\n    })\n    await batch.commit()\n  },\n"""
new = """  async batchUpdateStatus(ids, status) {\n    const refs = ids.map(id => doc(db,'orders',id))\n    const current = status === 'shipped' ? await Promise.all(refs.map(ref => getDoc(ref))) : []\n    const batch = writeBatch(db)\n    refs.forEach((ref,index) => {\n      const patch = { status, updated_at:now(), status_history:arrayUnion({ status, at:nowISO(), note:'批次更新' }) }\n      if (status === 'shipped') {\n        patch.shipped_at = now()\n        const payment = current[index]?.exists() ? current[index].data().payment_status : 'unpaid'\n        if (!['partial_refund','refunded'].includes(payment)) patch.payment_status = 'paid'\n      } else if (status === 'pending') {\n        patch.shipped_at = null\n      }\n      batch.update(ref,patch)\n    })\n    await batch.commit()\n  },\n"""
if old not in s:
    raise SystemExit('db batch status block not found')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('src/pages/Orders.jsx')
s = p.read_text()
old = """      await OrdersAPI.update(order.id,{ items })\n      setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items } : o))"""
new = """      const result = await OrdersAPI.updateArrival(order.id,items)\n      setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items,...(result.allArrived ? { payable_status:'paid' } : {}) } : o))"""
if old not in s: raise SystemExit('Orders setItemArrival block not found')
s = s.replace(old,new,1)
old = "await OrdersAPI.update(order.id,{ items }); setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items } : o)); toast('此訂單商品已全部標記到貨 ✓')"
new = "await OrdersAPI.updateArrival(order.id,items); setOrders(prev => prev.map(o => o.id === order.id ? { ...o,items,payable_status:'paid' } : o)); toast('此訂單商品已全部到貨，供應商款已自動標記付款完成 ✓')"
if old not in s: raise SystemExit('Orders markAllArrived block not found')
s = s.replace(old,new,1)
old = "await Promise.all(updates.map(({ order,items }) => OrdersAPI.update(order.id,{ items })))"
new = "await Promise.all(updates.map(({ order,items }) => OrdersAPI.updateArrival(order.id,items)))"
if old not in s: raise SystemExit('Orders batch arrival call not found')
s = s.replace(old,new,1)
old = "setOrders(prev => prev.map(order => itemMap[order.id] ? { ...order,items:itemMap[order.id] } : order))\n      toast(`📦 ${targets.length} 筆選取訂單已全部標記到貨 ✓`)"
new = "setOrders(prev => prev.map(order => itemMap[order.id] ? { ...order,items:itemMap[order.id],payable_status:'paid' } : order))\n      toast(`📦 ${targets.length} 筆選取訂單已全部到貨，供應商款已自動標記付款完成 ✓`)"
if old not in s: raise SystemExit('Orders batch arrival local state not found')
s = s.replace(old,new,1)
old = "async function batchShip() { if (!selected.length) return; try { await OrdersAPI.batchUpdateStatus(selected,'shipped'); toast(`✅ ${selected.length} 筆訂單已原子化批次出貨`);"
new = "async function batchShip() { if (!selected.length) return; try { await OrdersAPI.batchUpdateStatus(selected,'shipped'); toast(`✅ ${selected.length} 筆訂單已出貨並自動標記已收款`);"
if old not in s: raise SystemExit('Orders batchShip not found')
s = s.replace(old,new,1)
old = "async function toggleShip(o) { try { await OrdersAPI.updateStatus(o.id,o.status === 'shipped' ? 'pending' : 'shipped'); await load() }"
new = "async function toggleShip(o) { try { const next=o.status === 'shipped' ? 'pending' : 'shipped'; await OrdersAPI.updateStatus(o.id,next); if(next==='shipped') toast('✅ 已出貨，收款狀態已自動改為已收款'); await load() }"
if old not in s: raise SystemExit('Orders toggleShip not found')
s = s.replace(old,new,1)
old = "<p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>到貨＝供應商商品已到；出貨＝客戶已取貨，兩者分開管理</p>"
new = "<p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>全部到貨→自動供應商付款完成；已出貨→自動已收款；兩者仍可手動調整</p>"
if old not in s: raise SystemExit('Orders subtitle not found')
s = s.replace(old,new,1)
old = "title=\"只更新到貨狀態，不會變更出貨、收款或供應商付款\""
new = "title=\"將選取訂單全部到貨，並自動標記供應商付款完成；之後仍可手動調整\""
if old not in s: raise SystemExit('Orders batch arrival title not found')
s = s.replace(old,new,1)
p.write_text(s)

p = Path('src/pages/PendingProductReport.jsx')
s = p.read_text()
old = "await Promise.all(changed.map(order => OrdersAPI.update(order.id,{ items:(order.items || []).map(item => matchesProduct(item,selectedProduct) ? { ...item,arrived_qty:itemQty(item),arrived_at:now } : item) })))"
new = "await Promise.all(changed.map(order => { const items=(order.items || []).map(item => matchesProduct(item,selectedProduct) ? { ...item,arrived_qty:itemQty(item),arrived_at:now } : item); return OrdersAPI.updateArrival(order.id,items) }))"
if old not in s: raise SystemExit('Report arrival call not found')
s = s.replace(old,new,1)
old = "toast(`「${selectedProduct.name}」已將 ${changed.length} 筆待出貨訂單標記為全部到貨 ✓`)"
new = "toast(`「${selectedProduct.name}」已更新到貨；整張訂單全部到貨者已自動標記供應商付款完成 ✓`)"
if old not in s: raise SystemExit('Report arrival toast not found')
s = s.replace(old,new,1)
old = "toast(nextStatus === 'shipped' ? `✅ ${row.name} 的 ${row.order_ids.length} 筆訂單已標記為已出貨` :"
new = "toast(nextStatus === 'shipped' ? `✅ ${row.name} 的 ${row.order_ids.length} 筆訂單已出貨並自動標記已收款` :"
if old not in s: raise SystemExit('Report ship toast not found')
s = s.replace(old,new,1)
old = "<p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>可從報表直接標記已出貨，並單獨查詢已出貨紀錄</p>"
new = "<p style={{color:'var(--text-secondary)',fontSize:13,marginTop:2}}>報表標記已出貨會自動同步已收款；整張訂單全部到貨會自動同步供應商付款完成</p>"
if old not in s: raise SystemExit('Report subtitle not found')
s = s.replace(old,new,1)
p.write_text(s)

p = Path('src/components/Layout.jsx')
s = p.read_text()
old = "const APP_VERSION = 'v2026.08.23.3'"
new = "const APP_VERSION = 'v2026.08.23.4'"
if old not in s: raise SystemExit('version pattern not found')
p.write_text(s.replace(old,new,1))
