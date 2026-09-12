from pathlib import Path
import json


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label} marker not found')
    return text.replace(old, new, 1)


# 1) Remove the standalone pickup manager from /pending-report.
path = Path('src/App.jsx')
text = path.read_text()
text = replace_once(text, "import { useState } from 'react'\n", "", 'App useState import')
text = replace_once(text, "import OrderPickupManager from './components/OrderPickupManager'\n", "", 'App pickup import')
text = replace_once(
    text,
    """function PendingReportWorkspace(){\n  const [refreshKey,setRefreshKey]=useState(0)\n  return <><OrderPickupManager onChanged={()=>setRefreshKey(v=>v+1)}/><PendingProductReport key={refreshKey}/></>\n}\n""",
    """function PendingReportWorkspace(){\n  return <PendingProductReport />\n}\n""",
    'App pending workspace',
)
path.write_text(text)


# 2) Preserve fully picked-up pending items as management-only records.
path = Path('src/pages/PendingProductReportFiltered.jsx')
text = path.read_text()
text = replace_once(
    text,
    """        const remaining=Math.max(0,qty-picked)\n        if(!remaining)return null\n        const arrived=Math.min(qty,Math.max(0,Number(item?.arrived_qty||0)))\n""",
    """        const remaining=Math.max(0,qty-picked)\n        if(!remaining)return {\n          ...item,\n          _source_item_index:sourceItemIndex,\n          pickup_original_qty:qty,\n          pickup_picked_up_qty:picked,\n          picked_up_qty:0,\n          _pickup_completed:true,\n        }\n        const arrived=Math.min(qty,Math.max(0,Number(item?.arrived_qty||0)))\n""",
    'pending fully picked item',
)
text = replace_once(
    text,
    """          pickup_original_qty:qty,\n          pickup_picked_up_qty:picked,\n          picked_up_qty:0,\n        }\n""",
    """          pickup_original_qty:qty,\n          pickup_picked_up_qty:picked,\n          picked_up_qty:0,\n          _pickup_completed:false,\n        }\n""",
    'pending partial picked item',
)
text = text.replace(
    '// V43/V44：已出貨商品依出貨日期分組；V45：已釋出品項仍顯示；V54：待出貨只顯示尚未取貨數量。',
    '// V43/V44：已出貨商品依出貨日期分組；V45：已釋出品項仍顯示；V59：正常待出貨只顯示尚未完成數量，取貨管理模式可重新顯示已完成品項。',
    1,
)
path.write_text(text)


# 3) Integrate pickup controls into the shipment report.
path = Path('src/pages/PendingProductReportSql.jsx')
text = path.read_text()

