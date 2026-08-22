from pathlib import Path

products_path = Path('src/pages/Products.jsx')
text = products_path.read_text(encoding='utf-8')

start = text.index('function PriceOptionsEditor({form,setForm})')
end = text.index('function SpecBadges({product})', start)
new_editor = '''function PriceOptionsEditor({form,setForm}){const[open,setOpen]=useState(false);const count=(form.price_options||[]).length;function add(){const label=String(form.price_label_input||'').trim(),price=Number(form.price_value_input),costRaw=String(form.price_cost_input??'').trim();if(!label||!Number.isFinite(price)||price<0)return;if((form.price_options||[]).some(x=>x.label===label))return;setForm(p=>({...p,price_options:[...(p.price_options||[]),{label,price,cost:costRaw===''?'':Number(costRaw)}],price_label_input:'',price_value_input:'',price_cost_input:''}))}return <div style={{border:'2px solid #f59e0b',background:'#fffaf0',borderRadius:12,marginTop:14,marginBottom:14,overflow:'hidden'}}><button type="button" onClick={()=>setOpen(v=>!v)} style={{width:'100%',border:0,background:'linear-gradient(90deg,#fff7ed,#fffbeb)',padding:'13px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,cursor:'pointer',fontFamily:'inherit',textAlign:'left'}}><span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><strong style={{fontSize:15,color:'#92400e'}}>💰 組合／包裝價（選填）</strong>{count>0&&<span className="badge badge-emerald" style={{fontWeight:900}}>已設定 {count} 組</span>}</span><span style={{fontSize:13,fontWeight:800,color:'#b45309'}}>{open?'▲ 收合':'▼ 展開設定'}</span></button>{open&&<div style={{padding:'14px',borderTop:'1px solid #fde68a'}}><div style={{fontSize:12,color:'#92400e',marginBottom:10,fontWeight:600}}>有設定時，下單需選擇組合；數量 1 代表 1 組。例如：一盒500克 200元、一箱5公斤 1800元。</div><div style={{display:'grid',gridTemplateColumns:'minmax(160px,2fr) minmax(90px,1fr) minmax(100px,1fr) auto',gap:8,alignItems:'end'}}><div className="form-group" style={{marginBottom:0}}><label>組合名稱</label><input value={form.price_label_input||''} onChange={e=>setForm(p=>({...p,price_label_input:e.target.value}))} placeholder="例：一盒500克／二包"/></div><div className="form-group" style={{marginBottom:0}}><label>售價</label><input type="number" min="0" inputMode="numeric" value={form.price_value_input||''} onChange={e=>setForm(p=>({...p,price_value_input:e.target.value}))}/></div><div className="form-group" style={{marginBottom:0}}><label>成本（可選）</label><input type="number" min="0" inputMode="numeric" value={form.price_cost_input||''} onChange={e=>setForm(p=>({...p,price_cost_input:e.target.value}))}/></div><button type="button" className="btn btn-ghost" onClick={add}><Plus size={13}/>加入</button></div>{count>0&&<div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:10}}>{form.price_options.map(opt=><span key={opt.label} className="badge badge-emerald" style={{display:'inline-flex',alignItems:'center',gap:5,padding:'7px 10px',fontSize:13,fontWeight:800}}>{opt.label} NT${Number(opt.price||0).toLocaleString()}{opt.cost!==''&&opt.cost!=null?`（成本 ${Number(opt.cost).toLocaleString()}）`:''}<button type="button" onClick={()=>setForm(p=>({...p,price_options:p.price_options.filter(x=>x.label!==opt.label)}))} style={{background:'none',border:0,padding:0,cursor:'pointer',color:'inherit',display:'flex'}}><X size={11}/></button></span>)}</div>}</div>}</div>}\n'''
text = text[:start] + new_editor + text[end:]

old_qty = "<QuantityInput value={row.qty} min={1} onChange={value=>updateBuyerRow(b.id,idx,'qty',value)} ariaLabel={`${b.name}數量`} style={{width:75}}/>"
new_qty = "<QuantityInput value={row.qty} min={1} onChange={value=>updateBuyerRow(b.id,idx,'qty',value)} ariaLabel={`${b.name}數量`} style={{width:110,height:48,fontSize:20,fontWeight:900,padding:'8px 12px',textAlign:'center'}}/>"
if old_qty not in text:
    raise SystemExit('batch quantity input pattern not found')
text = text.replace(old_qty, new_qty, 1)

products_path.write_text(text, encoding='utf-8')

layout_path = Path('src/components/Layout.jsx')
layout = layout_path.read_text(encoding='utf-8')
if "v2026.08.22.2" not in layout:
    raise SystemExit('expected app version not found')
layout_path.write_text(layout.replace("v2026.08.22.2", "v2026.08.22.3", 1), encoding='utf-8')
