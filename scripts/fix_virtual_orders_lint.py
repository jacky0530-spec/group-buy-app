from pathlib import Path
p=Path('src/pages/PendingProductReport.jsx')
s=p.read_text().replace("item.sources?.map((source,i)=><div", "item.sources?.map(source=><div")
p.write_text(s)
