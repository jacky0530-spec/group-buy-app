import { useState, useEffect, useCallback } from 'react'
import { ProductsAPI, CustomersAPI, OrdersAPI } from '../lib/db'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import { Plus, Pencil, Trash2, Search, TrendingUp, X, Tag } from 'lucide-react'

export const CATEGORIES = [
  { id: 'daily',    name: '日用品',   icon: '🧴', color: '#3b82f6' },
  { id: 'frozen',   name: '冷凍食品', icon: '🧊', color: '#06b6d4' },
  { id: 'clothing', name: '服飾',     icon: '👗', color: '#ec4899' },
  { id: 'biscuit',  name: '餅乾',     icon: '🍪', color: '#f59e0b' },
  { id: 'candy',    name: '糖果',     icon: '🍬', color: '#8b5cf6' },
  { id: 'other',    name: '其他',     icon: '📦', color: '#6b7280' },
]
export const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

// ── 規格設定定義 ──────────────────────────────────────────────
// 每個分類可設定的規格模式
const SPEC_MODES = {
  clothing: [
    { id: 'color_size', label: '顏色 ＋ 尺碼' },
    { id: 'color_free', label: '顏色 ＋ Free Size' },
    { id: 'color_only', label: '僅顏色' },
    { id: 'size_only',  label: '僅尺碼' },
    { id: 'none',       label: '無規格' },
  ],
  daily: [
    { id: 'random',      label: '隨機出貨' },
    { id: 'color_only',  label: '僅顏色' },
    { id: 'color_size',  label: '顏色 ＋ 尺寸' },
    { id: 'none',        label: '無規格' },
  ],
}

// 預設尺碼選項
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']

// 預設顏色
const PRESET_COLORS = ['黑色', '白色', '灰色', '米白', '藏青', '紅色', '粉色', '藍色', '綠色', '黃色', '咖啡', '紫色']

const EMPTY_FORM = {
  name: '', price: '', cost: '', category: 'other', note: '',
  spec_mode: 'none',
  spec_colors: [],    // ['黑色','白色',...]
  spec_sizes: [],     // ['S','M','L',...]
  color_input: '',    // 暫存輸入框
  size_input: '',     // 暫存輸入框
}

// ── 規格標籤顯示 ──────────────────────────────────────────────
function SpecBadges({ product }) {
  const mode = product.spec_mode
  if (!mode || mode === 'none') return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  if (mode === 'random') return <span className="badge badge-sky">🎲 隨機</span>
  const colors = product.spec_colors || []
  const sizes  = product.spec_sizes  || []
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {colors.length > 0 && (
        <span className="badge badge-pink">🎨 {colors.length} 色</span>
      )}
      {mode === 'color_free' && (
        <span className="badge badge-gray">Free Size</span>
      )}
      {sizes.length > 0 && (
        <span className="badge badge-indigo">📏 {sizes.join('/')}</span>
      )}
    </div>
  )
}

