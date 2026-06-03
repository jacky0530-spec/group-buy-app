import { useState, useEffect } from 'react'
import { useToast, Modal, ConfirmDialog } from '../components/UI'
import { useAuth } from '../components/AuthGuard'
import { auth } from '../lib/firebase'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
  fetchSignInMethodsForEmail,
} from 'firebase/auth'
import { db } from '../lib/firebase'
import {
  collection, doc, setDoc, getDocs, deleteDoc, getDoc, query, orderBy,
} from 'firebase/firestore'
import { Plus, Trash2, Shield, User, Mail, Key, Eye, EyeOff, Crown } from 'lucide-react'

// ── 角色定義 ─────────────────────────────────────────────────
const ROLES = {
  owner: { label: '負責人', color: '#f59e0b', bg: '#fffbeb', icon: '👑' },
  staff: { label: '員工',   color: '#6366f1', bg: '#eef2ff', icon: '👤' },
}

// ── 帳號資料存在 Firestore accounts 集合 ─────────────────────
// 結構：{ email, role, display_name, created_at }
// Firebase Auth 本身不提供帳號列表 API（前端限制），
// 所以額外在 Firestore 記錄一份供顯示用。

const ACCOUNTS_COL = 'accounts'

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
  const toast     = useToast()
  const { user }  = useAuth()

  const [accounts,    setAccounts]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showModal,   setShowModal]   = useState(false)
  const [confirmDel,  setConfirmDel]  = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [showPwd,     setShowPwd]     = useState(false)

  const [form, setForm] = useState({ display_name:'', email:'', password:'', role:'staff' })

  // 取得目前登入者在 Firestore 的角色
  const [myRole, setMyRole] = useState(null)

  useEffect(() => {
    if (!user) return
    getDoc(doc(db, ACCOUNTS_COL, user.uid)).then(d => {
      setMyRole(d.exists() ? d.data().role : 'owner') // 第一個使用者預設 owner
    })
  }, [user])

  const isOwner = myRole === 'owner' || myRole === null

  const load = async () => {
    setLoading(true)
    const list = await getAccounts()
    // 若 Firestore 完全沒有帳號（第一次使用），自動把目前登入者寫入為 owner
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
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // ── 新增帳號 ─────────────────────────────────────────────
  async function createAccount() {
    if (!form.display_name.trim()) { toast('請填寫姓名','error'); return }
    if (!form.email.trim())        { toast('請填寫 Email','error'); return }
    if (form.password.length < 6)  { toast('密碼至少 6 碼','error'); return }

    setSaving(true)
    try {
      // 暫存目前登入者的憑證（建立新帳號後 Firebase 會自動切換登入）
      const currentEmail    = user.email
      const currentPassword = sessionStorage.getItem('__pwd') || ''

      // 用 Firebase Auth 建立新帳號
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password)
      const newUid = cred.user.uid

      // 寫入 Firestore 帳號記錄
      await saveAccountRecord(newUid, {
        email:        form.email.trim().toLowerCase(),
        display_name: form.display_name.trim(),
        role:         form.role,
        created_at:   new Date().toISOString(),
      })

      // 立刻登出新帳號，重新登入原來的帳號
      await signOut(auth)
      if (currentPassword) {
        await signInWithEmailAndPassword(auth, currentEmail, currentPassword)
      } else {
        // 若沒有存密碼，提示使用者手動重新整理
        toast('帳號建立成功！請重新整理頁面並重新登入。', 'warning')
        setShowModal(false); load(); return
      }

      toast(`帳號「${form.display_name}」建立成功 ✓`)
      setShowModal(false)
      setForm({ display_name:'', email:'', password:'', role:'staff' })
      load()
    } catch (err) {
      const msg = {
        'auth/email-already-in-use': '此 Email 已被使用。',
        'auth/invalid-email':        'Email 格式不正確。',
        'auth/weak-password':        '密碼強度不足，請使用至少 6 碼。',
      }[err.code] || err.message
      toast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── 刪除帳號 ─────────────────────────────────────────────
  async function deleteAccount(account) {
    if (account.id === user?.uid) { toast('不能刪除自己的帳號','error'); return }
    try {
      // 只刪除 Firestore 記錄（Firebase Auth 刪除需要 Admin SDK，前端無法刪除他人帳號）
      // 實務做法：刪除 Firestore 記錄後，帳號雖在 Auth 存在但無法通過白名單驗證
      await deleteAccountRecord(account.id)
      toast(`已移除「${account.display_name}」的存取權限 ✓`, 'warning')
      setConfirmDel(null)
      load()
    } catch (err) {
      toast('刪除失敗：' + err.message, 'error')
    }
  }

  // ── 儲存當前使用者密碼（供建立帳號後還原登入用）────────────
  function handlePwdHint(e) {
    // 僅存在 sessionStorage，關閉瀏覽器即消失
    sessionStorage.setItem('__pwd', e.target.value)
    setForm(p => ({ ...p, _ownerPwd: e.target.value }))
  }

  return (
    <div className="animate-fade">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800 }}>帳號管理</h2>
          <p style={{ color:'var(--text-secondary)', fontSize:13, marginTop:2 }}>
            共 {accounts.length} 個帳號　{isOwner ? '（負責人模式）' : '（員工只能查看）'}
          </p>
        </div>
        {isOwner && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15}/>新增帳號</button>
        )}
      </div>

      {/* 說明提示 */}
      <div style={{ background:'var(--amber-light)', border:'1.5px solid #fde68a', borderRadius:'var(--radius)', padding:'12px 16px', marginBottom:20, fontSize:13, color:'#92400e', display:'flex', gap:10 }}>
        <Shield size={16} style={{ flexShrink:0, marginTop:1 }} />
        <div>
          <strong>存取控管說明：</strong>只有列在此處的帳號才能登入系統。
          刪除帳號記錄後，對方即使知道密碼也無法進入（已被白名單攔截）。
          {!isOwner && <span style={{ color:'var(--rose)', fontWeight:700 }}> 員工無法新增或刪除帳號。</span>}
        </div>
      </div>

      {/* 帳號列表 */}
      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr>
              <th>姓名</th><th>Email</th><th>角色</th><th>建立時間</th>
              {isOwner && <th style={{ textAlign:'right' }}>操作</th>}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{ textAlign:'center',padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/></td></tr>}
              {!loading && accounts.length===0 && (
                <tr><td colSpan={5}><div className="empty-state"><User size={36}/><span>尚無帳號</span></div></td></tr>
              )}
              {accounts.map(a => {
                const role    = ROLES[a.role] || ROLES.staff
                const isMe    = a.id === user?.uid
                const isOwnerAcc = a.role === 'owner'
                return (
                  <tr key={a.id} style={{ background: isMe ? 'var(--indigo-light)' : undefined }}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:34,height:34,borderRadius:'50%',background:role.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0 }}>
                          {role.icon}
                        </div>
                        <div>
                          <div style={{ fontWeight:700 }}>{a.display_name}</div>
                          {isMe && <div style={{ fontSize:11,color:'var(--indigo)',fontWeight:600 }}>（目前登入）</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ color:'var(--text-secondary)',fontSize:13 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                        <Mail size={12}/>{a.email}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ background:role.bg, color:role.color }}>
                        {role.icon} {role.label}
                      </span>
                    </td>
                    <td style={{ color:'var(--text-secondary)',fontSize:13 }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('zh-TW') : '—'}
                    </td>
                    {isOwner && (
                      <td style={{ textAlign:'right' }}>
                        {isMe || isOwnerAcc ? (
                          <span style={{ fontSize:12,color:'var(--text-muted)' }}>—</span>
                        ) : (
                          <button className="btn-icon btn" onClick={() => setConfirmDel(a)}
                            style={{ borderColor:'var(--rose-light)',color:'var(--rose)' }}>
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
        <Modal title="新增帳號" onClose={() => setShowModal(false)} width={460}>
          <div style={{ background:'var(--sky-light)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#0369a1' }}>
            💡 建立帳號時系統需要暫時切換登入，請先在下方填入你的密碼以便自動還原。
          </div>

          <div className="form-group">
            <label>你的目前密碼（還原登入用）</label>
            <div style={{ position:'relative' }}>
              <Key size={14} style={{ position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)',pointerEvents:'none' }}/>
              <input type={showPwd?'text':'password'}
                onChange={handlePwdHint}
                placeholder="輸入你自己的登入密碼"
                style={{ paddingLeft:30 }}/>
              <button type="button" onClick={() => setShowPwd(p=>!p)}
                style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',display:'flex' }}>
                {showPwd ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
          </div>

          <div style={{ borderTop:'1.5px solid var(--border)',paddingTop:14,marginTop:4 }}>
            <div className="form-group">
              <label>姓名 *</label>
              <input value={form.display_name} onChange={e => setForm(p=>({...p,display_name:e.target.value}))} placeholder="例如：小美"/>
            </div>
            <div className="form-group">
              <label>Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(p=>({...p,email:e.target.value}))} placeholder="staff@example.com"/>
            </div>
            <div className="form-group">
              <label>密碼 *（至少 6 碼）</label>
              <input type="password" value={form.password} onChange={e => setForm(p=>({...p,password:e.target.value}))} placeholder="設定員工初始密碼"/>
            </div>
            <div className="form-group">
              <label>角色</label>
              <div style={{ display:'flex',gap:10 }}>
                {Object.entries(ROLES).map(([id,r]) => (
                  <button key={id} type="button" onClick={() => setForm(p=>({...p,role:id}))}
                    style={{ flex:1,padding:'10px',borderRadius:10,border:`2px solid ${form.role===id?r.color:'var(--border)'}`,background:form.role===id?r.bg:'var(--surface)',cursor:'pointer',fontFamily:'inherit',fontWeight:700,fontSize:13,color:form.role===id?r.color:'var(--text-secondary)',transition:'all .15s' }}>
                    {r.icon} {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display:'flex',gap:10,justifyContent:'flex-end',marginTop:8 }}>
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
