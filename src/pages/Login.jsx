import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { loginWithEmail } from '../lib/auth'
import { useAuth } from '../components/AuthGuard'
import { ShoppingBag, Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react'

export default function Login() {
  const { user, allowed, checking } = useAuth()
  const navigate = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  // 已登入且通過白名單 → 直接跳首頁
  if (user && allowed && !checking) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) { setError('請填寫帳號和密碼'); return }
    setLoading(true); setError('')
    try {
      await loginWithEmail(email.trim(), password)
      navigate('/', { replace: true })   // 登入成功 → 主動跳轉
    } catch (err) {
      // Firebase 錯誤碼轉換成中文
      const msg = {
        'auth/user-not-found':    '找不到此帳號，請確認 Email 是否正確。',
        'auth/wrong-password':    '密碼錯誤，請重新輸入。',
        'auth/invalid-email':     'Email 格式不正確。',
        'auth/too-many-requests': '登入失敗次數過多，請稍後再試。',
        'auth/invalid-credential':'帳號或密碼錯誤。',
      }[err.code] || err.message || '登入失敗，請再試一次。'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e293b 0%, #334155 50%, #1e3a5f 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      fontFamily: "'Noto Sans TC', sans-serif",
    }}>
      {/* 背景裝飾 */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {[
          { w: 300, h: 300, top: '-80px', left: '-80px',   bg: 'rgba(99,102,241,.08)' },
          { w: 200, h: 200, bottom: '-60px', right: '-60px', bg: 'rgba(16,185,129,.06)' },
          { w: 150, h: 150, top: '40%', left: '60%',       bg: 'rgba(245,158,11,.05)' },
        ].map((s, i) => (
          <div key={i} style={{ position: 'absolute', borderRadius: '50%', ...s }} />
        ))}
      </div>

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 8px 32px rgba(99,102,241,.4)' }}>
            <ShoppingBag size={30} color="white" />
          </div>
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 900, letterSpacing: '-.5px', margin: 0 }}>
            團購百貨管理系統
          </h1>
          <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, marginTop: 6 }}>
            請登入以繼續使用
          </p>
        </div>

        {/* 登入卡片 */}
        <div style={{ background: 'rgba(255,255,255,.06)', backdropFilter: 'blur(20px)', borderRadius: 20, padding: '32px 28px', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>
          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 7, letterSpacing: '.6px', textTransform: 'uppercase' }}>
                帳號 Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.3)', pointerEvents: 'none' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  placeholder="your@email.com"
                  autoComplete="email"
                  style={{
                    width: '100%', padding: '11px 12px 11px 38px',
                    background: 'rgba(255,255,255,.08)',
                    border: '1.5px solid rgba(255,255,255,.12)',
                    borderRadius: 10, fontSize: 14, color: '#fff',
                    outline: 'none', fontFamily: 'inherit',
                    transition: 'border-color .2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,.7)'}
                  onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 7, letterSpacing: '.6px', textTransform: 'uppercase' }}>
                密碼
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.3)', pointerEvents: 'none' }} />
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  placeholder="輸入密碼"
                  autoComplete="current-password"
                  style={{
                    width: '100%', padding: '11px 40px 11px 38px',
                    background: 'rgba(255,255,255,.08)',
                    border: '1.5px solid rgba(255,255,255,.12)',
                    borderRadius: 10, fontSize: 14, color: '#fff',
                    outline: 'none', fontFamily: 'inherit',
                    transition: 'border-color .2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,.7)'}
                  onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
                />
                <button type="button" onClick={() => setShowPwd(p => !p)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.4)', display: 'flex', padding: 0 }}>
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* 錯誤訊息 */}
            {error && (
              <div style={{ background: 'rgba(244,63,94,.15)', border: '1px solid rgba(244,63,94,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#fda4af', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0 }}>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* 登入按鈕 */}
            <button type="submit" disabled={loading}
              style={{
                width: '100%', padding: '12px',
                background: loading ? 'rgba(99,102,241,.5)' : 'linear-gradient(135deg,#6366f1,#4338ca)',
                border: 'none', borderRadius: 10,
                color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,.4)',
                transition: 'all .2s',
              }}>
              {loading
                ? <><div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />登入中...</>
                : <><LogIn size={16} />登入系統</>
              }
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 12, marginTop: 24 }}>
          © 2025 團購百貨管理系統
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,.25) !important; }
      `}</style>
    </div>
  )
}
