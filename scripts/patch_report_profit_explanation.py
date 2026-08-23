from pathlib import Path

p = Path('src/pages/Reports.jsx')
s = p.read_text()

old = "{[['應收帳款（未收款）',outstandingAmount],['應付商品成本',payableOutstanding],['已付供應商商品成本',supplierPaidCost],['其他費用淨額',expenseNet],['現金流淨額',netCashFlow]].map(([l,v])=><div key={l} style={{background:'var(--surface-2)',borderRadius:10,padding:14}}><div style={{fontSize:11,fontWeight:700}}>{l}</div><div style={{fontSize:20,fontWeight:900,marginTop:5}}>{money(v)}</div></div>)}"
new = "{[['應收帳款（未收款）',outstandingAmount,false],['應付商品成本',payableOutstanding,false],['已付供應商商品成本',supplierPaidCost,false],[adjustmentLabel,adjustmentDisplay,adjustmentIsDiscount],['現金流淨額',netCashFlow,false]].map(([l,v,isPositiveAdjustment])=><div key={l} style={{background:'var(--surface-2)',borderRadius:10,padding:14}}><div style={{fontSize:11,fontWeight:700}}>{l}</div><div style={{fontSize:20,fontWeight:900,marginTop:5,color:isPositiveAdjustment?'var(--emerald)':'inherit'}}>{isPositiveAdjustment?signedMoney(v):money(v)}</div></div>)}"
if old not in s:
    raise SystemExit('finance summary cards block not found')
s = s.replace(old,new,1)

old = "<th>供應商</th><th>商品成本</th><th>未付商品</th><th>其他費用淨額</th>"
new = "<th>供應商</th><th>商品成本</th><th>未付商品</th><th>費用／折讓淨額</th>"
if old not in s:
    raise SystemExit('supplier header not found')
s = s.replace(old,new,1)

old = "<td style={{fontWeight:800,color:r.adjustments>0?'var(--rose)':'var(--emerald)'}}>{money(r.adjustments)}</td>"
new = "<td style={{fontWeight:800,color:r.adjustments>0?'var(--rose)':'var(--emerald)'}}>{r.adjustments<0?`折讓 ${signedMoney(Math.abs(r.adjustments))}`:money(r.adjustments)}</td>"
if old not in s:
    raise SystemExit('supplier adjustment cell not found')
s = s.replace(old,new,1)

p.write_text(s)
