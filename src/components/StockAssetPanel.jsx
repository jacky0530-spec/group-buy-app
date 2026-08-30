import { useCallback, useEffect, useState } from 'react'
import { Boxes, RefreshCw, ShoppingCart, TrendingUp, Truck, Warehouse } from 'lucide-react'
import { neonHelperAdminRuntime } from '../lib/neonRuntime'
import { useToast } from './UI'

const EMPTY={month:'',inventoryCostValue:0,purchaseValue:0,salesRevenue:0,cogs:0,grossProfit:0}
const money=value=>`NT$${Math.round(Number(value||0)).toLocaleString()}`

export default function StockAssetPanel(){
  const toast=useToast()
  const [data,setData]=useState(EMPTY)
  const [loading,setLoading]=useState(true)

  const load=useCallback(async()=>{
    setLoading(true)
    try{
      const result=await neonHelperAdminRuntime({action:'stock_support',movementLimit:20})
      setData({...EMPTY,...(result?.stockAsset||{})})
    }catch(err){
      toast('現貨庫存資產載入失敗：'+err.message,'error')
    }finally{
      setLoading(false)
    }
  },[toast])

  useEffect(()=>{load()},[load])

  const monthLabel=data.month?data.month.replace('-',' / '):'本月'
  const cards=[
    ['現貨庫存成本價值',data.inventoryCostValue,Warehouse,'目前可售庫存 × 庫存成本'],
    ['本月現貨進貨',data.purchaseValue,Truck,'只計實際 extra_receive 入庫成本'],
    ['本月現貨銷售',data.salesRevenue,ShoppingCart,'非取消正式現貨訂單淨銷售額'],
    ['現貨銷貨成本',data.cogs,Boxes,'本月現貨訂單成本快照'],
    ['現貨毛利',data.grossProfit,TrendingUp,'現貨銷售 − 現貨銷貨成本'],
  ]

  return <section className="card" style={{marginTop:18,marginBottom:18,border:'1px solid #bfdbfe',background:'linear-gradient(180deg,#f8fbff,#ffffff)'}}>
    <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <div><strong style={{fontSize:16}}>📦 現貨庫存資產</strong><div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>庫存資產為即時餘額；流量指標固定統計台北時間 {monthLabel}</div></div>
      <button className="btn btn-sm btn-ghost no-print" onClick={load} disabled={loading}><RefreshCw size={13}/>{loading?'更新中...':'重新整理'}</button>
    </div>
    <div className="card-body">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
        {cards.map(([label,value,Icon,note])=><div key={label} style={{padding:'14px 14px 12px',border:'1px solid var(--border)',borderRadius:12,background:'#fff',position:'relative',minHeight:100}}><div style={{fontSize:11,fontWeight:800,color:'var(--text-secondary)'}}>{label}</div><div style={{fontSize:22,fontWeight:900,marginTop:7,color:label==='現貨毛利'?(Number(value)>=0?'#047857':'#be123c'):'var(--text-primary)'}}>{loading?'—':money(value)}</div><div style={{fontSize:10,color:'var(--text-muted)',marginTop:7,lineHeight:1.4,paddingRight:26}}>{note}</div><Icon size={25} style={{position:'absolute',right:12,top:13,opacity:.16}}/></div>)}
      </div>
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:10,lineHeight:1.6}}>手動調整庫存不列為「現貨進貨」；取消現貨訂單不計銷售，並沿用既有還庫流程。庫存成本優先採庫存平均成本，缺值時依商品規格成本／商品成本補足。</div>
    </div>
  </section>
}
