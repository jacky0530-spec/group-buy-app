from pathlib import Path

p = Path('src/pages/PendingProductReport.jsx')
s = p.read_text()

def repl(old, new):
    global s
    if old not in s:
        raise SystemExit('pattern not found:\n' + old[:300])
    s = s.replace(old, new, 1)

repl("const SPEC_STYLE = { color:'#dc2626', fontWeight:900 }",
     "const SPEC_STYLE = { color:'#dc2626', fontWeight:900 }\nconst COMBO_STYLE = { color:'#2563eb', fontWeight:900 }\nconst specDisplayStyle = text => String(text || '').startsWith('組合：') ? COMBO_STYLE : SPEC_STYLE")

repl("  if (!selectedProduct) return { combos:[],colors:[],sizes:[],flavors:[],totalQty:0,totalArrived:0,totalMissing:0,totalAmount:0 }\n  const combos = new Map(), colors = new Map(), sizes = new Map(), flavors = new Map()",
     "  if (!selectedProduct) return { combos:[],packages:[],colors:[],sizes:[],flavors:[],totalQty:0,totalArrived:0,totalMissing:0,totalAmount:0 }\n  const combos = new Map(), packages = new Map(), colors = new Map(), sizes = new Map(), flavors = new Map()")

repl("    const flavor = String(spec.flavor || '').trim()\n    const color = String(spec.color || '').trim()\n    const size = String(spec.size || '').trim()",
     "    const packageName = String(spec.package || '').trim()\n    const flavor = String(spec.flavor || '').trim()\n    const color = String(spec.color || '').trim()\n    const size = String(spec.size || '').trim()")

repl("    const comboKey = [flavor,color,size].join('|')\n    const comboLabel = [flavor && `口味：${flavor}`,color && `顏色：${color}`,size && `尺寸：${size}`].filter(Boolean).join('／') || '一般規格'\n    if (!combos.has(comboKey)) combos.set(comboKey,{ label:comboLabel,flavor,color,size,qty:0,arrived:0,missing:0,amount:0 })",
     "    const comboKey = [packageName,flavor,color,size].join('|')\n    const comboLabel = [packageName && `組合：${packageName}`,flavor && `口味：${flavor}`,color && `顏色：${color}`,size && `尺寸：${size}`].filter(Boolean).join('／') || '一般規格'\n    if (!combos.has(comboKey)) combos.set(comboKey,{ label:comboLabel,packageName,flavor,color,size,qty:0,arrived:0,missing:0,amount:0 })")

repl("    increment(flavors,flavor,qty); increment(colors,color,qty); increment(sizes,size,qty)",
     "    increment(packages,packageName,qty); increment(flavors,flavor,qty); increment(colors,color,qty); increment(sizes,size,qty)")

repl("  return { combos:Array.from(combos.values()).sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant',{numeric:true})),colors:mapToRows(colors),sizes:mapToRows(sizes),flavors:mapToRows(flavors),totalQty,totalArrived,totalMissing,totalAmount }",
     "  return { combos:Array.from(combos.values()).sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant',{numeric:true})),packages:mapToRows(packages),colors:mapToRows(colors),sizes:mapToRows(sizes),flavors:mapToRows(flavors),totalQty,totalArrived,totalMissing,totalAmount }")

repl("<span style={SPEC_STYLE}>{item.spec}</span> ×<strong>{item.qty}</strong>",
     "<span style={specDisplayStyle(item.spec)}>{item.spec}</span> ×<strong>{item.qty}</strong>")

repl("<span style={SPEC_STYLE}>{item.spec}</span> ×{item.qty}",
     "<span style={specDisplayStyle(item.spec)}>{item.spec}</span> ×{item.qty}")

repl("<table><thead><tr><th>規格組合</th><th>口味</th><th>顏色</th><th>尺寸</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(r => <tr key={r.label}><td><span style={SPEC_STYLE}>{r.label}</span></td><td><span style={r.flavor?SPEC_STYLE:undefined}>{r.flavor||'—'}</span></td><td><span style={r.color?SPEC_STYLE:undefined}>{r.color||'—'}</span></td><td><span style={r.size?SPEC_STYLE:undefined}>{r.size||'—'}</span></td><td><strong>{r.qty}</strong></td><td style={{fontWeight:900,color:'var(--emerald)'}}>{r.arrived}</td><td style={{fontWeight:900,color:r.missing?'var(--rose)':'var(--text-muted)'}}>{r.missing}</td></tr>)}</tbody></table></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}><DimensionSummary title=\"口味小計\" rows={orderingSummary.flavors}/><DimensionSummary title=\"顏色小計\" rows={orderingSummary.colors}/><DimensionSummary title=\"尺寸小計\" rows={orderingSummary.sizes}/></div>",
     "<table><thead><tr><th>規格組合</th><th>組合</th><th>口味</th><th>顏色</th><th>尺寸</th><th>訂購</th><th>已到</th><th>未到</th></tr></thead><tbody>{orderingSummary.combos.map(r => <tr key={r.label}><td><span style={r.packageName?COMBO_STYLE:SPEC_STYLE}>{r.label}</span></td><td><span style={r.packageName?COMBO_STYLE:undefined}>{r.packageName||'—'}</span></td><td><span style={r.flavor?SPEC_STYLE:undefined}>{r.flavor||'—'}</span></td><td><span style={r.color?SPEC_STYLE:undefined}>{r.color||'—'}</span></td><td><span style={r.size?SPEC_STYLE:undefined}>{r.size||'—'}</span></td><td><strong>{r.qty}</strong></td><td style={{fontWeight:900,color:'var(--emerald)'}}>{r.arrived}</td><td style={{fontWeight:900,color:r.missing?'var(--rose)':'var(--text-muted)'}}>{r.missing}</td></tr>)}</tbody></table></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}><DimensionSummary title=\"組合小計\" rows={orderingSummary.packages}/><DimensionSummary title=\"口味小計\" rows={orderingSummary.flavors}/><DimensionSummary title=\"顏色小計\" rows={orderingSummary.colors}/><DimensionSummary title=\"尺寸小計\" rows={orderingSummary.sizes}/></div>")

p.write_text(s)

lp = Path('src/components/Layout.jsx')
ls = lp.read_text()
old = "const APP_VERSION = 'v2026.08.22.5'"
new = "const APP_VERSION = 'v2026.08.23.1'"
if old not in ls:
    raise SystemExit('version pattern not found')
lp.write_text(ls.replace(old, new, 1))
