from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# 1) Backend: allow a completed incoming batch to batch-ship the orders actually
# affected by that batch, independent of supplier payment.
api_path = Path('api/neon-order-status.js')
api = api_path.read_text(encoding='utf-8')
old = """  const shippedIds=Array.isArray(rows[0]?.ids)?rows[0].ids:[]\n  return {requested:ids.length,shipped:Number(rows[0]?.shipped||0),waiting:Math.max(0,ids.length-shippedIds.length),ids:shippedIds}\n}\n\nasync function getOrder(sql,legacyId){\n"""
new = """  const shippedIds=Array.isArray(rows[0]?.ids)?rows[0].ids:[]\n  return {requested:ids.length,shipped:Number(rows[0]?.shipped||0),waiting:Math.max(0,ids.length-shippedIds.length),ids:shippedIds}\n}\n\nasync function incomingShipBatchReady(sql,body){\n  await ensureIncomingSchema(sql)\n  const batchId=text(body?.id)\n  if(!batchId) throw new Error('缺少到貨批次 ID')\n  // incoming_complete 與 order_items.arrived_at 使用同一交易的 now()，\n  // 因此 arrived_at = completed_at 可準確找回「這一批」實際完成到貨的訂單，\n  // 不會把其他批次或更早已到貨的訂單混進來。\n  const rows=await sql`\n    SELECT DISTINCT o.legacy_id AS id\n    FROM incoming_batches b\n    JOIN incoming_batch_items bi ON bi.batch_id=b.id\n    JOIN order_items oi ON oi.product_id=bi.product_id\n      AND oi.supplier=b.supplier\n      AND COALESCE(oi.spec_package,'')=COALESCE(bi.spec_package,'')\n      AND COALESCE(oi.spec_flavor,'')=COALESCE(bi.spec_flavor,'')\n      AND COALESCE(oi.spec_color,'')=COALESCE(bi.spec_color,'')\n      AND COALESCE(oi.spec_size,'')=COALESCE(bi.spec_size,'')\n      AND oi.arrived_at=b.completed_at\n    JOIN orders o ON o.id=oi.order_id\n    WHERE b.legacy_id=${batchId}\n      AND b.status='completed'\n      AND o.status='pending'\n      AND COALESCE(o.is_virtual,false)=false\n      AND COALESCE(o.fulfillment_type,'preorder')='preorder'\n    ORDER BY o.legacy_id`\n  const ids=rows.map(r=>text(r.id)).filter(Boolean)\n  if(!ids.length) return {batch_id:batchId,requested:0,shipped:0,waiting:0,ids:[]}\n  const result=await incomingShipReady(sql,{\n    order_ids:ids,\n    reason:text(body?.reason)||`即將到貨批次 ${batchId} 完成後批次出貨`,\n  })\n  return {batch_id:batchId,...result}\n}\n\nasync function getOrder(sql,legacyId){\n"""
api = replace_once(api, old, new, 'insert incomingShipBatchReady')
old = """    if(action==='incoming_complete') return res.status(200).json({ok:true,result:await incomingComplete(sql,req.body||{})})\n    if(action==='incoming_ship_ready') return res.status(200).json({ok:true,result:await incomingShipReady(sql,req.body||{})})\n    throw new Error('未知的訂單狀態動作')\n"""
new = """    if(action==='incoming_complete') return res.status(200).json({ok:true,result:await incomingComplete(sql,req.body||{})})\n    if(action==='incoming_ship_ready') return res.status(200).json({ok:true,result:await incomingShipReady(sql,req.body||{})})\n    if(action==='incoming_ship_batch_ready') return res.status(200).json({ok:true,result:await incomingShipBatchReady(sql,req.body||{})})\n    throw new Error('未知的訂單狀態動作')\n"""
api = replace_once(api, old, new, 'register incoming_ship_batch_ready')
api_path.write_text(api, encoding='utf-8')