text = replace_once(
    text,
    'function buildRows(orderRows,customerMap,product,arrivalView,shippedView){',
    'function buildRows(orderRows,customerMap,product,arrivalView,shippedView,pickupManageMode=false){',
    'buildRows signature',
)
text = replace_once(
    text,
    """  orderRows.forEach(order=>{\n    const scopedItems=(order.items||[]).filter(item=>!product||matchesProduct(item,product))\n    const items=scopedItems.filter(item=>shippedView?itemQty(item)>0:displayQty(item,arrivalView)>0)\n    if(!items.length)return\n""",
    """  orderRows.forEach(order=>{\n    const scopedItems=(order.items||[]).filter(item=>!product||matchesProduct(item,product))\n    const activeScopedItems=scopedItems.filter(item=>!item?._pickup_completed)\n    const items=scopedItems.filter(item=>{\n      if(shippedView)return itemQty(item)>0\n      if(item?._pickup_completed)return pickupManageMode\n      return displayQty(item,arrivalView)>0\n    })\n    if(!items.length)return\n""",
    'buildRows item filter',
)
text = replace_once(
    text,
    """    group.overall_arrived_qty+=scopedItems.reduce((sum,item)=>sum+arrivedQty(item),0)\n    group.overall_missing_qty+=scopedItems.reduce((sum,item)=>sum+missingQty(item),0)\n""",
    """    group.overall_arrived_qty+=activeScopedItems.reduce((sum,item)=>sum+arrivedQty(item),0)\n    group.overall_missing_qty+=activeScopedItems.reduce((sum,item)=>sum+missingQty(item),0)\n""",
    'active arrival totals',
)
text = replace_once(
    text,
    """      const originalQty=Math.max(ordered,Number(item?.pickup_original_qty||ordered))\n      const pickedQty=Math.max(0,Number(item?.pickup_picked_up_qty||0))\n      const releasedQty=Math.max(0,Number(item?.pickup_released_qty??item?.released_qty??0))\n      const remainingTarget=Math.max(0,originalQty-releasedQty-pickedQty)\n      const shipNowQty=Math.min(arrived,Math.max(0,ordered),remainingTarget)\n      const nextPickedQty=Math.min(Math.max(0,originalQty-releasedQty),pickedQty+shipNowQty)\n      const canPickup=!order.is_virtual&&remainingTarget>0&&shipNowQty>0\n      detail.qty+=shown;detail.ordered_qty+=ordered;detail.arrived_qty+=arrived;detail.missing_qty+=missing;detail.amount+=price*shown;detail.dates.add(dateText(order.order_date));detail.sources.push({order_id:order.id,item_index:sourceItemIndex,qty:originalQty,arrived_qty:arrived,released_qty:releasedQty,pickup_target:remainingTarget,ship_now_qty:shipNowQty,next_picked_up_qty:nextPickedQty,can_pickup:canPickup,picked_up_qty:pickedQty,locked_after_pickup:pickedQty>0,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual)})\n""",
    """      const originalQty=Math.max(ordered,Number(item?.pickup_original_qty??item?.original_qty??ordered))\n      const pickedQty=Math.max(0,Number(item?.pickup_picked_up_qty??item?.picked_up_qty??0))\n      const releasedQty=Math.max(0,Number(item?.pickup_released_qty??item?.released_qty??0))\n      const transformedPickup=item?.pickup_original_qty!==undefined||item?.pickup_picked_up_qty!==undefined\n      const totalArrived=transformedPickup?Math.min(originalQty,Math.max(0,arrived+pickedQty)):Math.min(originalQty,Math.max(0,arrived))\n      const maxPickup=Math.min(totalArrived,Math.max(0,originalQty-releasedQty))\n      const remainingTarget=Math.max(0,originalQty-releasedQty-pickedQty)\n      const shipNowQty=Math.min(arrived,Math.max(0,ordered),remainingTarget)\n      const nextPickedQty=Math.min(Math.max(0,originalQty-releasedQty),pickedQty+shipNowQty)\n      const canPickup=!order.is_virtual&&remainingTarget>0&&shipNowQty>0\n      detail.qty+=shown;detail.ordered_qty+=ordered;detail.arrived_qty+=arrived;detail.missing_qty+=missing;detail.amount+=price*shown;detail.dates.add(dateText(order.order_date));detail.sources.push({order_id:order.id,item_index:sourceItemIndex,qty:originalQty,arrived_qty:totalArrived,released_qty:releasedQty,pickup_target:remainingTarget,ship_now_qty:shipNowQty,next_picked_up_qty:nextPickedQty,max_pickup:maxPickup,can_pickup:canPickup,picked_up_qty:pickedQty,pickup_completed:Boolean(item?._pickup_completed),locked_after_pickup:pickedQty>0,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual),order_status:order.status})\n""",
    'pickup source hydration',
)

