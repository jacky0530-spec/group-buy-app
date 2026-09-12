from pathlib import Path
import json

# 1) Existing Neon helper runtime: add read-only exact duplicate query.
path = Path('api/neon-helper-runtime.js')
text = path.read_text()
marker = "\nexport default async function handler(req,res){\n"
if marker not in text:
    raise SystemExit('neon-helper handler marker not found')
addition = r'''
function pendingDuplicateKey(customerId,productId,spec={}){
  return JSON.stringify([
    text(customerId),text(productId),text(spec.package),text(spec.flavor),text(spec.color),text(spec.size),
  ])
}
async function checkPendingDuplicates(sql,rows=[]){
  const source=Array.isArray(rows)?rows:[]
  if(source.length>120) throw new Error('單次最多檢查 120 筆重複訂單')
  const unique=new Map()
  for(const row of source){
    const customerId=text(row?.customer_id),productId=text(row?.product_id||row?.id)
    if(!customerId||!productId)continue
    const spec={
      package:text(row?.spec?.package),flavor:text(row?.spec?.flavor),color:text(row?.spec?.color),size:text(row?.spec?.size),
    }
    const key=pendingDuplicateKey(customerId,productId,spec)
    unique.set(key,{key,customer_id:customerId,product_id:productId,spec})
  }
  const prepared=[...unique.values()]
  if(!prepared.length)return[]
  const customerIds=[...new Set(prepared.map(row=>row.customer_id))]
  const productIds=[...new Set(prepared.map(row=>row.product_id))]
  const matches=await sql`
    SELECT c.legacy_id AS customer_id,p.legacy_id AS product_id,
      COALESCE(oi.spec_package,'') AS spec_package,
      COALESCE(oi.spec_flavor,'') AS spec_flavor,
      COALESCE(oi.spec_color,'') AS spec_color,
      COALESCE(oi.spec_size,'') AS spec_size,
      COUNT(*)::int AS match_count,
      SUM(GREATEST(0,oi.qty-COALESCE(oi.released_qty,0)-COALESCE(oi.picked_up_qty,0)))::int AS remaining_qty,
      MAX(o.order_date) AS latest_order_date
    FROM orders o
    JOIN customers c ON c.id=o.customer_id
    JOIN order_items oi ON oi.order_id=o.id
    JOIN products p ON p.id=oi.product_id
    WHERE c.legacy_id=ANY(${customerIds}::text[])
      AND p.legacy_id=ANY(${productIds}::text[])
      AND o.status='pending'
      AND COALESCE(o.archived,false)=false
      AND COALESCE(o.is_virtual,false)=false
      AND COALESCE(o.fulfillment_type,'preorder')='preorder'
      AND GREATEST(0,oi.qty-COALESCE(oi.released_qty,0)-COALESCE(oi.picked_up_qty,0))>0
    GROUP BY c.legacy_id,p.legacy_id,oi.spec_package,oi.spec_flavor,oi.spec_color,oi.spec_size`
  const found=new Map()
  for(const row of matches){
    const spec={package:text(row.spec_package),flavor:text(row.spec_flavor),color:text(row.spec_color),size:text(row.spec_size)}
    found.set(pendingDuplicateKey(row.customer_id,row.product_id,spec),{
      match_count:Number(row.match_count||0),remaining_qty:Number(row.remaining_qty||0),latest_order_date:row.latest_order_date||null,
    })
  }
  return prepared.map(row=>{
    const hit=found.get(row.key)
    return {...row,duplicate:Boolean(hit),match_count:hit?.match_count||0,remaining_qty:hit?.remaining_qty||0,latest_order_date:hit?.latest_order_date||null}
  })
}
'''
text = text.replace(marker, '\n' + addition + marker, 1)
old = "    if(action==='my_pending_orders')return res.status(200).json({ok:true,rows:await listMyPendingOrders(sql,auth)})\n"
new = old + "    if(action==='duplicate_pending')return res.status(200).json({ok:true,rows:await checkPendingDuplicates(sql,req.body?.rows||[])})\n"
if old not in text:
    raise SystemExit('my_pending_orders action marker not found')
path.write_text(text.replace(old,new,1))

# 2) Neon-only helper read facade.
path = Path('src/lib/enableNeonHelperReads.js')
text = path.read_text()
old = "  installNeonOnly('myPendingOrders','my_pending_orders',(a,b)=>String(b.order_date||b.created_at||'').localeCompare(String(a.order_date||a.created_at||'')))\n"
new = """  HelperAPI.checkPendingDuplicates=async function(rows=[]){
    const list=Array.isArray(rows)?rows:[]
    if(!list.length)return[]
    const output=[]
    for(let i=0;i<list.length;i+=100){
      output.push(...rowsOf(await neonHelperRuntime('duplicate_pending',{rows:list.slice(i,i+100)})))
    }
    return output
  }

""" + old
if old not in text:
    raise SystemExit('myPendingOrders read marker not found')
