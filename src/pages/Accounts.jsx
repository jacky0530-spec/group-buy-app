import { useState, useEffect } from 'react'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import { useAuth } from '../components/AuthGuard'
import { db } from '../lib/firebase'
import {
  collection, doc, setDoc, getDocs, deleteDoc, getDoc, query, orderBy,
} from 'firebase/firestore'
import { Plus, Trash2, Shield, User, Mail, Eye, EyeOff, RefreshCw } from 'lucide-react'

const ROLES = {
  owner: { label: '負責人', color: '#f59e0b', bg: '#fffbeb', icon: '👑' },
  staff: { label: '員工',   color: '#6366f1', bg: '#eef2ff', icon: '👤' },
}

const ACCOUNTS_COL = 'accounts'

// ── Firebase REST API 建立帳號（不影響目前登入狀態）─────────
// 使用 Firebase Identity Toolkit API，用 API Key 即可呼叫
async function createAuthUser(email, password, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    }
  )
  const data = await res.json()
  if (!res.ok) {
    const code = data.error?.message || 'UNKNOWN'
    const msg = {
      'EMAIL_EXISTS':           '此 Email 已被使用。',
      'INVALID_EMAIL':          'Email 格式不正確。',
      'WEAK_PASSWORD':          '密碼強度不足，請使用至少 6 碼。',
      'WEAK_PASSWORD : Password should be at least 6 characters': '密碼至少需要 6 個字元。',
    }[code] || `建立失敗：${code}`
    throw new Error(msg)
  }
  return data.localId  // 新帳號的 uid
}

