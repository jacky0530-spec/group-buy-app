import { useState, useEffect, useCallback, useRef } from 'react'
import { CustomersAPI, OrdersAPI } from '../lib/db'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import { customerMatchesSearch, derivePhoneLast2, getCustomerPhoneLast2, normalizePhoneLast2 } from '../lib/customerSearch'
import { Plus, Pencil, Archive, Search, Users, RotateCcw, Upload, ArrowUpDown } from 'lucide-react'

const EMPTY = { name:'', line_nick:'', fb_name:'', phone:'', phone_last2:'', note:'' }
const INITIAL_RENDER = 100
const RENDER_STEP = 100
const ORDER_COUNT_PAGE = 250

const SORT_OPTIONS = [
  { value:'last2_asc', label:'末碼：小 → 大' },
  { value:'last2_desc', label:'末碼：大 → 小' },
  { value:'name_asc', label:'姓名：A → Z / 筆畫' },
  { value:'orders_desc', label:'有效訂單數：多 → 少' },
]

function compareLast2(a,b,direction='asc') {
  const aRaw = getCustomerPhoneLast2(a)
  const bRaw = getCustomerPhoneLast2(b)
  const aMissing = !aRaw
  const bMissing = !bRaw
  if (aMissing !== bMissing) return aMissing ? 1 : -1
  if (aMissing && bMissing) return (a.name || '').localeCompare(b.name || '','zh-Hant',{ numeric:true })
  const aNum = Number(aRaw)
  const bNum = Number(bRaw)
  if (aNum !== bNum) return direction === 'desc' ? bNum - aNum : aNum - bNum
  return (a.name || '').localeCompare(b.name || '','zh-Hant',{ numeric:true })
}

