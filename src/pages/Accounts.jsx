import { useState, useEffect, useCallback } from 'react'
import { useToast, Modal } from '../components/UI'
import { useAuth } from '../components/AuthGuard'
import { MaintenanceAPI } from '../lib/db'
import { db } from '../lib/firebase'
import { collection, doc, setDoc, getDocs, getDoc, query, orderBy, updateDoc } from 'firebase/firestore'
import { Plus, Shield, User, Mail, Eye, EyeOff, RefreshCw, Power, Crown } from 'lucide-react'

const ROLES = {
  owner:{ label:'負責人', icon:'👑', color:'#f59e0b', bg:'#fffbeb' },
  staff:{ label:'員工', icon:'👤', color:'#6366f1', bg:'#eef2ff' },
}
const ACCOUNTS_COL = 'accounts'

async function createAuthUser(email,password,apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email,password,returnSecureToken:false }),
  })
  const data = await res.json()
  if (!res.ok) {
    const code = data.error?.message || 'UNKNOWN'
    const msg = { EMAIL_EXISTS:'此 Email 已被使用。', INVALID_EMAIL:'Email 格式不正確。', WEAK_PASSWORD:'密碼強度不足，至少 6 碼。', 'WEAK_PASSWORD : Password should be at least 6 characters':'密碼至少需要 6 碼。' }[code] || `建立 Firebase Auth 帳號失敗：${code}`
    throw new Error(msg)
  }
  return data.localId
}
async function getAccounts() {
  const snap = await getDocs(query(collection(db,ACCOUNTS_COL),orderBy('created_at','asc')))
  return snap.docs.map(d => ({ id:d.id,...d.data() }))
}

