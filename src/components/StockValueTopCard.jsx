import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Warehouse } from 'lucide-react'
import { neonHelperAdminRuntime } from '../lib/neonRuntime'

const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`

export default function StockValueTopCard(){
  const [target,setTarget]=useState(null)
  const [value,setValue]=useState(null)

  useEffect(()=>{
    const first=Array.from(document.querySelectorAll('.stat-card')).find(el=>String(el.textContent||'').includes('有效訂單總額'))
    setTarget(first?.parentElement||null)
  },[])

  useEffect(()=>{
    let active=true
    neonHelperAdminRuntime({action:'stock_support',movementLimit:1})
      .then(result=>{if(active)setValue(Number(result?.stockAsset?.inventoryCostValue||0))})
      .catch(()=>{if(active)setValue(0)})
    return()=>{active=false}
  },[])

  if(!target)return null
  return createPortal(
    <div className="stat-card" style={{background:'linear-gradient(135deg,#0ea5e9,#0369a1)'}}>
      <div style={{fontSize:11,fontWeight:700,opacity:.8}}>現貨庫存金額</div>
      <div style={{fontSize:21,fontWeight:900,marginTop:5}}>{value===null?'—':money(value)}</div>
      <Warehouse size={27} style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',opacity:.22}}/>
    </div>,
    target
  )
}
