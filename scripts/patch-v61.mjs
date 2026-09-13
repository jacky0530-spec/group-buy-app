import fs from 'node:fs'

function replaceOnce(text,from,to,label){
  const i=text.indexOf(from)
  if(i<0)throw new Error(`V61 patch missing target: ${label}`)
  return text.slice(0,i)+to+text.slice(i+from.length)
}

// 1) Neon runtime: persist an archived quantity for pickup/shipment history.
const runtimePath='api/neon-orders-runtime.js'
let runtime=fs.readFileSync(runtimePath,'utf8')
runtime=replaceOnce(runtime,
  "AND column_name IN ('released_qty','released_at','released_by_uid','picked_up_qty','picked_up_at','picked_up_by_uid')",
  "AND column_name IN ('released_qty','released_at','released_by_uid','picked_up_qty','picked_up_at','picked_up_by_uid','picked_up_archived_qty','picked_up_archived_at','picked_up_archived_by_uid')",
  'schema column discovery')
runtime=replaceOnce(runtime,
  "  if(!names.has('picked_up_by_uid')) await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_up_by_uid text`\n  releaseSchemaReady=true",
  "  if(!names.has('picked_up_by_uid')) await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_up_by_uid text`\n  if(!names.has('picked_up_archived_qty')) await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_up_archived_qty integer NOT NULL DEFAULT 0`\n  if(!names.has('picked_up_archived_at')) await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_up_archived_at timestamptz`\n  if(!names.has('picked_up_archived_by_uid')) await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_up_archived_by_uid text`\n  releaseSchemaReady=true",
  'ensure pickup archive columns')
runtime=replaceOnce(runtime,
  "      picked_up_qty,picked_up_at,picked_up_by_uid\n    FROM order_items WHERE order_id=${orderId}`",
  "      picked_up_qty,picked_up_at,picked_up_by_uid,picked_up_archived_qty,picked_up_archived_at,picked_up_archived_by_uid\n    FROM order_items WHERE order_id=${orderId}`",
  'sync previous pickup archive columns')
runtime=replaceOnce(runtime,
  "    const pickedUpBy=pickedUpQty>0?text(previous?.picked_up_by_uid||item.picked_up_by_uid):''\n    const arrivedQty=",
  "    const pickedUpBy=pickedUpQty>0?text(previous?.picked_up_by_uid||item.picked_up_by_uid):''\n    const pickedUpArchivedQty=Math.min(pickedUpQty,Math.max(0,Math.trunc(num(previous?.picked_up_archived_qty??item.picked_up_archived_qty))))\n    const pickedUpArchivedAt=pickedUpArchivedQty>0?(iso(previous?.picked_up_archived_at)||iso(item.picked_up_archived_at)||new Date().toISOString()):null\n    const pickedUpArchivedBy=pickedUpArchivedQty>0?text(previous?.picked_up_archived_by_uid||item.picked_up_archived_by_uid):''\n    const arrivedQty=",
  'sync pickup archive values')
runtime=replaceOnce(runtime,
  "        picked_up_qty,picked_up_at,picked_up_by_uid,supplier_payment_term,supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at",
  "        picked_up_qty,picked_up_at,picked_up_by_uid,picked_up_archived_qty,picked_up_archived_at,picked_up_archived_by_uid,supplier_payment_term,supplier_paid_amount,supplier_payment_status,supplier_payment_refs,created_at,updated_at",
  'insert pickup archive columns')
runtime=replaceOnce(runtime,
  "        ${pickedUpQty},${pickedUpAt},${pickedUpBy||null},${text(item.supplier_payment_term)||'manual'},",
  "        ${pickedUpQty},${pickedUpAt},${pickedUpBy||null},${pickedUpArchivedQty},${pickedUpArchivedAt},${pickedUpArchivedBy||null},${text(item.supplier_payment_term)||'manual'},",
  'insert pickup archive values')
