from pathlib import Path

# AuthGuard
p=Path('src/components/AuthGuard.jsx')
s=p.read_text()
s=s.replace("import { onAuthChange, logout, isEmailAllowed } from '../lib/auth'", "import { onAuthChange, logout, getAccountAccess } from '../lib/auth'")
s=s.replace("  const [allowed, setAllowed] = useState(false)\n  const [checking,setChecking]= useState(false)", "  const [allowed, setAllowed] = useState(false)\n  const [role,setRole] = useState(null)\n  const [account,setAccount] = useState(null)\n  const [checking,setChecking]= useState(false)")
s=s.replace("        const ok = await isEmailAllowed(u.uid)\n        setAllowed(ok)", "        const access = await getAccountAccess(u.uid)\n        setAllowed(access.allowed)\n        setRole(access.role)\n        setAccount(access.account)")
s=s.replace("        setAllowed(false)\n      }", "        setAllowed(false)\n        setRole(null)\n        setAccount(null)\n      }")
s=s.replace("<AuthContext.Provider value={{ user, allowed, checking, logout }}>", "<AuthContext.Provider value={{ user, allowed, role, account, checking, logout }}>")
insert="""
export function RoleGuard({ roles = [] }) {
  const { role } = useAuth()
  if (!roles.length || roles.includes(role)) return <Outlet />
  return <Navigate to={role === 'helper' ? '/helper' : '/'} replace />
}
"""
s=s.replace("// ── UserMenu", insert+"\n// ── UserMenu")
p.write_text(s)

# App routes
p=Path('src/App.jsx')
s=p.read_text()
s=s.replace("import { AuthProvider, AuthGuard } from './components/AuthGuard'", "import { AuthProvider, AuthGuard, RoleGuard, useAuth } from './components/AuthGuard'")
s=s.replace("import Accounts from './pages/Accounts'", "import Accounts from './pages/Accounts'\nimport HelperPortal from './pages/HelperPortal'\nimport HelperEntries from './pages/HelperEntries'")
s=s.replace("export default function App() {", "function LandingRedirect(){ const { role } = useAuth(); return <Navigate to={role === 'helper' ? '/helper' : '/'} replace /> }\n\nexport default function App() {")
old='''            <Route element={<AuthGuard />}>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="products" element={<Products />} />
                <Route path="customers" element={<Customers />} />
                <Route path="orders" element={<Orders />} />
                <Route path="reports" element={<Reports />} />
                <Route path="pending-report" element={<PendingProductReport />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="supplier-payments" element={<SupplierPayments />} />
                <Route path="accounts" element={<Accounts />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />'''
new='''            <Route element={<AuthGuard />}>
              <Route element={<RoleGuard roles={['owner','staff']} />}>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="products" element={<Products />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="orders" element={<Orders />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="pending-report" element={<PendingProductReport />} />
                  <Route path="expenses" element={<Expenses />} />
                  <Route path="supplier-payments" element={<SupplierPayments />} />
                  <Route path="helper-entries" element={<HelperEntries />} />
                  <Route path="accounts" element={<Accounts />} />
                </Route>
              </Route>
              <Route element={<RoleGuard roles={['helper']} />}>
                <Route path="/helper" element={<HelperPortal />} />
              </Route>
              <Route path="/go" element={<LandingRedirect />} />
            </Route>
            <Route path="*" element={<Navigate to="/go" replace />} />'''
if old not in s: raise SystemExit('App route block not found')
s=s.replace(old,new)
p.write_text(s)

# Layout nav/version
p=Path('src/components/Layout.jsx')
s=p.read_text()
s=s.replace("ReceiptText, CreditCard }", "ReceiptText, CreditCard, ClipboardCheck } from 'lucide-react'") if "ReceiptText, CreditCard } from 'lucide-react'" in s else s
# handle exact import
s=s.replace("ReceiptText, CreditCard } from 'lucide-react'", "ReceiptText, CreditCard, ClipboardCheck } from 'lucide-react'")
s=s.replace("v2026.08.23.12", "v2026.08.24.1")
s=s.replace("  { to: '/supplier-payments', icon: CreditCard, label: '供應商付款' },", "  { to: '/supplier-payments', icon: CreditCard, label: '供應商付款' },\n  { to: '/helper-entries', icon: ClipboardCheck, label: '小幫手登記' },")
p.write_text(s)