# 2) UI: completed incoming batches get a dedicated shipment action that does not
# depend on supplier-payment lines.
page_path = Path('src/pages/IncomingBatches.jsx')
page = page_path.read_text(encoding='utf-8')
page = replace_once(
    page,
    "  const[paying,setPaying]=useState(false)\n",
    "  const[paying,setPaying]=useState(false)\n  const[shippingReady,setShippingReady]=useState(false)\n",
    'shippingReady state',
)
page = replace_once(
    page,
    """  const payBatch=async()=>{\n""",
    """  const shipReadyBatch=async()=>{\n    if(!activeBatch||activeBatch.status!=='completed'||shippingReady)return\n    if(!window.confirm('確定批次出貨本批已到齊訂單？\\n\\n只會出貨「整張訂單所有商品都已到齊」的正式預購訂單；仍有其他商品未到貨的訂單會繼續保留待出貨。\\n供應商付款狀態不會阻擋此操作。'))return\n    setShippingReady(true)\n    try{\n      const data=await neonOrderStatusRuntime('incoming_ship_batch_ready',{\n        id:activeBatch.id,\n        reason:`即將到貨批次 ${activeBatch.id} 完成後批次出貨`,\n      })\n      const result=data?.result||{}\n      const shipped=Number(result.shipped||0),waiting=Number(result.waiting||0),requested=Number(result.requested||0)\n      if(requested===0) toast('本批目前沒有尚待出貨的相關訂單')\n      else toast(`✅ 本批已批次出貨 ${shipped} 張${waiting>0?`；另 ${waiting} 張仍有商品未到齊，繼續保留待出貨`:''}`)\n    }catch(e){toast('本批批次出貨失敗：'+e.message,'error')}\n    finally{setShippingReady(false)}\n  }\n\n  const payBatch=async()=>{\n""",
    'shipReadyBatch action',
)
page = replace_once(
    page,
    '先把廠商這次要送的商品拉成一批；完成本批到貨後會立即更新未出貨報表，供應商付款依商品付款條件另外處理。',
    '先把廠商這次要送的商品拉成一批；完成到貨後立即更新未出貨報表，並可直接批次出貨本批已到齊訂單，不需先完成供應商付款。',
    'incoming header copy V63',
)
marker = """      {activeBatch.status==='completed'&&<div className=\"no-print\" style={{marginTop:16,paddingTop:14,borderTop:'1px solid var(--border)'}}><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}><WalletCards size={18}/><strong>本批付款</strong></div>"""
insert = """      {activeBatch.status==='completed'&&<div className=\"no-print\" style={{marginTop:16,padding:12,border:'1px solid #bfdbfe',borderRadius:10,background:'#eff6ff'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><div><div style={{display:'flex',alignItems:'center',gap:8,fontWeight:900}}><Truck size={18}/>本批出貨</div><div style={{fontSize:12,color:'#1e40af',marginTop:4}}>到貨與供應商付款分開處理。可直接批次出貨本批「整張訂單均已到齊」的正式訂單；真正尚未到齊的會自動略過並保留待出貨。</div></div><button className=\"btn btn-primary\" disabled={shippingReady} onClick={shipReadyBatch}><Truck size={15}/>{shippingReady?'批次出貨中...':'批次出貨本批已到齊訂單'}</button></div></div>}\n\n      {activeBatch.status==='completed'&&<div className=\"no-print\" style={{marginTop:16,paddingTop:14,borderTop:'1px solid var(--border)'}}><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}><WalletCards size={18}/><strong>本批付款</strong></div>"""
page = replace_once(page, marker, insert, 'completed batch shipping panel')
page_path.write_text(page, encoding='utf-8')

# 3) Version
layout_path = Path('src/components/Layout.jsx')
layout = layout_path.read_text(encoding='utf-8')
layout = replace_once(
    layout,
    "// 第62版：修正完成即將到貨後自動付款被撤銷；到貨完成立即同步未出貨，付款不再被誤要求重做。\nconst APP_VERSION = '第62版｜2026/09/15'",
    "// 第63版：完成到貨批次可直接批次出貨本批已到齊訂單；出貨不再綁定供應商付款。\nconst APP_VERSION = '第63版｜2026/09/16'",
    'app version V63',
)
layout_path.write_text(layout, encoding='utf-8')

# 4) Migration Registry
registry_path = Path('src/migration-registry.json')
registry = json.loads(registry_path.read_text(encoding='utf-8'))
entries = registry if isinstance(registry, list) else registry.get('entries')
if not isinstance(entries, list):
    raise SystemExit('migration registry format not recognized')
if not any(str(item.get('version')) == 'V63' for item in entries):
    entries.append({
        'version': 'V63',
        'date': '2026-09-16',
        'type': 'bugfix/workflow',
        'summary': '即將到貨批次完成後新增獨立的批次出貨流程，不再要求先進入供應商付款；只出貨本批實際完成到貨且整張訂單所有商品均已到齊的正式預購訂單。',
        'database_changes': [],
        'api_changes': [
            "api/neon-order-status.js: 新增 incoming_ship_batch_ready；以同一批次完成交易的 order_items.arrived_at = incoming_batches.completed_at 找回本批實際完成到貨的訂單，再沿用 incomingShipReady 只出貨全品項到齊的 pending 正式預購訂單。"
        ],
        'ui_changes': [
            'src/pages/IncomingBatches.jsx: 已完成批次新增「批次出貨本批已到齊訂單」按鈕；尚有其他商品未到齊的訂單自動略過並保留待出貨，供應商付款不再是批次出貨前置條件。'
        ],
        'data_logic': '到貨、出貨、供應商付款三者分離：完成到貨只更新 arrived_qty；使用者可在已完成批次直接批次出貨該批相關且整張均到齊的訂單；未到齊、虛擬、非預購或非 pending 訂單不會被出貨。付款功能與既有自動付款規則保持不變。',
        'data_migration': '無 schema migration、無歷史資料批次改寫。既有已完成批次可直接使用新按鈕補做批次出貨。',
        'rollback': '移除 incoming_ship_batch_ready 與已完成批次的獨立出貨按鈕，APP_VERSION 還原 V62；不需資料庫 rollback。'
    })
registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('V63 patch applied')