runtime=replaceOnce(runtime,
  "    SELECT o.id AS order_id,o.status,o.archived,o.is_virtual,o.fulfillment_type,oi.line_no,oi.product_name,oi.qty,oi.arrived_qty,oi.released_qty,oi.picked_up_qty\n",
  "    SELECT o.id AS order_id,o.status,o.archived,o.is_virtual,o.fulfillment_type,oi.line_no,oi.product_name,oi.qty,oi.arrived_qty,oi.released_qty,oi.picked_up_qty,oi.picked_up_archived_qty\n",
  'pickup select archive qty')
runtime=replaceOnce(runtime,
  "      picked_up_by_uid=${pickedQty>0?auth.uid:null},\n      updated_at=now()",
  "      picked_up_by_uid=${pickedQty>0?auth.uid:null},\n      picked_up_archived_qty=LEAST(COALESCE(picked_up_archived_qty,0),${pickedQty}),\n      picked_up_archived_at=CASE WHEN LEAST(COALESCE(picked_up_archived_qty,0),${pickedQty})>0 THEN picked_up_archived_at ELSE NULL END,\n      picked_up_archived_by_uid=CASE WHEN LEAST(COALESCE(picked_up_archived_qty,0),${pickedQty})>0 THEN picked_up_archived_by_uid ELSE NULL END,\n      updated_at=now()",
  'pickup clamp archive qty')
runtime=replaceOnce(runtime,
  "    RETURNING line_no,product_name,qty,arrived_qty,released_qty,picked_up_qty,picked_up_at,picked_up_by_uid`",
  "    RETURNING line_no,product_name,qty,arrived_qty,released_qty,picked_up_qty,picked_up_at,picked_up_by_uid,picked_up_archived_qty,picked_up_archived_at,picked_up_archived_by_uid`",
  'pickup returning archive fields')
const pickupStatesMarker=`async function pickupStates(sql,ids){`
const pickupArchiveFn=`async function setItemPickupArchive(sql,auth,legacyId,itemIndex,archived){
  const id=text(legacyId)
  const lineNo=Math.trunc(num(itemIndex))+1
  if(!id||lineNo<1) throw new Error('缺少訂單品項')
  const rows=await sql\`
    SELECT o.id AS order_id,o.status,o.is_virtual,oi.line_no,oi.product_name,oi.picked_up_qty,oi.picked_up_archived_qty
    FROM orders o JOIN order_items oi ON oi.order_id=o.id
    WHERE o.legacy_id=\${id} AND oi.line_no=\${lineNo} LIMIT 1\`
  const row=rows[0]
  if(!row) throw new Error('找不到訂單商品')
  if(row.status==='cancelled') throw new Error('已取消訂單不可封存出貨紀錄')
  if(row.is_virtual===true) throw new Error('虛擬訂單沒有部分出貨紀錄可封存')
  const picked=Math.max(0,Math.trunc(num(row.picked_up_qty)))
  if(picked<=0) throw new Error('目前沒有已出貨／取貨數量可封存')
  const nextArchived=archived===true?picked:0
  const updated=await sql\`
    UPDATE order_items SET
      picked_up_archived_qty=\${nextArchived},
      picked_up_archived_at=\${nextArchived>0?new Date().toISOString():null},
      picked_up_archived_by_uid=\${nextArchived>0?auth.uid:null},
      updated_at=now()
    WHERE order_id=\${row.order_id} AND line_no=\${lineNo}
    RETURNING line_no,product_name,picked_up_qty,picked_up_archived_qty,picked_up_archived_at,picked_up_archived_by_uid\`
  await sql\`UPDATE orders SET updated_at=now() WHERE id=\${row.order_id}\`
  return updated[0]
}

`
runtime=replaceOnce(runtime,pickupStatesMarker,pickupArchiveFn+pickupStatesMarker,'pickup archive action')
runtime=replaceOnce(runtime,
  "    SELECT o.legacy_id AS id,oi.line_no,oi.picked_up_qty,oi.picked_up_at,oi.picked_up_by_uid\n",
  "    SELECT o.legacy_id AS id,oi.line_no,oi.picked_up_qty,oi.picked_up_at,oi.picked_up_by_uid,oi.picked_up_archived_qty,oi.picked_up_archived_at,oi.picked_up_archived_by_uid\n",
  'pickup state archive fields')
