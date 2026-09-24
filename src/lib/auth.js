import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth } from './firebase'

const ACCESS_CACHE_PREFIX='group-buy.neon-access:'
const ACCESS_CACHE_TTL_MS=5*60*1000
const DENIED_CACHE_TTL_MS=30*1000
const memoryAccessCache=new Map()

function readAccessCache(uid){
  const now=Date.now()
  const memory=memoryAccessCache.get(uid)
  if(memory&&now-memory.at<(memory.allowed?ACCESS_CACHE_TTL_MS:DENIED_CACHE_TTL_MS))return memory
  try{
    const raw=sessionStorage.getItem(ACCESS_CACHE_PREFIX+uid)
    if(!raw)return null
    const parsed=JSON.parse(raw)
    if(!parsed||now-Number(parsed.at||0)>((parsed.allowed===true)?ACCESS_CACHE_TTL_MS:DENIED_CACHE_TTL_MS)){
      sessionStorage.removeItem(ACCESS_CACHE_PREFIX+uid)
      return null
    }
    memoryAccessCache.set(uid,parsed)
    return parsed
  }catch{return null}
}

function writeAccessCache(uid,access){
  const row={...access,at:Date.now()}
  memoryAccessCache.set(uid,row)
  try{sessionStorage.setItem(ACCESS_CACHE_PREFIX+uid,JSON.stringify(row))}catch{return access}
  return access
}

function clearAccessCache(uid){
  if(uid)memoryAccessCache.delete(uid)
  else memoryAccessCache.clear()
  try{
    if(uid)sessionStorage.removeItem(ACCESS_CACHE_PREFIX+uid)
    else Object.keys(sessionStorage).filter(key=>key.startsWith(ACCESS_CACHE_PREFIX)).forEach(key=>sessionStorage.removeItem(key))
  }catch{return}
}

async function getNeonAccountAccess(uid) {
  const user = auth.currentUser
  if (!user || user.uid !== uid) throw new Error('登入狀態尚未就緒')
  const cached=readAccessCache(uid)
  if(cached)return {allowed:cached.allowed===true,role:cached.role||null,account:cached.account||null}
  const token = await user.getIdToken()
  const response = await fetch('/api/neon-auth-profile', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
  })
  const data = await response.json().catch(() => ({}))
  if (response.ok && data.ok) {
    return writeAccessCache(uid,{
      allowed:data.allowed === true,
      role:data.role || null,
      account:data.account || null,
    })
  }
  if (response.status >= 400 && response.status < 500) {
    return writeAccessCache(uid,{ allowed:false, role:null, account:null })
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
    clearAccessCache(credential.user.uid)
    await signOut(auth)
    throw new Error('此帳號沒有存取權限或已被停用，請聯繫管理員。')
  }
  return credential.user
}

export async function logout() {
  const uid=auth.currentUser?.uid
  clearAccessCache(uid)
  await signOut(auth)
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}