# Accounts helper role and simpler selector
p=Path('src/pages/Accounts.jsx')
s=p.read_text()
s=s.replace("  staff:{ label:'員工', icon:'👤', color:'#6366f1', bg:'#eef2ff' },", "  staff:{ label:'員工', icon:'👤', color:'#6366f1', bg:'#eef2ff' },\n  helper:{ label:'小幫手', icon:'📝', color:'#0f766e', bg:'#ecfdf5' },")
s=s.replace("<button className=\"btn btn-sm btn-ghost\" onClick={() => changeRole(a,a.role === 'owner' ? 'staff' : 'owner')}><Crown size={11}/>{a.role === 'owner' ? '改員工' : '設負責人'}</button>", "<select value={a.role||'staff'} onChange={e=>changeRole(a,e.target.value)} style={{padding:'6px 8px',borderRadius:8,fontWeight:700}}>{Object.entries(ROLES).map(([id,r])=><option key={id} value={id}>{r.icon} {r.label}</option>)}</select>")
p.write_text(s)

# db: sync sanitized catalog on product writes
p=Path('src/lib/db.js')
s=p.read_text()
s=s.replace("writeBatch, arrayUnion, limit, startAfter,", "writeBatch, arrayUnion, limit, startAfter, setDoc,")
helper_fn="""
function helperCatalogPayload(product) {
  return {
    name:String(product?.name || '').trim(),
    price:Number(product?.price || 0),
    category:product?.category || 'other',
    pricing_mode:product?.pricing_mode || ((product?.price_options || []).length ? 'options' : 'single'),
    spec_mode:product?.spec_mode || 'none',
    spec_colors:[...(product?.spec_colors || [])],
    spec_sizes:[...(product?.spec_sizes || [])],
    spec_flavors:[...(product?.spec_flavors || [])],
    price_options:(product?.price_options || []).map(o => ({ label:String(o.label || ''), price:Number(o.price || 0) })),
    active:product?.active !== false,
    updated_at:now(),
  }
}
"""
s=s.replace("export const ProductsAPI = {", helper_fn+"\nexport const ProductsAPI = {")
s=s.replace("    const ref = await addDoc(collection(db,'products'), payload)\n    return", "    const ref = await addDoc(collection(db,'products'), payload)\n    await setDoc(doc(db,'helper_catalog',ref.id), helperCatalogPayload({ ...data,active:true }))\n    return")
s=s.replace("    await updateDoc(doc(db,'products',id), { ...data, updated_at:now() })\n  },\n  async archive", "    await updateDoc(doc(db,'products',id), { ...data, updated_at:now() })\n    await setDoc(doc(db,'helper_catalog',id), helperCatalogPayload(data), { merge:true })\n  },\n  async archive")
s=s.replace("    await updateDoc(doc(db,'products',id), { active:false, archived_at:now(), updated_at:now() })", "    await updateDoc(doc(db,'products',id), { active:false, archived_at:now(), updated_at:now() })\n    await setDoc(doc(db,'helper_catalog',id), { active:false,updated_at:now() }, { merge:true })")
s=s.replace("    await updateDoc(doc(db,'products',id), { active:true, archived_at:null, updated_at:now() })", "    await updateDoc(doc(db,'products',id), { active:true, archived_at:null, updated_at:now() })\n    await setDoc(doc(db,'helper_catalog',id), { active:true,updated_at:now() }, { merge:true })")
p.write_text(s)