async function getAccounts() {
  const snap = await getDocs(query(collection(db, ACCOUNTS_COL), orderBy('created_at', 'asc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function saveAccountRecord(uid, data) {
  await setDoc(doc(db, ACCOUNTS_COL, uid), data)
}

async function deleteAccountRecord(uid) {
  await deleteDoc(doc(db, ACCOUNTS_COL, uid))
}

// ── 主元件 ───────────────────────────────────────────────────
export default function Accounts() {
  const toast    = useToast()
  const { user } = useAuth()

  const [accounts,   setAccounts]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showModal,  setShowModal]  = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [showPwd,    setShowPwd]    = useState(false)
  const [myRole,     setMyRole]     = useState(null)

  const [form, setForm] = useState({ display_name:'', email:'', password:'', role:'staff' })

  // 取得目前登入者角色
  useEffect(() => {
    if (!user) return
    getDoc(doc(db, ACCOUNTS_COL, user.uid)).then(d => {
      setMyRole(d.exists() ? d.data().role : 'owner')
    })
  }, [user])

  const isOwner = myRole === 'owner' || myRole === null

  const load = async () => {
    setLoading(true)
    try {
      const list = await getAccounts()
      if (list.length === 0 && user) {
        const ownerData = {
          email:        user.email,
          display_name: user.displayName || user.email.split('@')[0],
          role:         'owner',
          created_at:   new Date().toISOString(),
        }
        await saveAccountRecord(user.uid, ownerData)
        setAccounts([{ id: user.uid, ...ownerData }])
      } else {
        setAccounts(list)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── 新增帳號（REST API，不登出目前使用者）────────────────
  async function createAccount() {
    if (!form.display_name.trim()) { toast('請填寫姓名', 'error'); return }
    if (!form.email.trim())        { toast('請填寫 Email', 'error'); return }
    if (form.password.length < 6)  { toast('密碼至少 6 碼', 'error'); return }

    setSaving(true)
    try {
      // 從環境變數取 Firebase API Key
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
      if (!apiKey) throw new Error('找不到 Firebase API Key，請確認環境變數設定。')

      // 用 REST API 建立帳號，目前登入狀態完全不受影響
      const newUid = await createAuthUser(form.email.trim(), form.password, apiKey)

      // 寫入 Firestore 帳號記錄
      await saveAccountRecord(newUid, {
        email:        form.email.trim().toLowerCase(),
        display_name: form.display_name.trim(),
        role:         form.role,
        created_at:   new Date().toISOString(),
      })

      toast(`帳號「${form.display_name}」建立成功 ✓`)
      setShowModal(false)
      setForm({ display_name:'', email:'', password:'', role:'staff' })
      load()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── 刪除帳號記錄（白名單移除，對方立即無法登入）──────────
  async function deleteAccount(account) {
    if (account.id === user?.uid) { toast('不能刪除自己的帳號', 'error'); return }
    try {
      await deleteAccountRecord(account.id)
      toast(`已移除「${account.display_name}」的存取權限`, 'warning')
      setConfirmDel(null)
      load()
    } catch (err) {
      toast('刪除失敗：' + err.message, 'error')
    }
  }

  return (
    <div className="animate-fade">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800 }}>帳號管理</h2>
          <p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>
            共 {accounts.length} 個帳號　
            <span style={{ color: isOwner ? '#f59e0b' : 'var(--text-muted)', fontWeight:600 }}>
              {isOwner ? '👑 負責人模式' : '👤 員工（唯讀）'}
            </span>
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            <RefreshCw size={13}/>重新整理
          </button>
          {isOwner && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15}/>新增員工帳號
            </button>
          )}
        </div>
      </div>

      {/* 說明提示 */}
      <div style={{ background:'var(--amber-light)', border:'1.5px solid #fde68a', borderRadius:'var(--radius)', padding:'12px 16px', marginBottom:20, fontSize:13, color:'#92400e', display:'flex', gap:10, alignItems:'flex-start' }}>
        <Shield size={16} style={{ flexShrink:0, marginTop:1 }}/>
        <div>
          <strong>存取控管說明：</strong>
          只有列在此處的帳號才能登入系統。刪除後對方立即無法進入，即使知道密碼也會被攔截。
          {!isOwner && <span style={{ color:'var(--rose)', fontWeight:700, marginLeft:6 }}>員工無法新增或刪除帳號。</span>}
        </div>
      </div>

      {/* 帳號列表 */}
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr>
              <th>姓名</th>
              <th>Email</th>
              <th>角色</th>
              <th>建立時間</th>
              {isOwner && <th style={{ textAlign:'right' }}>操作</th>}
            </tr></thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} style={{ textAlign:'center', padding:40 }}>
                  <div className="loading-spinner" style={{ margin:'0 auto' }}/>
                </td></tr>
              )}
              {!loading && accounts.length === 0 && (
                <tr><td colSpan={5}>
                  <div className="empty-state"><User size={36}/><span>尚無帳號</span></div>
                </td></tr>
              )}
              {accounts.map(a => {
                const role     = ROLES[a.role] || ROLES.staff
                const isMe     = a.id === user?.uid
                const isOwnerAcc = a.role === 'owner'
                return (
                  <tr key={a.id} style={{ background: isMe ? 'var(--indigo-light)' : undefined }}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:34, height:34, borderRadius:'50%', background:role.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                          {role.icon}
                        </div>
                        <div>
                          <div style={{ fontWeight:700 }}>{a.display_name}</div>
                          {isMe && <div style={{ fontSize:11, color:'var(--indigo)', fontWeight:600 }}>（目前登入）</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ color:'var(--text-secondary)', fontSize:13 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <Mail size={12}/>{a.email}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ background:role.bg, color:role.color }}>
                        {role.icon} {role.label}
                      </span>
                    </td>
                    <td style={{ color:'var(--text-secondary)', fontSize:13 }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('zh-TW') : '—'}
                    </td>
                    {isOwner && (
                      <td style={{ textAlign:'right' }}>
                        {isMe || isOwnerAcc ? (
                          <span style={{ fontSize:12, color:'var(--text-muted)' }}>—</span>
                        ) : (
                          <button className="btn-icon btn" onClick={() => setConfirmDel(a)}
                            style={{ borderColor:'var(--rose-light)', color:'var(--rose)' }}>
                            <Trash2 size={13}/>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增帳號 Modal */}
      {showModal && (
        <Modal title="新增員工帳號" onClose={() => setShowModal(false)} width={440}>
          <div style={{ background:'var(--emerald-light)', border:'1px solid #6ee7b7', borderRadius:8, padding:'10px 14px', marginBottom:18, fontSize:13, color:'#065f46', display:'flex', gap:8, alignItems:'flex-start' }}>
            <span style={{ fontSize:16 }}>✅</span>
            <span>建立帳號時<strong>不會影響你目前的登入狀態</strong>，可以安心操作。</span>
          </div>

          <div className="form-group">
            <label>姓名 *</label>
            <input value={form.display_name}
              onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
              placeholder="例如：小美"/>
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input type="email" value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="staff@example.com"/>
          </div>
          <div className="form-group">
            <label>初始密碼 *（至少 6 碼）</label>
            <div style={{ position:'relative' }}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="設定員工初始密碼"
                style={{ paddingRight: 40 }}/>
              <button type="button" onClick={() => setShowPwd(p => !p)}
                style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:0 }}>
                {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>角色</label>
            <div style={{ display:'flex', gap:10 }}>
              {Object.entries(ROLES).map(([id, r]) => (
                <button key={id} type="button" onClick={() => setForm(p => ({ ...p, role: id }))}
                  style={{ flex:1, padding:'10px', borderRadius:10, border:`2px solid ${form.role===id ? r.color : 'var(--border)'}`, background:form.role===id ? r.bg : 'var(--surface)', cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:13, color:form.role===id ? r.color : 'var(--text-secondary)', transition:'all .15s' }}>
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button>
            <button className="btn btn-primary" onClick={createAccount} disabled={saving}>
              {saving ? '建立中...' : '建立帳號'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog
          message={`確定要移除「${confirmDel.display_name}」的存取權限？\n對方將無法再登入系統。`}
          onConfirm={() => deleteAccount(confirmDel)}
          onCancel={() => setConfirmDel(null)}/>
      )}
    </div>
  )
}
