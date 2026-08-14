import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'

export async function getAccountAccess(uid) {
  try {
    const snap = await getDoc(doc(db, 'accounts', uid))
    if (!snap.exists()) return { allowed: false, role: null, account: null }
    const account = snap.data()
    return {
      allowed: account.disabled !== true,
      role: account.role || 'staff',
      account,
    }
  } catch {
    return { allowed: false, role: null, account: null }
  }
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