old_state = "const [mode,setMode]=useState('buyer'),[shipmentView,setShipmentView]=useState('shipped'),[arrivalView,setArrivalView]=useState('all'),[productSearch,setProductSearch]=useState(''),[selectedProduct,setSelectedProduct]=useState(null),[productBuyerSearch,setProductBuyerSearch]=useState(''),[buyerSearch,setBuyerSearch]=useState(''),[selectedBuyerKey,setSelectedBuyerKey]=useState(''),[showArchived,setShowArchived]=useState(false),[marking,setMarking]=useState(false),[shippingKey,setShippingKey]=useState(''),[archivingKey,setArchivingKey]=useState(''),[pickupKey,setPickupKey]=useState('')"
new_state = "const [mode,setMode]=useState('buyer'),[shipmentView,setShipmentView]=useState('shipped'),[arrivalView,setArrivalView]=useState('all'),[productSearch,setProductSearch]=useState(''),[selectedProduct,setSelectedProduct]=useState(null),[productBuyerSearch,setProductBuyerSearch]=useState(''),[buyerSearch,setBuyerSearch]=useState(''),[selectedBuyerKey,setSelectedBuyerKey]=useState(''),[showArchived,setShowArchived]=useState(false),[marking,setMarking]=useState(false),[shippingKey,setShippingKey]=useState(''),[archivingKey,setArchivingKey]=useState(''),[pickupKey,setPickupKey]=useState(''),[pickupManageMode,setPickupManageMode]=useState(false),[pickupDrafts,setPickupDrafts]=useState({})"
text = replace_once(text, old_state, new_state, 'pickup management state')

text = replace_once(
    text,
    "const productRows=useMemo(()=>selectedProduct?buildRows(sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView==='shipped'):[],[sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView])",
    "const productRows=useMemo(()=>selectedProduct?buildRows(sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView==='shipped',pickupManageMode):[],[sourceOrders,customerMap,selectedProduct,effectiveArrivalView,shipmentView,pickupManageMode])",
    'productRows manage mode',
)
text = replace_once(
    text,
    "const buyerRows=useMemo(()=>buildRows(sourceOrders,customerMap,null,effectiveArrivalView,shipmentView==='shipped'),[sourceOrders,customerMap,effectiveArrivalView,shipmentView])",
    "const buyerRows=useMemo(()=>buildRows(sourceOrders,customerMap,null,effectiveArrivalView,shipmentView==='shipped',pickupManageMode),[sourceOrders,customerMap,effectiveArrivalView,shipmentView,pickupManageMode])",
    'buyerRows manage mode',
)

old_marker = """  async function markSourcePickedUp(source){\n    if(!source?.can_pickup||pickupKey)return\n    const key=`${source.order_id}-${source.item_index}`\n    setPickupKey(key)\n    try{\n      await OrdersAPI.setItemPickup(source.order_id,source.item_index,source.next_picked_up_qty)\n      toast(`✅ 已先出貨 ${source.ship_now_qty} 件；尚未到貨／尚未出貨的數量會繼續保留`)\n      await refresh()\n    }catch(err){toast('品項先出貨失敗：'+err.message,'error')}finally{setPickupKey('')}\n  }\n"""
new_marker = """  async function markSourcePickedUp(source){\n    if(!source?.can_pickup||pickupKey)return\n    const key=`${source.order_id}-${source.item_index}`\n    setPickupKey(key)\n    try{\n      await OrdersAPI.setItemPickup(source.order_id,source.item_index,source.next_picked_up_qty)\n      toast(`✅ 已先出貨 ${source.ship_now_qty} 件；尚未到貨／尚未出貨的數量會繼續保留`)\n      await refresh()\n    }catch(err){toast('品項先出貨失敗：'+err.message,'error')}finally{setPickupKey('')}\n  }\n  function pickupSourceKey(source){return `${source.order_id}-${source.item_index}`}\n  function pickupDraftValue(source){\n    const key=pickupSourceKey(source)\n    if(Object.prototype.hasOwnProperty.call(pickupDrafts,key))return String(pickupDrafts[key]??'')\n    return String(Math.max(0,Number(source.picked_up_qty||0)))\n  }\n  function changePickupDraft(source,value){\n    const key=pickupSourceKey(source)\n    const digits=String(value??'').replace(/\\D/g,'')\n    setPickupDrafts(prev=>({...prev,[key]:digits}))\n  }\n  async function applySourcePickup(source,nextInput){\n    if(!source||source.is_virtual||pickupKey)return\n    const key=pickupSourceKey(source),max=Math.max(0,Math.trunc(Number(source.max_pickup||0)))\n    const parsed=Math.trunc(Number(nextInput))\n    const next=Math.max(0,Math.min(max,Number.isFinite(parsed)?parsed:0))\n    const current=Math.max(0,Math.trunc(Number(source.picked_up_qty||0)))\n    if(next===current){toast('已出貨／取貨數量沒有變更','warning');return}\n    setPickupKey(key)\n    try{\n      const result=await OrdersAPI.setItemPickup(source.order_id,source.item_index,next)\n      if(result?.order_reopened)toast('↩️ 已調整品項完成數量；訂單仍有待處理品項，已自動恢復待出貨')\n      else if(result?.order_completed)toast('✅ 本張訂單所有有效品項已完成，已自動標記已出貨')\n      else if(next===0)toast('↩️ 已取消此品項出貨／取貨標記')\n      else toast(`✅ 已完成出貨／取貨 ${next}/${source.qty} 件`)\n      setPickupDrafts(prev=>{const copy={...prev};delete copy[key];return copy})\n      await refresh()\n    }catch(err){toast('更新品項出貨／取貨狀態失敗：'+err.message,'error')}finally{setPickupKey('')}\n  }\n"""
text = replace_once(text, old_marker, new_marker, 'pickup functions')

