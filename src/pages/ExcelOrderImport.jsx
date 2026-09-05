import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, Upload, CheckCircle, AlertTriangle, Trash2, RefreshCw } from 'lucide-react'
import { CustomersAPI, OrdersAPI, ProductsAPI, snapshotOrderItem } from '../lib/db'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'
import { useToast } from '../components/UI'

const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
const SIZE_ALIASES = { '2L':'XXL', '3L':'XXXL', '4L':'XXXXL', XXL:'2L', XXXL:'3L', XXXXL:'4L' }
const clean = v => String(v ?? '').trim()
const norm = v => clean(v).toLowerCase().replace(/[\s　、，,。．.／/()（）【】\[\]_-]/g,'')
const qtyNumber = v => { const n=Number(v); return Number.isFinite(n)&&n>0?Math.floor(n):0 }

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-xlsx-loader="1"]')
    if(existing){existing.addEventListener('load',()=>resolve(window.XLSX));existing.addEventListener('error',()=>reject(new Error('Excel 解析元件載入失敗')));return}
    const s=document.createElement('script');s.src=XLSX_CDN;s.async=true;s.dataset.xlsxLoader='1';s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(new Error('Excel 解析元件載入失敗，請確認網路連線'));document.head.appendChild(s)
  })
}

function stripCodeLabel(v){return clean(v).replace(/^[A-ZＡ-Ｚ]\s*[、,，.．:\-]?\s*/i,'').replace(/碼$/,'').trim()}
function parseHeaderSpec(header){
  const original=clean(header).replace(/碼$/,'').trim()
  const plain=stripCodeLabel(original)
  if(!original)return{raw_label:'',plain_label:''}
  const sizeMatch=plain.match(/(XS|S|M|L|XL|XXL|XXXL|XXXXL|2L|3L|4L)$/i)
  if(sizeMatch){
    const size=sizeMatch[1].toUpperCase()
    const color=plain.slice(0,sizeMatch.index).trim()
    return{raw_label:original,plain_label:plain,color,size}
  }
  return{raw_label:original,plain_label:plain,color:plain}
}
function parseCellValue(value,header){
  if(value===null||value===undefined||clean(value)==='')return null
  const base=parseHeaderSpec(header)
  if(typeof value==='number'){const qty=qtyNumber(value);return qty?{qty,...base}:null}
  const text=clean(value)
  const mx=text.match(/^(.+?)\s*[xX×*]\s*(\d+)$/)
  if(mx){const qty=qtyNumber(mx[2]);if(!qty)return null;const token=clean(mx[1]).replace(/碼$/,'').toUpperCase();return{qty,raw_label:base.raw_label,plain_label:base.plain_label||'',color:base.color||'',size:token}}
  const num=text.match(/^(\d+)$/)
  if(num)return{qty:qtyNumber(num[1]),...base}
  return null
}
function likelySummaryRow(row){
  const rawName=row?.[1]
  const name=clean(rawName)
  const nums=(row||[]).slice(2).filter(v=>qtyNumber(v)>0).length
  if(!nums)return false
  if(!name)return true
  if(typeof rawName==='number'&&!clean(row?.[0]))return true
  return false
}
function parseSheetRows(rows,fileName,sheetName){
  const title=clean(rows?.[0]?.[0]) || fileName.replace(/\.xlsx?$/i,'')
  const headerRow=rows?.[1]||[]
  const headers=headerRow.slice(2)
  const matrix=headers.some(v=>typeof v==='string'&&clean(v)!==''&&qtyNumber(v)===0)
  const buyers=[]
  const start=matrix?2:1
  for(let r=start;r<rows.length;r+=1){
    const row=rows[r]||[]
    if(likelySummaryRow(row))continue
    const customer_name=clean(row[1]);if(!customer_name)continue
    const marker=clean(row[0])
    const items=[]
    if(matrix){
      headers.forEach((header,i)=>{const parsed=parseCellValue(row[i+2],header);if(parsed&&parsed.qty>0)items.push(parsed)})
    }else{
      const qty=qtyNumber(row[2]);if(qty>0)items.push({qty,raw_label:'',plain_label:'',color:'',size:''})
    }
    if(!items.length)continue
    buyers.push({key:`${fileName}:${sheetName}:${r}`,customer_name,marker,is_virtual:marker==='私',items})
  }
  return{fileName,sheetName,title,buyers}
}
function productCore(value){
  return norm(value)
    .replace(/^\d{1,2}\d{1,2}/,'')
    .replace(/\d+(入|尾|包|盒|組|顆|片|支|件|元)?$/g,'')
    .replace(/\d+元/g,'')
    .replace(/元/g,'')
}
function commonPrefixLength(a,b){let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i+=1;return i}
function productScore(title,product){
  const t=productCore(title)
  const p=productCore(product?.name)
  if(!t||!p)return 0
  if(t===p)return 1000+t.length
  if(t.includes(p)||p.includes(t)){
    const ratio=Math.min(t.length,p.length)/Math.max(t.length,p.length)
    if(ratio>=0.72)return 800+Math.round(ratio*100)
  }
  const prefix=commonPrefixLength(t,p)
  if(prefix>=4)return 500+prefix
  let common=0;for(const ch of new Set([...t]))if(p.includes(ch))common+=1
  const ratio=common/Math.max(t.length,p.length)
  return ratio>=0.7?Math.round(ratio*300):0
}
function guessProduct(title,products){
  const ranked=[...products].map(product=>({product,score:productScore(title,product)})).sort((a,b)=>b.score-a.score)
  const best=ranked[0]
  const second=ranked[1]
  if(!best||best.score<500)return null
  if(second&&best.score<800&&best.score-second.score<30)return null
  return best.product
}
function findCustomerMatches(name,customers){const n=norm(name);return customers.filter(c=>norm(c.name)===n)}
function matchValue(value,options=[]){
  const n=norm(value);if(!n)return''
  const exact=options.find(v=>norm(v)===n);if(exact)return exact
  const alias=SIZE_ALIASES[clean(value).toUpperCase()];if(alias){const a=options.find(v=>norm(v)===norm(alias));if(a)return a}
  return''
}
function matchLabeledValue(values,options=[]){
  const candidates=[...new Set((Array.isArray(values)?values:[values]).map(clean).filter(Boolean))]
  for(const value of candidates){
    const exact=options.find(v=>norm(v)===norm(value));if(exact)return exact
  }
  for(const value of candidates){
    const plain=stripCodeLabel(value);if(!plain)continue
    const plainMatch=options.find(v=>norm(stripCodeLabel(v))===norm(plain));if(plainMatch)return plainMatch
  }
  return''
}
function findPackageOption(values,options=[]){
  const candidates=[...new Set((Array.isArray(values)?values:[values]).map(clean).filter(Boolean))]
  for(const value of candidates){
    const exact=options.find(o=>norm(o.label)===norm(value));if(exact)return exact
  }
  for(const value of candidates){
    const plain=stripCodeLabel(value);if(!plain)continue
    const exactPlain=options.find(o=>norm(stripCodeLabel(o.label))===norm(plain));if(exactPlain)return exactPlain
  }
  for(const value of candidates){
    const n=norm(value);if(!n)continue
    const fuzzy=options.find(o=>n.includes(norm(o.label))||norm(o.label).includes(n));if(fuzzy)return fuzzy
  }
  return null
}
function resolveImportedItem(product,item){
  const raw=item.raw_label||''
  const plain=item.plain_label||stripCodeLabel(raw)
  const packageOpt=findPackageOption([raw,plain],product.price_options||[])
  const flavor=matchLabeledValue([raw,plain],product.spec_flavors||[])
  const size=matchValue(item.size,product.spec_sizes||[]) || (!product.spec_sizes?.length?clean(item.size):'')
  const color=flavor?'':(matchLabeledValue([raw,item.color,plain],product.spec_colors||[]) || (!product.spec_colors?.length?clean(item.color||plain):''))
  return{qty:item.qty,spec:{package:packageOpt?.label||'',flavor,color,size},priceOption:packageOpt,raw_label:raw}
}
function validationError(product,resolved){
  if((product.price_options||[]).length&&!resolved.spec.package)return `找不到組合／包裝「${resolved.raw_label||'空白'}」`
  if((product.spec_flavors||[]).length&&!resolved.spec.flavor)return `找不到口味「${resolved.raw_label||'空白'}」`
  if(['color_size','color_only','color_free'].includes(product.spec_mode)&&!resolved.spec.color)return `找不到顏色「${resolved.raw_label||'空白'}」`
  if(['color_size','size_only'].includes(product.spec_mode)&&!resolved.spec.size)return `找不到尺寸「${resolved.spec.size||resolved.raw_label||'空白'}」`
  return''
}
function signature(customerId,productId,items){
  return norm(`${customerId}|${productId}|${(items||[]).map(i=>{const s=i.spec||{};return `${s.package||''}:${s.flavor||''}:${s.color||''}:${s.size||''}:${Number(i.original_qty??i.qty??0)}`}).join('|')}`)
}
function existingOrderSignature(order){
  if(order?.source!=='excel_import'||!order?.customer_id)return''
  const items=Array.isArray(order.items)?order.items:[]
  if(!items.length)return''
  const productIds=[...new Set(items.map(i=>clean(i.product_id||i.id)).filter(Boolean))]
  if(productIds.length!==1)return''
  return signature(order.customer_id,productIds[0],items)
}

