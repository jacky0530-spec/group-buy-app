from pathlib import Path
p=Path('src/pages/Reports.jsx')
s=p.read_text()
s=s.replace("candy:'糖果'","candy:'生鮮蔬果'")
s=s.replace(",supplierPaidCost=validOrders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Math.max(0,Number(i.supplier_paid_amount||0)),0),0)","")
old="const supplierRows=useMemo(()=>{const map={};validOrders.forEach(o=>(o.items||[]).forEach(i=>{const supplier=i.supplier||'未指定供應商';if(!map[supplier])map[supplier]={supplier,total:0,outstanding:0,adjustments:0};const fallback=currentCostMap[i.product_id||i.id]??0,cost=Number(i.cost_price??fallback)*Number(i.qty||0);map[supplier].total+=cost;if(o.payable_status!=='paid')map[supplier].outstanding+=cost}));periodExpenses.forEach"
new="const supplierRows=useMemo(()=>{const map={};validOrders.forEach(o=>(o.items||[]).forEach(i=>{const supplier=i.supplier||'未指定供應商';if(!map[supplier])map[supplier]={supplier,total:0,outstanding:0,adjustments:0};const fallback=currentCostMap[i.product_id||i.id]??0,cost=Number(i.cost_price??fallback)*Number(i.qty||0),paid=Math.max(0,Number(i.supplier_paid_amount||0));map[supplier].total+=cost;map[supplier].outstanding+=Math.max(0,cost-paid)}));periodExpenses.forEach"
if old not in s: raise SystemExit('supplierRows pattern not found')
s=s.replace(old,new,1)
p.write_text(s)
