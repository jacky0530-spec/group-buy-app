from pathlib import Path
import json

# Pending report: allow partially arrived items to be fulfilled/shipped first.
path = Path('src/pages/PendingProductReportSql.jsx')
text = path.read_text()

old = """  orderRows.forEach(order=>{\n    const items=(order.items||[]).filter(item=>{\n      if(product&&!matchesProduct(item,product))return false\n      return shippedView?itemQty(item)>0:displayQty(item,arrivalView)>0\n    })\n    if(!items.length)return\n"""
new = """  orderRows.forEach(order=>{\n    const scopedItems=(order.items||[]).filter(item=>!product||matchesProduct(item,product))\n    const items=scopedItems.filter(item=>shippedView?itemQty(item)>0:displayQty(item,arrivalView)>0)\n    if(!items.length)return\n"""
if old not in text: raise SystemExit('buildRows item filter marker not found')
text = text.replace(old,new,1)

old = "all_virtual:true,archived:true})"
new = "all_virtual:true,archived:true,overall_arrived_qty:0,overall_missing_qty:0})"
if old not in text: raise SystemExit('group init marker not found')
text = text.replace(old,new,1)

old = """    if(order.archived!==true)group.archived=false\n    items.forEach(item=>{\n"""
new = """    if(order.archived!==true)group.archived=false\n    group.overall_arrived_qty+=scopedItems.reduce((sum,item)=>sum+arrivedQty(item),0)\n    group.overall_missing_qty+=scopedItems.reduce((sum,item)=>sum+missingQty(item),0)\n    items.forEach(item=>{\n"""
if old not in text: raise SystemExit('overall quantities insertion marker not found')
text = text.replace(old,new,1)

old = """      const pickupTarget=Math.max(0,originalQty-releasedQty)\n      const canPickup=!order.is_virtual&&pickupTarget>0&&pickedQty===0&&arrived>=pickupTarget\n      detail.qty+=shown;detail.ordered_qty+=ordered;detail.arrived_qty+=arrived;detail.missing_qty+=missing;detail.amount+=price*shown;detail.dates.add(dateText(order.order_date));detail.sources.push({order_id:order.id,item_index:sourceItemIndex,qty:originalQty,arrived_qty:arrived,released_qty:releasedQty,pickup_target:pickupTarget,can_pickup:canPickup,picked_up_qty:pickedQty,locked_after_pickup:pickedQty>0,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual)})\n"""
new = """      const remainingTarget=Math.max(0,originalQty-releasedQty-pickedQty)\n      const shipNowQty=Math.min(arrived,Math.max(0,ordered),remainingTarget)\n      const nextPickedQty=Math.min(Math.max(0,originalQty-releasedQty),pickedQty+shipNowQty)\n      const canPickup=!order.is_virtual&&remainingTarget>0&&shipNowQty>0\n      detail.qty+=shown;detail.ordered_qty+=ordered;detail.arrived_qty+=arrived;detail.missing_qty+=missing;detail.amount+=price*shown;detail.dates.add(dateText(order.order_date));detail.sources.push({order_id:order.id,item_index:sourceItemIndex,qty:originalQty,arrived_qty:arrived,released_qty:releasedQty,pickup_target:remainingTarget,ship_now_qty:shipNowQty,next_picked_up_qty:nextPickedQty,can_pickup:canPickup,picked_up_qty:pickedQty,locked_after_pickup:pickedQty>0,date:dateText(order.order_date),is_virtual:Boolean(order.is_virtual)})\n"""
if old not in text: raise SystemExit('pickup calculation marker not found')
text = text.replace(old,new,1)

old = "order_count:group.order_ids.size,all_arrived:group.total_missing_qty===0})).sort"
new = "order_count:group.order_ids.size,all_arrived:group.overall_missing_qty===0})).sort"
if old not in text: raise SystemExit('all_arrived marker not found')
text = text.replace(old,new,1)

