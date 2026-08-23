from pathlib import Path
for fn, keys in {
 'src/pages/Products.jsx':['batchCreate','batchBuyers','saveBatch','一鍵批次','開單'],
 'src/pages/PendingProductReport.jsx':['currentRows','buildOrderingSummary','filteredProductRows','markRowShipped','map(row','row.archived','order_ids'],
 'src/pages/Orders.jsx':['payload =','showForm','訂單備註','save()','orderNote'],
}.items():
    s=Path(fn).read_text()
    print('\n###',fn)
    for key in keys:
        start=0
        while True:
            i=s.find(key,start)
            if i<0: break
            a=max(0,i-500); b=min(len(s),i+1200)
            print('\n---',key,'@',i,'---\n',s[a:b].replace('\n','\\n'))
            start=i+len(key)