runtime=replaceOnce(runtime,
  "    if(action==='set_item_pickup') return res.status(200).json({ok:true,result:await setItemPickup(sql,auth,req.body?.id,req.body?.item_index,req.body?.picked_up_qty)})",
  "    if(action==='set_item_pickup') return res.status(200).json({ok:true,result:await setItemPickup(sql,auth,req.body?.id,req.body?.item_index,req.body?.picked_up_qty)})\n    if(action==='set_item_pickup_archive') return res.status(200).json({ok:true,result:await setItemPickupArchive(sql,auth,req.body?.id,req.body?.item_index,req.body?.archived===true)})",
  'handler pickup archive action')
fs.writeFileSync(runtimePath,runtime)

// 2) Read adapter: attach archived pickup quantity to each item.
const pickupReadPath='src/lib/enableNeonPickupReads.js'
let pickupRead=fs.readFileSync(pickupReadPath,'utf8')
pickupRead=replaceOnce(pickupRead,
  "            picked_up_by_uid:state.picked_up_by_uid||'',\n",
  "            picked_up_by_uid:state.picked_up_by_uid||'',\n            picked_up_archived_qty:Number(state.picked_up_archived_qty||0),\n            picked_up_archived_at:state.picked_up_archived_at||null,\n            picked_up_archived_by_uid:state.picked_up_archived_by_uid||'',\n",
  'read pickup archive state')
fs.writeFileSync(pickupReadPath,pickupRead)

// 3) Primary write adapter: expose item-level partial shipment archive.
const writesPath='src/lib/enableNeonPrimaryOrderWrites.js'
let writes=fs.readFileSync(writesPath,'utf8')
writes=replaceOnce(writes,
  "  OrdersAPI.setItemPickup=async function(id,item_index,picked_up_qty=0){\n    return (await neonOrdersRuntime('set_item_pickup',{id,item_index,picked_up_qty:Number(picked_up_qty||0)}))?.result\n  }\n",
  "  OrdersAPI.setItemPickup=async function(id,item_index,picked_up_qty=0){\n    return (await neonOrdersRuntime('set_item_pickup',{id,item_index,picked_up_qty:Number(picked_up_qty||0)}))?.result\n  }\n\n  OrdersAPI.setItemPickupArchive=async function(id,item_index,archived=true){\n    return (await neonOrdersRuntime('set_item_pickup_archive',{id,item_index,archived:Boolean(archived)}))?.result\n  }\n",
  'write pickup archive API')
fs.writeFileSync(writesPath,writes)

