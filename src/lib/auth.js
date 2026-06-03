import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'

// ── 白名單：從 Firestore accounts 集合動態讀取 ───────────────
// 不需要再手動維護程式碼內的 Email 陣列
// 新增員工：在帳號管理頁操作即可
export async function isEmailAllowed(uid) {
  try {
    const snap = await getDoc(doc(db, 'accounts', uid))
    return snap.exists()
  } catch {
    return false
  }
}

export async function loginWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  const allowed = await isEmailAllowed(credential.user.uid)
  if (!allowed) {
    await signOut(auth)
    throw new Error('此帳號沒有存取權限，請聯繫管理員。')
  }
  return credential.user
}

export async function logout() {
  await signOut(auth)
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}
