import fs from 'node:fs'

function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from)
  if (index < 0) throw new Error(`V60 patch missing target: ${label}`)
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`V60 patch target not unique: ${label}`)
  return text.slice(0,index) + to + text.slice(index + from.length)
}

const reportPath='src/pages/PendingProductReportSql.jsx'
let report=fs.readFileSync(reportPath,'utf8')

const fetchBlock=`async function fetchAllOrders(params){
  const rows=[];let cursor=null;let guard=0
  do{
    const page=await OrdersAPI.searchPage({...params,pageSize:PAGE_SIZE,cursor})
    rows.push(...(page.rows||[]))
    cursor=page.hasMore?page.nextCursor:null
    guard++
  }while(cursor&&guard<100)
  return rows
}`

const fetchReplacement=`async function fetchAllOrders(params){
  const rows=[];let cursor=null;let guard=0
  do{
    const page=await OrdersAPI.searchPage({...params,pageSize:PAGE_SIZE,cursor})
    rows.push(...(page.rows||[]))
    cursor=page.hasMore?page.nextCursor:null
    guard++
  }while(cursor&&guard<100)
  return rows
}
function partialShippedOrder(order){
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
report=replaceOnce(report,fetchBlock,fetchReplacement,'fetch report orders')

report=replaceOnce(
  report,
  "order_ids:new Set(),real_order_ids:new Set(),virtual_order_ids:new Set(),has_virtual:false",
  "order_ids:new Set(),real_order_ids:new Set(),virtual_order_ids:new Set(),partial_order_ids:new Set(),has_virtual:false",
  'partial order id set',
)

report=replaceOnce(
  report,
  `    group.order_ids.add(order.id)\n    if(order.is_virtual){group.virtual_order_ids.add(order.id);group.has_virtual=true}else{group.real_order_ids.add(order.id);group.all_virtual=false}`,
  `    if(order._partial_shipped_record){\n      group.partial_order_ids.add(order.id)\n      if(order.is_virtual)group.has_virtual=true\n      else group.all_virtual=false\n    }else{\n      group.order_ids.add(order.id)\n      if(order.is_virtual){group.virtual_order_ids.add(order.id);group.has_virtual=true}else{group.real_order_ids.add(order.id);group.all_virtual=false}\n    }`,
  'separate partial shipped order ids',
)

report=replaceOnce(
  report,
  `      const totalArrived=transformedPickup?Math.min(originalQty,Math.max(0,arrived+pickedQty)):Math.min(originalQty,Math.max(0,arrived))`,
  `      const totalArrived=item?._partial_shipped_item?Math.min(originalQty,Math.max(pickedQty,Number(item?._partial_shipped_total_arrived??pickedQty))):transformedPickup?Math.min(originalQty,Math.max(0,arrived+pickedQty)):Math.min(originalQty,Math.max(0,arrived))`,
  'partial shipped arrived qty',
)

report=replaceOnce(
  report,
  `order_status:order.status})`,
  `order_status:order.status,partial_shipped_record:Boolean(order._partial_shipped_record)})`,
  'source partial flag',
)

report=replaceOnce(
  report,
  `order_ids:Array.from(group.order_ids),real_order_ids:Array.from(group.real_order_ids),virtual_order_ids:Array.from(group.virtual_order_ids),order_count:group.order_ids.size,all_arrived:group.overall_missing_qty===0`,
  `order_ids:Array.from(group.order_ids),real_order_ids:Array.from(group.real_order_ids),virtual_order_ids:Array.from(group.virtual_order_ids),partial_order_ids:Array.from(group.partial_order_ids),order_count:new Set([...group.order_ids,...group.partial_order_ids]).size,has_partial_shipped:group.partial_order_ids.size>0,all_arrived:group.overall_missing_qty===0`,
  'partial shipped group output',
)

report=replaceOnce(
  report,
  `const rows=await fetchAllOrders({status:shipmentView,includeArchived:shipmentView==='shipped'&&showArchived})`,
  `const rows=await fetchReportOrders({status:shipmentView,includeArchived:shipmentView==='shipped'&&showArchived})`,
  'catalog includes partial shipped',
)

report=replaceOnce(
  report,
  `      const rows=await fetchAllOrders({\n        status:shipmentView,`,
  `      const rows=await fetchReportOrders({\n        status:shipmentView,`,
  'buyer product query includes partial shipped',
)

report=replaceOnce(
  report,
  `shipmentView==='shipped'?'✅ 已出貨':c.all_arrived`,
  `shipmentView==='shipped'?(c.has_partial_shipped?(c.order_ids.length?'✅ 已出貨（含部分先出貨）':'✅ 部分品項已出貨；其餘仍待出貨'):'✅ 已出貨'):c.all_arrived`,
  'partial shipped status label',
)

report=replaceOnce(
  report,
  `disabled={Boolean(shippingKey)} onClick={()=>changeRowShipment(c,'pending')}`,
  `disabled={Boolean(shippingKey)||!c.order_ids.length} onClick={()=>changeRowShipment(c,'pending')}`,
  'disable restore for partial-only row',
)

report=replaceOnce(
  report,
  `disabled={Boolean(archivingKey)} onClick={()=>changeRowArchive(c,false)}`,
  `disabled={Boolean(archivingKey)||!c.order_ids.length} onClick={()=>changeRowArchive(c,false)}`,
  'disable unarchive for partial-only row',
)

report=replaceOnce(
  report,
  `disabled={Boolean(archivingKey)} onClick={()=>requestRowArchive(c)}`,
  `disabled={Boolean(archivingKey)||!c.order_ids.length} onClick={()=>requestRowArchive(c)}`,
  'disable archive for partial-only row',
)

report=replaceOnce(
  report,
  `SQL 篩選版：只顯示目前狀態下實際有數量的商品或買家`,
  `SQL 篩選版：已出貨查詢同時包含整單已出貨與待出貨訂單中已先出貨的品項`,
  'report subtitle',
)

fs.writeFileSync(reportPath,report)

const layoutPath='src/components/Layout.jsx'
let layout=fs.readFileSync(layoutPath,'utf8')
layout=replaceOnce(layout,
  `// 第59版：品項出貨／取貨管理整合進出貨查詢報表，統一搜尋並可修改／取消取貨。\nconst APP_VERSION = '第59版｜2026/09/12'`,
  `// 第60版：已出貨報表納入待出貨訂單中已先出貨的品項，部分出貨也可依買家／商品查到。\nconst APP_VERSION = '第60版｜2026/09/13'`,
  'app version V60')
fs.writeFileSync(layoutPath,layout)

const registryPath='src/migration-registry.json'
const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'))
if(!Array.isArray(registry.versions))throw new Error('migration registry missing versions array')
if(registry.versions.some(row=>row.version==='V60'))throw new Error('V60 already exists')
registry.versions.push({
  version:'V60',
  date:'2026-09-13',
  type:'bugfix/report',
  summary:'修正部分品項已先出貨但整張訂單仍 pending 時，已出貨報表依買家／商品查不到該客戶的問題；已出貨查詢現在同時顯示完整 shipped 訂單與 pending 訂單中 picked_up_qty>0 的已完成品項。',
  database_changes:[],
  api_changes:[],
  ui_changes:[
    'src/pages/PendingProductReportSql.jsx: 已出貨查詢額外讀取符合搜尋條件的 pending 訂單，只抽出 picked_up_qty>0 的品項建立唯讀已出貨快照；未出貨品項不會混入已出貨報表。',
    '部分出貨快照與真正 shipped 訂單分開保存 order id；恢復待出貨／封存按鈕不會誤操作仍為 pending 的原訂單。',
    '已出貨商品候選清單也納入部分先出貨品項，因此可依商品查詢部分出貨紀錄。'
  ],
  data_logic:'orders.status 仍維持既有規則：只要同張訂單尚有未完成品項就保持 pending。報表層將 pending 訂單中 picked_up_qty>0 的數量視為已出貨歷史快照，顯示數量與金額只計已完成部分；剩餘品項仍只出現在待出貨查詢。',
  data_migration:'無。僅修正查詢與顯示組合，不修改 orders/order_items 正式資料、不新增欄位、不新增 Serverless Function。',
  rollback:'移除 fetchReportOrders / partialShippedOrder 與 partial_order_ids 分流，APP_VERSION 還原 V59；資料庫不需 rollback。'
})
fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n')

console.log('V60 patch applied')
