import { doc, setDoc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { CustomersAPI, ProductsAPI } from './db'
import { ExpensesAPI } from './expenses'
import { derivePhoneLast2, getCustomerPhoneLast2, normalizePhoneLast2 } from './customerSearch'
import { neonRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-catalog-writes-installed')
const nowISO=()=>new Date().toISOString()
const normalizeNameKey=value=>String(value||'').trim().toLocaleLowerCase('zh-TW')

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

function mergedNote(current,incoming){
  const oldText=String(current||'').trim()
  const newText=String(incoming||'').trim()
  if(!newText) return oldText
  if(!oldText) return newText
  if(oldText.includes(newText)) return oldText
  return `${oldText}；${newText}`
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

function fsTime(value){
  if(!value) return null
  if(value instanceof Timestamp) return value
  const date=new Date(value)
  return Number.isNaN(date.getTime())?null:Timestamp.fromDate(date)
}

function customerFirestoreRow(row){
  return {
    name:String(row.name||'').trim(),phone:String(row.phone||'').trim(),phone_last2:String(row.phone_last2||'').trim(),
    line_nick:String(row.line_nick||'').trim(),fb_name:String(row.fb_name||'').trim(),note:String(row.note||'').trim(),
    active:row.active!==false,joined_at:fsTime(row.joined_at)||Timestamp.now(),archived_at:fsTime(row.archived_at),updated_at:fsTime(row.updated_at)||Timestamp.now(),
    ...(row.import_source?{import_source:row.import_source}:{}),
  }
}

async function mirror(label,fn){
  try{return await fn()}
  catch(err){console.error(`[Firestore mirror] ${label} failed after Neon success`,err);return null}
}

async function mirrorCustomers(rows=[]){
  await mirror('CustomersAPI.importRows',async()=>{
    for(let i=0;i<rows.length;i+=400){
      const batch=writeBatch(db)
      for(const row of rows.slice(i,i+400)) batch.set(doc(db,'customers',row.id),customerFirestoreRow(row),{merge:true})
      await batch.commit()
    }
  })
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

  CustomersAPI.isDuplicateIdentity=async function({phone='',line_nick='',fb_name=''},excludeId=null){
    const result=await neonRuntime('list_customers',{includeArchived:false})
    const rows=Array.isArray(result?.rows)?result.rows:[]
    const checks=[['phone',phone.trim()],['line_nick',line_nick.trim()],['fb_name',fb_name.trim()]].filter(([,v])=>v)
    for(const [field,value] of checks){
      const hit=rows.find(row=>row.id!==excludeId&&row.active!==false&&String(row[field]||'')===value)
      if(hit) return {duplicate:true,field,value}
    }
    return {duplicate:false}
  }

  CustomersAPI.importRows=async function(rows=[]){
    if(!Array.isArray(rows)) throw new Error('匯入格式不正確')
    const currentResult=await neonRuntime('list_customers',{includeArchived:true})
    const local=(currentResult?.rows||[]).map(row=>({...row}))
    const changes=[]
    let created=0,updated=0,skipped=0,ambiguous=0

    for(const input of rows){
      const name=String(input?.name||'').trim()
      if(!name){skipped++;continue}
      const phone=String(input?.phone||'').trim()
      const phoneLast2=normalizePhoneLast2(input?.phone_last2)||derivePhoneLast2(phone)
      const note=String(input?.note||'').trim()
      const key=normalizeNameKey(name)
      const sameName=local.filter(c=>c.active!==false&&normalizeNameKey(c.name)===key)
      const exact=sameName.find(c=>{
        const existingLast2=getCustomerPhoneLast2(c)
        return phoneLast2?existingLast2===phoneLast2:!existingLast2
      })

      if(exact){
        const patch={}
        if(phoneLast2&&!normalizePhoneLast2(exact.phone_last2)) patch.phone_last2=phoneLast2
        if(phone&&!exact.phone) patch.phone=phone
        const nextNote=mergedNote(exact.note,note)
        if(nextNote!==String(exact.note||'').trim()) patch.note=nextNote
        if(Object.keys(patch).length){
          Object.assign(exact,patch,{updated_at:nowISO()});changes.push({...exact});updated++
        }else skipped++
        continue
      }

      const untagged=sameName.filter(c=>!getCustomerPhoneLast2(c)&&!c.phone)
      if(phoneLast2&&sameName.length===1&&untagged.length===1){
        const target=untagged[0]
        const patch={phone_last2:phoneLast2}
        if(phone) patch.phone=phone
        const nextNote=mergedNote(target.note,note)
        if(nextNote!==String(target.note||'').trim()) patch.note=nextNote
        Object.assign(target,patch,{updated_at:nowISO()});changes.push({...target});updated++
        continue
      }

      if(phoneLast2&&sameName.length>1&&untagged.length>0) ambiguous++
      const createdAt=nowISO()
      const row={
        id:randomLegacyId(),name,line_nick:String(input?.line_nick||'').trim(),fb_name:String(input?.fb_name||'').trim(),
        phone,phone_last2:phoneLast2,note,active:true,import_source:String(input?.import_source||'customer-json-v1'),
        joined_at:createdAt,updated_at:createdAt,
      }
      local.push(row);changes.push(row);created++
    }

    for(let i=0;i<changes.length;i+=250) await neonRuntime('sync_customers',{rows:changes.slice(i,i+250)})
    await mirrorCustomers(changes)
    return {scanned:rows.length,created,updated,skipped,ambiguous}
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

  ProductsAPI.isDuplicate=async function(name,excludeId=null){
    const result=await neonRuntime('list_products',{includeArchived:false})
    return (result?.rows||[]).some(row=>row.id!==excludeId&&row.active!==false&&String(row.name||'')===String(name||''))
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
