from pathlib import Path

rp=Path('src/pages/PendingProductReport.jsx')
s=rp.read_text()

def repl(old,new):
    global s
    if old not in s:
        raise SystemExit('pattern not found:\n'+old[:260])
    s=s.replace(old,new,1)

repl("import { Download, PackageSearch, Printer, Search, UserSearch, Boxes, PackageCheck, PackageX, Layers3, Truck, Undo2 } from 'lucide-react'",
     "import { Download, PackageSearch, Printer, Search, UserSearch, Boxes, PackageCheck, PackageX, Layers3, Truck, Undo2, Archive, ArchiveRestore } from 'lucide-react'")
repl("  const [shippingKey,setShippingKey] = useState('')",
     "  const [shippingKey,setShippingKey] = useState('')\n  const [showArchived,setShowArchived] = useState(false)\n  const [archivingKey,setArchivingKey] = useState('')")
repl("  const sourceOrders = useMemo(() => orders.filter(order => order.status === shipmentView && order.archived !== true),[orders,shipmentView])",
     "  const sourceOrders = useMemo(() => orders.filter(order => {\n    if (order.status !== shipmentView) return false\n    if (shipmentView !== 'shipped') return order.archived !== true\n    return showArchived ? true : order.archived !== true\n  }),[orders,shipmentView,showArchived])")
repl("        order_ids:new Set(),",
     "        order_ids:new Set(),\n        archived:true,")
repl("    group.order_ids.add(order.id)",
     "    group.order_ids.add(order.id)\n    if (order.archived !== true) group.archived = false")

anchor="  function exportCurrent() {"
insert="""  async function changeRowArchive(row,archiveNext) {
    if (!row.order_ids?.length || archivingKey) return
    if (archiveNext && !window.confirm(`確定要封存 ${row.name} 的 ${row.order_ids.length} 筆已出貨訂單？\\n封存後預設不會顯示，但可從「顯示封存」查回。`)) return
    const key = `${row.key}-${archiveNext?'archive':'restore'}`
    setArchivingKey(key)
    try {
      await Promise.all(row.order_ids.map(id => archiveNext ? OrdersAPI.archive(id) : OrdersAPI.unarchive(id)))
      toast(archiveNext ? `📦 ${row.name} 的 ${row.order_ids.length} 筆訂單已封存` : `↩️ ${row.name} 的 ${row.order_ids.length} 筆訂單已解除封存`)
      await load()
    } catch(err) { toast(`${archiveNext?'封存':'解除封存'}失敗：${err.message}`,'error') }
    finally { setArchivingKey('') }
  }

"""
if anchor not in s: raise SystemExit('export anchor missing')
s=s.replace(anchor,insert+anchor,1)

repl("setShipmentView('pending'); setArrivalView('all'); setSelectedBuyerKey('')",
     "setShipmentView('pending'); setArrivalView('all'); setSelectedBuyerKey(''); setShowArchived(false)")

repl("<PackageCheck size={16} style={{verticalAlign:'middle',marginRight:7}}/>已出貨查詢</button></div>",
     "<PackageCheck size={16} style={{verticalAlign:'middle',marginRight:7}}/>已出貨查詢</button></div>{shipmentView==='shipped' && <div className=\"no-print\" style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:10,margin:'-4px 0 14px'}}><button type=\"button\" className={`btn btn-sm ${showArchived?'btn-primary':'btn-ghost'}`} onClick={()=>{setShowArchived(v=>!v);setSelectedBuyerKey('')}}>{showArchived?<><ArchiveRestore size={13}/>隱藏封存</>:<><Archive size={13}/>顯示封存</>}</button><span style={{fontSize:12,color:'var(--text-muted)'}}>{showArchived?'目前包含已封存訂單':'封存訂單預設隱藏'}</span></div>}")

