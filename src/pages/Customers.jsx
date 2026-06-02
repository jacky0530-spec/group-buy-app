import { useState, useEffect, useCallback } from 'react'
import { CustomersAPI, OrdersAPI } from '../lib/db'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import { Plus, Pencil, Trash2, Search, Users } from 'lucide-react'

const EMPTY = { name:'', line_nick:'', fb_name:'', phone:'', note:'' }

export default function Customers() {
  const toast = useToast()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState(EMPTY)
  const [editId, setEditId]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [orderCounts, setOrderCounts] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [custs, orders] = await Promise.all([
      CustomersAPI.list(),
      OrdersAPI.list(),
    ])
    setCustomers(custs)
    const counts = {}
    orders.forEach(o => { if (o.customer_id) counts[o.customer_id] = (counts[o.customer_id]||0)+1 })
    setOrderCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.line_nick||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.fb_name||'').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone||'').includes(search)
  )

  function openAdd()   { setForm(EMPTY); setEditId(null); setShowModal(true) }
  function openEdit(c) { setForm({ name:c.name, line_nick:c.line_nick||'', fb_name:c.fb_name||'', phone:c.phone||'', note:c.note||'' }); setEditId(c.id); setShowModal(true) }

  async function save() {
    if (!form.name.trim()) { toast('請填寫客戶姓名','error'); return }
    setSaving(true)
    try {
      const dup = await CustomersAPI.isDuplicate(form.name.trim(), editId)
      if (dup) { toast(`客戶「${form.name}」已存在`,'error'); return }
      const payload = { name:form.name.trim(), line_nick:form.line_nick.trim(), fb_name:form.fb_name.trim(), phone:form.phone.trim(), note:form.note.trim() }
      if (editId) {
        await CustomersAPI.update(editId, payload)
        toast('客戶資料已更新 ✓')
      } else {
        await CustomersAPI.create(payload)
        toast('客戶已新增 ✓')
      }
      setShowModal(false); load()
    } finally { setSaving(false) }
  }

  async function del(id, name) {
    await CustomersAPI.delete(id)
    setConfirmDel(null); toast(`已刪除「${name}」`,'warning'); load()
  }

  return (
    <div className="animate-fade">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800 }}>客戶管理</h2>
          <p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>共 {customers.length} 位客戶</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={15}/>新增客戶</button>
      </div>

      <div style={{ marginBottom:14 }}>
        <div className="search-input-wrap" style={{ maxWidth:360 }}>
          <Search size={14}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋姓名、Line、FB、電話..."
            style={{ padding:'8px 8px 8px 32px', border:'1.5px solid var(--border)', borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', background:'var(--surface)', width:'100%' }}/>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr>
              <th>姓名</th><th>Line 暱稱</th><th>FB 名稱</th><th>電話</th><th>訂單數</th><th>備註</th>
              <th style={{ textAlign:'right' }}>操作</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign:'center',padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/></td></tr>}
              {!loading && filtered.length===0 && <tr><td colSpan={7}><div className="empty-state"><Users size={36}/><span>尚無客戶</span></div></td></tr>}
              {filtered.map(c=>(
                <tr key={c.id}>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:32,height:32,borderRadius:'50%',background:'var(--indigo-light)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:14,color:'var(--indigo)',flexShrink:0 }}>
                        {c.name.charAt(0)}
                      </div>
                      <span style={{ fontWeight:700 }}>{c.name}</span>
                    </div>
                  </td>
                  <td>{c.line_nick ? <span className="badge badge-emerald">🟢 {c.line_nick}</span> : <span style={{ color:'var(--text-muted)' }}>—</span>}</td>
                  <td>{c.fb_name  ? <span className="badge badge-sky">📘 {c.fb_name}</span>   : <span style={{ color:'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ color:'var(--text-secondary)' }}>{c.phone||'—'}</td>
                  <td>{orderCounts[c.id] ? <span className="badge badge-indigo">{orderCounts[c.id]} 筆</span> : <span style={{ color:'var(--text-muted)' }}>0</span>}</td>
                  <td style={{ color:'var(--text-secondary)',fontSize:13 }}>{c.note||'—'}</td>
                  <td style={{ textAlign:'right' }}>
                    <div style={{ display:'flex',gap:6,justifyContent:'flex-end' }}>
                      <button className="btn-icon btn" onClick={()=>openEdit(c)}><Pencil size={13}/></button>
                      <button className="btn-icon btn" onClick={()=>setConfirmDel(c)} style={{ borderColor:'var(--rose-light)',color:'var(--rose)' }}><Trash2 size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editId?'編輯客戶資料':'新增客戶'} onClose={()=>setShowModal(false)}>
          <div className="form-group"><label>真實姓名 *</label>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="例如：王小明"/>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <div className="form-group"><label>Line 暱稱</label>
              <input value={form.line_nick} onChange={e=>setForm(p=>({...p,line_nick:e.target.value}))} placeholder="Line 顯示名稱"/>
            </div>
            <div className="form-group"><label>FB 名稱</label>
              <input value={form.fb_name} onChange={e=>setForm(p=>({...p,fb_name:e.target.value}))} placeholder="Facebook 名稱"/>
            </div>
          </div>
          <div className="form-group"><label>聯絡電話</label>
            <input type="tel" value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} placeholder="0912-345-678"/>
          </div>
          <div className="form-group"><label>備註</label>
            <input value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} placeholder="例如：管理室代收、需冷藏配送..."/>
          </div>
          <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
            <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>取消</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'儲存中...':editId?'確認更新':'新增客戶'}</button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog message={`確定要刪除客戶「${confirmDel.name}」？`}
          onConfirm={()=>del(confirmDel.id,confirmDel.name)}
          onCancel={()=>setConfirmDel(null)}/>
      )}
    </div>
  )
}
