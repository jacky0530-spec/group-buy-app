import { useState, useEffect, useCallback } from 'react'
import { CustomersAPI, OrdersAPI } from '../lib/db'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import { Plus, Pencil, Archive, Search, Users, RotateCcw } from 'lucide-react'

const EMPTY = { name:'', line_nick:'', fb_name:'', phone:'', note:'' }

export default function Customers() {
  const toast = useToast()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null)
  const [orderCounts, setOrderCounts] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [custs, orders] = await Promise.all([
        CustomersAPI.list({ includeArchived: showArchived }),
        OrdersAPI.list(),
      ])
      setCustomers(custs)
      const counts = {}
      orders.filter(o => o.status !== 'cancelled' && !o.archived).forEach(o => {
        if (o.customer_id) counts[o.customer_id] = (counts[o.customer_id] || 0) + 1
      })
      setOrderCounts(counts)
    } catch (err) {
      toast('載入失敗：' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [showArchived, toast])

  useEffect(() => { load() }, [load])

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.line_nick || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.fb_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  )

  function openAdd() {
    setForm({ ...EMPTY })
    setEditId(null)
    setShowModal(true)
  }

  function openEdit(c) {
    setForm({
      name:c.name || '', line_nick:c.line_nick || '', fb_name:c.fb_name || '',
      phone:c.phone || '', note:c.note || '',
    })
    setEditId(c.id)
    setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) { toast('請填寫客戶姓名', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        name:form.name.trim(), line_nick:form.line_nick.trim(), fb_name:form.fb_name.trim(),
        phone:form.phone.trim(), note:form.note.trim(),
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

  async function archiveCustomer(c) {
    try {
      await CustomersAPI.archive(c.id)
      setConfirmArchive(null)
      toast(`已封存「${c.name}」；歷史訂單仍保留`, 'warning')
      await load()
    } catch (err) { toast('封存失敗：' + err.message, 'error') }
  }

  async function restoreCustomer(c) {
    try {
      await CustomersAPI.restore(c.id)
      toast(`已還原「${c.name}」`)
      await load()
    } catch (err) { toast('還原失敗：' + err.message, 'error') }
  }

  return (
    <div className="animate-fade">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800 }}>客戶管理</h2>
          <p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>
            共 {customers.length} 位　姓名可重複；電話 / Line / FB 用來輔助辨識
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost" onClick={() => setShowArchived(v => !v)}>{showArchived ? '隱藏封存' : '顯示封存'}</button>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={15}/>新增客戶</button>
        </div>
      </div>

      <div style={{ marginBottom:14 }}>
        <div className="search-input-wrap" style={{ maxWidth:420 }}>
          <Search size={14}/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋姓名、Line、FB、電話..."
            style={{ padding:'8px 8px 8px 32px', border:'1.5px solid var(--border)', borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', background:'var(--surface)', width:'100%' }}/>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>姓名</th><th>Line 暱稱</th><th>FB 名稱</th><th>電話</th><th>有效訂單數</th><th>備註</th><th style={{ textAlign:'right' }}>操作</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign:'center', padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/></td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={7}><div className="empty-state"><Users size={36}/><span>尚無客戶</span></div></td></tr>}
              {filtered.map(c => {
                const archived = c.active === false
                return (
                  <tr key={c.id} style={{ opacity:archived ? .55 : 1 }}>
                    <td><div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--indigo-light)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'var(--indigo)' }}>{c.name.charAt(0)}</div>
                      <div><div style={{ fontWeight:700 }}>{c.name}</div>{archived && <span className="badge badge-gray">已封存</span>}</div>
                    </div></td>
                    <td>{c.line_nick ? <span className="badge badge-emerald">🟢 {c.line_nick}</span> : '—'}</td>
                    <td>{c.fb_name ? <span className="badge badge-sky">📘 {c.fb_name}</span> : '—'}</td>
                    <td style={{ color:'var(--text-secondary)' }}>{c.phone || '—'}</td>
                    <td>{orderCounts[c.id] ? <span className="badge badge-indigo">{orderCounts[c.id]} 筆</span> : '0'}</td>
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
      </div>

      {showModal && (
        <Modal title={editId ? '編輯客戶資料' : '新增客戶'} onClose={() => setShowModal(false)}>
          <div style={{ background:'var(--sky-light)', borderRadius:8, padding:'9px 12px', marginBottom:14, fontSize:12, color:'#0369a1' }}>
            ℹ️ 不再以姓名判斷重複；同名客戶可以建立。系統會用電話、Line、FB 資料提醒重複。
          </div>
          <div className="form-group"><label>真實姓名 *</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name:e.target.value }))}/></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="form-group"><label>Line 暱稱</label><input value={form.line_nick} onChange={e => setForm(p => ({ ...p, line_nick:e.target.value }))}/></div>
            <div className="form-group"><label>FB 名稱</label><input value={form.fb_name} onChange={e => setForm(p => ({ ...p, fb_name:e.target.value }))}/></div>
          </div>
          <div className="form-group"><label>聯絡電話</label><input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone:e.target.value }))} placeholder="0912-345-678"/></div>
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