// 4) Shipment report: split active and archived partial-shipment snapshots.
const reportPath='src/pages/PendingProductReportSql.jsx'
let report=fs.readFileSync(reportPath,'utf8')
const oldPartial=`function partialShippedOrder(order){
  if(!order||order.is_virtual)return null
  const items=(order.items||[]).map((item,sourceIndex)=>{
    const picked=Math.max(0,Math.trunc(Number(item?.pickup_picked_up_qty??item?.picked_up_qty??0)))
    if(picked<=0)return null
    const originalQty=Math.max(picked,Math.trunc(Number(item?.pickup_original_qty??item?.original_qty??item?.qty??picked)))
    const sourceItemIndex=Number.isInteger(Number(item?._source_item_index))?Number(item._source_item_index):sourceIndex
    const transformed=item?.pickup_original_qty!==undefined||item?.pickup_picked_up_qty!==undefined
    const visibleArrived=Math.max(0,Number(item?.arrived_qty||0))
    const totalArrived=Math.min(originalQty,Math.max(picked,transformed?visibleArrived+picked:visibleArrived))
    const price=Number(item?.pickup_original_price??item?.sale_price??item?.price??0)
    return {
      ...item,
      _source_item_index:sourceItemIndex,
      _partial_shipped_item:true,
      _partial_shipped_total_arrived:totalArrived,
      _pickup_completed:true,
      qty:picked,
      arrived_qty:picked,
      sale_price:price,
      price,
      subtotal:price*picked,
      pickup_original_qty:originalQty,
      pickup_picked_up_qty:picked,
      picked_up_qty:picked,
    }
  }).filter(Boolean)
  if(!items.length)return null
  const pickedTimes=items.map(item=>Date.parse(item?.picked_up_at||'')).filter(Number.isFinite)
  const partialShippedAt=pickedTimes.length?new Date(Math.max(...pickedTimes)).toISOString():(order.updated_at||order.order_date||order.created_at||null)
  return {...order,status:'shipped',archived:false,_partial_shipped_record:true,shipped_at:partialShippedAt,items}
}
async function fetchReportOrders(params){
  if(params?.status!=='shipped')return fetchAllOrders(params)
  const [shippedRows,pendingRows]=await Promise.all([
    fetchAllOrders(params),
    fetchAllOrders({...params,status:'pending',includeArchived:false,partialShippedLookup:true}),
  ])
  const partialRows=pendingRows.map(partialShippedOrder).filter(Boolean)
  return [...shippedRows,...partialRows]
}`
const newPartial=`function partialShippedOrder(order,archiveView='active'){
  if(!order||order.is_virtual)return null
  const archivedView=archiveView==='archived'
  const items=(order.items||[]).map((item,sourceIndex)=>{
    const picked=Math.max(0,Math.trunc(Number(item?.pickup_picked_up_qty??item?.picked_up_qty??0)))
    const archived=Math.min(picked,Math.max(0,Math.trunc(Number(item?.picked_up_archived_qty||0))))
    const shown=archivedView?archived:Math.max(0,picked-archived)
    if(shown<=0)return null
    const originalQty=Math.max(picked,Math.trunc(Number(item?.pickup_original_qty??item?.original_qty??item?.qty??picked)))
    const sourceItemIndex=Number.isInteger(Number(item?._source_item_index))?Number(item._source_item_index):sourceIndex
    const transformed=item?.pickup_original_qty!==undefined||item?.pickup_picked_up_qty!==undefined
    const visibleArrived=Math.max(0,Number(item?.arrived_qty||0))
    const totalArrived=Math.min(originalQty,Math.max(picked,transformed?visibleArrived+picked:visibleArrived))
    const price=Number(item?.pickup_original_price??item?.sale_price??item?.price??0)
    return {
      ...item,
      _source_item_index:sourceItemIndex,
      _partial_shipped_item:true,
      _partial_shipped_archived:archivedView,
      _partial_shipped_total_arrived:totalArrived,
      _pickup_completed:true,
      qty:shown,
      arrived_qty:shown,
      sale_price:price,
      price,
      subtotal:price*shown,
      pickup_original_qty:originalQty,
      pickup_picked_up_qty:picked,
      pickup_archived_qty:archived,
      picked_up_qty:picked,
    }
  }).filter(Boolean)
  if(!items.length)return null
  const pickedTimes=items.map(item=>Date.parse(archivedView?(item?.picked_up_archived_at||item?.picked_up_at||''):(item?.picked_up_at||''))).filter(Number.isFinite)
  const partialShippedAt=pickedTimes.length?new Date(Math.max(...pickedTimes)).toISOString():(order.updated_at||order.order_date||order.created_at||null)
  return {...order,status:'shipped',archived:archivedView,_partial_shipped_record:true,_partial_shipped_archived_record:archivedView,shipped_at:partialShippedAt,items}
}
async function fetchReportOrders(params){
  if(params?.status!=='shipped')return fetchAllOrders(params)
  const [shippedRows,pendingRows]=await Promise.all([
    fetchAllOrders(params),
    fetchAllOrders({...params,status:'pending',includeArchived:false,partialShippedLookup:true}),
  ])
  const activePartialRows=pendingRows.map(order=>partialShippedOrder(order,'active')).filter(Boolean)
  const archivedPartialRows=params?.includeArchived?pendingRows.map(order=>partialShippedOrder(order,'archived')).filter(Boolean):[]
  return [...shippedRows,...activePartialRows,...archivedPartialRows]
}`
report=replaceOnce(report,oldPartial,newPartial,'partial shipment active/archive snapshots')
report=replaceOnce(report,
  "partial_shipped_record:Boolean(order._partial_shipped_record)})",
  "partial_shipped_record:Boolean(order._partial_shipped_record),partial_shipped_archived:Boolean(item?._partial_shipped_archived),picked_up_archived_qty:Math.max(0,Number(item?.pickup_archived_qty??item?.picked_up_archived_qty??0))})",
  'partial source archive flags')
