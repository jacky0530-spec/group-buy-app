import { doc, getDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { CustomersAPI, ProductsAPI } from './db'
import { bestEffortNeonSync } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-dual-write-installed')

function clean(value){
  if(value==null) return value
  if(value instanceof Timestamp) return value.toDate().toISOString()
  if(typeof value?.toDate==='function') return value.toDate().toISOString()
  if(Array.isArray(value)) return value.map(clean)
  if(typeof value==='object'){
    const out={}
    for(const [key,item] of Object.entries(value)) out[key]=clean(item)
    return out
  }
  return value
}

async function syncFirestoreDocument(collectionName,id,action){
  if(!id) return null
  try{
    const snap=await getDoc(doc(db,collectionName,id))
    if(!snap.exists()) return null
    return await bestEffortNeonSync(action,{id:snap.id,...clean(snap.data())})
  }catch(err){
    console.error(`[Neon dual-write] ${collectionName}/${id} readback failed`,err)
    return null
  }
}

function wrapCrud(api,collectionName,action){
  for(const method of ['create','update','archive','restore']){
    const original=api[method]
    if(typeof original!=='function') continue
    api[method]=async function(...args){
      const result=await original.apply(this,args)
      const id=method==='create'?result?.id:args[0]
      await syncFirestoreDocument(collectionName,id,action)
      return result
    }
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  wrapCrud(CustomersAPI,'customers','sync_customer')
  wrapCrud(ProductsAPI,'products','sync_product')
}
