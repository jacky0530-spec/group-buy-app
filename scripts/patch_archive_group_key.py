from pathlib import Path
p=Path('src/pages/PendingProductReport.jsx')
s=p.read_text()
old="    const groupKey = order.customer_id || `${order.customer_name || customer.name || ''}|${phone || last2 || ''}`\n"
new="    const baseGroupKey = order.customer_id || `${order.customer_name || customer.name || ''}|${phone || last2 || ''}`\n    const groupKey = `${baseGroupKey}|${order.archived === true ? 'archived' : 'active'}`\n"
if old not in s:
    raise SystemExit('groupKey pattern not found')
s=s.replace(old,new,1)
p.write_text(s)