report=replaceOnce(report,
  "  async function changeRowArchive(row,next){if(!row.order_ids?.length||archivingKey)return;const key=`${row.key}-${next?'archive':'restore'}`;setArchivingKey(key);try{await Promise.all(row.order_ids.map(id=>next?OrdersAPI.archive(id):OrdersAPI.unarchive(id)));toast(next?'訂單已封存':'已解除封存');await refresh()}catch(err){toast(`${next?'封存':'解除封存'}失敗：${err.message}`,'error')}finally{setArchivingKey('')}}\n  function requestRowArchive(row){if(!row.order_ids?.length||archivingKey)return;setArchiveConfirmRow(row)}",
  "  function partialArchiveSources(row){const map=new Map();(row.items||[]).forEach(item=>(item.sources||[]).forEach(source=>{if(source.partial_shipped_record)map.set(`${source.order_id}:${source.item_index}`,source)}));return Array.from(map.values())}\n  async function changeRowArchive(row,next){const partialSources=partialArchiveSources(row),wholeIds=row.order_ids||[];if((!wholeIds.length&&!partialSources.length)||archivingKey)return;const key=`${row.key}-${next?'archive':'restore'}`;setArchivingKey(key);try{await Promise.all([...wholeIds.map(id=>next?OrdersAPI.archive(id):OrdersAPI.unarchive(id)),...partialSources.map(source=>OrdersAPI.setItemPickupArchive(source.order_id,source.item_index,next))]);toast(next?(partialSources.length&&!wholeIds.length?'已出貨部分已封存':'訂單／已出貨部分已封存'):'已解除封存');await refresh()}catch(err){toast(`${next?'封存':'解除封存'}失敗：${err.message}`,'error')}finally{setArchivingKey('')}}\n  function requestRowArchive(row){if((!row.order_ids?.length&&!row.has_partial_shipped)||archivingKey)return;setArchiveConfirmRow(row)}",
  'row archive partial shipment support')
report=replaceOnce(report,
  "    {archiveConfirmRow&&<ConfirmDialog danger={false} message={`確定要封存 ${archiveConfirmRow.name} 的 ${archiveConfirmRow.order_ids?.length||0} 筆已出貨訂單？\\n封存後可從「顯示封存」中再解除封存。`} onCancel={()=>setArchiveConfirmRow(null)} onConfirm={confirmRowArchive}/>} ",
  "    {archiveConfirmRow&&<ConfirmDialog danger={false} message={archiveConfirmRow.has_partial_shipped&&!archiveConfirmRow.order_ids?.length?`確定要封存 ${archiveConfirmRow.name} 目前已先出貨的部分？\\n尚未到貨／尚未出貨的品項仍會保留在待出貨。封存後可從「顯示封存」解除。`:`確定要封存 ${archiveConfirmRow.name} 的已出貨紀錄？\\n封存後可從「顯示封存」中再解除封存。`} onCancel={()=>setArchiveConfirmRow(null)} onConfirm={confirmRowArchive}/>} ",
  'partial archive confirm text')
