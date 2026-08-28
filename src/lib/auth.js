import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth } from './firebase'

async function getNeonAccountAccess(uid) {
  const user = auth.currentUser
  if (!user || user.uid !== uid) throw new Error('登入狀態尚未就緒')
  const token = await user.getIdToken()
  const response = await fetch('/api/neon-auth-profile', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
  })
  const data = await response.json().catch(() => ({}))
  if (response.ok && data.ok) {
    return {
      allowed:data.allowed === true,
      role:data.role || null,
      account:data.account || null,
    }
  }
  if (response.status >= 400 && response.status < 500) {
    return { allowed:false, role:null, account:null }
  }
  throw new Error(data.error || `Neon access check failed: ${response.status}`)
}

export async function getAccountAccess(uid) {
  return getNeonAccountAccess(uid)
}

export async function isEmailAllowed(uid) {
  const access = await getAccountAccess(uid)
  return access.allowed
}

export async function loginWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  const access = await getAccountAccess(credential.user.uid)
  if (!access.allowed) {
    await signOut(auth)
    throw new Error('此帳號沒有存取權限或已被停用，請聯繫管理員。')
  }
  return credential.user
}

export async function logout() {
  await signOut(auth)
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}