text = text.replace("arrivalView==='arrived'?'已到貨可取貨'", "arrivalView==='arrived'?'已到貨可先出貨'", 1)

old = """  async function markSourcePickedUp(source){\n    if(!source?.can_pickup||pickupKey)return\n    const key=`${source.order_id}-${source.item_index}`\n    setPickupKey(key)\n    try{\n      await OrdersAPI.setItemPickup(source.order_id,source.item_index,source.pickup_target)\n      toast(`✅ 已取貨 ${source.pickup_target} 件，已從未出貨明細隱藏`)\n      await refresh()\n    }catch(err){toast('標記取貨失敗：'+err.message,'error')}finally{setPickupKey('')}\n  }\n"""
new = """  async function markSourcePickedUp(source){\n    if(!source?.can_pickup||pickupKey)return\n    const key=`${source.order_id}-${source.item_index}`\n    setPickupKey(key)\n    try{\n      await OrdersAPI.setItemPickup(source.order_id,source.item_index,source.next_picked_up_qty)\n      toast(`✅ 已先出貨 ${source.ship_now_qty} 件；尚未到貨／尚未出貨的數量會繼續保留`)\n      await refresh()\n    }catch(err){toast('品項先出貨失敗：'+err.message,'error')}finally{setPickupKey('')}\n  }\n"""
if old not in text: raise SystemExit('markSourcePickedUp marker not found')
text = text.replace(old,new,1)

text = text.replace("已取貨 {source.picked_up_qty}", "已先出貨 {source.picked_up_qty}", 1)
text = text.replace("已有取貨紀錄，請勿直接改量", "已有部分出貨紀錄，請勿直接改量", 1)
text = text.replace("'已取貨並隱藏'", "`先出貨 ${source.ship_now_qty} 件`", 1)
text = text.replace(">已到貨可取貨</button>", ">已到貨可先出貨</button>", 1)
text = text.replace("c.all_arrived?'✅ 商品全部到齊，可取貨':`⚠️ 尚未到貨 ${c.total_missing_qty} 件`", "c.all_arrived?'✅ 商品全部到齊，可出貨':c.overall_arrived_qty>0?`🟡 已到貨 ${c.overall_arrived_qty} 件，可先出貨；尚欠 ${c.overall_missing_qty} 件`:`⚠️ 尚未到貨 ${c.overall_missing_qty} 件`", 1)

old = """<button className=\"btn btn-sm btn-primary\" disabled={Boolean(shippingKey)||!c.real_order_ids.length} onClick={()=>changeRowShipment(c,'shipped')}><Truck size={13}/>{shippingKey===actionKey?'更新中...':'標記已出貨'}</button>"""
new = """{c.all_arrived?<button className=\"btn btn-sm btn-primary\" disabled={Boolean(shippingKey)||!c.real_order_ids.length} onClick={()=>changeRowShipment(c,'shipped')}><Truck size={13}/>{shippingKey===actionKey?'更新中...':'整單標記已出貨'}</button>:<span style={{fontSize:11,color:'#b45309',fontWeight:800}}>請在已到貨品項旁按「先出貨」</span>}"""
if old not in text: raise SystemExit('row shipment button marker not found')
text = text.replace(old,new,1)
path.write_text(text)

# Wrapper: keep arrival catalog filter in sync with new wording.
path = Path('src/pages/PendingProductReportFiltered.jsx')
text = path.read_text()
text = text.replace("'已到貨可取貨': 'arrived'", "'已到貨可先出貨': 'arrived'", 1)
text = text.replace("arrivalCatalogView === 'arrived' ? '已到貨可取貨' : '尚未到貨'", "arrivalCatalogView === 'arrived' ? '已到貨可先出貨' : '尚未到貨'", 1)
text = text.replace("全部待出貨 / 已到貨可取貨 / 尚未到貨", "全部待出貨 / 已到貨可先出貨 / 尚未到貨", 1)
path.write_text(text)

