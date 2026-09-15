from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# 1) Backend: completing an incoming batch must not undo the automatic supplier-payment
# trigger that just ran when arrived_qty increased.
api_path = Path('api/neon-order-status.js')
api = api_path.read_text(encoding='utf-8')
old = """  const affected=Array.isArray(r.affected)?r.affected:[]\n  for(const a of affected){\n    try{await correctSupplierState(sql,a.order_id,a.item_index,false)}catch(err){console.error('incoming-correct-supplier-state',a,err)}\n  }\n  return {completed:true,requested:Number(r.requested||0),allocated:Number(r.allocated||0),affected}\n"""
new = """  const affected=Array.isArray(r.affected)?r.affected:[]\n  // arrived_qty 的 UPDATE 會由 trg_auto_supplier_payment_arrival 依商品付款條件處理自動付款。\n  // 這裡不可再呼叫 correctSupplierState，否則會把剛建立的自動付款 allocation 撤銷，\n  // 導致使用者完成到貨後又必須逐筆重新勾選供應商付款。\n  return {completed:true,requested:Number(r.requested||0),allocated:Number(r.allocated||0),affected}\n"""
api = replace_once(api, old, new, 'incomingComplete supplier reset block')
api_path.write_text(api, encoding='utf-8')

# 2) UI: make the separation between arrival and supplier payment explicit.
page_path = Path('src/pages/IncomingBatches.jsx')
page = page_path.read_text(encoding='utf-8')
page = replace_once(
    page,
    '先把廠商這次要送的商品拉成一批；貨到後理貨、一次完成到貨，再直接處理本批付款。',
    '先把廠商這次要送的商品拉成一批；完成本批到貨後會立即更新未出貨報表，供應商付款依商品付款條件另外處理。',
    'incoming header copy',
)
page = replace_once(
    page,
    'toast(`✅ 本批到貨完成，共分配 ${result.allocated||0} 件`)',
    'toast(`✅ 本批到貨完成，共分配 ${result.allocated||0} 件；未出貨報表已更新`)',
    'incoming complete toast',
)
page = replace_once(
    page,
    '若本批剛完成且有可手動付款明細，系統會自動帶入；若沒有，代表已付款或付款條件由系統自動處理。',
    '✅ 到貨資料已完成分配，已立即同步到「未出貨報表」。供應商付款不是到貨顯示的前置條件；若沒有付款明細，代表已付款或付款條件由系統自動處理。',
    'incoming completed empty payment copy',
)
page = replace_once(
    page,
    '本批可付款 {paymentLines.length} 筆，共 <strong>{money(paymentLines.reduce((s,l)=>s+Number(l.outstanding||0),0))}</strong>。全額付款成功後，會自動批次出貨「整張訂單商品均已到齊」的正式預購訂單；仍有其他商品未到齊的訂單會保留待出貨。',
    '本批另有可手動付款 {paymentLines.length} 筆，共 <strong>{money(paymentLines.reduce((s,l)=>s+Number(l.outstanding||0),0))}</strong>。到貨資料已經同步未出貨報表，不需先付款；若在這裡全額付款，仍沿用既有規則自動批次出貨「整張訂單商品均已到齊」的正式預購訂單。',
    'incoming manual payment copy',
)
page_path.write_text(page, encoding='utf-8')

# 3) Version
layout_path = Path('src/components/Layout.jsx')
layout = layout_path.read_text(encoding='utf-8')
layout = replace_once(
    layout,
    "// 第61版：部分先出貨紀錄可獨立封存／解除封存，不影響同張訂單尚未完成的待出貨品項。\nconst APP_VERSION = '第61版｜2026/09/13'",
    "// 第62版：修正完成即將到貨後自動付款被撤銷；到貨完成立即同步未出貨，付款不再被誤要求重做。\nconst APP_VERSION = '第62版｜2026/09/15'",
    'app version',
)
layout_path.write_text(layout, encoding='utf-8')

# 4) Migration Registry
registry_path = Path('src/migration-registry.json')
registry = json.loads(registry_path.read_text(encoding='utf-8'))
entries = registry if isinstance(registry, list) else registry.get('entries')
if not isinstance(entries, list):
    raise SystemExit('migration registry format not recognized')
if not any(str(item.get('version')) == 'V62' for item in entries):
    entries.append({
        'version': 'V62',
        'date': '2026-09-15',
        'type': 'bugfix/workflow',
        'summary': '修正即將到貨批次完成時，arrived_qty 觸發的供應商自動付款隨即又被更正流程撤銷，造成到貨後必須逐筆重新勾選批次付款。',
        'database_changes': [],
        'api_changes': [
            'api/neon-order-status.js: incoming_complete 完成 arrived_qty 分配後不再呼叫 correctSupplierState；保留 trg_auto_supplier_payment_arrival 依 supplier_payment_term 自動建立的付款與 allocation，不新增 Serverless Function。'
        ],
        'ui_changes': [
            'src/pages/IncomingBatches.jsx: 明確提示完成本批到貨即更新未出貨報表；供應商付款不是到貨顯示前置條件，只有仍需手動付款的明細才另外處理。'
        ],
        'data_logic': "完成本批到貨仍只負責將實收數量依正式預購訂單順序配置到 order_items.arrived_qty；arrived_qty 增加時由既有 trg_auto_supplier_payment_arrival 依 supplier_payment_term='order'/'arrival' 自動付款，manual 才保留手動付款。完成到貨本身不要求先勾選付款，未完成出貨的訂單仍可立即出現在未出貨報表。V37 的手動全額付款後 incoming_ship_ready 規則保留。",
        'data_migration': '無 schema migration、無歷史資料批次改寫；只修正未來完成到貨時的付款狀態處理。既有已被撤銷的付款不自動重建，避免未經確認改寫正式金流紀錄。',
        'rollback': '恢復 incoming_complete 完成後逐 affected item 呼叫 correctSupplierState(..., false) 的 V61 行為，並將 APP_VERSION 還原 V61；不需資料庫 rollback。'
    })
registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('V62 patch applied')
