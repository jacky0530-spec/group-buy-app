import { CustomersAPI, ProductsAPI } from './db'
import { derivePhoneLast2, getCustomerPhoneLast2, normalizePhoneLast2 } from './customerSearch'
import { neonHelperAdminRuntime, neonRuntime } from './neonRuntime'

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
function stripUndefined(value={}){return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined))}
function customerData(data={}){
  const phone=String(data.phone||'').trim()
  const manual=normalizePhoneLast2(data.phone_last2)
  return {...stripUndefined(data),name:String(data.name||'').trim(),phone,phone_last2:manual||derivePhoneLast2(phone),line_nick:String(data.line_nick||'').trim(),fb_name:String(data.fb_name||'').trim(),note:String(data.note||'').trim()}
}
function mergedNote(current,incoming){
  const oldText=String(current||'').trim(),newText=String(incoming||'').trim()
  if(!newText)return oldText
  if(!oldText)return newText
  if(oldText.includes(newText))return oldText
  return `${oldText}；${newText}`
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  CustomersAPI.list=async function({includeArchived=false}={}){
    const result=await neonRuntime('list_customers',{includeArchived})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 客戶回傳格式錯誤')
    return result.rows
  }
  CustomersAPI.create=async function(data={}){
    const id=randomLegacyId(),createdAt=nowISO(),clean=customerData(data)
    const row={id,...clean,active:true,joined_at:createdAt,updated_at:createdAt}
    const primary=await neonRuntime('write_customer',{op:'create',id,row})
    return {...row,...(primary?.result||{})}
  }
  CustomersAPI.update=async function(id,data={}){return (await neonRuntime('write_customer',{op:'update',id,data:customerData(data)}))?.result}
  CustomersAPI.archive=async function(id){return (await neonRuntime('write_customer',{op:'archive',id}))?.result}
  CustomersAPI.restore=async function(id){return (await neonRuntime('write_customer',{op:'restore',id}))?.result}
  CustomersAPI.isDuplicateIdentity=async function({phone='',line_nick='',fb_name=''},excludeId=null){
    const rows=(await CustomersAPI.list({includeArchived:false}))||[]
    const checks=[['phone',phone.trim()],['line_nick',line_nick.trim()],['fb_name',fb_name.trim()]].filter(([,v])=>v)
    for(const [field,value] of checks){
      if(rows.find(row=>row.id!==excludeId&&row.active!==false&&String(row[field]||'')===value)) return {duplicate:true,field,value}
    }
    return {duplicate:false}
  }
  CustomersAPI.importRows=async function(rows=[]){
    if(!Array.isArray(rows)) throw new Error('匯入格式不正確')
    const local=(await CustomersAPI.list({includeArchived:true})).map(row=>({...row}))
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
      const exact=sameName.find(c=>{const existingLast2=getCustomerPhoneLast2(c);return phoneLast2?existingLast2===phoneLast2:!existingLast2})
      if(exact){
        const patch={}
        if(phoneLast2&&!normalizePhoneLast2(exact.phone_last2))patch.phone_last2=phoneLast2
        if(phone&&!exact.phone)patch.phone=phone
        const nextNote=mergedNote(exact.note,note)
        if(nextNote!==String(exact.note||'').trim())patch.note=nextNote
        if(Object.keys(patch).length){Object.assign(exact,patch,{updated_at:nowISO()});changes.push({...exact});updated++}else skipped++
        continue
      }
      const untagged=sameName.filter(c=>!getCustomerPhoneLast2(c)&&!c.phone)
      if(phoneLast2&&sameName.length===1&&untagged.length===1){
        const target=untagged[0],patch={phone_last2:phoneLast2}
        if(phone)patch.phone=phone
        const nextNote=mergedNote(target.note,note)
        if(nextNote!==String(target.note||'').trim())patch.note=nextNote
        Object.assign(target,patch,{updated_at:nowISO()});changes.push({...target});updated++;continue
      }
      if(phoneLast2&&sameName.length>1&&untagged.length>0)ambiguous++
      const createdAt=nowISO()
      const row={id:randomLegacyId(),name,line_nick:String(input?.line_nick||'').trim(),fb_name:String(input?.fb_name||'').trim(),phone,phone_last2:phoneLast2,note,active:true,import_source:String(input?.import_source||'customer-json-v1'),joined_at:createdAt,updated_at:createdAt}
      local.push(row);changes.push(row);created++
    }
    for(let i=0;i<changes.length;i+=250) await neonRuntime('sync_customers',{rows:changes.slice(i,i+250)})
    return {scanned:rows.length,created,updated,skipped,ambiguous}
  }

  ProductsAPI.list=async function({includeArchived=false}={}){
    const result=await neonRuntime('list_products',{includeArchived})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 商品回傳格式錯誤')
    return result.rows
  }
  ProductsAPI.create=async function(data={}){
    const id=randomLegacyId(),createdAt=nowISO(),clean=stripUndefined(data)
    const row={id,...clean,active:true,created_at:createdAt,updated_at:createdAt}
    const primary=await neonRuntime('write_product',{op:'create',id,row})
    return {...row,...(primary?.result||{})}
  }
  ProductsAPI.update=async function(id,data={}){return (await neonRuntime('write_product',{op:'update',id,data:stripUndefined(data)}))?.result}
  ProductsAPI.archive=async function(id){return (await neonRuntime('write_product',{op:'archive',id}))?.result}
  ProductsAPI.restore=async function(id){return (await neonRuntime('write_product',{op:'restore',id}))?.result}
  ProductsAPI.isDuplicate=async function(name,excludeId=null){
    const result=await neonHelperAdminRuntime({action:'product_duplicate',name:String(name||'').trim(),excludeId:excludeId||''})
    return result?.duplicate===true
  }
}