# Runtime wording: the existing picked_up_qty is now the shared item-level fulfilment marker for pickup/partial shipment.
path = Path('api/neon-orders-runtime.js')
text = path.read_text()
text = text.replace("已取消訂單不可標記取貨", "已取消訂單不可標記出貨／取貨", 1)
text = text.replace("已封存訂單不可標記取貨", "已封存訂單不可標記出貨／取貨", 1)
text = text.replace("虛擬訂單不可標記取貨", "虛擬訂單不可標記出貨／取貨", 1)
text = text.replace("現貨訂單不使用預購品項取貨功能", "現貨訂單不使用預購品項分批出貨／取貨功能", 1)
text = text.replace("已取貨數量必須介於 0～${maxPickup} 件", "已完成出貨／取貨數量必須介於 0～${maxPickup} 件", 1)
text = text.replace("所有有效品項已取貨／釋出，自動完成訂單", "所有有效品項已出貨／取貨／釋出，自動完成訂單", 1)
path.write_text(text)

# Version label.
path = Path('src/components/Layout.jsx')
text = path.read_text()
text = text.replace("// 第57版：小幫手登記時只針對同客戶、同商品且同規格的既有待出貨訂單顯示紅色重複提示。\nconst APP_VERSION = '第57版｜2026/09/12'", "// 第58版：同一訂單部分到貨時，可逐品項先出貨；未到貨品項繼續保留待出貨。\nconst APP_VERSION = '第58版｜2026/09/12'", 1)
path.write_text(text)

# Migration registry.
path = Path('src/migration-registry.json')
data = json.loads(path.read_text())
if not any(e.get('version') == 'V58' for e in data.get('entries', [])):
    data['entries'].append({
        "version": "V58",
        "date": "2026-09-12",
        "type": "feature/bugfix",
        "summary": "待出貨查詢支援同一訂單部分到貨後逐品項先出貨：已到貨品項可先完成並從待出貨明細隱藏，未到貨品項繼續保留；同一規格數量大於 1 時也可按目前已到貨數量分批出貨。",
        "database_changes": [],
        "api_changes": [
            "沿用 api/neon-orders-runtime.js 既有 set_item_pickup / picked_up_qty 作為預購品項已完成出貨或取貨的數量標記，不新增 Serverless Function、不新增欄位。",
            "set_item_pickup 的錯誤訊息與自動完成 status_history 改為出貨／取貨共用語意；實際寫入規則與安全上限不變。"
        ],
        "ui_changes": [
            "src/pages/PendingProductReportSql.jsx: 已到貨篩選改為『已到貨可先出貨』，部分到貨的買家會顯示已到貨／尚欠件數。",
            "已到貨品項新增逐品項『先出貨 N 件』操作；同規格訂 3 件、先到 2 件時可先出貨 2 件，剩餘 1 件繼續留在待出貨。",
            "整單仍有未到貨品項時不再提供整單標記已出貨，避免把未到貨品項一起結案；全部到齊才保留整單出貨按鈕。",
            "src/pages/PendingProductReportFiltered.jsx: 到貨商品目錄篩選同步改為已到貨可先出貨。"
        ],
        "data_logic": "部分出貨沿用 picked_up_qty 累積完成量。每次最多只能增加到目前 arrived_qty 且扣除 released_qty 後可完成的數量；已完成數量從 pending 顯示扣除，剩餘未到貨／未完成數量持續保留。所有有效品項均完成或釋出後，沿用 V55 自動將整張預購訂單轉 shipped。",
        "data_migration": "無。沿用 V54 已存在的 picked_up_qty / picked_up_at / picked_up_by_uid；不修改正式歷史資料。",
        "rollback": "還原 PendingProductReportSql / PendingProductReportFiltered 與 set_item_pickup 顯示文案至 V57；不需資料庫 rollback。"
    })
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