export default function Accounts() {
  const toast = useToast()
  const { user } = useAuth()
  const [accounts,setAccounts] = useState([])
  const [myRole,setMyRole] = useState(null)
  const [roleLoaded,setRoleLoaded] = useState(false)
  const [loading,setLoading] = useState(true)
  const [showModal,setShowModal] = useState(false)
  const [saving,setSaving] = useState(false)
  const [showPwd,setShowPwd] = useState(false)
  const [migrating,setMigrating] = useState(false)
  const [form,setForm] = useState({ display_name:'', email:'', password:'', role:'staff' })
  const isOwner = roleLoaded && myRole === 'owner'

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [list,mine] = await Promise.all([getAccounts(),getDoc(doc(db,ACCOUNTS_COL,user.uid))])
      setAccounts(list); setMyRole(mine.exists() ? (mine.data().role || 'staff') : null); setRoleLoaded(true)
    } catch (err) { toast('帳號資料載入失敗：'+err.message,'error') }
    finally { setLoading(false) }
  },[user,toast])
  useEffect(() => { load() },[load])

  async function createAccount() {
    if (!isOwner) { toast('只有負責人可以建立帳號','error'); return }
    if (!form.display_name.trim() || !form.email.trim()) { toast('請填寫姓名與 Email','error'); return }
    if (form.password.length < 6) { toast('密碼至少 6 碼','error'); return }
    setSaving(true)
    try {
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
      if (!apiKey) throw new Error('找不到 Firebase API Key')
      const uid = await createAuthUser(form.email.trim(),form.password,apiKey)
      await setDoc(doc(db,ACCOUNTS_COL,uid), { email:form.email.trim().toLowerCase(), display_name:form.display_name.trim(), role:form.role, disabled:false, created_at:new Date().toISOString() })
      toast(`帳號「${form.display_name}」建立成功 ✓`)
      setShowModal(false); setForm({ display_name:'', email:'', password:'', role:'staff' }); await load()
    } catch (err) { toast(err.message,'error') }
    finally { setSaving(false) }
  }

  async function toggleDisabled(account) {
    if (!isOwner) return
    if (account.id === user?.uid) { toast('不能停用自己的帳號','error'); return }
    try {
      await updateDoc(doc(db,ACCOUNTS_COL,account.id), { disabled:account.disabled !== true })
      if (account.disabled) toast('帳號已重新啟用'); else toast('帳號已停用；對方下次驗證會被拒絕','warning')
      await load()
    } catch (err) { toast('更新失敗：'+err.message,'error') }
  }

  async function backfillSnapshots() {
    if (!isOwner) return
    setMigrating(true)
    try {
      const result = await MaintenanceAPI.backfillLegacyOrderSnapshots()
      toast(`歷史訂單快照升級完成：掃描 ${result.scanned} 筆，更新 ${result.updated} 筆 ✓`)
    } catch (err) { toast('歷史資料升級失敗：'+err.message,'error') }
    finally { setMigrating(false) }
  }

  async function changeRole(account,role) {
    if (!isOwner || account.id === user?.uid) return
    try { await updateDoc(doc(db,ACCOUNTS_COL,account.id),{ role }); toast(`已將「${account.display_name}」設為${ROLES[role].label}`); await load() }
    catch (err) { toast('角色更新失敗：'+err.message,'error') }
  }

  return <div className="animate-fade">
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
      <div><h2 style={{ fontSize:22,fontWeight:800 }}>帳號與權限</h2><p style={{ color:'var(--text-secondary)',fontSize:13,marginTop:2 }}>{roleLoaded ? (isOwner ? '👑 負責人：可新增、停用、調整角色' : '👤 員工：唯讀') : '正在確認角色...'}</p></div>
      <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}><button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/>重新整理</button>{isOwner && <button className="btn btn-ghost btn-sm" disabled={migrating} onClick={backfillSnapshots}>{migrating ? '升級歷史資料中...' : '升級舊訂單快照'}</button>}{isOwner && <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15}/>新增帳號</button>}</div>
    </div>

    <div style={{ background:'var(--amber-light)',border:'1px solid #fde68a',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:13,color:'#92400e',display:'flex',gap:9 }}><Shield size={16} style={{ flexShrink:0 }}/><div>權限真正由 <strong>Firestore Security Rules</strong> 控制；前端只負責顯示。停用帳號不刪除 Firebase Auth 使用者，但會讓該 UID 無法通過白名單與 Firestore 權限驗證，保留稽核歷史。</div></div>
    {!roleLoaded && !loading && <div style={{ background:'var(--rose-light)',color:'var(--rose)',padding:12,borderRadius:8,marginBottom:16 }}>目前登入 UID 尚未建立 accounts 文件。首次部署請依 README 的「建立第一位 Owner」步驟在 Firebase Console 建立。</div>}

    <div className="card"><div className="table-container"><table><thead><tr><th>姓名</th><th>Email</th><th>角色</th><th>狀態</th><th>建立時間</th>{isOwner && <th style={{ textAlign:'right' }}>操作</th>}</tr></thead><tbody>
      {loading && <tr><td colSpan={6} style={{ textAlign:'center',padding:40 }}><div className="loading-spinner" style={{ margin:'0 auto' }}/></td></tr>}
      {!loading && accounts.length === 0 && <tr><td colSpan={6}><div className="empty-state"><User size={36}/><span>尚無帳號</span></div></td></tr>}
      {accounts.map(a => { const role = ROLES[a.role] || ROLES.staff; const isMe = a.id === user?.uid; return <tr key={a.id} style={{ background:isMe ? 'var(--indigo-light)' : undefined,opacity:a.disabled ? .55 : 1 }}>
        <td><div style={{ fontWeight:700 }}>{a.display_name || '未命名'} {isMe && <span style={{ fontSize:11,color:'var(--indigo)' }}>（目前登入）</span>}</div></td><td style={{ color:'var(--text-secondary)' }}><Mail size={12} style={{ verticalAlign:'middle',marginRight:5 }}/>{a.email}</td><td><span className="badge" style={{ background:role.bg,color:role.color }}>{role.icon} {role.label}</span></td><td><span className={`badge ${a.disabled ? 'badge-rose' : 'badge-emerald'}`}>{a.disabled ? '已停用' : '可登入'}</span></td><td style={{ color:'var(--text-secondary)',fontSize:12 }}>{a.created_at ? new Date(a.created_at).toLocaleDateString('zh-TW') : '—'}</td>
        {isOwner && <td style={{ textAlign:'right' }}>{!isMe && <div style={{ display:'flex',gap:5,justifyContent:'flex-end',flexWrap:'wrap' }}><button className="btn btn-sm btn-ghost" onClick={() => changeRole(a,a.role === 'owner' ? 'staff' : 'owner')}><Crown size={11}/>{a.role === 'owner' ? '改員工' : '設負責人'}</button><button className="btn btn-sm btn-ghost" onClick={() => toggleDisabled(a)}><Power size={11}/>{a.disabled ? '啟用' : '停用'}</button></div>}</td>}
      </tr>})}
    </tbody></table></div></div>

    {showModal && <Modal title="新增帳號" onClose={() => setShowModal(false)} width={450}>
      <div className="form-group"><label>姓名 *</label><input value={form.display_name} onChange={e => setForm(p => ({ ...p,display_name:e.target.value }))}/></div><div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e => setForm(p => ({ ...p,email:e.target.value }))}/></div><div className="form-group"><label>初始密碼 *（至少 6 碼）</label><div style={{ position:'relative' }}><input type={showPwd ? 'text' : 'password'} value={form.password} onChange={e => setForm(p => ({ ...p,password:e.target.value }))} style={{ paddingRight:38 }}/><button type="button" onClick={() => setShowPwd(v => !v)} style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',border:'none',background:'none',cursor:'pointer' }}>{showPwd ? <EyeOff size={14}/> : <Eye size={14}/>}</button></div></div>
      <div className="form-group"><label>角色</label><div style={{ display:'flex',gap:8 }}>{Object.entries(ROLES).map(([id,r]) => <button key={id} type="button" onClick={() => setForm(p => ({ ...p,role:id }))} style={{ flex:1,padding:10,borderRadius:8,cursor:'pointer',border:`2px solid ${form.role === id ? r.color : 'var(--border)'}`,background:form.role === id ? r.bg : 'var(--surface)',fontWeight:700 }}>{r.icon} {r.label}</button>)}</div></div>
      <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}><button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button><button className="btn btn-primary" disabled={saving} onClick={createAccount}>{saving ? '建立中...' : '建立帳號'}</button></div>
    </Modal>}
  </div>
}