# Rules
Path('firestore.rules').write_text(r'''rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function accountPath() { return /databases/$(database)/documents/accounts/$(request.auth.uid); }
    function hasAccess() { return signedIn() && exists(accountPath()) && get(accountPath()).data.disabled != true; }
    function role() { return hasAccess() ? get(accountPath()).data.role : null; }
    function isOwner() { return role() == 'owner'; }
    function isAdmin() { return role() == 'owner' || role() == 'staff'; }
    function isHelper() { return role() == 'helper'; }
    function validRole(value) { return value == 'owner' || value == 'staff' || value == 'helper'; }

    match /accounts/{uid} {
      allow read: if isAdmin() || (hasAccess() && uid == request.auth.uid);
      allow create: if isOwner() && validRole(request.resource.data.role) && request.resource.data.disabled == false;
      allow update: if isOwner() && validRole(request.resource.data.role) && (uid != request.auth.uid || request.resource.data.disabled == false);
      allow delete: if false;
    }

    match /customers/{id} {
      allow read: if isAdmin() || isHelper();
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /helper_catalog/{id} {
      allow read: if isAdmin() || isHelper();
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /helper_entries/{id} {
      allow read: if isAdmin() || (isHelper() && resource.data.created_by_uid == request.auth.uid);
      allow create: if isHelper()
        && request.resource.data.created_by_uid == request.auth.uid
        && request.resource.data.status == 'pending'
        && request.resource.data.keys().hasOnly(['created_by_uid','created_by_name','customer_id','customer_name','customer_phone_last2','items','total_amount','is_virtual','note','status','created_at','updated_at']);
      allow update: if isAdmin() || (isHelper()
        && resource.data.created_by_uid == request.auth.uid
        && resource.data.status == 'pending'
        && request.resource.data.created_by_uid == resource.data.created_by_uid
        && request.resource.data.status in ['pending','cancelled']
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['customer_id','customer_name','customer_phone_last2','items','total_amount','is_virtual','note','status','updated_at']));
      allow delete: if isAdmin();
    }

    match /products/{id} { allow read, create, update: if isAdmin(); allow delete: if false; }
    match /orders/{id} { allow read, create, update: if isAdmin(); allow delete: if isOwner(); }
    match /expenses/{id} { allow read, create, update: if isAdmin(); allow delete: if false; }
    match /supplier_payments/{id} { allow read, create, update: if isAdmin(); allow delete: if false; }

    match /{document=**} { allow read, write: if false; }
  }
}
''')

# helper lib
Path('src/lib/helper.js').write_text(r'''import { collection, doc, getDocs, addDoc, updateDoc, writeBatch, Timestamp } from 'firebase/firestore'
import { db } from './firebase'

const now = () => Timestamp.now()
const toISO = v => v?.toDate ? v.toDate().toISOString() : (v || null)
const normalize = d => { const x={id:d.id,...d.data()}; ['created_at','updated_at'].forEach(k=>{if(x[k])x[k]=toISO(x[k])}); return x }

export const HelperAPI = {
  async catalog(){ const snap=await getDocs(collection(db,'helper_catalog')); return snap.docs.map(normalize).filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant')) },
  async customers(){ const snap=await getDocs(collection(db,'customers')); return snap.docs.map(normalize).filter(x=>x.active!==false).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant')) },
  async myEntries(uid){ const snap=await getDocs(collection(db,'helper_entries')); return snap.docs.map(normalize).filter(x=>x.created_by_uid===uid).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) },
  async allEntries(){ const snap=await getDocs(collection(db,'helper_entries')); return snap.docs.map(normalize).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) },
  async createEntry(data){ const payload={...data,status:'pending',created_at:now(),updated_at:now()}; const ref=await addDoc(collection(db,'helper_entries'),payload); return {id:ref.id,...data,status:'pending'} },
  async updateEntry(id,data){ await updateDoc(doc(db,'helper_entries',id),{...data,updated_at:now()}) },
  async syncCatalog(products=[]){
    for(let i=0;i<products.length;i+=400){ const batch=writeBatch(db); products.slice(i,i+400).forEach(p=>batch.set(doc(db,'helper_catalog',p.id),{ name:p.name||'',price:Number(p.price||0),category:p.category||'other',pricing_mode:p.pricing_mode||((p.price_options||[]).length?'options':'single'),spec_mode:p.spec_mode||'none',spec_colors:p.spec_colors||[],spec_sizes:p.spec_sizes||[],spec_flavors:p.spec_flavors||[],price_options:(p.price_options||[]).map(o=>({label:o.label||'',price:Number(o.price||0)})),active:p.active!==false,updated_at:now() },{merge:true})); await batch.commit() }
    return products.length
  }
}
''')

