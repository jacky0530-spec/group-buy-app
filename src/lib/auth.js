import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth } from './firebase'

// ============================================================
//  允許登入的 Email 白名單
//  只有這裡列出的帳號才能進入系統，其他人即使有密碼也會被擋下
//  新增員工：在這裡加一行 Email，同時在 Firebase Console 建立帳號
// ============================================================
const ALLOWED_EMAILS = [
  // 'owner@example.com',      // 老闆
  // 'staff01@example.com',    // 員工 01
  // 'staff02@example.com',    // 員工 02
]

// 若白名單為空（開發初期未設定），所有登入者都能進入
// 正式上線後請務必填入白名單
export function isEmailAllowed(email) {
  if (!email) return false
  if (ALLOWED_EMAILS.length === 0) return true   // 開發模式：不限制
  return ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase())
}

export async function loginWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  if (!isEmailAllowed(credential.user.email)) {
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
