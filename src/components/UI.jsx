import { createContext, useContext, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react'

const ToastCtx = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((msg, type = 'success') => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])

  const remove = (id) => setToasts(p => p.filter(t => t.id !== id))

  return (
    <ToastCtx.Provider value={addToast}>
      {children}
      <div className="toast-container no-print">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' && <CheckCircle size={16} color="var(--emerald)" />}
            {t.type === 'error' && <XCircle size={16} color="var(--rose)" />}
            {t.type === 'warning' && <AlertCircle size={16} color="var(--amber)" />}
            <span style={{ flex: 1 }}>{t.msg}</span>
            <button onClick={() => remove(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

const BACKDROP = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,.48)',
  backdropFilter: 'blur(4px)',
  zIndex: 9000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
  boxSizing: 'border-box',
  animation: 'fadeIn .15s ease',
  overflowY: 'auto',
}

export function Modal({ title, onClose, children, width = 560 }) {
  return createPortal(
    <div className="app-modal-backdrop" style={BACKDROP} onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        className="card animate-scale modal-card"
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          margin: 'auto',
          flexShrink: 0,
        }}
      >
        <div className="card-header modal-header" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
          <button className="btn-icon btn" onClick={onClose} aria-label="關閉"><X size={16} /></button>
        </div>
        <div className="card-body modal-body">{children}</div>
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({ message, onConfirm, onCancel, danger = true }) {
  return createPortal(
    <div className="app-modal-backdrop" style={BACKDROP} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div
        className="card animate-scale confirm-card"
        style={{ width: '100%', maxWidth: 380, margin: 'auto', flexShrink: 0 }}
      >
        <div className="card-body confirm-body" style={{ textAlign: 'center', padding: '28px 24px' }}>
          <AlertCircle size={40} color={danger ? 'var(--rose)' : 'var(--amber)'} style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 20, whiteSpace: 'pre-line' }}>{message}</p>
          <div className="confirm-actions" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={onCancel}>取消</button>
            <button className={`btn ${danger ? 'btn-danger' : 'btn-amber'}`} onClick={onConfirm}>確認</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function SearchableSelect({ options = [], value, onChange, placeholder = '請選擇...' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
  const selected = options.find(o => o.value === value)

  return (
    <div className="dropdown">
      <button
        type="button"
        className="btn btn-ghost"
        style={{ width: '100%', justifyContent: 'space-between', background: 'var(--surface)', border: '1.5px solid var(--border)' }}
        onClick={() => setOpen(p => !p)}
      >
        <span style={{ color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <div className="dropdown-menu" style={{ width: '100%' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="搜尋..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
              onClick={e => e.stopPropagation()}
            />
          </div>
          {filtered.length === 0 && <div className="dropdown-item" style={{ color: 'var(--text-muted)' }}>無結果</div>}
          {filtered.map(o => (
            <div key={o.value} className="dropdown-item" onClick={() => { onChange(o.value); setOpen(false); setQ('') }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12 }}>
      <div className="loading-spinner" />
      <span style={{ color: 'var(--text-muted)' }}>載入中...</span>
    </div>
  )
}