# Helper portal page
Path('src/pages/HelperPortal.jsx').write_text(r'''import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Plus, X, Save, LogOut, ClipboardList } from 'lucide-react'
import { useAuth } from '../components/AuthGuard'
import { useToast } from '../components/UI'
import { HelperAPI } from '../lib/helper'
import { filterCustomers, customerSecondaryLabel, getCustomerPhoneLast2 } from '../lib/customerSearch'
import QuantityInput from '../components/QuantityInput'

function specText(item){const s=item.spec||{};return [s.package&&`組合：${s.package}`,s.flavor&&`口味：${s.flavor}`,s.color&&`顏色：${s.color}`,s.size&&`尺寸：${s.size}`].filter(Boolean).join('／')||'一般規格'}
function itemPrice(item){const opt=(item.product.price_options||[]).find(o=>o.label===item.spec?.package);return Number(opt?.price??item.product.price??0)}

export default function HelperPortal(){
  const { user,account,logout }=useAuth(); const toast=useToast()
  const[customers,setCustomers]=useState([]),[products,setProducts]=useState([]),[entries,setEntries]=useState([]),[loading,setLoading]=useState(true)
  const[customerSearch,setCustomerSearch]=useState(''),[productSearch,setProductSearch]=useState(''),[customer,setCustomer]=useState(null),[items,setItems]=useState([]),[isVirtual,setIsVirtual]=useState(false),[note,setNote]=useState(''),[saving,setSaving]=useState(false)
  const load=useCallback(async()=>{setLoading(true);try{const[c,p,e]=await Promise.all([HelperAPI.customers(),HelperAPI.catalog(),HelperAPI.myEntries(user.uid)]);setCustomers(c);setProducts(p);setEntries(e)}catch(err){toast('載入失敗：'+err.message,'error')}finally{setLoading(false)}},[user,toast])
  useEffect(()=>{if(user)load()},[user,load])
  const custs=useMemo(()=>filterCustomers(customers,customerSearch).slice(0,20),[customers,customerSearch])
  const prods=useMemo(()=>products.filter(p=>String(p.name||'').toLowerCase().includes(productSearch.toLowerCase())).slice(0,30),[products,productSearch])
  function addProduct(product){setItems(p=>[...p,{product,qty:1,spec:{package:'',flavor:'',color:'',size:''},note:''}]);setProductSearch('')}
  function patchItem(i,patch){setItems(p=>p.map((x,n)=>n===i?{...x,...patch}:x))}
  function patchSpec(i,key,value){setItems(p=>p.map((x,n)=>n===i?{...x,spec:{...x.spec,[key]:value}}:x))}
  async function save(){if(!customer){toast('請先選擇客戶','error');return}if(!items.length){toast('請至少加入一項商品','error');return}for(const x of items){if(!Number.isInteger(Number(x.qty))||Number(x.qty)<1){toast('數量至少為 1','error');return}if((x.product.price_options||[]).length&&!x.spec.package){toast(`「${x.product.name}」請選組合／包裝`,'error');return}if((x.product.spec_flavors||[]).length&&!x.spec.flavor){toast(`「${x.product.name}」請選口味`,'error');return}if(['color_size','color_free','color_only'].includes(x.product.spec_mode)&&!x.spec.color){toast(`「${x.product.name}」請選顏色`,'error');return}if(['color_size','size_only'].includes(x.product.spec_mode)&&!x.spec.size){toast(`「${x.product.name}」請選尺寸`,'error');return}}
    setSaving(true);try{const cleanItems=items.map(x=>({product_id:x.product.id,product_name:x.product.name,sale_price:itemPrice(x),qty:Number(x.qty),spec:x.spec,note:x.note||''}));await HelperAPI.createEntry({created_by_uid:user.uid,created_by_name:account?.display_name||user.email||'',customer_id:customer.id,customer_name:customer.name,customer_phone_last2:getCustomerPhoneLast2(customer),items:cleanItems,total_amount:cleanItems.reduce((s,x)=>s+x.sale_price*x.qty,0),is_virtual:isVirtual,note:note.trim()});toast('登記完成 ✓');setCustomer(null);setCustomerSearch('');setItems([]);setIsVirtual(false);setNote('');await load()}catch(err){toast('登記失敗：'+err.message,'error')}finally{setSaving(false)}}
  const total=items.reduce((s,x)=>s+itemPrice(x)*Number(x.qty||0),0)
  return <div style={{minHeight:'100vh',background:'#f8fafc'}}><header style={{position:'sticky',top:0,zIndex:20,background:'#0f172a',color:'#fff',padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><div><strong style={{fontSize:18}}>📝 小幫手團購登記</strong><div style={{fontSize:11,opacity:.6}}>{account?.display_name||user?.email}</div></div><button onClick={logout} style={{border:'1px solid rgba(255,255,255,.2)',background:'transparent',color:'#fff',borderRadius:8,padding:'8px 10px'}}><LogOut size={14}/> 登出</button></header><main style={{maxWidth:900,margin:'0 auto',padding:16}}>
    <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',padding:'10px 12px',borderRadius:10,marginBottom:14,fontSize:13,color:'#065f46'}}>此頁只提供客戶查詢與訂單登記；成本、供應商、毛利、財務與付款資料不會提供給小幫手。</div>
    <div className="card" style={{marginBottom:14}}><div className="card-header"><strong>① 選擇客戶</strong></div><div className="card-body"><div className="search-input-wrap"><Search size={16}/><input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="姓名／手機末兩碼／Line／FB" style={{paddingLeft:36,height:48,fontSize:16}}/></div>{customerSearch&&<div style={{marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>{custs.map(c=><button key={c.id} onClick={()=>{setCustomer(c);setCustomerSearch('')}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:0,borderBottom:'1px solid var(--border)',background:'#fff'}}><strong>{c.name}</strong><div style={{fontSize:11,color:'var(--text-muted)'}}>{customerSecondaryLabel(c)||'無其他辨識資料'}</div></button>)}</div>}{customer&&<div style={{marginTop:10,padding:12,borderRadius:10,background:'var(--indigo-light)',display:'flex',justifyContent:'space-between'}}><strong>👤 {customer.name}{getCustomerPhoneLast2(customer)?`（末碼 ${getCustomerPhoneLast2(customer)}）`:''}</strong><button onClick={()=>setCustomer(null)} style={{border:0,background:'transparent'}}><X size={16}/></button></div>}</div></div>
    <div className="card" style={{marginBottom:14}}><div className="card-header"><strong>② 加入商品</strong></div><div className="card-body"><div className="search-input-wrap"><Search size={16}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="輸入商品名稱" style={{paddingLeft:36,height:48,fontSize:16}}/></div>{productSearch&&<div style={{marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>{prods.map(p=><button key={p.id} onClick={()=>addProduct(p)} style={{display:'flex',width:'100%',justifyContent:'space-between',padding:'10px 12px',border:0,borderBottom:'1px solid var(--border)',background:'#fff'}}><span>{p.name}</span><strong>NT${Number(p.price||0).toLocaleString()}</strong></button>)}</div>}{items.map((x,i)=><div key={i} style={{marginTop:10,padding:12,border:'1px solid var(--border)',borderRadius:10,background:'#fff'}}><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><strong style={{flex:1}}>{x.product.name}</strong><QuantityInput value={x.qty} min={1} onChange={v=>patchItem(i,{qty:v})} style={{width:90,height:44,fontSize:18,fontWeight:900}}/><button onClick={()=>setItems(p=>p.filter((_,n)=>n!==i))} style={{border:0,background:'transparent',color:'var(--rose)'}}><X size={16}/></button></div><div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>{(x.product.price_options||[]).length>0&&<select value={x.spec.package} onChange={e=>patchSpec(i,'package',e.target.value)}><option value="">選組合／包裝 *</option>{x.product.price_options.map(o=><option key={o.label} value={o.label}>{o.label}｜NT${Number(o.price||0).toLocaleString()}</option>)}</select>}{(x.product.spec_flavors||[]).length>0&&<select value={x.spec.flavor} onChange={e=>patchSpec(i,'flavor',e.target.value)}><option value="">選口味 *</option>{x.product.spec_flavors.map(v=><option key={v}>{v}</option>)}</select>}{['color_size','color_free','color_only'].includes(x.product.spec_mode)&&<select value={x.spec.color} onChange={e=>patchSpec(i,'color',e.target.value)}><option value="">選顏色 *</option>{(x.product.spec_colors||[]).map(v=><option key={v}>{v}</option>)}</select>}{['color_size','size_only'].includes(x.product.spec_mode)&&<select value={x.spec.size} onChange={e=>patchSpec(i,'size',e.target.value)}><option value="">選尺寸 *</option>{(x.product.spec_sizes||[]).map(v=><option key={v}>{v}</option>)}</select>}<input value={x.note} onChange={e=>patchItem(i,{note:e.target.value})} placeholder="備註" style={{maxWidth:180}}/></div><div style={{marginTop:7,fontSize:12,color:'var(--text-secondary)'}}>{specText(x)}　小計 NT${(itemPrice(x)*Number(x.qty||0)).toLocaleString()}</div></div>)}</div></div>
    <div className="card" style={{marginBottom:14}}><div className="card-body"><label style={{display:'flex',gap:10,padding:12,border:'2px solid #fb7185',borderRadius:10,background:isVirtual?'#fff1f2':'#fff'}}><input type="checkbox" checked={isVirtual} onChange={e=>setIsVirtual(e.target.checked)}/><span><strong style={{color:'#be123c'}}>⚠ 虛擬訂單</strong><div style={{fontSize:11,color:'var(--text-secondary)'}}>客戶尚未完全確定時勾選；不會計入實際訂貨量。</div></span></label><div className="form-group" style={{marginTop:12}}><label>備註</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：客戶晚點確認"/></div><div style={{textAlign:'right',fontSize:20,fontWeight:900,marginBottom:10}}>合計 NT${total.toLocaleString()}</div><button className="btn btn-primary" onClick={save} disabled={saving} style={{width:'100%',justifyContent:'center',height:50,fontSize:16}}><Save size={16}/>{saving?'儲存中...':'送出登記'}</button></div></div>
    <div className="card"><div className="card-header"><strong><ClipboardList size={15}/> 我的最近登記</strong></div><div className="table-container"><table><thead><tr><th>客戶</th><th>商品</th><th>狀態</th></tr></thead><tbody>{entries.slice(0,20).map(e=><tr key={e.id}><td>{e.customer_name}<div style={{fontSize:10,color:'var(--text-muted)'}}>{e.customer_phone_last2?`末碼 ${e.customer_phone_last2}`:''}</div></td><td>{(e.items||[]).map((x,i)=><div key={i}>{x.product_name} ×{x.qty}</div>)}</td><td><span className={`badge ${e.status==='pending'?'badge-amber':e.status==='converted'?'badge-emerald':'badge-gray'}`}>{e.status==='pending'?'待確認':e.status==='converted'?'已轉訂單':'已取消'}</span>{e.is_virtual&&<div><span className="badge badge-rose">虛擬</span></div>}</td></tr>)}{!loading&&!entries.length&&<tr><td colSpan={3} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>尚無登記</td></tr>}</tbody></table></div></div>
  </main></div>
}
''')