repl("<td><strong>{c.name}</strong></td><td>{c.phone || (c.phone_last2 ? `末碼 ${c.phone_last2}` : '—')}</td>",
     "<td><strong>{c.name}</strong>{c.archived && <span style={{marginLeft:6,color:'#64748b',fontWeight:800}}>【已封存】</span>}</td><td>{c.phone || (c.phone_last2 ? `末碼 ${c.phone_last2}` : '—')}</td>")

old="<tr key={c.key}><td style={{fontWeight:800,minWidth:120}}>{c.name}<div style={{fontSize:11,marginTop:4,color:shipmentView==='shipped'?'var(--emerald)':c.all_arrived?'var(--emerald)':'#b45309'}}>{shipmentView==='shipped'?'✅ 已出貨':c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td>"
new="<tr key={c.key} style={{opacity:c.archived?.62:1,background:c.archived?'#f8fafc':undefined}}><td style={{fontWeight:800,minWidth:120}}>{c.name}{c.archived&&<span className=\"badge badge-gray\" style={{marginLeft:6}}>已封存</span>}<div style={{fontSize:11,marginTop:4,color:c.archived?'#64748b':shipmentView==='shipped'?'var(--emerald)':c.all_arrived?'var(--emerald)':'#b45309'}}>{c.archived?'📦 已封存':shipmentView==='shipped'?'✅ 已出貨':c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`}</div></td>"
repl(old,new)

old="{shipmentView==='pending' ? <button className=\"btn btn-sm btn-primary\" disabled={Boolean(shippingKey)} onClick={() => changeRowShipment(c,'shipped')}><Truck size={13}/>{shippingKey===actionKey?'更新中...':'標記已出貨'}</button> : <button className=\"btn btn-sm btn-ghost\" disabled={Boolean(shippingKey)} onClick={() => changeRowShipment(c,'pending')}><Undo2 size={13}/>{shippingKey===actionKey?'更新中...':'恢復待出貨'}</button>}"
new="{shipmentView==='pending' ? <button className=\"btn btn-sm btn-primary\" disabled={Boolean(shippingKey)} onClick={() => changeRowShipment(c,'shipped')}><Truck size={13}/>{shippingKey===actionKey?'更新中...':'標記已出貨'}</button> : <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{!c.archived&&<button className=\"btn btn-sm btn-ghost\" disabled={Boolean(shippingKey)} onClick={() => changeRowShipment(c,'pending')}><Undo2 size={13}/>{shippingKey===actionKey?'更新中...':'恢復待出貨'}</button>}{c.archived?<button className=\"btn btn-sm btn-ghost\" disabled={Boolean(archivingKey)} onClick={() => changeRowArchive(c,false)}><ArchiveRestore size={13}/>{archivingKey===`${c.key}-restore`?'更新中...':'解除封存'}</button>:<button className=\"btn btn-sm btn-ghost\" style={{color:'#64748b'}} disabled={Boolean(archivingKey)} onClick={() => changeRowArchive(c,true)}><Archive size={13}/>{archivingKey===`${c.key}-archive`?'封存中...':'封存訂單'}</button>}</div>}"
repl(old,new)

rp.write_text(s)

dp=Path('src/lib/db.js')
d=dp.read_text()
old="  async archive(id) {\n    await updateDoc(doc(db,'orders',id), { archived:true, archived_at:now(), updated_at:now() })\n  },\n  async batchUpdateStatus(ids, status) {"
new="  async archive(id) {\n    await updateDoc(doc(db,'orders',id), { archived:true, archived_at:now(), updated_at:now() })\n  },\n  async unarchive(id) {\n    await updateDoc(doc(db,'orders',id), { archived:false, archived_at:null, updated_at:now() })\n  },\n  async batchUpdateStatus(ids, status) {"
if old not in d: raise SystemExit('db archive pattern missing')
dp.write_text(d.replace(old,new,1))

lp=Path('src/components/Layout.jsx')
ls=lp.read_text()
oldv="const APP_VERSION = 'v2026.08.22.4'"
newv="const APP_VERSION = 'v2026.08.22.5'"
if oldv not in ls: raise SystemExit('version pattern missing')
lp.write_text(ls.replace(oldv,newv,1))
