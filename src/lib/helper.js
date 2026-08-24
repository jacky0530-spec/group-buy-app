import { collection, doc, getDocs, addDoc, updateDoc, writeBatch, Timestamp, query, where } from 'firebase/firestore'
import { db } from './firebase'

const now = () => Timestamp.now()
const toISO = v => v?.toDate ? v.toDate().toISOString() : (v || null)
const normalize = d => { const x={id:d.id,...d.data()}; ['created_at','updated_at'].forEach(k=>{if(x[k])x[k]=toISO(x[k])}); return x }

export const HelperAPI = {
  async catalog(){ const snap=await getDocs(collection(db,'helper_catalog')); return snap.docs.map(normalize).filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant')) },
  async customers(){ const snap=await getDocs(collection(db,'customers')); return snap.docs.map(normalize).filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant')) },
  async myEntries(uid){ const snap=await getDocs(query(collection(db,'helper_entries'),where('created_by_uid','==',uid))); return snap.docs.map(normalize).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) },
  async allEntries(){ const snap=await getDocs(collection(db,'helper_entries')); return snap.docs.map(normalize).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) },
  async createEntry(data){ const payload={...data,status:'pending',created_at:now(),updated_at:now()}; const ref=await addDoc(collection(db,'helper_entries'),payload); return {id:ref.id,...data,status:'pending'} },
  async updateEntry(id,data){ await updateDoc(doc(db,'helper_entries',id),{...data,updated_at:now()}) },
  async syncCatalog(products=[]){
    for(let i=0;i<products.length;i+=400){ const batch=writeBatch(db); products.slice(i,i+400).forEach(p=>batch.set(doc(db,'helper_catalog',p.id),{ name:p.name||'',price:Number(p.price||0),category:p.category||'other',pricing_mode:p.pricing_mode||((p.price_options||[]).length?'options':'single'),spec_mode:p.spec_mode||'none',spec_colors:p.spec_colors||[],spec_sizes:p.spec_sizes||[],spec_flavors:p.spec_flavors||[],price_options:(p.price_options||[]).map(o=>({label:o.label||'',price:Number(o.price||0)})),active:p.active!==false,updated_at:now() },{merge:true})); await batch.commit() }
    return products.length
  }
}
