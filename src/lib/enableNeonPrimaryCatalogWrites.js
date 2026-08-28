import { doc, setDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { CustomersAPI, ProductsAPI } from './db'
import { ExpensesAPI } from './expenses'
import { derivePhoneLast2, normalizePhoneLast2 } from './customerSearch'
import { neonRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-catalog-writes-installed')
const nowISO=()=>new Date().toISOString()

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

function stripUndefined(value={}){
  return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined))
}

function customerData(data={}){
  const phone=String(data.phone||'').trim()
  const manual=normalizePhoneLast2(data.phone_last2)
  return {
    ...stripUndefined(data),
    name:String(data.name||'').trim(),
    phone,
    phone_last2:manual||derivePhoneLast2(phone),
    line_nick:String(data.line_nick||'').trim(),
    fb_name:String(data.fb_name||'').trim(),
    note:String(data.note||'').trim(),
  }
}

function helperCatalogPayload(product={}){
  return {
    name:String(product.name||'').trim(),
    price:Number(product.price||0),
    category:product.category||'other',
    pricing_mode:product.pricing_mode||((product.price_options||[]).length?'options':'single'),
    spec_mode:product.spec_mode||'none',
    spec_colors:[...(product.spec_colors||[])],
    spec_sizes:[...(product.spec_sizes||[])],
    spec_flavors:[...(product.spec_flavors||[])],
    price_options:(product.price_options||[]).map(o=>({label:String(o.label||''),price:Number(o.price||0)})),
    active:product.active!==false,
    updated_at:Timestamp.now(),
  }
}

async function mirror(label,fn){
  try{return await fn()}
  catch(err){console.error(`[Firestore mirror] ${label} failed after Neon success`,err);return null}
}

function installCustomers(){
  CustomersAPI.create=async function(data={}){
    const id=randomLegacyId()
    const createdAt=nowISO()
    const clean=customerData(data)
    const row={id,...clean,active:true,joined_at:createdAt,updated_at:createdAt}
    const primary=await neonRuntime('write_customer',{op:'create',id,row})
    await mirror('CustomersAPI.create',()=>setDoc(doc(db,'customers',id),{
      ...clean,active:true,joined_at:Timestamp.now(),updated_at:Timestamp.now(),
    }))
    return {...row,...(primary?.result||{})}
  }

  CustomersAPI.update=async function(id,data={}){
    const clean=customerData(data)
    const primary=await neonRuntime('write_customer',{op:'update',id,data:clean})
    await mirror('CustomersAPI.update',()=>updateDoc(doc(db,'customers',id),{...clean,updated_at:Timestamp.now()}))
    return primary?.result
  }

  CustomersAPI.archive=async function(id){
    const primary=await neonRuntime('write_customer',{op:'archive',id})
    await mirror('CustomersAPI.archive',()=>updateDoc(doc(db,'customers',id),{active:false,archived_at:Timestamp.now(),updated_at:Timestamp.now()}))
    return primary?.result
  }

  CustomersAPI.restore=async function(id){
    const primary=await neonRuntime('write_customer',{op:'restore',id})
    await mirror('CustomersAPI.restore',()=>updateDoc(doc(db,'customers',id),{active:true,archived_at:null,updated_at:Timestamp.now()}))
    return primary?.result
  }
}

function installProducts(){
  ProductsAPI.create=async function(data={}){
    const id=randomLegacyId()
    const createdAt=nowISO()
    const clean=stripUndefined(data)
    const row={id,...clean,active:true,created_at:createdAt,updated_at:createdAt}
    const primary=await neonRuntime('write_product',{op:'create',id,row})
    await mirror('ProductsAPI.create',async()=>{
      const ts=Timestamp.now()
      await setDoc(doc(db,'products',id),{...clean,active:true,created_at:ts,updated_at:ts})
      await setDoc(doc(db,'helper_catalog',id),helperCatalogPayload({...clean,active:true}))
    })
    return {...row,...(primary?.result||{})}
  }

  ProductsAPI.update=async function(id,data={}){
    const clean=stripUndefined(data)
    const primary=await neonRuntime('write_product',{op:'update',id,data:clean})
    await mirror('ProductsAPI.update',async()=>{
      await updateDoc(doc(db,'products',id),{...clean,updated_at:Timestamp.now()})
      await setDoc(doc(db,'helper_catalog',id),helperCatalogPayload(clean),{merge:true})
    })
    return primary?.result
  }

  ProductsAPI.archive=async function(id){
    const primary=await neonRuntime('write_product',{op:'archive',id})
    await mirror('ProductsAPI.archive',async()=>{
      await updateDoc(doc(db,'products',id),{active:false,archived_at:Timestamp.now(),updated_at:Timestamp.now()})
      await setDoc(doc(db,'helper_catalog',id),{active:false,updated_at:Timestamp.now()},{merge:true})
    })
    return primary?.result
  }

  ProductsAPI.restore=async function(id){
    const primary=await neonRuntime('write_product',{op:'restore',id})
    await mirror('ProductsAPI.restore',async()=>{
      await updateDoc(doc(db,'products',id),{active:true,archived_at:null,updated_at:Timestamp.now()})
      await setDoc(doc(db,'helper_catalog',id),{active:true,updated_at:Timestamp.now()},{merge:true})
    })
    return primary?.result
  }
}

function installExpenses(){
  ExpensesAPI.create=async function(data={}){
    const id=randomLegacyId()
    const createdAt=nowISO()
    const row={
      id,
      month:String(data.month||''),supplier:String(data.supplier||'').trim(),type:String(data.type||'shipping'),
      amount:Math.abs(Number(data.amount||0)),note:String(data.note||'').trim(),active:true,
      created_at:createdAt,updated_at:createdAt,
    }
    const primary=await neonRuntime('write_expense',{op:'create',id,row})
    await mirror('ExpensesAPI.create',()=>setDoc(doc(db,'expenses',id),{
      ...row,created_at:Timestamp.now(),updated_at:Timestamp.now(),
    }))
    return {...row,...(primary?.result||{})}
  }

  ExpensesAPI.update=async function(id,data={}){
    const clean=stripUndefined({...data,amount:data.amount==null?undefined:Math.abs(Number(data.amount||0))})
    const primary=await neonRuntime('write_expense',{op:'update',id,data:clean})
    await mirror('ExpensesAPI.update',()=>updateDoc(doc(db,'expenses',id),{...clean,updated_at:Timestamp.now()}))
    return primary?.result
  }

  ExpensesAPI.archive=async function(id){
    const primary=await neonRuntime('write_expense',{op:'archive',id})
    await mirror('ExpensesAPI.archive',()=>updateDoc(doc(db,'expenses',id),{active:false,archived_at:Timestamp.now(),updated_at:Timestamp.now()}))
    return primary?.result
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  installCustomers()
  installProducts()
  installExpenses()
}
