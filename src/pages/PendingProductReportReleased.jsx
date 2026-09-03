import { useEffect, useRef } from 'react'
import { OrdersAPI } from '../lib/db'
import PendingProductReport from './PendingProductReportFiltered'

const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`

function releasedReportPage(page){
  return {
    ...page,
    rows:(page?.rows||[]).map(order=>({
      ...order,
      items:(order.items||[]).map(item=>{
        const qty=Math.max(0,Number(item.qty||0))
        const released=Math.min(qty,Math.max(0,Number(item.released_qty||0)))
        if(!(qty>0&&released>0))return item
        const originalName=String(item.original_product_name||item.product_name||item.name||'商品')
        const originalPrice=Number(item.sale_price??item.price??0)
        const pickupQty=Math.max(0,qty-released)
        const pickupRate=qty>0?pickupQty/qty:0
        const label=released>=qty
          ? `${originalName}　🟣 已釋出（原價 ${money(originalPrice)}）`
          : `${originalName}　🟣 已釋出 ${released}/${qty}（原價 ${money(originalPrice)}）`
        return {
          ...item,
          original_product_name:originalName,
          product_name:label,
          name:label,
          pickup_original_price:originalPrice,
          pickup_released_qty:released,
          pickup_qty:pickupQty,
          sale_price:originalPrice*pickupRate,
          price:originalPrice*pickupRate,
          subtotal:originalPrice*pickupQty,
        }
      }),
    })),
  }
}

export default function PendingProductReportReleased(){
  const originalRef=useRef(null)
  if(!originalRef.current){
    originalRef.current=OrdersAPI.searchPage
    const original=originalRef.current
    OrdersAPI.searchPage=async params=>releasedReportPage(await original(params))
  }

  useEffect(()=>()=>{
    if(originalRef.current)OrdersAPI.searchPage=originalRef.current
  },[])

  return <PendingProductReport/>
}