# Admin helper entries
Path('src/pages/HelperEntries.jsx').write_text(r'''import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Database } from 'lucide-react'
import { useToast } from '../components/UI'
import { HelperAPI } from '../lib/helper'
import { ProductsAPI, OrdersAPI, snapshotOrderItem } from '../lib/db'

const money=v=>`NT$${Math.round(Number(v||0)).toLocaleString()}`
export default function HelperEntries(){
 const toast=useToast();const[entries,setEntries]=useState([]),[products,setProducts]=useState([]),[loading,setLoading]=useState(true),[working,setWorking]=useState('')
 const load=useCallback(async()=>{setLoading(true);try{const[e,p]=await Promise.all([HelperAPI.allEntries(),ProductsAPI.list({includeArchived:true})]);setEntries(e);setProducts(p)}catch(err){toast('載入失敗：'+err.message,'error')}finally{setLoading(false)}},[toast]);useEffect(()=>{load()},[load])
 const productMap=useMemo(()=>Object.fromEntries(products.map(p=>[p.id,p])),[products]);const pending=entries.filter(e=>e.status==='pending')
 async function sync(){setWorking('sync');try{const n=await HelperAPI.syncCatalog(products);toast(`已同步 ${n} 筆小幫手安全商品目錄 ✓`)}catch(err){toast('同步失敗：'+err.message,'error')}finally{setWorking('')}}
 async function convert(entry){setWorking(entry.id);try{const items=(entry.items||[]).map(x=>{const p=productMap[x.product_id];if(!p||p.active===false)throw new Error(`商品「${x.product_name}」不存在或已封存`);const priceOption=(p.price_options||[]).find(o=>o.label===(x.spec?.package||''))||null;return snapshotOrderItem(p,{qty:x.qty,spec:x.spec||{},note:x.note||'',priceOption})});const order=await OrdersAPI.create({customer_id:entry.customer_id,customer_name:entry.customer_name,customer_phone_last2:entry.customer_phone_last2||'',items,total_amount:items.reduce((s,i)=>s+i.subtotal,0),note:entry.note||'',is_virtual:Boolean(entry.is_virtual),source:'helper',helper_entry_id:entry.id,created_by_uid:entry.created_by_uid||'',created_by_name:entry.created_by_name||''});await HelperAPI.updateEntry(entry.id,{status:'converted',converted_order_id:order.id,converted_at:new Date().toISOString()});toast(`已轉成${entry.is_virtual?'虛擬':'正式'}訂單 ✓`);await load()}catch(err){toast('轉單失敗：'+err.message,'error')}finally{setWorking('')}}
 async function reject(entry){setWorking(entry.id);try{await HelperAPI.updateEntry(entry.id,{status:'cancelled'});toast('已取消此筆登記');await load()}catch(err){toast('取消失敗：'+err.message,'error')}finally{setWorking('')}}
 return <div className="animate-fade"><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:18}}><div><h2 style={{fontSize:22,fontWeight:800}}>小幫手登記</h2><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:3}}>小幫手只能登記；由正式後台確認後才寫入訂單與成本快照。</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-ghost" onClick={sync} disabled={working==='sync'}><Database size={14}/>{working==='sync'?'同步中...':'同步小幫手商品目錄'}</button><button className="btn btn-ghost" onClick={load}><RefreshCw size={14}/>重新整理</button></div></div><div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',padding:12,borderRadius:10,marginBottom:14,fontSize:13,color:'#065f46'}}>首次啟用小幫手前，請先按一次「同步小幫手商品目錄」。之後正式後台新增／修改商品時會自動同步安全版商品資料。</div><div className="card"><div className="card-header"><strong>待確認 {pending.length} 筆</strong></div><div className="table-container"><table><thead><tr><th>登記人</th><th>客戶</th><th>商品明細</th><th>類型</th><th>登記金額</th><th>操作</th></tr></thead><tbody>{pending.map(e=><tr key={e.id} style={{background:e.is_virtual?'#fff1f2':undefined}}><td>{e.created_by_name||'小幫手'}</td><td><strong>{e.customer_name}</strong>{e.customer_phone_last2&&<div style={{fontSize:11,color:'var(--text-muted)'}}>末碼 {e.customer_phone_last2}</div>}</td><td>{(e.items||[]).map((x,i)=><div key={i}>{x.product_name} ×<strong>{x.qty}</strong>{x.spec?.package?`／${x.spec.package}`:''}{x.spec?.flavor?`／${x.spec.flavor}`:''}{x.spec?.color?`／${x.spec.color}`:''}{x.spec?.size?`／${x.spec.size}`:''}</div>)}{e.note&&<div style={{fontSize:11,color:'var(--text-muted)'}}>備註：{e.note}</div>}</td><td><span className={`badge ${e.is_virtual?'badge-rose':'badge-emerald'}`}>{e.is_virtual?'⚠ 虛擬':'正式'}</span></td><td>{money(e.total_amount)}</td><td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="btn btn-sm btn-primary" disabled={working===e.id} onClick={()=>convert(e)}><CheckCircle size={12}/>確認轉單</button><button className="btn btn-sm btn-ghost" disabled={working===e.id} onClick={()=>reject(e)} style={{color:'var(--rose)'}}><XCircle size={12}/>取消</button></div></td></tr>)}{!loading&&!pending.length&&<tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'var(--text-muted)'}}>目前沒有待確認登記</td></tr>}</tbody></table></div></div></div>
}
''')
