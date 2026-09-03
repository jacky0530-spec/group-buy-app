import { Printer } from 'lucide-react'
import { Modal } from './UI'

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

function phoneSuffix(order) {
  const stored = String(order?.customer_phone_last2 || '').trim()
  if (stored) return stored
  const phone = digits(order?.customer_phone)
  return phone.length >= 2 ? phone.slice(-2) : phone
}

function customerKey(order) {
  const name = String(order?.customer_name || '').trim().toLocaleLowerCase('zh-TW')
  const suffix = phoneSuffix(order)
  return `${name}__${suffix}`
}

function specText(item) {
  const spec = item?.spec || {}
  const parts = []
  if (spec.package) parts.push(`組合：${spec.package}`)
  if (spec.flavor) parts.push(`口味：${spec.flavor}`)
  if (spec.color) parts.push(spec.color)
  if (spec.size) parts.push(spec.size)
  return parts.length ? `（${parts.join('／')}）` : ''
}

function itemKey(item) {
  const price = Number(item.sale_price ?? item.price ?? 0)
  const qty = Math.max(0,Number(item.qty || 0))
  const released = Math.min(qty,Math.max(0,Number(item.released_qty || 0)))
  const spec = item?.spec || {}
  return [
    item.product_id || item.id || '',
    item.product_name || item.name || '',
    price,
    released > 0 ? 'released' : 'active',
    spec.package || '',
    spec.flavor || '',
    spec.color || '',
    spec.size || '',
    item.note || '',
  ].join('__')
}

export function groupReceiptOrders(orders = []) {
  const groups = new Map()

  orders.forEach(order => {
    const key = customerKey(order)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        customer_name:order.customer_name || '未命名客戶',
        customer_phone:order.customer_phone || '',
        customer_phone_last2:phoneSuffix(order),
        order_ids:[],
        items:new Map(),
      })
    }

    const group = groups.get(key)
    group.order_ids.push(order.id)
    if (!group.customer_phone && order.customer_phone) group.customer_phone = order.customer_phone

    ;(order.items || []).forEach(item => {
      const key = itemKey(item)
      const qty = Math.max(0,Number(item.qty || 0))
      const releasedQty = Math.min(qty,Math.max(0,Number(item.released_qty || 0)))
      const pickupQty = Math.max(0,qty-releasedQty)
      const price = Number(item.sale_price ?? item.price ?? 0)
      const pickupSubtotal = price * pickupQty
      const old = group.items.get(key)
      if (old) {
        old.qty += qty
        old.released_qty += releasedQty
        old.pickup_qty += pickupQty
        old.subtotal += pickupSubtotal
      } else {
        group.items.set(key, {
          ...item,
          qty,
          released_qty:releasedQty,
          pickup_qty:pickupQty,
          sale_price:price,
          subtotal:pickupSubtotal,
        })
      }
    })
  })

  return [...groups.values()].map(group => {
    const items = [...group.items.values()]
    return {
      ...group,
      items,
      subtotal:items.reduce((sum,item) => sum + Number(item.subtotal || 0),0),
    }
  })
}

function phoneLabel(group) {
  const phone = String(group.customer_phone || '').trim()
  if (phone) return phone
  return group.customer_phone_last2 ? `末碼 ${group.customer_phone_last2}` : '未留手機'
}

function printReceiptInIsolatedWindow() {
  const source = document.getElementById('receipt-area')
  if (!source) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    window.print()
    return
  }

  const receiptHtml = source.innerHTML
  printWindow.document.open()
  printWindow.document.write(`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>團購百貨 出貨單</title>
<style>
  :root {
    --border:#e2e8f0;
    --surface-2:#f8f9fc;
    --text-primary:#1e293b;
    --text-secondary:#64748b;
    --indigo:#6366f1;
    --indigo-light:#eef2ff;
  }
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html,body { margin:0; padding:0; background:#fff; color:var(--text-primary); font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; }
  #receipt-area { width:100%; max-width:186mm; margin:0 auto; }
  @page { size:A4 portrait; margin:10mm; }
  @media print {
    html,body { width:auto; height:auto; }
    #receipt-area { max-width:none; }
    #receipt-area > div { break-inside:avoid; page-break-inside:avoid; }
  }
</style>
</head>
<body><div id="receipt-area">${receiptHtml}</div></body>
</html>`)
  printWindow.document.close()

  const launchPrint = () => {
    printWindow.focus()
    window.setTimeout(() => {
      printWindow.print()
    }, 120)
  }

  if (printWindow.document.readyState === 'complete') launchPrint()
  else printWindow.addEventListener('load', launchPrint, { once:true })
}

