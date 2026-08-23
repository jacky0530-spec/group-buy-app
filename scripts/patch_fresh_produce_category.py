from pathlib import Path

p = Path('src/pages/Products.jsx')
s = p.read_text()

repls = [
("  { id:'candy', name:'糖果', icon:'🍬', color:'#8b5cf6' },", "  { id:'candy', name:'生鮮蔬果', icon:'🥬', color:'#22c55e' },"),
("const PRESET_FLAVORS = { frozen:['原味','辣味','黑胡椒','蒜香','起司','海鮮','牛肉','豬肉','雞肉'], biscuit:['原味','巧克力','草莓','抹茶','起司','牛奶','咖啡','花生'], candy:['綜合','葡萄','草莓','檸檬','橘子','水蜜桃','蘋果','薄荷'] }", "const PRESET_FLAVORS = { frozen:['原味','辣味','黑胡椒','蒜香','起司','海鮮','牛肉','豬肉','雞肉'], biscuit:['原味','巧克力','草莓','抹茶','起司','牛奶','咖啡','花生'], candy:[] }"),
("<div style={{fontSize:12,color:'#92400e',marginBottom:10,fontWeight:700}}>🍽️ 第二層口味：有設定口味時，下單必須選擇口味。</div>", "<div style={{fontSize:12,color:'#92400e',marginBottom:10,fontWeight:700}}>{form.category==='candy'?'🥬 第二層品種／口味：生鮮蔬果不提供預設選項，需要時請自行輸入；有設定後，下單必須選擇。':'🍽️ 第二層口味：有設定口味時，下單必須選擇口味。'}</div>"),
("label=\"口味選項\"", "label={form.category==='candy'?'品種／口味選項':'口味選項'}"),
("placeholder=\"自訂口味，例如：椒鹽、海苔、麻辣\"", "placeholder={form.category==='candy'?'自訂品種／口味，例如：愛文、巨峰、智利櫻桃':'自訂口味，例如：椒鹽、海苔、麻辣'}")
]
for old,new in repls:
    if old not in s:
        raise SystemExit('pattern not found: '+old[:120])
    s=s.replace(old,new,1)
p.write_text(s)

lp=Path('src/components/Layout.jsx')
ls=lp.read_text()
old="const APP_VERSION = 'v2026.08.23.2'"
new="const APP_VERSION = 'v2026.08.23.3'"
if old not in ls:
    raise SystemExit('version pattern not found')
lp.write_text(ls.replace(old,new,1))