export default function Customers() {
  const toast = useToast()
  const importRef = useRef(null)
  const loadSeqRef = useRef(0)
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [countsLoading, setCountsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('last2_asc')
  const [showArchived, setShowArchived] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null)
  const [orderCounts, setOrderCounts] = useState({})
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER)

  const loadOrderCountsInBackground = useCallback(async seq => {
    setCountsLoading(true)
    const counts = {}
    try {
      let cursor = null
      let hasMore = true
      while (hasMore) {
        const page = await OrdersAPI.listPage({ pageSize:ORDER_COUNT_PAGE, cursor })
        if (seq !== loadSeqRef.current) return
        for (const order of page.rows || []) {
          if (order.status === 'cancelled' || order.archived || !order.customer_id) continue
          counts[order.customer_id] = (counts[order.customer_id] || 0) + 1
        }
        setOrderCounts({ ...counts })
        hasMore = page.hasMore === true && Boolean(page.nextCursor)
        cursor = hasMore ? page.nextCursor : null
        if (hasMore) await new Promise(resolve => setTimeout(resolve, 25))
      }
    } catch (err) {
      console.error('客戶有效訂單數背景統計失敗', err)
    } finally {
      if (seq === loadSeqRef.current) setCountsLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setCountsLoading(false)
    setOrderCounts({})
    try {
      const custs = await CustomersAPI.list({ includeArchived: showArchived })
      if (seq !== loadSeqRef.current) return
      setCustomers(custs)
      setRenderLimit(INITIAL_RENDER)
      setLoading(false)
      setTimeout(() => {
        if (seq === loadSeqRef.current) loadOrderCountsInBackground(seq)
      }, 50)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      toast('載入失敗：' + err.message, 'error')
      setLoading(false)
    }
  }, [showArchived, toast, loadOrderCountsInBackground])

  useEffect(() => { load() }, [load])
  useEffect(() => { setRenderLimit(INITIAL_RENDER) }, [search, sortBy, showArchived])

  const q = search.toLowerCase().trim()
  const filtered = customers.filter(c => customerMatchesSearch(c,q)).sort((a,b) => {
    if (sortBy === 'last2_desc') return compareLast2(a,b,'desc')
    if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '','zh-Hant',{ numeric:true })
    if (sortBy === 'orders_desc') {
      const diff = Number(orderCounts[b.id] || 0) - Number(orderCounts[a.id] || 0)
      return diff || compareLast2(a,b,'asc')
    }
    return compareLast2(a,b,'asc')
  })
  const displayed = filtered.slice(0, renderLimit)

  function openAdd() {
    setForm({ ...EMPTY })
    setEditId(null)
    setShowModal(true)
  }

  function openEdit(c) {
    setForm({
      name:c.name || '', line_nick:c.line_nick || '', fb_name:c.fb_name || '',
      phone:c.phone || '', phone_last2:getCustomerPhoneLast2(c), note:c.note || '',
    })
    setEditId(c.id)
    setShowModal(true)
  }

  function updatePhone(value) {
    setForm(p => {
      const derived = derivePhoneLast2(value)
      return { ...p, phone:value, phone_last2:derived || p.phone_last2 }
    })
  }

  async function save() {
    if (!form.name.trim()) { toast('請填寫客戶姓名', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        name:form.name.trim(), line_nick:form.line_nick.trim(), fb_name:form.fb_name.trim(),
        phone:form.phone.trim(), phone_last2:normalizePhoneLast2(form.phone_last2), note:form.note.trim(),
      }
      const dup = await CustomersAPI.isDuplicateIdentity(payload, editId)
      if (dup.duplicate) {
        const label = { phone:'電話', line_nick:'Line 暱稱', fb_name:'FB 名稱' }[dup.field] || dup.field
        toast(`${label}「${dup.value}」已被其他客戶使用`, 'error')
        return
      }
      if (editId) {
        await CustomersAPI.update(editId, payload)
        toast('客戶資料已更新 ✓')
      } else {
        await CustomersAPI.create(payload)
        toast('客戶已新增 ✓')
      }
      setShowModal(false)
      await load()
    } catch (err) {
      toast('儲存失敗：' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function importCustomerFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const parsed = JSON.parse(await file.text())
      const rows = Array.isArray(parsed) ? parsed : parsed.customers
      if (!Array.isArray(rows)) throw new Error('檔案內找不到 customers 資料')
      const result = await CustomersAPI.importRows(rows)
      toast(`匯入完成：新增 ${result.created}、補資料 ${result.updated}、略過重複 ${result.skipped}${result.ambiguous ? `、同名需區分 ${result.ambiguous}` : ''} ✓`)
      await load()
    } catch (err) {
      toast('匯入失敗：' + err.message, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function archiveCustomer(c) {
    try {
      await CustomersAPI.archive(c.id)
      setConfirmArchive(null)
      toast(`已封存「${c.name}」；歷史訂單仍保留`, 'warning')
      await load()
    } catch (err) { toast('封存失敗：' + err.message,'error') }
  }

  async function restoreCustomer(c) {
    try {
      await CustomersAPI.restore(c.id)
      toast(`已還原「${c.name}」`)
      await load()
    } catch (err) { toast('還原失敗：' + err.message,'error') }
  }

  return (
    <div className="animate-fade">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800 }}>客戶管理</h2>
          <p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>
            共 {customers.length} 位　姓名可重複；辨識末碼可自訂 2 碼、3 碼以上
            {countsLoading && <span style={{ marginLeft:8, color:'var(--indigo)' }}>・有效訂單數背景整理中</span>}
          </p>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input ref={importRef} type="file" accept=".json,application/json" onChange={importCustomerFile} style={{ display:'none' }}/>
          <button className="btn btn-ghost" disabled={importing} onClick={() => importRef.current?.click()}><Upload size={15}/>{importing ? '匯入中...' : '匯入客戶檔'}</button>
          <button className="btn btn-ghost" onClick={() => setShowArchived(v => !v)}>{showArchived ? '隱藏封存' : '顯示封存'}</button>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={15}/>新增客戶</button>
        </div>
      </div>

      <div style={{ background:'var(--sky-light)', borderRadius:8, padding:'9px 12px', marginBottom:14, fontSize:12, color:'#0369a1' }}>
        📱 辨識末碼可重複，也可自行輸入 2～3 碼以上，例如「00」或「000」；完整電話填入後會自動帶出末兩碼。搜尋會掃描目前完整載入的全部客戶，也支援客戶備註。
      </div>

      <div style={{ marginBottom:14, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        <div className="search-input-wrap" style={{ flex:'1 1 360px', maxWidth:520 }}>
          <Search size={14}/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋姓名、辨識末碼、完整電話、Line、FB、備註..."
            style={{ padding:'8px 8px 8px 32px', border:'1.5px solid var(--border)', borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', background:'var(--surface)', width:'100%' }}/>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surface)', border:'1.5px solid var(--border)', borderRadius:8, padding:'0 10px', minHeight:38 }}>
          <ArrowUpDown size={14} style={{ color:'var(--indigo)' }}/>
          <span style={{ fontSize:12, fontWeight:800, color:'var(--text-secondary)', whiteSpace:'nowrap' }}>排序</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ border:0, outline:'none', background:'transparent', fontWeight:700, fontFamily:'inherit', minWidth:165 }} aria-label="客戶排序方式">
            {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      {!loading && <div style={{ fontSize:11, color:'var(--text-muted)', margin:'-5px 0 10px' }}>
        {q ? <>搜尋結果 <strong>{filtered.length}</strong> 位；搜尋範圍為全部 {customers.length} 位客戶。</> : <>目前顯示 {Math.min(displayed.length, filtered.length)} / {filtered.length} 位客戶。</>}
      </div>}

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>姓名</th><th>辨識末碼</th><th>Line 暱稱</th><th>FB 名稱</th><th>完整電話</th><th>有效訂單數</th><th>備註</th><th style={{ textAlign:'right' }}>操作</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ textAlign:'center', padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/></td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={8}><div className="empty-state"><Users size={36}/><span>找不到符合的客戶</span></div></td></tr>}
              {displayed.map(c => {
                const archived = c.active === false
                const last2 = getCustomerPhoneLast2(c)
                return (
                  <tr key={c.id} style={{ opacity:archived ? .55 : 1 }}>
                    <td><div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--indigo-light)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'var(--indigo)' }}>{c.name.charAt(0)}</div>
                      <div><div style={{ fontWeight:700 }}>{c.name}</div>{archived && <span className="badge badge-gray">已封存</span>}</div>
                    </div></td>
                    <td>{last2 ? <span className="badge badge-indigo">📱 {last2}</span> : '—'}</td>
                    <td>{c.line_nick ? <span className="badge badge-emerald">🟢 {c.line_nick}</span> : '—'}</td>
                    <td>{c.fb_name ? <span className="badge badge-sky">📘 {c.fb_name}</span> : '—'}</td>
                    <td style={{ color:'var(--text-secondary)' }}>{c.phone || '—'}</td>
                    <td>{countsLoading && orderCounts[c.id] == null ? <span style={{ color:'var(--text-muted)' }}>…</span> : orderCounts[c.id] ? <span className="badge badge-indigo">{orderCounts[c.id]} 筆</span> : '0'}</td>
                    <td style={{ color:'var(--text-secondary)', fontSize:13 }}>{c.note || '—'}</td>
                    <td style={{ textAlign:'right' }}><div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                      {!archived && <button className="btn-icon btn" onClick={() => openEdit(c)}><Pencil size={13}/></button>}
                      {!archived
                        ? <button className="btn-icon btn" onClick={() => setConfirmArchive(c)} style={{ color:'var(--rose)' }} title="封存"><Archive size={13}/></button>
                        : <button className="btn-icon btn" onClick={() => restoreCustomer(c)} title="還原"><RotateCcw size={13}/></button>}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!loading && displayed.length < filtered.length && <div style={{ padding:12, textAlign:'center', borderTop:'1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={() => setRenderLimit(v => v + RENDER_STEP)}>顯示更多客戶（{displayed.length} / {filtered.length}）</button>
        </div>}
      </div>

      {showModal && (
        <Modal title={editId ? '編輯客戶資料' : '新增客戶'} onClose={() => setShowModal(false)}>
          <div style={{ background:'var(--sky-light)', borderRadius:8, padding:'9px 12px', marginBottom:14, fontSize:12, color:'#0369a1' }}>
            ℹ️ 同名客戶可以存在；請用辨識末碼、完整電話、Line、FB 或備註協助辨識。
          </div>
          <div className="form-group"><label>真實姓名 *</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name:e.target.value }))}/></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="form-group"><label>辨識末碼</label><input inputMode="numeric" value={form.phone_last2} onChange={e => setForm(p => ({ ...p, phone_last2:e.target.value.replace(/\D/g,'') }))} placeholder="例如：12、000"/></div>
            <div className="form-group"><label>完整電話</label><input type="tel" value={form.phone} onChange={e => updatePhone(e.target.value)} placeholder="0912-345-678"/></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="form-group"><label>Line 暱稱</label><input value={form.line_nick} onChange={e => setForm(p => ({ ...p, line_nick:e.target.value }))}/></div>
            <div className="form-group"><label>FB 名稱</label><input value={form.fb_name} onChange={e => setForm(p => ({ ...p, fb_name:e.target.value }))}/></div>
          </div>
          <div className="form-group"><label>備註</label><input value={form.note} onChange={e => setForm(p => ({ ...p, note:e.target.value }))}/></div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '儲存中...' : '儲存'}</button>
          </div>
        </Modal>
      )}

      {confirmArchive && <ConfirmDialog message={`確定要封存客戶「${confirmArchive.name}」？\n不會刪除歷史訂單，之後也可以還原。`} onConfirm={() => archiveCustomer(confirmArchive)} onCancel={() => setConfirmArchive(null)}/>} 
    </div>
  )
}