export default function GroupedReceipt({ orders, onClose }) {
  const groups = groupReceiptOrders(orders)
  const grandTotal = groups.reduce((sum,group) => sum + group.subtotal,0)
  const itemCount = groups.reduce((sum,group) => sum + group.items.reduce((s,item) => s + Number(item.pickup_qty ?? item.qty ?? 0),0),0)

  return (
    <Modal title="📋 出貨明細單" onClose={onClose} width={760}>
      <div id="receipt-area">
        <div style={{ textAlign:'center',marginBottom:16,paddingBottom:12,borderBottom:'2px solid var(--border)' }}>
          <div style={{ fontWeight:900,fontSize:20 }}>🛍️ 團購百貨 出貨單</div>
          <div style={{ color:'var(--text-secondary)',fontSize:12,marginTop:4 }}>
            列印日期：{new Date().toLocaleDateString('zh-TW')}　｜　共 {groups.length} 位客戶／應取 {itemCount} 件
          </div>
        </div>

        {groups.map(group => (
          <div key={group.key} style={{ border:'1px solid var(--border)',borderRadius:10,marginBottom:14,overflow:'hidden',breakInside:'avoid' }}>
            <div style={{ background:'var(--surface-2)',padding:'9px 12px',fontWeight:800,display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap' }}>
              <span>👤 {group.customer_name}</span>
              <span style={{ color:'var(--text-secondary)',fontSize:12 }}>📱 {phoneLabel(group)}</span>
            </div>

            {group.items.map((item,i) => {
              const releasedQty=Number(item.released_qty||0)
              const pickupQty=Number(item.pickup_qty??item.qty??0)
              return <div key={`${group.key}-${i}`} style={{ display:'grid',gridTemplateColumns:'1fr 80px 90px 100px',gap:8,padding:'7px 12px',borderTop:'1px solid var(--border)',fontSize:13,opacity:releasedQty>0 ? .78 : 1 }}>
                <span>{item.product_name || item.name}{specText(item)}{item.note && ` — ${item.note}`}{releasedQty>0&&<strong style={{color:'#7c3aed'}}>　🟣 已釋出 {releasedQty}/{item.qty}</strong>}</span>
                <span style={{ textAlign:'right' }}>NT${Number(item.sale_price ?? item.price ?? 0).toLocaleString()}</span>
                <span style={{ textAlign:'center' }}>{releasedQty>0?`應取 ×${pickupQty}`:`×${item.qty}`}</span>
                <strong style={{ textAlign:'right',color:releasedQty>0?'#7c3aed':undefined }}>{pickupQty>0?`NT${Number(item.subtotal || 0).toLocaleString()}`:'已釋出'}</strong>
              </div>
            })}

            <div style={{ borderTop:'2px solid var(--border)',padding:'9px 12px',display:'flex',justifyContent:'flex-end',alignItems:'center',gap:18,background:'var(--surface-2)' }}>
              <span style={{ fontSize:12,color:'var(--text-secondary)' }}>取貨應收小計</span>
              <strong style={{ fontSize:16,color:'var(--indigo)' }}>NT${group.subtotal.toLocaleString()}</strong>
            </div>
          </div>
        ))}

        <div style={{ borderTop:'3px double var(--border)',marginTop:18,padding:'14px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--indigo-light)',borderRadius:10 }}>
          <strong>取貨應收總合計（{groups.length} 位客戶）</strong>
          <strong style={{ fontSize:22,color:'var(--indigo)' }}>NT${grandTotal.toLocaleString()}</strong>
        </div>
      </div>

      <div style={{ display:'flex',gap:10,justifyContent:'flex-end',marginTop:14 }}>
        <button className="btn btn-ghost" onClick={onClose}>關閉</button>
        <button className="btn btn-primary" onClick={printReceiptInIsolatedWindow}><Printer size={14}/>列印</button>
      </div>
    </Modal>
  )
}
