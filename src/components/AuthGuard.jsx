import { useState, useEffect, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, Outlet } from 'react-router-dom'
import { onAuthChange, logout, isEmailAllowed } from '../lib/auth'
import { ShoppingBag, LogOut, User } from 'lucide-react'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// ── AuthProvider ─────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(undefined)  // undefined = 初始化中
  const [allowed, setAllowed] = useState(false)
  const [checking,setChecking]= useState(false)

  useEffect(() => {
    const unsub = onAuthChange(async u => {
      setUser(u)
      if (u) {
        setChecking(true)
        const ok = await isEmailAllowed(u.uid)
        setAllowed(ok)
        setChecking(false)
      } else {
        setAllowed(false)
      }
    })
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ user, allowed, checking, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── 載入畫面 ──────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#1e293b,#334155)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16 }}>
      <div style={{ width:52, height:52, borderRadius:16, background:'var(--indigo)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <ShoppingBag size={24} color="white"/>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, color:'rgba(255,255,255,.6)', fontSize:14 }}>
        <div style={{ width:18, height:18, border:'2.5px solid rgba(255,255,255,.2)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}/>
        正在驗證身份...
      </div>
      <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  )
}

// ── 無權限畫面 ────────────────────────────────────────────────
function NoPermission({ user }) {
  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#1e293b,#334155)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:"'Noto Sans TC',sans-serif" }}>
      <div style={{ background:'rgba(255,255,255,.06)', backdropFilter:'blur(20px)', borderRadius:20, padding:'40px 32px', border:'1px solid rgba(255,255,255,.1)', maxWidth:380, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>🚫</div>
        <h2 style={{ color:'#fff', fontSize:20, fontWeight:800, marginBottom:8 }}>沒有存取權限</h2>
        <p style={{ color:'rgba(255,255,255,.5)', fontSize:14, marginBottom:6 }}>
          帳號 <strong style={{ color:'rgba(255,255,255,.8)' }}>{user?.email}</strong>
        </p>
        <p style={{ color:'rgba(255,255,255,.4)', fontSize:13, marginBottom:28 }}>
          尚未在允許名單中，請聯繫管理員新增權限。
        </p>
        <button onClick={logout}
          style={{ padding:'10px 24px', background:'rgba(244,63,94,.8)', border:'none', borderRadius:10, color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          登出
        </button>
      </div>
    </div>
  )
}

// ── AuthGuard ─────────────────────────────────────────────────
export function AuthGuard() {
  const { user, allowed, checking } = useAuth()

  if (user === undefined || checking) return <LoadingScreen />
  if (!user)    return <Navigate to="/login" replace />
  if (!allowed) return <NoPermission user={user} />
  return <Outlet />
}

// ── UserMenu ──────────────────────────────────────────────────
export function UserMenu() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  if (!user) return null

  const name    = user.displayName || user.email?.split('@')[0] || '使用者'
  const email   = user.email || ''
  const initial = name.charAt(0).toUpperCase()

  const menu = (
    <div style={{ position:'fixed', inset:0, zIndex:9100 }} onClick={() => setOpen(false)}>
      <div style={{ position:'fixed', bottom:80, left:10, width:200, background:'#1e293b', border:'1px solid rgba(255,255,255,.12)', borderRadius:12, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,.5)', zIndex:9200 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,.08)' }}>
          <div style={{ color:'rgba(255,255,255,.8)', fontSize:13, fontWeight:600 }}>{name}</div>
          <div style={{ color:'rgba(255,255,255,.35)', fontSize:11, marginTop:2 }}>{email}</div>
        </div>
        <button onClick={() => { logout(); setOpen(false) }}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'11px 14px', background:'none', border:'none', cursor:'pointer', color:'#fda4af', fontSize:13, fontWeight:600, fontFamily:'inherit' }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(244,63,94,.12)'}
          onMouseLeave={e => e.currentTarget.style.background='none'}>
          <LogOut size={14}/>登出系統
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button onClick={() => setOpen(p => !p)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', borderRadius:10, cursor:'pointer', transition:'background .15s' }}
        onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.1)'}
        onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.06)'}>
        <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--indigo)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, color:'#fff', flexShrink:0 }}>
          {initial}
        </div>
        <div style={{ flex:1, textAlign:'left', minWidth:0 }}>
          <div style={{ color:'#fff', fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
          <div style={{ color:'rgba(255,255,255,.35)', fontSize:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{email}</div>
        </div>
        <User size={13} style={{ color:'rgba(255,255,255,.35)', flexShrink:0 }}/>
      </button>
      {open && createPortal(menu, document.body)}
    </>
  )
}
