from pathlib import Path
p=Path('src/pages/Orders.jsx')
s=p.read_text()
old="const orderDay = String(o.order_date || '').slice(0,10); const dateMatch = (!filterDateFrom || orderDay >= filterDateFrom) && (!filterDateTo || orderDay <= filterDateTo);"
new="const orderDate = o.order_date ? new Date(o.order_date) : null; const orderDay = orderDate && !Number.isNaN(orderDate.getTime()) ? `${orderDate.getFullYear()}-${String(orderDate.getMonth()+1).padStart(2,'0')}-${String(orderDate.getDate()).padStart(2,'0')}` : ''; const dateMatch = (!filterDateFrom || orderDay >= filterDateFrom) && (!filterDateTo || orderDay <= filterDateTo);"
if old not in s: raise SystemExit('date filter pattern not found')
p.write_text(s.replace(old,new,1))
