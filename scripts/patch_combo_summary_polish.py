from pathlib import Path
p=Path('src/pages/PendingProductReport.jsx')
s=p.read_text()
old="function DimensionSummary({ title,rows }) {\n  if (!rows.length) return null\n  return <div style={{ border:'1px solid var(--border)',borderRadius:10,overflow:'hidden' }}><div style={{ background:'var(--surface-2)',padding:'9px 12px',fontSize:13,fontWeight:800 }}>{title}</div><div style={{ padding:'8px 12px' }}>{rows.map(row => <div key={row.label} style={{ display:'flex',justifyContent:'space-between',gap:12,padding:'5px 0',borderBottom:'1px dashed var(--border)' }}><span style={SPEC_STYLE}>{row.label}</span><strong>{row.qty} 件</strong></div>)}</div></div>\n}"
new="function DimensionSummary({ title,rows }) {\n  if (!rows.length) return null\n  const isCombo = title === '組合小計'\n  const rowStyle = isCombo ? COMBO_STYLE : SPEC_STYLE\n  return <div style={{ border:'1px solid var(--border)',borderRadius:10,overflow:'hidden' }}><div style={{ background:isCombo?'#eff6ff':'var(--surface-2)',color:isCombo?'#1d4ed8':'inherit',padding:'9px 12px',fontSize:13,fontWeight:900 }}>{title}</div><div style={{ padding:'8px 12px' }}>{rows.map(row => <div key={row.label} style={{ display:'flex',justifyContent:'space-between',gap:12,padding:'5px 0',borderBottom:'1px dashed var(--border)' }}><span style={rowStyle}>{row.label}</span><strong>{row.qty} 件</strong></div>)}</div></div>\n}"
if old not in s: raise SystemExit('DimensionSummary pattern missing')
s=s.replace(old,new,1)
old2="{orderingSummary.combos.map(r => <tr key={r.label}><td><span style={SPEC_STYLE}>{r.label}</span></td><td>{r.qty}</td><td>{r.arrived}</td><td>{r.missing}</td></tr>)}"
new2="{orderingSummary.combos.map(r => <tr key={r.label}><td><span style={r.packageName?COMBO_STYLE:SPEC_STYLE}>{r.label}</span></td><td>{r.qty}</td><td>{r.arrived}</td><td>{r.missing}</td></tr>)}"
if old2 not in s: raise SystemExit('print summary pattern missing')
s=s.replace(old2,new2,1)
p.write_text(s)
