import { createPublicKey, createVerify } from 'node:crypto'

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
let cache = { expiresAt:0, certs:null }

function decodePart(value){
  const text = String(value || '').replace(/-/g,'+').replace(/_/g,'/')
  return Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4,'='),'base64').toString('utf8')
}

async function getCerts(){
  if(cache.certs && Date.now() < cache.expiresAt) return cache.certs
  const response = await fetch(CERT_URL)
  if(!response.ok) throw new Error('無法取得 Firebase 驗證憑證')
  const certs = await response.json()
  const cacheControl = response.headers.get('cache-control') || ''
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 1800)
  cache = { certs, expiresAt:Date.now() + Math.max(60,maxAge - 60) * 1000 }
  return certs
}

export async function verifyFirebaseIdToken(req){
  const authHeader = String(req.headers?.authorization || '')
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if(!token) throw new Error('缺少登入憑證')
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
  if(!projectId) throw new Error('伺服器尚未設定 FIREBASE_PROJECT_ID')
  const parts = token.split('.')
  if(parts.length !== 3) throw new Error('登入憑證格式錯誤')
  let header,payload
  try { header = JSON.parse(decodePart(parts[0])); payload = JSON.parse(decodePart(parts[1])) }
  catch { throw new Error('登入憑證內容錯誤') }
  if(header.alg !== 'RS256' || !header.kid) throw new Error('登入憑證演算法錯誤')
  const certs = await getCerts()
  const cert = certs[header.kid]
  if(!cert) throw new Error('登入憑證已過期，請重新登入')
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${parts[0]}.${parts[1]}`)
  verifier.end()
  const signature = Buffer.from(parts[2].replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(parts[2].length / 4) * 4,'='),'base64')
  if(!verifier.verify(createPublicKey(cert),signature)) throw new Error('登入憑證驗證失敗')
  const now = Math.floor(Date.now()/1000)
  if(payload.aud !== projectId) throw new Error('登入憑證專案不符')
  if(payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('登入憑證來源不符')
  if(!payload.sub || typeof payload.sub !== 'string') throw new Error('登入帳號識別錯誤')
  if(Number(payload.exp || 0) <= now) throw new Error('登入憑證已過期，請重新登入')
  if(Number(payload.iat || 0) > now + 60) throw new Error('登入憑證時間錯誤')
  return { token, uid:payload.sub, email:payload.email || '', payload, projectId }
}
