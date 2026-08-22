from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_once('src/lib/db.js',
"export function snapshotOrderItem(product, { qty = 1, note = '', spec = {} } = {}) {\n  const price = Number(product.price || 0)\n  const cost = Number(product.cost || 0)",
"export function snapshotOrderItem(product, { qty = 1, note = '', spec = {}, priceOption = null } = {}) {\n  const price = Number(priceOption?.price ?? product.price ?? 0)\n  const cost = Number(priceOption?.cost === '' || priceOption?.cost == null ? (product.cost || 0) : priceOption.cost)")
replace_once('src/lib/db.js',
"      flavor: spec?.flavor || '',\n    },",
"      flavor: spec?.flavor || '',\n      package: priceOption?.label || spec?.package || '',\n    },")

p='src/pages/Products.jsx'
text=Path(p).read_text(encoding='utf-8')
text=text.replace("const EMPTY_FORM = { name:'',price:'',cost:'',category:'other',supplier:'',note:'',spec_mode:'none',spec_colors:[],spec_sizes:[],spec_flavors:[],color_input:'',size_input:'',flavor_input:'' }",
"const EMPTY_FORM = { name:'',price:'',cost:'',category:'other',supplier:'',note:'',spec_mode:'none',spec_colors:[],spec_sizes:[],spec_flavors:[],price_options:[],price_label_input:'',price_value_input:'',price_cost_input:'',color_input:'',size_input:'',flavor_input:'' }")
text=text.replace("function SpecBadges({product}){const parts=[];", "function PriceOptionsEditor({form,setForm}){function add(){const label=String(form.price_label_input||'').trim(),price=Number(form.price_value_input),costRaw=String(form.price_cost_input??'').trim();if(!label||!Number.isFinite(price)||price<0)return;if((form.price_options||[]).some(x=>x.label===label))return;setForm(p=>({...p,price_options:[...(p.price_options||[]),{label,price,cost:costRaw===''?'':Number(costRaw)}],price_label_input:'',price_value_input:'',price_cost_input:''}))}return <div style={{borderTop:'1.5px solid var(--border)',paddingTop:16,marginTop:4,marginBottom:14}}><div style={{fontWeight:800,fontSize:13,marginBottom:6}}>💰 組合／包裝價（選填）</div><div style={{fontSize:12,color:'var(--text-secondary)',marginBottom:10}}>有設定時，下單需選擇組合；數量 1 代表 1 組。例如：一盒500克 200元、一箱5公斤 1800元。</div><div style={{display:'grid',gridTemplateColumns:'minmax(160px,2fr) minmax(90px,1fr) minmax(100px,1fr) auto',gap:8,alignItems:'end'}}><div className=\"form-group\" style={{marginBottom:0}}><label>組合名稱</label><input value={form.price_label_input||''} onChange={e=>setForm(p=>({...p,price_label_input:e.target.value}))} placeholder=\"例：一盒500克／二包\"/></div><div className=\"form-group\" style={{marginBottom:0}}><label>售價</label><input type=\"number\" min=\"0\" inputMode=\"numeric\" value={form.price_value_input||''} onChange={e=>setForm(p=>({...p,price_value_input:e.target.value}))}/></div><div className=\"form-group\" style={{marginBottom:0}}><label>成本（可選）</label><input type=\"number\" min=\"0\" inputMode=\"numeric\" value={form.price_cost_input||''} onChange={e=>setForm(p=>({...p,price_cost_input:e.target.value}))}/></div><button type=\"button\" className=\"btn btn-ghost\" onClick={add}><Plus size={13}/>加入</button></div>{(form.price_options||[]).length>0&&<div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:10}}>{form.price_options.map(opt=><span key={opt.label} className=\"badge badge-emerald\" style={{display:'inline-flex',alignItems:'center',gap:5,padding:'6px 9px'}}>{opt.label} NT${Number(opt.price||0).toLocaleString()}{opt.cost!==''&&opt.cost!=null?`（成本 ${Number(opt.cost).toLocaleString()}）`:''}<button type=\"button\" onClick={()=>setForm(p=>({...p,price_options:p.price_options.filter(x=>x.label!==opt.label)}))} style={{background:'none',border:0,padding:0,cursor:'pointer',color:'inherit',display:'flex'}}><X size={11}/></button></span>)}</div>}</div>}\nfunction SpecBadges({product}){const parts=[];")
text=text.replace("if((product.spec_flavors||[]).length)parts.push(<span key=\"v\" className=\"badge badge-amber\">🍽️ {product.spec_flavors.length} 口味</span>);return parts.length?", "if((product.spec_flavors||[]).length)parts.push(<span key=\"v\" className=\"badge badge-amber\">🍽️ {product.spec_flavors.length} 口味</span>);if((product.price_options||[]).length)parts.push(<span key=\"p\" className=\"badge badge-emerald\">💰 {product.price_options.length} 種組合價</span>);return parts.length?")
text=text.replace("function validateSpec(product,spec){", "function validateSpec(product,spec,priceOptionLabel=''){if((product.price_options||[]).length>0&&!priceOptionLabel)return'請選擇組合／包裝價';")
text=text.replace("function resetForm(){setForm({...EMPTY_FORM,spec_colors:[],spec_sizes:[],spec_flavors:[]})}", "function resetForm(){setForm({...EMPTY_FORM,spec_colors:[],spec_sizes:[],spec_flavors:[],price_options:[]})}")
text=text.replace("spec_flavors:[...(p.spec_flavors||[])],color_input:'',size_input:'',flavor_input:''", "spec_flavors:[...(p.spec_flavors||[])],price_options:[...(p.price_options||[])],price_label_input:'',price_value_input:'',price_cost_input:'',color_input:'',size_input:'',flavor_input:''")
text=text.replace("rows:[{qty:1,spec:{color:'',size:'',flavor:''}}]", "rows:[{qty:1,price_option:'',spec:{color:'',size:'',flavor:''}}]")
text=text.replace("rows:[...b.rows,{qty:1,spec:{color:'',size:'',flavor:''}}]", "rows:[...b.rows,{qty:1,price_option:'',spec:{color:'',size:'',flavor:''}}]")
text=text.replace("field==='qty'?{...row,qty:value}:{...row,spec:{...row.spec,[field]:value}}", "field==='qty'?{...row,qty:value}:field==='price_option'?{...row,price_option:value}:{...row,spec:{...row.spec,[field]:value}}")
text=text.replace("spec_flavors:form.spec_flavors||[]};let product", "spec_flavors:form.spec_flavors||[],price_options:(form.price_options||[]).map(o=>({label:String(o.label||'').trim(),price:Number(o.price||0),cost:o.cost===''||o.cost==null?'':Number(o.cost)}))};let product")
text=text.replace("const err=validateSpec(product,row.spec);", "const err=validateSpec(product,row.spec,row.price_option);")
text=text.replace("const items=buyer.rows.map(row=>snapshotOrderItem(product,{qty:row.qty,spec:row.spec}));", "const items=buyer.rows.map(row=>{const priceOption=(product.price_options||[]).find(o=>o.label===row.price_option)||null;return snapshotOrderItem(product,{qty:row.qty,spec:row.spec,priceOption})});")
text=text.replace("</div></div><SpecEditor form={form} setForm={setForm}/><div style={{display:'grid'", "</div></div><SpecEditor form={form} setForm={setForm}/><PriceOptionsEditor form={form} setForm={setForm}/><div style={{display:'grid'")
needle="{(form.spec_flavors||[]).length>0&&<select value={row.spec.flavor} onChange={e=>updateBuyerRow(b.id,idx,'flavor',e.target.value)}><option value=\"\">選口味 *</option>{form.spec_flavors.map(v=><option key={v}>{v}</option>)}</select>}"
replacement="{(form.price_options||[]).length>0&&<select value={row.price_option||''} onChange={e=>updateBuyerRow(b.id,idx,'price_option',e.target.value)} style={{fontWeight:800,border:'1.5px solid var(--emerald)'}}><option value=\"\">💰 選組合／包裝 *</option>{form.price_options.map(opt=><option key={opt.label} value={opt.label}>{opt.label}｜NT${Number(opt.price||0).toLocaleString()}</option>)}</select>}"+needle
if needle not in text: raise SystemExit('Products batch selector insertion point missing')
text=text.replace(needle,replacement,1)
Path(p).write_text(text,encoding='utf-8')

