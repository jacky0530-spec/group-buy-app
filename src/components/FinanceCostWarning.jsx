import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { neonPaymentsRuntime } from '../lib/neonRuntime'

export default function FinanceCostWarning(){
  const [unknownCost,setUnknownCost]=useState(0)
  const [loaded,setLoaded]=useState(false)

  useEffect(()=>{
    let active=true
    neonPaymentsRuntime('dashboard')
      .then(result=>{
        if(!active)return
        setUnknownCost(Number(result?.summary?.unknownCost||0))
        setLoaded(true)
      })
      .catch(()=>{ if(active)setLoaded(true) })
    return()=>{active=false}
  },[])

  if(!loaded||unknownCost<=0)return null
  return <div style={{display:'flex',alignItems:'flex-start',gap:10,background:'#fff7ed',border:'1px solid #fdba74',borderRadius:12,padding:'12px 14px',marginBottom:14,color:'#9a3412',fontSize:13,lineHeight:1.65}}>
    <AlertTriangle size={20} style={{flex:'0 0 auto',marginTop:1}}/>
    <div><strong>目前有 {unknownCost} 筆商品成本待確認，毛利屬暫估值。</strong><br/>請到「供應商付款」確認單位成本；確認後銷售報表會依原銷售月份重新計算成本與毛利，實際付款月份只影響現金流。</div>
  </div>
}
