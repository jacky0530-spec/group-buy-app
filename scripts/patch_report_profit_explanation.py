from pathlib import Path

p = Path('src/pages/Reports.jsx')
s = p.read_text()

old = "const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`"
new = "const money = value => `NT$${Math.round(Number(value || 0)).toLocaleString()}`\nconst signedMoney = value => `${Number(value || 0) >= 0 ? '+' : '-'}NT$${Math.round(Math.abs(Number(value || 0))).toLocaleString()}`"
if old not in s:
    raise SystemExit('money helper not found')
s = s.replace(old, new, 1)

old = "const orderValue=validOrders.reduce((s,o)=>s+effectiveOrderAmount(o),0),shippedRevenue=shippedOrders.reduce((s,o)=>s+effectiveOrderAmount(o),0),shippedCost=shippedOrders.reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),baseProfit=shippedRevenue-shippedCost,adjustedProfit=baseProfit-expenseNet"
new = "const orderValue=validOrders.reduce((s,o)=>s+effectiveOrderAmount(o),0),shippedGrossRevenue=shippedOrders.reduce((s,o)=>s+Number(o.total_amount||0),0),shippedRefundAmount=shippedOrders.reduce((s,o)=>s+Number(o.refund_amount||0),0),shippedRevenue=shippedOrders.reduce((s,o)=>s+effectiveOrderAmount(o),0),shippedCost=shippedOrders.reduce((s,o)=>s+orderSnapshotCost(o,currentCostMap),0),baseProfit=shippedRevenue-shippedCost,adjustedProfit=baseProfit-expenseNet,adjustmentIsDiscount=expenseNet<0,adjustmentLabel=adjustmentIsDiscount?'折讓淨額':'其他費用淨額',adjustmentDisplay=adjustmentIsDiscount?Math.abs(expenseNet):expenseNet"
if old not in s:
    raise SystemExit('profit calculation block not found')
s = s.replace(old, new, 1)

old = "[['有效訂單總額',orderValue,ReceiptText,'linear-gradient(135deg,#6366f1,#4338ca)'],['已出貨營收',shippedRevenue,DollarSign,'linear-gradient(135deg,#10b981,#059669)'],['未收款',outstandingAmount,WalletCards,'linear-gradient(135deg,#f59e0b,#d97706)'],['商品毛利',baseProfit,TrendingUp,'linear-gradient(135deg,#14b8a6,#0f766e)'],['其他費用淨額',expenseNet,Truck,'linear-gradient(135deg,#64748b,#475569)'],['調整後毛利',adjustedProfit,TrendingUp,'linear-gradient(135deg,#8b5cf6,#6d28d9)'],['退款',refundAmount,Package,'linear-gradient(135deg,#f43f5e,#be123c)']]"
new = "[['有效訂單總額',orderValue,ReceiptText,'linear-gradient(135deg,#6366f1,#4338ca)'],['已出貨營收',shippedRevenue,DollarSign,'linear-gradient(135deg,#10b981,#059669)'],['未收款',outstandingAmount,WalletCards,'linear-gradient(135deg,#f59e0b,#d97706)'],['商品毛利',baseProfit,TrendingUp,'linear-gradient(135deg,#14b8a6,#0f766e)'],[adjustmentLabel,adjustmentDisplay,Truck,'linear-gradient(135deg,#64748b,#475569)'],['調整後毛利',adjustedProfit,TrendingUp,'linear-gradient(135deg,#8b5cf6,#6d28d9)'],['客戶退款',refundAmount,Package,'linear-gradient(135deg,#f43f5e,#be123c)']]"
if old not in s:
    raise SystemExit('stat cards block not found')
s = s.replace(old, new, 1)

old = "<div style={{fontSize:21,fontWeight:900,marginTop:5}}>{loading?'—':money(value)}</div>"
new = "<div style={{fontSize:21,fontWeight:900,marginTop:5}}>{loading?'—':(label==='折讓淨額'?signedMoney(value):money(value))}</div>"
if old not in s:
    raise SystemExit('stat value display not found')
s = s.replace(old, new, 1)

old = "<div style={{background:'var(--surface-2)',borderRadius:10,padding:'10px 12px',marginBottom:18,fontSize:12,color:'var(--text-secondary)'}}>調整後毛利＝已出貨營收－商品成本－運費－其他費用＋退費折讓。本期：運費 {money(expenseShipping)}、其他費用 {money(expenseOther)}、退費折讓 {money(expenseDiscount)}。取消金額 {money(cancelledAmount)} 不計入。</div>"
new = "<div style={{background:'linear-gradient(135deg,#eff6ff,#f5f3ff)',border:'1px solid #c7d2fe',borderRadius:14,padding:'14px 16px',marginBottom:18,color:'var(--text-secondary)'}}>\n      <div style={{fontWeight:900,color:'var(--text-primary)',fontSize:14,marginBottom:10}}>🧮 毛利怎麼算？</div>\n      <div style={{display:'grid',gap:8,fontSize:12,lineHeight:1.7}}>\n        <div><strong style={{color:'#059669'}}>① 已出貨營收</strong>＝原已出貨銷售額 {money(shippedGrossRevenue)} − 客戶退款 {money(shippedRefundAmount)} ＝ <strong>{money(shippedRevenue)}</strong><br/><span style={{color:'#b45309'}}>註：客戶退款已在這一步扣除，後面計算毛利時不會再扣第二次。</span></div>\n        <div><strong style={{color:'#0f766e'}}>② 商品毛利</strong>＝已出貨營收 {money(shippedRevenue)} − 已出貨商品成本 {money(shippedCost)} ＝ <strong>{money(baseProfit)}</strong></div>\n        <div><strong style={{color:'#6d28d9'}}>③ 調整後毛利</strong>＝商品毛利 {money(baseProfit)} − 運費 {money(expenseShipping)} − 其他費用 {money(expenseOther)} ＋ 供應商退費折讓 {money(expenseDiscount)} ＝ <strong style={{color:'#6d28d9'}}>{money(adjustedProfit)}</strong></div>\n      </div>\n      <div style={{marginTop:10,paddingTop:10,borderTop:'1px dashed #c7d2fe',fontSize:11}}>本期{adjustmentIsDiscount?<>折讓大於其他費用，因此顯示 <strong style={{color:'#059669'}}>折讓淨額 {signedMoney(adjustmentDisplay)}</strong></>:<>費用高於折讓，因此顯示 <strong>其他費用淨額 {money(adjustmentDisplay)}</strong></>}。取消金額 {money(cancelledAmount)} 不計入營收與毛利。</div>\n    </div>"
if old not in s:
    raise SystemExit('old profit explanation box not found')
s = s.replace(old, new, 1)

s = s.replace("<th>其他費用</th><th>調整後毛利</th>", "<th>費用／折讓淨額</th><th>調整後毛利</th>")
s = s.replace("<td>{money(r.adjustments)}</td><td", "<td>{r.adjustments<0?signedMoney(Math.abs(r.adjustments)):money(r.adjustments)}</td><td")

p.write_text(s)

p = Path('src/components/Layout.jsx')
s = p.read_text()
old = "const APP_VERSION = 'v2026.08.23.5'"
new = "const APP_VERSION = 'v2026.08.23.6'"
if old not in s:
    raise SystemExit('version not found')
p.write_text(s.replace(old,new,1))