path.write_text(text.replace(old,new,1))

# 3) Helper entry UI: warn only for exact product + exact spec.
path = Path('src/pages/HelperPortalV3.jsx')
text = path.read_text()
marker = """function hasSelectableSpec(product) {
  if (!product) return false
  return (
    (product.price_options || []).length > 0 ||
    (product.spec_flavors || []).length > 0 ||
    ['color_size', 'color_free', 'color_only', 'size_only'].includes(product.spec_mode)
  )
}
"""
addition = marker + """
function normalizedSpec(spec = {}) {
  return {
    package:String(spec.package || '').trim(),
    flavor:String(spec.flavor || '').trim(),
    color:String(spec.color || '').trim(),
    size:String(spec.size || '').trim(),
  }
}
function duplicateKey(customerId,productId,spec = {}) {
  const s=normalizedSpec(spec)
  return JSON.stringify([String(customerId || ''),String(productId || ''),s.package,s.flavor,s.color,s.size])
}
function duplicateRequest(customer,product,spec = {}) {
  if (!customer?.id || !product?.id || specError(product,spec)) return null
  return {key:duplicateKey(customer.id,product.id,spec),customer_id:customer.id,product_id:product.id,spec:normalizedSpec(spec)}
}
function shortDate(value) {
  if (!value) return ''
  const d=new Date(value)
  return Number.isNaN(d.getTime()) ? String(value).slice(0,10) : d.toLocaleDateString('zh-TW')
}
"""
if marker not in text:
    raise SystemExit('hasSelectableSpec marker not found')
text = text.replace(marker,addition,1)

old = """  const [batchRows, setBatchRows] = useState([])
  const [batchNote, setBatchNote] = useState('')
"""
new = old + """  const [duplicateMap, setDuplicateMap] = useState({})
  const [duplicateChecking, setDuplicateChecking] = useState(false)
"""
if old not in text:
    raise SystemExit('duplicate state marker not found')
text = text.replace(old,new,1)

marker = """  const custs = useMemo(() => customers.slice(0,20), [customers])
"""
insertion = """  const duplicateRequests = useMemo(() => {
    const unique=new Map()
    if (mode === 'customer' && customer) {
      items.forEach(item => {
        const req=duplicateRequest(customer,item.product,item.spec)
        if (req) unique.set(req.key,req)
      })
    } else if (mode === 'product' && batchProduct) {
      batchRows.forEach(row => row.items.forEach(line => {
        const req=duplicateRequest(row.customer,batchProduct,line.spec)
        if (req) unique.set(req.key,req)
      }))
    }
    return Array.from(unique.values())
  }, [mode,customer,items,batchProduct,batchRows])

  useEffect(() => {
    if (!duplicateRequests.length) {
      setDuplicateMap({})
      setDuplicateChecking(false)
      return undefined
    }
    let active=true
    setDuplicateChecking(true)
    const timer=window.setTimeout(async()=>{
      try {
        const rows=await HelperAPI.checkPendingDuplicates(duplicateRequests)
        if (active) setDuplicateMap(Object.fromEntries(rows.map(row=>[row.key,row])))
      } catch (err) {
        if (active) {
          setDuplicateMap({})
          toast('重複訂單檢查失敗：'+err.message,'error')
        }
      } finally {
        if (active) setDuplicateChecking(false)
      }
    },220)
    return () => { active=false; window.clearTimeout(timer) }
  }, [duplicateRequests,toast])

""" + marker
if marker not in text:
    raise SystemExit('custs marker not found')
text = text.replace(marker,insertion,1)

marker = """  function renderProductList(list, search, onPick) {
"""
insertion = """  function renderDuplicateWarning(customerRow,product,spec) {
    const req=duplicateRequest(customerRow,product,spec)
    if (!req) return null
    const hit=duplicateMap[req.key]
    if (!hit?.duplicate) return null
    const count=Number(hit.match_count||0)
    const qty=Number(hit.remaining_qty||0)
    return <div style={{marginTop:8,padding:'9px 11px',border:'2px solid #ef4444',borderRadius:9,background:'#fef2f2',color:'#b91c1c',fontSize:13,fontWeight:900}}>⚠ 重複下單：這位客戶已有相同商品＋相同規格的待出貨訂單{count?` ${count} 筆`:''}{qty?`，尚有 ${qty} 件`:''}{hit.latest_order_date?`（最近 ${shortDate(hit.latest_order_date)}）`:''}</div>
  }

""" + marker
if marker not in text:
    raise SystemExit('renderProductList marker not found')
text = text.replace(marker,insertion,1)