report=replaceOnce(report,
  "{c.archived?<button className=\"btn btn-sm btn-ghost\" disabled={Boolean(archivingKey)||!c.order_ids.length} onClick={()=>changeRowArchive(c,false)}><ArchiveRestore size={13}/>解除封存</button>:<button className=\"btn btn-sm btn-ghost\" disabled={Boolean(archivingKey)||!c.order_ids.length} onClick={()=>requestRowArchive(c)}><Archive size={13}/>封存訂單</button>}",
  "{c.archived?<button className=\"btn btn-sm btn-ghost\" disabled={Boolean(archivingKey)||(!c.order_ids.length&&!c.has_partial_shipped)} onClick={()=>changeRowArchive(c,false)}><ArchiveRestore size={13}/>解除封存</button>:<button className=\"btn btn-sm btn-ghost\" disabled={Boolean(archivingKey)||(!c.order_ids.length&&!c.has_partial_shipped)} onClick={()=>requestRowArchive(c)}><Archive size={13}/>{c.has_partial_shipped&&!c.order_ids.length?'封存已出貨':'封存訂單'}</button>}",
  'enable archive for partial-only rows')
report=replaceOnce(report,
  "SQL 篩選版：已出貨查詢同時包含整單已出貨與待出貨訂單中已先出貨的品項",
  "SQL 篩選版：部分先出貨也可獨立封存；剩餘未到貨／未出貨品項仍保留待出貨",
  'report subtitle V61')
fs.writeFileSync(reportPath,report)

// 5) Version label.
const layoutPath='src/components/Layout.jsx'
let layout=fs.readFileSync(layoutPath,'utf8')
layout=replaceOnce(layout,
  "// 第60版：已出貨報表納入待出貨訂單中已先出貨的品項，部分出貨也可依買家／商品查到。\nconst APP_VERSION = '第60版｜2026/09/13'",
  "// 第61版：部分先出貨紀錄可獨立封存／解除封存，不影響同張訂單尚未完成的待出貨品項。\nconst APP_VERSION = '第61版｜2026/09/13'",
  'app version V61')
fs.writeFileSync(layoutPath,layout)

// 6) Migration registry.
const registryPath='src/migration-registry.json'
const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'))
if(!Array.isArray(registry.entries))throw new Error('migration registry missing entries array')
if(registry.entries.some(row=>row.version==='V61'))throw new Error('V61 already exists')
registry.entries.push({
  version:'V61',
  date:'2026-09-13',
  type:'feature/workflow',
  summary:'已出貨報表支援封存「同張訂單中的部分先出貨紀錄」；封存只影響已完成出貨的數量，尚未到貨／尚未出貨品項仍維持 pending 並繼續出現在待出貨查詢。',
  database_changes:[
    'order_items 新增 picked_up_archived_qty integer NOT NULL DEFAULT 0。',
    'order_items 新增 picked_up_archived_at timestamptz、picked_up_archived_by_uid text。'
  ],
  api_changes:[
    'api/neon-orders-runtime.js: 新增 set_item_pickup_archive；pickup_states 回傳部分出貨封存欄位。',
    'set_item_pickup 降低已完成數量時會同步將 picked_up_archived_qty 上限夾到新的 picked_up_qty，避免封存量大於實際出貨量。'
  ],
  ui_changes:[
    'src/pages/PendingProductReportSql.jsx: 部分先出貨列啟用「封存已出貨」；不再因原訂單仍 pending 而停用封存。',
    '顯示封存時，部分出貨封存紀錄以獨立封存列顯示並可解除封存；未封存的新出貨數量仍可另外顯示。',
    '整張 shipped 訂單仍沿用 orders.archived；部分先出貨則使用品項層級 picked_up_archived_qty，兩者互不干擾。'
  ],
  data_logic:'picked_up_qty 維持累積已完成出貨／取貨數量；picked_up_archived_qty 只表示其中已封存的歷史數量。正常已出貨查詢顯示 picked_up_qty-picked_up_archived_qty；「顯示封存」額外顯示 archived qty。之後同品項若再新增出貨，新增數量會重新出現在未封存已出貨報表。',
  data_migration:'既有資料不批次改寫；新增欄位預設 0，因此 V60 以前的部分出貨紀錄全部維持未封存。Schema 由既有 neon-orders-runtime ensureReleaseSchema 安全補欄位。',
  rollback:'移除 picked_up_archived_* 報表與 API 邏輯，APP_VERSION 還原 V60；新增欄位可保留，不影響既有 picked_up_qty。'
})
fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n')

console.log('V61 patch applied')