export default function ExcelOrderImport(){
  const toast=useToast();const[products,setProducts]=useState([]);const[customers,setCustomers]=useState([]);const[orders,setOrders]=useState([]);const[groups,setGroups]=useState([]);const[loading,setLoading]=useState(true);const[catalogReady,setCatalogReady]=useState(false);const[duplicateReady,setDuplicateReady]=useState(false);const[parsing,setParsing]=useState(false);const[saving,setSaving]=useState(false)
  const load=useCallback(async()=>{
    setLoading(true);setCatalogReady(false);setDuplicateReady(false)
    try{
      const[p,c]=await Promise.all([ProductsAPI.list(),CustomersAPI.list()])
      setProducts(p);setCustomers(c);setCatalogReady(true)
      try{const o=await OrdersAPI.list();setOrders(o);setDuplicateReady(true)}catch(err){setOrders([]);toast('重複訂單檢查載入失敗：'+err.message,'warning')}
    }catch(err){toast('載入失敗：'+err.message,'error')}finally{setLoading(false)}
  },[toast])
  useEffect(()=>{load()},[load])
  useEffect(()=>{
    if(!customers.length)return
    setGroups(prev=>{
      let changed=false
      const next=prev.map(g=>({...g,buyers:g.buyers.map(b=>{
        const ms=findCustomerMatches(b.customer_name,customers)
        const nextId=b.customer_id|| (ms.length===1?ms[0].id:'')
        if(nextId===b.customer_id&&ms.length===b.customer_matches)return b
        changed=true
        return{...b,customer_id:nextId,customer_matches:ms.length}
      })}))
      return changed?next:prev
    })
  },[customers])
  async function pickFiles(event){
    const files=[...(event.target.files||[])];event.target.value='';if(!files.length)return
    if(!catalogReady){toast('客戶／商品資料仍在載入中，請稍候再選擇 Excel','warning');return}
    setParsing(true)
    try{
      const XLSX=await loadXlsx();const next=[]
      for(const file of files){const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array'});for(const sheetName of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:null,raw:true});const parsed=parseSheetRows(rows,file.name,sheetName);if(!parsed.buyers.length)continue;const guessed=guessProduct(parsed.title,products);const buyers=parsed.buyers.map(b=>{const ms=findCustomerMatches(b.customer_name,customers);return{...b,customer_id:ms.length===1?ms[0].id:'',customer_matches:ms.length}});next.push({...parsed,id:`${file.name}:${sheetName}:${Date.now()}:${Math.random()}`,product_id:guessed?.id||'',buyers})}}
      setGroups(prev=>[...next,...prev]);toast(`已解析 ${next.length} 個工作表，請確認商品與客戶配對`)
    }catch(err){toast('Excel 解析失敗：'+err.message,'error')}finally{setParsing(false)}
  }
  function patchGroup(id,patch){setGroups(v=>v.map(g=>g.id===id?{...g,...patch}:g))}
  function patchBuyer(groupId,key,patch){setGroups(v=>v.map(g=>g.id!==groupId?g:{...g,buyers:g.buyers.map(b=>b.key===key?{...b,...patch}:b)}))}
  const existingSigs=useMemo(()=>new Set(orders.map(existingOrderSignature).filter(Boolean)),[orders])
  const preview=useMemo(()=>groups.map(g=>{const product=products.find(p=>p.id===g.product_id)||null;const buyers=g.buyers.map(b=>{const customer=customers.find(c=>c.id===b.customer_id)||null;const resolved=product?b.items.map(i=>resolveImportedItem(product,i)):[];const errors=[];if(!product)errors.push('未選商品');if(!customer)errors.push('未配對客戶');if(product)resolved.forEach(x=>{const e=validationError(product,x);if(e)errors.push(e)});const sig=product&&customer?signature(customer.id,product.id,resolved):'';const duplicate=sig&&existingSigs.has(sig);return{...b,customer,resolved,errors,sig,duplicate}});return{...g,product,buyers}}),[groups,products,customers,existingSigs])
  const counts=useMemo(()=>{const buyers=preview.flatMap(g=>g.buyers);return{files:preview.length,buyers:buyers.length,ready:buyers.filter(b=>!b.errors.length&&!b.duplicate).length,errors:buyers.filter(b=>b.errors.length).length,duplicates:buyers.filter(b=>b.duplicate).length}},[preview])
  async function importOrders(){
    if(!duplicateReady){toast('重複訂單檢查尚未完成，請稍候再匯入','warning');return}
    const bad=preview.flatMap(g=>g.buyers).filter(b=>b.errors.length);if(bad.length){toast(`仍有 ${bad.length} 位客戶需要完成商品／客戶／規格配對`,'error');return}
    const rows=[];const batchId=`IMP-${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}`
    preview.forEach(g=>g.buyers.forEach(b=>{if(b.duplicate)return;const items=b.resolved.map(r=>snapshotOrderItem(g.product,{qty:r.qty,spec:r.spec,priceOption:r.priceOption}));rows.push({customer_id:b.customer.id,customer_name:b.customer.name,customer_phone:b.customer.phone||'',customer_phone_last2:getCustomerPhoneLast2(b.customer),items,total_amount:items.reduce((s,i)=>s+i.subtotal,0),note:`Excel匯入：${g.fileName}${b.marker?`；原表標記：${b.marker}`:''}`,is_virtual:Boolean(b.is_virtual),source:'excel_import',import_batch_id:batchId,import_source_file:g.fileName,import_source_sheet:g.sheetName,import_signature:b.sig,imported_at:new Date().toISOString()})}))
    if(!rows.length){toast('沒有新的可匯入訂單','warning');return}
    if(!window.confirm(`確定建立 ${rows.length} 筆訂單？\n相同客戶＋商品＋規格＋原訂數量的既有 Excel 訂單會自動略過。`))return
    setSaving(true);try{let created=0;for(let i=0;i<rows.length;i+=250){const part=await OrdersAPI.batchCreate(rows.slice(i,i+250));created+=part.length}toast(`Excel 匯入完成：建立 ${created} 筆訂單 ✓`);setGroups([]);await load()}catch(err){toast('匯入失敗：'+err.message,'error')}finally{setSaving(false)}
  }
  return <div className="animate-fade">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:18}}><div><h2 style={{fontSize:22,fontWeight:800}}>Excel 匯入訂單</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>支援舊團購表：單純數量、橫向規格、顏色＋Mx1/Lx1/2Lx1。先預覽確認，再正式建立訂單。</p></div><div style={{display:'flex',gap:8}}><label className="btn btn-primary" style={{cursor:catalogReady?'pointer':'not-allowed',opacity:catalogReady?1:.6}}><Upload size={14}/>{!catalogReady?'載入客戶...':parsing?'解析中...':'選擇 Excel'}<input type="file" accept=".xlsx,.xls" multiple hidden onChange={pickFiles} disabled={parsing||!catalogReady}/></label><button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14}/>重整資料</button></div></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:14}}><div className="card" style={{padding:12}}><small>工作表</small><div style={{fontSize:24,fontWeight:900}}>{counts.files}</div></div><div className="card" style={{padding:12}}><small>客戶訂單</small><div style={{fontSize:24,fontWeight:900}}>{counts.buyers}</div></div><div className="card" style={{padding:12}}><small>可匯入</small><div style={{fontSize:24,fontWeight:900,color:'var(--emerald)'}}>{counts.ready}</div></div><div className="card" style={{padding:12}}><small>待處理</small><div style={{fontSize:24,fontWeight:900,color:'var(--rose)'}}>{counts.errors}</div></div><div className="card" style={{padding:12}}><small>重複略過</small><div style={{fontSize:24,fontWeight:900,color:'#b45309'}}>{counts.duplicates}</div></div></div>
    {!groups.length?<div className="card" style={{padding:34,textAlign:'center',color:'var(--text-muted)'}}><FileSpreadsheet size={44} style={{margin:'0 auto 10px'}}/><strong>請選擇一個或多個 Excel 檔案</strong><div style={{fontSize:12,marginTop:8}}>{catalogReady?'系統不會立即寫入；完成配對並按「確認匯入」後才建立訂單。':'正在從 Neon 載入商品與客戶資料…'}</div></div>:preview.map(g=><div className="card" key={g.id} style={{marginBottom:14}}><div className="card-header" style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><strong>📄 {g.fileName}</strong><div style={{fontSize:11,color:'var(--text-muted)'}}>{g.sheetName}｜表單標題：{g.title}</div></div><button className="btn btn-sm btn-ghost" onClick={()=>setGroups(v=>v.filter(x=>x.id!==g.id))}><Trash2 size={12}/>移除</button></div><div className="card-body"><div className="form-group"><label>對應系統商品 *</label><select value={g.product_id} onChange={e=>patchGroup(g.id,{product_id:e.target.value})}><option value="">請選擇商品</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="table-container"><table><thead><tr><th>Excel客戶</th><th>對應系統客戶</th><th>規格／數量</th><th>類型</th><th>狀態</th></tr></thead><tbody>{g.buyers.map(b=><tr key={b.key} style={{background:b.is_virtual?'#fff1f2':undefined}}><td><strong>{b.customer_name}</strong>{b.marker&&<div style={{fontSize:10,color:'#be123c'}}>原表標記：{b.marker}</div>}</td><td><select value={b.customer_id} onChange={e=>patchBuyer(g.id,b.key,{customer_id:e.target.value})} style={{minWidth:180}}><option value="">請選擇客戶</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}{getCustomerPhoneLast2(c)?`｜末碼${getCustomerPhoneLast2(c)}`:''}</option>)}</select>{b.customer_matches>1&&<div style={{fontSize:10,color:'#b45309'}}>同名 {b.customer_matches} 位，請確認末碼</div>}</td><td>{b.resolved.length?b.resolved.map((x,i)=><div key={i}>{x.spec.package||x.spec.flavor||[x.spec.color,x.spec.size].filter(Boolean).join('/')||'無規格'} × <strong>{x.qty}</strong></div>):b.items.map((x,i)=><div key={i}>{x.raw_label||'無規格'} × <strong>{x.qty}</strong></div>)}</td><td><label style={{display:'flex',gap:6,alignItems:'center',fontWeight:800,color:b.is_virtual?'#be123c':'var(--text-secondary)'}}><input type="checkbox" checked={Boolean(b.is_virtual)} onChange={e=>patchBuyer(g.id,b.key,{is_virtual:e.target.checked})}/>虛擬</label></td><td>{b.duplicate?<span className="badge badge-amber">重複略過</span>:b.errors.length?<div style={{color:'var(--rose)',fontSize:11}}><AlertTriangle size={12}/>{[...new Set(b.errors)].join('；')}</div>:<span className="badge badge-emerald"><CheckCircle size={11}/>可匯入</span>}</td></tr>)}</tbody></table></div></div></div>)}
    {groups.length>0&&<div style={{position:'sticky',bottom:12,zIndex:10,display:'flex',justifyContent:'flex-end'}}><button className="btn btn-primary" onClick={importOrders} disabled={saving||!duplicateReady||counts.errors>0||counts.ready===0} style={{minWidth:220,height:50,fontSize:16}}><CheckCircle size={15}/>{saving?'建立訂單中...':!duplicateReady?'載入重複檢查...':`確認匯入 ${counts.ready} 筆訂單`}</button></div>}
  </div>
}