p='src/pages/Orders.jsx'; text=Path(p).read_text(encoding='utf-8')
text=text.replace("if (s.flavor) parts.push(`口味：${s.flavor}`)", "if (s.package) parts.push(`組合：${s.package}`)\n  if (s.flavor) parts.push(`口味：${s.flavor}`)")
text=text.replace("function validateSpec(product,spec={}) {", "function validateSpec(product,spec={},priceOptionLabel='') {\n  if ((product?.price_options || []).length > 0 && !priceOptionLabel) return `「${product.name}」請選擇組合／包裝價`")
text=text.replace("  const snap = snapshotOrderItem(base,{ qty:item.qty,note:item.note,spec:item.spec })", "  const priceOption = item.snapshot ? (item.snapshot.spec?.package ? { label:item.snapshot.spec.package, price:item.snapshot.sale_price ?? item.snapshot.price, cost:item.snapshot.cost_price } : null) : ((item.product.price_options || []).find(option => option.label === item.price_option) || null)\n  const snap = snapshotOrderItem(base,{ qty:item.qty,note:item.note,spec:item.spec,priceOption })")
text=text.replace("spec_sizes:item.spec?.size ? [item.spec.size] : [] }", "spec_sizes:item.spec?.size ? [item.spec.size] : [],price_options:item.spec?.package ? [{label:item.spec.package,price:item.sale_price ?? item.price ?? 0,cost:item.cost_price ?? ''}] : [] }")
text=text.replace("spec:item.spec || {},snapshot:item }", "spec:item.spec || {},price_option:item.spec?.package || '',snapshot:item }")
text=text.replace("spec:{ color:'',size:'',flavor:'' },snapshot:null", "spec:{ color:'',size:'',flavor:'' },price_option:'',snapshot:null")
text=text.replace("spec:{ color:'',size:'',flavor:'' },snapshot:null", "spec:{ color:'',size:'',flavor:'' },price_option:'',snapshot:null")
text=text.replace("const total = cartItems.reduce((sum,item) => sum + Number(item.snapshot?.sale_price ?? item.snapshot?.price ?? item.product.price ?? 0)*Number(item.qty || 0),0)", "const itemPrice = item => Number(item.snapshot?.sale_price ?? item.snapshot?.price ?? (item.product.price_options||[]).find(o=>o.label===item.price_option)?.price ?? item.product.price ?? 0)\n  const total = cartItems.reduce((sum,item) => sum + itemPrice(item)*Number(item.qty || 0),0)")
text=text.replace("const err = validateSpec(item.product,item.spec);", "const err = validateSpec(item.product,item.spec,item.price_option);")
text=text.replace("{cartItems.map((item,idx) => { const price = item.snapshot?.sale_price ?? item.snapshot?.price ?? item.product.price ?? 0;", "{cartItems.map((item,idx) => { const price = itemPrice(item);")
needle="<strong style={{ flex:1,minWidth:140 }}>{item.product.name}</strong><button type=\"button\" className=\"btn btn-sm btn-ghost\""
insert="<strong style={{ flex:1,minWidth:140 }}>{item.product.name}</strong>{(item.product.price_options||[]).length>0&&<select value={item.price_option||''} onChange={e=>updateCart(idx,{price_option:e.target.value})} disabled={Boolean(item.snapshot)} style={{fontWeight:800,border:'1.5px solid var(--emerald)'}}><option value=\"\">💰 選組合／包裝 *</option>{item.product.price_options.map(opt=><option key={opt.label} value={opt.label}>{opt.label}｜NT${Number(opt.price||0).toLocaleString()}</option>)}</select>}<button type=\"button\" className=\"btn btn-sm btn-ghost\""
if needle not in text: raise SystemExit('Orders cart insertion point missing')
text=text.replace(needle,insert,1)
Path(p).write_text(text,encoding='utf-8')

replace_once('src/components/GroupedReceipt.jsx', "  if (spec.flavor) parts.push(`口味：${spec.flavor}`)", "  if (spec.package) parts.push(`組合：${spec.package}`)\n  if (spec.flavor) parts.push(`口味：${spec.flavor}`)")
replace_once('src/components/GroupedReceipt.jsx', "    spec.flavor || '',", "    spec.package || '',\n    spec.flavor || '',")
replace_once('src/pages/PendingProductReport.jsx', "    spec.flavor && `口味：${spec.flavor}`,", "    spec.package && `組合：${spec.package}`,\n    spec.flavor && `口味：${spec.flavor}`,")
replace_once('src/pages/Reports.jsx', "function specText(item) { const spec=item?.spec||{}; return [spec.flavor&&`口味:${spec.flavor}`,spec.color,spec.size].filter(Boolean).join(' / ') }", "function specText(item) { const spec=item?.spec||{}; return [spec.package&&`組合:${spec.package}`,spec.flavor&&`口味:${spec.flavor}`,spec.color,spec.size].filter(Boolean).join(' / ') }")
replace_once('src/components/Layout.jsx', "const APP_VERSION = 'v2026.08.22.1'", "const APP_VERSION = 'v2026.08.22.2'")
