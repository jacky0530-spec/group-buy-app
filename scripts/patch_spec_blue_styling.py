from pathlib import Path

p = Path('src/pages/PendingProductReport.jsx')
s = p.read_text()

old = "const SPEC_STYLE = { color:'#dc2626', fontWeight:900 }\nconst COMBO_STYLE = { color:'#2563eb', fontWeight:900 }\nconst specDisplayStyle = text => String(text || '').startsWith('組合：') ? COMBO_STYLE : SPEC_STYLE"
new = "const SPEC_STYLE = { color:'#2563eb', fontWeight:900 }\nconst COMBO_STYLE = { color:'#1d4ed8', fontWeight:900 }\nconst specDisplayStyle = () => SPEC_STYLE"
if old not in s:
    raise SystemExit('style constants pattern not found')
s = s.replace(old, new, 1)
p.write_text(s)

lp = Path('src/components/Layout.jsx')
ls = lp.read_text()
oldv = "const APP_VERSION = 'v2026.08.23.1'"
newv = "const APP_VERSION = 'v2026.08.23.2'"
if oldv not in ls:
    raise SystemExit('version pattern not found')
lp.write_text(ls.replace(oldv, newv, 1))