// ── 規格編輯區塊 ─────────────────────────────────────────────
function SpecEditor({ form, setForm }) {
  const cat = form.category
  const modes = SPEC_MODES[cat]
  if (!modes) return null   // 冷凍食品、餅乾、糖果、其他 → 不顯示規格

  const mode = form.spec_mode || 'none'
  const showColor = ['color_size','color_free','color_only','color_size'].includes(mode)
  const showSize  = mode === 'color_size' || mode === 'size_only'
  const isRandom  = mode === 'random'

  function addColor() {
    const v = form.color_input.trim()
    if (!v || form.spec_colors.includes(v)) { setForm(p => ({ ...p, color_input: '' })); return }
    setForm(p => ({ ...p, spec_colors: [...p.spec_colors, v], color_input: '' }))
  }
  function removeColor(c) { setForm(p => ({ ...p, spec_colors: p.spec_colors.filter(x => x !== c) })) }

  function addSize() {
    const v = form.size_input.trim().toUpperCase()
    if (!v || form.spec_sizes.includes(v)) { setForm(p => ({ ...p, size_input: '' })); return }
    setForm(p => ({ ...p, spec_sizes: [...p.spec_sizes, v], size_input: '' }))
  }
  function removeSize(s) { setForm(p => ({ ...p, spec_sizes: p.spec_sizes.filter(x => x !== s) })) }

  function togglePresetSize(s) {
    setForm(p => ({
      ...p,
      spec_sizes: p.spec_sizes.includes(s)
        ? p.spec_sizes.filter(x => x !== s)
        : [...p.spec_sizes, s]
    }))
  }

  return (
    <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 16, marginTop: 4, marginBottom: 4 }}>
      {/* 模式選擇 */}
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>規格模式</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {modes.map(m => (
            <button key={m.id} type="button"
              onClick={() => setForm(p => ({ ...p, spec_mode: m.id, spec_colors: [], spec_sizes: [] }))}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit',
                fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                border: `2px solid ${mode === m.id ? 'var(--indigo)' : 'var(--border)'}`,
                background: mode === m.id ? 'var(--indigo-light)' : 'var(--surface)',
                color: mode === m.id ? 'var(--indigo-dark)' : 'var(--text-secondary)',
              }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 隨機說明 */}
      {isRandom && (
        <div style={{ background: 'var(--sky-light)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#0369a1' }}>
          🎲 訂單備註將顯示「隨機出貨」，不需額外選色或選碼。
        </div>
      )}

      {/* 顏色編輯 */}
      {showColor && (
        <div className="form-group">
          <label>顏色選項</label>
          {/* 快速預設 */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {PRESET_COLORS.map(c => (
              <button key={c} type="button"
                onClick={() => {
                  setForm(p => ({
                    ...p,
                    spec_colors: p.spec_colors.includes(c)
                      ? p.spec_colors.filter(x => x !== c)
                      : [...p.spec_colors, c]
                  }))
                }}
                style={{
                  padding: '4px 10px', borderRadius: 99, fontSize: 12, fontFamily: 'inherit',
                  cursor: 'pointer', transition: 'all .12s', fontWeight: 600,
                  border: `1.5px solid ${form.spec_colors.includes(c) ? '#ec4899' : 'var(--border)'}`,
                  background: form.spec_colors.includes(c) ? '#fdf2f8' : 'var(--surface)',
                  color: form.spec_colors.includes(c) ? '#be185d' : 'var(--text-secondary)',
                }}>
                {c}
              </button>
            ))}
          </div>
          {/* 自訂輸入 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={form.color_input}
              onChange={e => setForm(p => ({ ...p, color_input: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addColor())}
              placeholder="輸入自訂顏色，按 Enter 加入"
              style={{ flex: 1, padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addColor}>加入</button>
          </div>
          {/* 已選顏色 */}
          {form.spec_colors.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {form.spec_colors.map(c => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#fdf2f8', border: '1.5px solid #fbcfe8', borderRadius: 99, fontSize: 12, fontWeight: 600, color: '#be185d' }}>
                  {c}
                  <button type="button" onClick={() => removeColor(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#be185d', display: 'flex', padding: 0, marginLeft: 2 }}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 尺碼編輯 */}
      {showSize && (
        <div className="form-group">
          <label>尺碼選項</label>
          {/* 快速預設尺碼 */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {DEFAULT_SIZES.map(s => (
              <button key={s} type="button"
                onClick={() => togglePresetSize(s)}
                style={{
                  padding: '4px 10px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit',
                  cursor: 'pointer', transition: 'all .12s', fontWeight: 700,
                  border: `1.5px solid ${form.spec_sizes.includes(s) ? 'var(--indigo)' : 'var(--border)'}`,
                  background: form.spec_sizes.includes(s) ? 'var(--indigo-light)' : 'var(--surface)',
                  color: form.spec_sizes.includes(s) ? 'var(--indigo-dark)' : 'var(--text-secondary)',
                }}>
                {s}
              </button>
            ))}
          </div>
          {/* 自訂輸入 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={form.size_input}
              onChange={e => setForm(p => ({ ...p, size_input: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSize())}
              placeholder="自訂尺碼（如 26吋、38號），按 Enter 加入"
              style={{ flex: 1, padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addSize}>加入</button>
          </div>
          {/* 已選尺碼 */}
          {form.spec_sizes.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {form.spec_sizes.map(s => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--indigo-light)', border: '1.5px solid #c7d2fe', borderRadius: 8, fontSize: 12, fontWeight: 700, color: 'var(--indigo-dark)' }}>
                  {s}
                  <button type="button" onClick={() => removeSize(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--indigo)', display: 'flex', padding: 0, marginLeft: 2 }}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Free Size 說明 */}
      {mode === 'color_free' && (
        <div style={{ background: 'var(--emerald-light)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#065f46', marginTop: 4 }}>
          ✅ Free Size：訂單只需選顏色，不需選尺碼。
        </div>
      )}
    </div>
  )
}

// ── 主元件 ───────────────────────────────────────────────────
const EMPTY = EMPTY_FORM

export default function Products() {
  const toast = useToast()
  const [products, setProducts]     = useState([])
  const [customers, setCustomers]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterCat, setFilterCat]   = useState('all')
  const [showModal, setShowModal]   = useState(false)
  const [form, setForm]             = useState(EMPTY)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  // 批次開單
  const [batchBuyers, setBatchBuyers]   = useState([])
  const [custSearch, setCustSearch]     = useState('')
  const [custDropOpen, setCustDropOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [prods, custs] = await Promise.all([ProductsAPI.list(), CustomersAPI.list()])
    setProducts(prods); setCustomers(custs)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = products.filter(p => {
    const m = p.name.toLowerCase().includes(search.toLowerCase())
    const c = filterCat === 'all' || p.category === filterCat
    return m && c
  })

  function openAdd() {
    setForm(EMPTY); setEditId(null); setBatchBuyers([]); setShowModal(true)
  }
  function openEdit(p) {
    setForm({
      name: p.name, price: p.price, cost: p.cost,
      category: p.category || 'other', note: p.note || '',
      spec_mode:   p.spec_mode   || 'none',
      spec_colors: p.spec_colors || [],
      spec_sizes:  p.spec_sizes  || [],
      color_input: '', size_input: '',
    })
    setEditId(p.id); setBatchBuyers([]); setShowModal(true)
  }

  // 切換分類時重置規格
  function setCategory(catId) {
    setForm(p => ({ ...p, category: catId, spec_mode: 'none', spec_colors: [], spec_sizes: [] }))
  }

  function addBuyer(c) {
    if (!batchBuyers.find(b => b.id === c.id))
      // specs = [{ color:'', size:'', qty:1 }, ...]  每組規格獨立數量
      setBatchBuyers(p => [...p, { id: c.id, name: c.name, specs: [{ color:'', size:'', qty:1 }] }])
    setCustDropOpen(false); setCustSearch('')
  }
  // 不再需要舊的 updateBuyerQty / updateBuyerSpec
  function removeBuyer(id) { setBatchBuyers(p => p.filter(b => b.id !== id)) }

  function addSpecRow(buyerId) {
    setBatchBuyers(p => p.map(b => b.id === buyerId
      ? { ...b, specs: [...b.specs, { color:'', size:'', qty:1 }] }
      : b
    ))
  }
  function removeSpecRow(buyerId, idx) {
    setBatchBuyers(p => p.map(b => {
      if (b.id !== buyerId) return b
      const next = b.specs.filter((_, i) => i !== idx)
      return next.length === 0 ? null : { ...b, specs: next }
    }).filter(Boolean))
  }
  function updateSpecRow(buyerId, idx, field, value) {
    setBatchBuyers(p => p.map(b => {
      if (b.id !== buyerId) return b
      return { ...b, specs: b.specs.map((s, i) => i === idx ? { ...s, [field]: value } : s) }
    }))
  }

  const profit = p => (+p.price) - (+p.cost)
  const margin = p => (+p.price) > 0 ? Math.round((profit(p) / (+p.price)) * 100) : 0

  async function save() {
    if (!form.name.trim() || form.price === '' || form.cost === '') {
      toast('請填寫名稱、售價與成本', 'error'); return
    }
    setSaving(true)
    try {
      const dup = await ProductsAPI.isDuplicate(form.name.trim(), editId)
      if (dup) { toast(`商品「${form.name}」已存在`, 'error'); return }

      const payload = {
        name:        form.name.trim(),
        price:       +form.price,
        cost:        +form.cost,
        category:    form.category,
        note:        form.note.trim(),
        spec_mode:   form.spec_mode || 'none',
        spec_colors: form.spec_colors || [],
        spec_sizes:  form.spec_sizes  || [],
      }

      let prodId = editId
      if (editId) {
        await ProductsAPI.update(editId, payload)
        toast('商品已更新 ✓')
      } else {
        const created = await ProductsAPI.create(payload)
        prodId = created.id
        toast('商品已新增 ✓')
      }

      if (batchBuyers.length > 0) {
        const mode = payload.spec_mode || 'none'
        // 驗證每位客戶每組規格
        for (const b of batchBuyers) {
          for (const s of b.specs) {
            if (['color_size','color_only'].includes(mode) && !s.color) {
              toast(`請為「${b.name}」選擇顏色`, 'error'); return
            }
            if (['color_size','size_only'].includes(mode) && !s.size) {
              toast(`請為「${b.name}」選擇尺碼`, 'error'); return
            }
          }
        }
        // 每位客戶建一筆訂單，items 含所有規格列
        await Promise.all(batchBuyers.map(b => {
          const items = b.specs.map(s => ({
            id:    prodId,
            name:  payload.name,
            price: payload.price,
            qty:   s.qty,
            note:  '',
            spec:  { color: s.color, size: s.size },
          }))
          const total = items.reduce((sum, i) => sum + i.price * i.qty, 0)
          return OrdersAPI.create({
            customer_id:   b.id,
            customer_name: b.name,
            items,
            total_amount:  total,
            note: '',
          })
        }))
        toast(`已同時幫 ${batchBuyers.length} 位客戶開立訂單 ✓`)
      }

      setShowModal(false); load()
    } finally { setSaving(false) }
  }

  async function del(id, name) {
    await ProductsAPI.delete(id)
    setConfirmDel(null); toast(`已刪除「${name}」`, 'warning'); load()
  }

  const filtCusts = customers.filter(c =>
    c.name.toLowerCase().includes(custSearch.toLowerCase()) ||
    (c.line_nick || '').toLowerCase().includes(custSearch.toLowerCase())
  )

  return (
    <div className="animate-fade">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>商品管理</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>共 {products.length} 項商品</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={15} />新增商品</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-input-wrap" style={{ flex: 1, minWidth: 180 }}>
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋商品名稱..."
            style={{ padding: '8px 8px 8px 32px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit', background: 'var(--surface)', width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${filterCat === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterCat('all')}>全部</button>
          {CATEGORIES.map(c => (
            <button key={c.id} className={`btn btn-sm ${filterCat === c.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterCat(c.id)}>
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr>
              <th>商品名稱</th><th>分類</th><th>規格</th><th>售價</th><th>成本</th><th>毛利</th><th>利潤率</th><th>備註</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9}><div className="empty-state"><Tag size={36} /><span>尚無商品</span></div></td></tr>
              )}
              {filtered.map(p => {
                const cat = CAT_MAP[p.category] || CAT_MAP.other
                const pct = margin(p)
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{p.name}</td>
                    <td><span className="badge" style={{ background: cat.color + '22', color: cat.color }}>{cat.icon} {cat.name}</span></td>
                    <td><SpecBadges product={p} /></td>
                    <td style={{ fontWeight: 700 }}>NT${p.price}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>NT${p.cost}</td>
                    <td><span style={{ fontWeight: 700, color: profit(p) >= 0 ? 'var(--emerald)' : 'var(--rose)' }}>{profit(p) >= 0 ? '+' : ''}NT${profit(p)}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 48, height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct > 30 ? 'var(--emerald)' : pct > 10 ? 'var(--amber)' : 'var(--rose)', borderRadius: 99 }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{p.note || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn-icon btn" onClick={() => openEdit(p)}><Pencil size={13} /></button>
                        <button className="btn-icon btn" onClick={() => setConfirmDel(p)} style={{ borderColor: 'var(--rose-light)', color: 'var(--rose)' }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 新增 / 編輯 Modal ── */}
      {showModal && (
        <Modal title={editId ? '編輯商品' : '新增商品'} onClose={() => setShowModal(false)} width={580}>

          <div className="form-group">
            <label>商品名稱 *</label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="例如：韓國海苔禮盒" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>售價 (NT$) *</label>
              <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="0" min="0" />
            </div>
            <div className="form-group">
              <label>成本 (NT$) *</label>
              <input type="number" value={form.cost} onChange={e => setForm(p => ({ ...p, cost: e.target.value }))} placeholder="0" min="0" />
            </div>
          </div>

          {form.price !== '' && form.cost !== '' && (
            <div style={{ background: profit(form) >= 0 ? 'var(--emerald-light)' : 'var(--rose-light)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, display: 'flex', gap: 16, alignItems: 'center' }}>
              <TrendingUp size={14} color={profit(form) >= 0 ? 'var(--emerald)' : 'var(--rose)'} />
              <span>毛利：<strong>NT${profit(form)}</strong></span>
              <span>利潤率：<strong>{margin(form)}%</strong></span>
            </div>
          )}

          {/* 分類選擇 */}
          <div className="form-group">
            <label>商品分類</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {CATEGORIES.map(c => (
                <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                  style={{ padding: '8px', borderRadius: 8, border: `2px solid ${form.category === c.id ? c.color : 'var(--border)'}`, background: form.category === c.id ? c.color + '18' : 'var(--surface)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600, color: form.category === c.id ? c.color : 'var(--text-secondary)', transition: 'all .15s' }}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* 規格編輯（服飾 / 日用品限定） */}
          <SpecEditor form={form} setForm={setForm} />

          <div className="form-group">
            <label>備註</label>
            <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="例如：需冷凍保存、易碎品..." />
          </div>

          {/* 批次開單 */}
          <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>🛒 一鍵批次開單（選填）</div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, position: 'relative' }}>
              <div style={{ marginBottom: 10 }}>
                <input value={custSearch}
                  onFocus={() => setCustDropOpen(true)}
                  onBlur={() => setTimeout(() => setCustDropOpen(false), 150)}
                  onChange={e => { setCustSearch(e.target.value); setCustDropOpen(true) }}
                  placeholder="點擊選擇或輸入搜尋客戶..."
                  style={{ width: '100%', padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: 'var(--surface)', cursor: 'pointer' }} />
                {custDropOpen && (
                  <div style={{ position: 'absolute', left: 12, right: 12, background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-md)', maxHeight: 200, overflowY: 'auto', zIndex: 50 }}>
                    {/* 未被加入的客戶清單，依搜尋即時篩選 */}
                    {filtCusts.filter(c => !batchBuyers.find(b => b.id === c.id)).length === 0 && (
                      <div className="dropdown-item" style={{ color: 'var(--text-muted)' }}>
                        {customers.length === 0 ? '尚無客戶，請先至客戶管理新增' : '所有客戶皆已加入'}
                      </div>
                    )}
                    {filtCusts.filter(c => !batchBuyers.find(b => b.id === c.id)).map(c => (
                      <div key={c.id} className="dropdown-item" onMouseDown={() => addBuyer(c)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--indigo-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: 'var(--indigo)', flexShrink: 0 }}>
                            {c.name.charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {c.line_nick && `Line: ${c.line_nick}`}{c.line_nick && c.fb_name && '　'}{c.fb_name && `FB: ${c.fb_name}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {batchBuyers.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '6px 0' }}>尚未加入客戶</div>}
              {batchBuyers.map(b => {
                const mode     = form.spec_mode || 'none'
                const colors   = form.spec_colors || []
                const sizes    = form.spec_sizes  || []
                const needColor = ['color_size','color_free','color_only'].includes(mode) && colors.length > 0
                const needSize  = ['color_size','size_only'].includes(mode) && sizes.length > 0
                const isRandom  = mode === 'random'
                const hasSpec   = needColor || needSize

                const buyerTotal = b.specs.reduce((s, sp) => s + (+form.price || 0) * sp.qty, 0)

                return (
                  <div key={b.id} style={{ padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
                    {/* 客戶標題列 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--indigo-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: 'var(--indigo)', flexShrink: 0 }}>
                        {b.name.charAt(0)}
                      </div>
                      <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{b.name}</span>
                      {isRandom && <span style={{ fontSize: 11, background: 'var(--sky-light)', color: '#0369a1', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>🎲 隨機出貨</span>}
                      <span style={{ fontSize: 12, color: 'var(--indigo)', fontWeight: 700 }}>NT${buyerTotal.toLocaleString()}</span>
                      <button type="button" onClick={() => removeBuyer(b.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', display: 'flex', padding: 2 }}>
                        <X size={13} />
                      </button>
                    </div>

                    {/* 每組規格列 */}
                    {b.specs.map((sp, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, paddingLeft: 34, flexWrap: 'wrap' }}>
                        {/* 顏色 */}
                        {needColor && (
                          <select value={sp.color} onChange={e => updateSpecRow(b.id, idx, 'color', e.target.value)}
                            style={{ padding: '4px 8px', border: `1.5px solid ${sp.color ? 'var(--indigo)' : 'var(--rose)'}`, borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', cursor: 'pointer' }}>
                            <option value="">選顏色 *</option>
                            {colors.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        )}
                        {/* 尺碼 */}
                        {needSize && (
                          <select value={sp.size} onChange={e => updateSpecRow(b.id, idx, 'size', e.target.value)}
                            style={{ padding: '4px 8px', border: `1.5px solid ${sp.size ? 'var(--indigo)' : 'var(--rose)'}`, borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', cursor: 'pointer' }}>
                            <option value="">選尺碼 *</option>
                            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        {/* Free Size 標籤 */}
                        {mode === 'color_free' && sp.color && (
                          <span style={{ fontSize: 11, background: 'var(--emerald-light)', color: '#065f46', padding: '3px 8px', borderRadius: 99, fontWeight: 600 }}>Free</span>
                        )}
                        {/* 數量 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <button type="button" onClick={() => updateSpecRow(b.id, idx, 'qty', Math.max(1, sp.qty - 1))}
                            style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                          <input type="number" value={sp.qty} min="1"
                            onChange={e => updateSpecRow(b.id, idx, 'qty', Math.max(1, parseInt(e.target.value)||1))}
                            style={{ width: 36, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 5, padding: '2px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                          <button type="button" onClick={() => updateSpecRow(b.id, idx, 'qty', sp.qty + 1)}
                            style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          NT${(+form.price||0) * sp.qty}
                        </span>
                        {/* 刪除此規格列（至少保留一列） */}
                        {b.specs.length > 1 && (
                          <button type="button" onClick={() => removeSpecRow(b.id, idx)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', display: 'flex', padding: 1 }}>
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    ))}

                    {/* 新增規格列按鈕（有規格模式才顯示） */}
                    {hasSpec && (
                      <button type="button" onClick={() => addSpecRow(b.id)}
                        style={{ marginLeft: 34, marginTop: 2, padding: '3px 10px', background: 'var(--indigo-light)', border: '1.5px dashed var(--indigo)', borderRadius: 7, color: 'var(--indigo-dark)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Plus size={11} /> 加規格
                      </button>
                    )}
                  </div>
                )
              })}
              {batchBuyers.length > 0 && (
                <div style={{ textAlign: 'right', marginTop: 10, fontSize: 13, color: 'var(--indigo)', fontWeight: 700 }}>
                  共 {batchBuyers.length} 人，合計 NT${batchBuyers.reduce((s, b) => s + b.specs.reduce((ss, sp) => ss + (+form.price||0)*sp.qty, 0), 0).toLocaleString()}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '處理中...' : editId ? '確認更新' : '新增商品'}</button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog message={`確定要刪除「${confirmDel.name}」？`}
          onConfirm={() => del(confirmDel.id, confirmDel.name)}
          onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}