old_render = """  function renderContact(c){return <>{c.phone?<div>{c.phone}</div>:c.phone_last2?<div>末碼 {c.phone_last2}</div>:<div>—</div>}{c.line_nick&&<div style={{color:'var(--text-muted)'}}>Line：{c.line_nick}</div>}{c.fb_name&&<div style={{color:'var(--text-muted)'}}>FB：{c.fb_name}</div>}</>}\n  function renderDetails(c,showProduct){return c.items.map((item,index)=><div key={`${c.key}-${index}`} style={{padding:'7px 0',borderBottom:index<c.items.length-1?'1px dashed var(--border)':'none'}}>{showProduct&&<strong style={{color:'var(--indigo)'}}>{item.product_name}　</strong>}<span style={SPEC_STYLE}>{item.spec}</span> ×<strong>{item.qty}</strong>{shipmentView==='pending'?<>　<span style={{fontWeight:800,color:item.arrival_color}}>{item.arrival_label}</span></>:<span style={{fontWeight:800,color:'var(--emerald)'}}>　✅ 已出貨</span>}　{money(item.price)}／件{item.note&&<span style={{color:'var(--rose)',fontWeight:900}}>　備註：{item.note}</span>}<div style={{color:'var(--text-muted)',fontSize:11}}>訂購：{item.dates.join('、')}</div>{shipmentView==='pending'&&item.sources.map(source=><div key={`${source.order_id}-${source.item_index}`} style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginTop:5,padding:'5px 7px',borderRadius:7,background:source.is_virtual?'#fff1f2':'#f8fafc'}}><span className={`badge ${source.is_virtual?'badge-rose':'badge-gray'}`}>{source.is_virtual?'⚠ 虛擬':'正式'}</span>{source.locked_after_pickup?<><span className=\"badge badge-emerald\">已先出貨 {source.picked_up_qty}</span><span style={{fontSize:11}}>原訂購量 {source.qty}（已有部分出貨紀錄，請勿直接改量）</span></>:<><span style={{fontSize:11}}>訂購量</span><input type=\"number\" min=\"1\" defaultValue={source.qty} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>changeSourceQty(source,e.target.value)} style={{width:72,padding:'6px',fontWeight:900,textAlign:'center'}}/></>}{source.can_pickup&&<button type=\"button\" className=\"btn btn-sm btn-primary\" disabled={Boolean(pickupKey)} onClick={()=>markSourcePickedUp(source)}><PackageCheck size={13}/>{pickupKey===`${source.order_id}-${source.item_index}`?'處理中...':`先出貨 ${source.ship_now_qty} 件`}</button>}</div>)}</div>)}\n"""
new_render = """  function renderContact(c){return <>{c.phone?<div>{c.phone}</div>:c.phone_last2?<div>末碼 {c.phone_last2}</div>:<div>—</div>}{c.line_nick&&<div style={{color:'var(--text-muted)'}}>Line：{c.line_nick}</div>}{c.fb_name&&<div style={{color:'var(--text-muted)'}}>FB：{c.fb_name}</div>}</>}\n  function renderPickupControls(source){\n    if(!pickupManageMode||source.is_virtual)return null\n    const key=pickupSourceKey(source),picked=Math.max(0,Number(source.picked_up_qty||0)),max=Math.max(0,Number(source.max_pickup||0))\n    if(shipmentView==='shipped'&&picked<=0)return <span style={{fontSize:11,color:'var(--text-muted)'}}>整單出貨紀錄（無品項取貨數量）</span>\n    if(max<=0)return <span style={{fontSize:11,color:'var(--text-muted)'}}>目前無可調整的已到貨數量</span>\n    const raw=pickupDraftValue(source),parsed=Math.trunc(Number(raw)),draft=Math.max(0,Math.min(max,Number.isFinite(parsed)?parsed:0))\n    return <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:6,padding:'7px',border:'1px solid #86efac',borderRadius:9,background:'#f0fdf4'}}><span className=\"badge badge-emerald\">已出貨／取貨 {picked}/{source.qty}</span><input type=\"text\" inputMode=\"numeric\" value={raw} onFocus={e=>e.currentTarget.select()} onChange={e=>changePickupDraft(source,e.target.value)} aria-label={`已出貨／取貨數量，最多 ${max} 件`} style={{width:78,height:48,fontSize:16,fontWeight:900,textAlign:'center',padding:'0 8px',border:'2px solid #16a34a',borderRadius:10,background:'var(--surface)'}}/><span style={{fontSize:12,fontWeight:800}}>最多 {max}</span><button type=\"button\" className=\"btn btn-sm btn-primary\" disabled={Boolean(pickupKey)||draft===picked} onClick={()=>applySourcePickup(source,draft)}>{pickupKey===key?'處理中...':picked>0?'修改取貨':'標記已取貨'}</button>{picked>0&&<button type=\"button\" className=\"btn btn-sm btn-ghost\" disabled={Boolean(pickupKey)} onClick={()=>applySourcePickup(source,0)}>取消取貨</button>}</div>\n  }\n  function renderDetails(c,showProduct){return c.items.map((item,index)=><div key={`${c.key}-${index}`} style={{padding:'7px 0',borderBottom:index<c.items.length-1?'1px dashed var(--border)':'none'}}>{showProduct&&<strong style={{color:'var(--indigo)'}}>{item.product_name}　</strong>}<span style={SPEC_STYLE}>{item.spec}</span> ×<strong>{item.qty}</strong>{shipmentView==='pending'?<>　<span style={{fontWeight:800,color:item.arrival_color}}>{item.arrival_label}</span></>:<span style={{fontWeight:800,color:'var(--emerald)'}}>　✅ 已出貨</span>}　{money(item.price)}／件{item.note&&<span style={{color:'var(--rose)',fontWeight:900}}>　備註：{item.note}</span>}<div style={{color:'var(--text-muted)',fontSize:11}}>訂購：{item.dates.join('、')}</div>{(shipmentView==='pending'||pickupManageMode)&&item.sources.map(source=><div key={`${source.order_id}-${source.item_index}`} style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginTop:5,padding:'5px 7px',borderRadius:7,background:source.is_virtual?'#fff1f2':'#f8fafc'}}><span className={`badge ${source.is_virtual?'badge-rose':'badge-gray'}`}>{source.is_virtual?'⚠ 虛擬':'正式'}</span>{shipmentView==='pending'&&<>{source.locked_after_pickup?<><span className=\"badge badge-emerald\">已先出貨 {source.picked_up_qty}</span><span style={{fontSize:11}}>原訂購量 {source.qty}（已有部分出貨紀錄，請勿直接改量）</span></>:<><span style={{fontSize:11}}>訂購量</span><input type=\"number\" min=\"1\" defaultValue={source.qty} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>changeSourceQty(source,e.target.value)} style={{width:72,padding:'6px',fontWeight:900,textAlign:'center'}}/></>}{!pickupManageMode&&source.can_pickup&&<button type=\"button\" className=\"btn btn-sm btn-primary\" disabled={Boolean(pickupKey)} onClick={()=>markSourcePickedUp(source)}><PackageCheck size={13}/>{pickupKey===`${source.order_id}-${source.item_index}`?'處理中...':`先出貨 ${source.ship_now_qty} 件`}</button>}</>}{renderPickupControls(source)}</div>)}</div>)}\n"""
text = replace_once(text, old_render, new_render, 'integrated pickup renderer')

