from pathlib import Path

products_path = Path('src/pages/Products.jsx')
text = products_path.read_text(encoding='utf-8')
old = "setBatchBuyers(p=>[...p,{id:c.id,name:c.name,phone:c.phone||'',phone_last2:getCustomerPhoneLast2(c),rows:[{qty:1,spec:{color:'',size:'',flavor:''}}]}])"
new = "setBatchBuyers(p=>[{id:c.id,name:c.name,phone:c.phone||'',phone_last2:getCustomerPhoneLast2(c),rows:[{qty:1,spec:{color:'',size:'',flavor:''}}]},...p])"
if old not in text:
    raise SystemExit('addBuyer pattern not found')
products_path.write_text(text.replace(old, new, 1), encoding='utf-8')

layout_path = Path('src/components/Layout.jsx')
layout = layout_path.read_text(encoding='utf-8')
if "v2026.08.21.9" not in layout:
    raise SystemExit('expected app version not found')
layout_path.write_text(layout.replace("v2026.08.21.9", "v2026.08.22.1", 1), encoding='utf-8')
