// ============================================================
//  Firebase 設定檔
//  請將下方 firebaseConfig 替換成你的 Firebase 專案資訊
//  Firebase Console → 專案設定 → 您的應用程式 → SDK 設定
// ============================================================
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'YOUR_API_KEY',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'YOUR_PROJECT.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'YOUR_PROJECT_ID',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'YOUR_PROJECT.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| '000000000000',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '1:000000000000:web:xxxxxxxx',
}

const app = initializeApp(firebaseConfig)
export const db  = getFirestore(app)