old = """<div style={{marginTop:8}}><SpecFields product={x.product} spec={x.spec} onChange={(k,v)=>patchItemSpec(i,k,v)}/></div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>"""
new = """<div style={{marginTop:8}}><SpecFields product={x.product} spec={x.spec} onChange={(k,v)=>patchItemSpec(i,k,v)}/>{customer&&renderDuplicateWarning(customer,x.product,x.spec)}</div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>"""
if old not in text:
    raise SystemExit('customer item render marker not found')
text = text.replace(old,new,1)

old = """<SpecFields product={batchProduct} spec={line.spec} onChange={(k,v)=>patchBatchSpec(r.customer.id,lineIndex,k,v)}/><span style={{fontSize:14,color:'var(--text-muted)',fontWeight:800}}>數量</span>"""
new = """<div><SpecFields product={batchProduct} spec={line.spec} onChange={(k,v)=>patchBatchSpec(r.customer.id,lineIndex,k,v)}/>{renderDuplicateWarning(r.customer,batchProduct,line.spec)}</div><span style={{fontSize:14,color:'var(--text-muted)',fontWeight:800}}>數量</span>"""
if old not in text:
    raise SystemExit('batch line render marker not found')
text = text.replace(old,new,1)

old = """      <div style={{ background:'#ecfdf5', border:'1px solid #a7f3d0', padding:'10px 12px', borderRadius:10, marginBottom:14, fontSize:13, color:'#065f46' }}>送出後會直接建立訂單；客戶與商品改為即時 SQL 搜尋，不需先下載全部資料。</div>"""
new = """      <div style={{ background:'#ecfdf5', border:'1px solid #a7f3d0', padding:'10px 12px', borderRadius:10, marginBottom:14, fontSize:13, color:'#065f46' }}>送出後會直接建立訂單；客戶與商品改為即時 SQL 搜尋，不需先下載全部資料。相同客戶若已有「同商品＋同規格」待出貨訂單，登記時會以紅色提示；同商品但不同規格不提示。{duplicateChecking&&<span style={{marginLeft:8,color:'#475569'}}>重複檢查中…</span>}</div>"""
if old not in text:
    raise SystemExit('helper intro marker not found')
path.write_text(text.replace(old,new,1))

# 4) App version.
path = Path('src/components/Layout.jsx')
text = path.read_text()
old = "// 第56版：混合到貨訂單可逐規格直接標記已取貨並隱藏，未到貨規格繼續保留。\nconst APP_VERSION = '第56版｜2026/09/12'"
new = "// 第57版：小幫手登記時只針對同客戶、同商品且同規格的既有待出貨訂單顯示紅色重複提示。\nconst APP_VERSION = '第57版｜2026/09/12'"
if old not in text:
    raise SystemExit('layout V56 marker not found')
path.write_text(text.replace(old,new,1))

# 5) Migration Registry.
path = Path('src/migration-registry.json')
data = json.loads(path.read_text())
if not any(e.get('version') == 'V57' for e in data.get('entries',[])):
    data['entries'].append({
      'version':'V57',
      'date':'2026-09-12',
      'type':'feature/ui',
      'summary':'小幫手登記新增精準重複下單提示：只有同一客戶已存在同商品且 package/flavor/color/size 四項規格完全相同的有效待出貨正式預購時顯示紅色警示；同商品但不同規格不提示。',
      'database_changes':[],
      'api_changes':['api/neon-helper-runtime.js: 既有 Function 新增 duplicate_pending 唯讀 action，批次比對客戶＋商品＋完整規格；不新增 Serverless Function。','src/lib/enableNeonHelperReads.js: 新增 HelperAPI.checkPendingDuplicates，僅走 Neon。'],
      'ui_changes':['src/pages/HelperPortalV3.jsx: 依客戶打單與依商品連續打單都會在規格完整後自動查詢；若存在完全相同規格的待出貨正式預購，以紅色框顯示「重複下單」與既有筆數／剩餘件數。','同商品但 package/flavor/color/size 任一不同時不顯示警示；警示不阻擋小幫手仍可確認後繼續建立訂單。'],
      'data_logic':'duplicate_pending 僅讀取 status=pending、未封存、非虛擬、preorder 且 qty-released_qty-picked_up_qty 仍大於 0 的 Neon 訂單品項；以 customer legacy id、product legacy id、spec_package/spec_flavor/spec_color/spec_size 全部完全相同才判定重複。已出貨、已取貨完、已釋出完、虛擬訂單及不同規格都不提示。',
      'data_migration':'無。只新增既有 Neon helper runtime 的唯讀查詢與前端警示，不修改 orders、order_items、helper_entries 或任何正式資料。',
      'rollback':'移除 duplicate_pending action、HelperAPI.checkPendingDuplicates 與 HelperPortalV3 紅色重複提示，APP_VERSION 還原 V56；不需資料庫 rollback。'
    })
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
