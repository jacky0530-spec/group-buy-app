from pathlib import Path

orders_path = Path('src/pages/Orders.jsx')
text = orders_path.read_text(encoding='utf-8')

marker = """  async function batchShip() { if (!selected.length) return; try { await OrdersAPI.batchUpdateStatus(selected,'shipped'); toast(`✅ ${selected.length} 筆訂單已原子化批次出貨`); setSelected([]); await load() } catch (err) { toast('批次出貨失敗：'+err.message,'error') } }"""
insert = """  async function batchMarkAllArrived() {
    if (!selected.length) return
    const targets = orders.filter(order => selected.includes(order.id) && !order.archived && order.status !== 'cancelled')
    if (!targets.length) { toast('目前選取訂單沒有可更新的到貨資料','warning'); return }
    try {
      const at = new Date().toISOString()
      const updates = targets.map(order => ({
        order,
        items:(order.items || []).map(item => ({ ...item, arrived_qty:itemQty(item), arrived_at:at })),
      }))
      await Promise.all(updates.map(({ order,items }) => OrdersAPI.update(order.id,{ items })))
      const itemMap = Object.fromEntries(updates.map(({ order,items }) => [order.id,items]))
      setOrders(prev => prev.map(order => itemMap[order.id] ? { ...order,items:itemMap[order.id] } : order))
      toast(`📦 ${targets.length} 筆選取訂單已全部標記到貨 ✓`)
    } catch (err) { toast('批次到貨更新失敗：'+err.message,'error') }
  }
  async function batchShip() { if (!selected.length) return; try { await OrdersAPI.batchUpdateStatus(selected,'shipped'); toast(`✅ ${selected.length} 筆訂單已原子化批次出貨`); setSelected([]); await load() } catch (err) { toast('批次出貨失敗：'+err.message,'error') } }"""
if marker not in text:
    raise SystemExit('batchShip marker not found')
text = text.replace(marker, insert, 1)

old_buttons = """{selected.length > 0 && <><button className=\"btn btn-primary btn-sm\" onClick={batchShip}><CheckCircle size={13}/>批次出貨 {selected.length}</button><button className=\"btn btn-ghost btn-sm\" onClick={() => setReceiptOrders(filtered.filter(o => selected.includes(o.id)))}><Printer size={13}/>出貨單</button></>}"""
new_buttons = """{selected.length > 0 && <><button className=\"btn btn-success btn-sm\" onClick={batchMarkAllArrived} title=\"只更新到貨狀態，不會變更出貨、收款或供應商付款\"><PackageCheck size={13}/>選取全部到貨 {selected.length}</button><button className=\"btn btn-primary btn-sm\" onClick={batchShip}><CheckCircle size={13}/>批次出貨 {selected.length}</button><button className=\"btn btn-ghost btn-sm\" onClick={() => setReceiptOrders(filtered.filter(o => selected.includes(o.id)))}><Printer size={13}/>出貨單</button></>}"""
if old_buttons not in text:
    raise SystemExit('selected buttons marker not found')
text = text.replace(old_buttons, new_buttons, 1)
orders_path.write_text(text, encoding='utf-8')

layout_path = Path('src/components/Layout.jsx')
layout = layout_path.read_text(encoding='utf-8')
if "v2026.08.21.7" not in layout:
    raise SystemExit('expected app version not found')
layout = layout.replace("v2026.08.21.7", "v2026.08.21.8", 1)
layout_path.write_text(layout, encoding='utf-8')