arrival_marker = """    {shipmentView==='pending'&&<div className=\"no-print\" style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:16}}><button className={`btn btn-sm ${arrivalView==='all'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('all')}><Layers3 size={13}/>全部待出貨</button><button className={`btn btn-sm ${arrivalView==='arrived'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('arrived')}><PackageCheck size={13}/>已到貨可先出貨</button><button className={`btn btn-sm ${arrivalView==='missing'?'btn-primary':'btn-ghost'}`} onClick={()=>setArrivalView('missing')}><PackageX size={13}/>尚未到貨</button></div>}\n\n"""
arrival_new = arrival_marker + """    <div className=\"no-print\" style={{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap',marginBottom:16,padding:'10px 12px',border:'1px solid #86efac',borderRadius:10,background:'#f0fdf4'}}><button type=\"button\" className={`btn btn-sm ${pickupManageMode?'btn-primary':'btn-ghost'}`} onClick={()=>{setPickupManageMode(v=>!v);setPickupDrafts({})}}><PackageCheck size={13}/>{pickupManageMode?'關閉取貨管理':'取貨管理模式'}</button><span style={{fontSize:12,color:'#166534',fontWeight:700}}>沿用目前報表搜尋；管理模式可直接修改／取消品項出貨或取貨，正常模式維持原本報表顯示。</span></div>\n\n"""
text = replace_once(text, arrival_marker, arrival_new, 'pickup management toggle')
path.write_text(text)


# 4) If pickup is reduced/cancelled on a shipped order, reopen the order when items remain.
path = Path('api/neon-orders-runtime.js')
text = path.read_text()
old = """  let orderCompleted=false\n  if(completed&&row.status==='pending'){\n    const completedAt=new Date().toISOString()\n    const historyEntry=[{status:'shipped',at:completedAt,note:'所有有效品項已出貨／取貨／釋出，自動完成訂單'}]\n    await sql`\n      UPDATE orders SET status='shipped',shipped_at=COALESCE(shipped_at,${completedAt}),\n        status_history=COALESCE(status_history,'[]'::jsonb) || ${JSON.stringify(historyEntry)}::jsonb,updated_at=now()\n      WHERE id=${row.order_id}`\n    orderCompleted=true\n  }else{\n    await sql`UPDATE orders SET updated_at=now() WHERE id=${row.order_id}`\n  }\n  return {...updated[0],order_completed:orderCompleted}\n"""
new = """  let orderCompleted=false\n  let orderReopened=false\n  if(completed&&row.status==='pending'){\n    const completedAt=new Date().toISOString()\n    const historyEntry=[{status:'shipped',at:completedAt,note:'所有有效品項已出貨／取貨／釋出，自動完成訂單'}]\n    await sql`\n      UPDATE orders SET status='shipped',shipped_at=COALESCE(shipped_at,${completedAt}),\n        status_history=COALESCE(status_history,'[]'::jsonb) || ${JSON.stringify(historyEntry)}::jsonb,updated_at=now()\n      WHERE id=${row.order_id}`\n    orderCompleted=true\n  }else if(!completed&&row.status==='shipped'){\n    const reopenedAt=new Date().toISOString()\n    const historyEntry=[{status:'pending',at:reopenedAt,note:'品項出貨／取貨數量調整後仍有待完成品項，自動恢復待出貨'}]\n    await sql`\n      UPDATE orders SET status='pending',shipped_at=NULL,\n        status_history=COALESCE(status_history,'[]'::jsonb) || ${JSON.stringify(historyEntry)}::jsonb,updated_at=now()\n      WHERE id=${row.order_id}`\n    orderReopened=true\n  }else{\n    await sql`UPDATE orders SET updated_at=now() WHERE id=${row.order_id}`\n  }\n  return {...updated[0],order_completed:orderCompleted,order_reopened:orderReopened}\n"""
text = replace_once(text, old, new, 'setItemPickup reopen')
path.write_text(text)


# 5) Version label.
path = Path('src/components/Layout.jsx')
text = path.read_text()
text = replace_once(
    text,
    "// 第58版：同一訂單部分到貨時，可逐品項先出貨；未到貨品項繼續保留待出貨。\nconst APP_VERSION = '第58版｜2026/09/12'",
    "// 第59版：品項出貨／取貨管理整合進出貨查詢報表，統一搜尋並可修改／取消取貨。\nconst APP_VERSION = '第59版｜2026/09/12'",
    'V59 version label',
)
path.write_text(text)


# 6) Migration Registry.
path = Path('src/migration-registry.json')
data = json.loads(path.read_text())
if not any(entry.get('version') == 'V59' for entry in data.get('entries', [])):
    data['entries'].append({
        'version': 'V59',
        'date': '2026-09-12',
        'type': 'feature/workflow',
        'summary': '將獨立品項取貨管理整合進出貨查詢報表；同一搜尋即可查看待出貨／已出貨、逐品項先出貨、修改取貨與取消取貨；取消已完成品項後若訂單仍有待處理數量，已出貨訂單自動恢復 pending。',
        'database_changes': [],
        'api_changes': [
            'api/neon-orders-runtime.js: set_item_pickup 在 shipped 訂單降低／取消品項完成數量後，如仍有 open_items，自動恢復 orders.status=pending、清除 shipped_at 並追加 status_history；沿用既有 Function，不新增 Serverless Function。'
        ],
        'ui_changes': [
            'src/App.jsx: /pending-report 移除獨立 OrderPickupManager 掛載，只保留整合後報表。',
            'src/pages/PendingProductReportSql.jsx: 新增取貨管理模式；沿用報表既有買家／商品搜尋，結果列直接修改／取消 picked_up_qty，待出貨仍保留 V58 先出貨。',
            'src/pages/PendingProductReportFiltered.jsx: pending 轉換保留已全數取貨品項為管理用隱藏記錄，正常檢視不顯示，取貨管理模式可重新操作。'
        ],
        'data_logic': '正常待出貨檢視仍只顯示尚未完成數量；取貨管理模式才納入已完成品項。修改／取消取貨不得超過已到貨且未釋出數量；released_qty 與 picked_up_qty 維持不同語意。取消取貨後有剩餘數量則品項回待出貨，整張 shipped 訂單同步回 pending。',
        'data_migration': '無。沿用 V54 picked_up_* 欄位，不批次改寫歷史資料。',
        'rollback': '重新掛載 OrderPickupManager、移除報表取貨管理模式與 set_item_pickup 自動 reopen 段落，APP_VERSION 還原 V58；既有 picked_up_* 資料保留。'
    })
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
