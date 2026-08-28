import { collection, doc, getDoc, Timestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { SupplierPaymentsAPI } from './db'
import { neonPaymentsRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-payment-writes-installed')

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

async function mirrorPayment(id,request,result){
  try{
    const allocations=Array.isArray(result?.allocations)?result.allocations:[]
    const byOrder=new Map()
    for(const a of allocations){
      if(!byOrder.has(a.order_id)) byOrder.set(a.order_id,[])
      byOrder.get(a.order_id).push(a)
    }
    const orderUpdates=[]
    for(const [orderId,rows] of byOrder.entries()){
      const ref=doc(db,'orders',orderId)
      const snap=await getDoc(ref)
      if(!snap.exists()) continue
      const items=[...(snap.data().items||[])]
      for(const a of rows){
        const index=Math.max(0,Number(a.item_index||0))
        if(!items[index]) continue
        const item={...items[index]}
        const costTotal=Number(item.cost_price||0)*Number(item.qty||0)
        const oldPaid=Math.max(0,Number(item.supplier_paid_amount||0))
        const nextPaid=Math.min(costTotal,oldPaid+Number(a.amount||0))
        item.supplier_paid_amount=nextPaid
        item.supplier_payment_status=nextPaid>=costTotal-0.01?'paid':nextPaid>0?'partial':'unpaid'
        item.supplier_payment_refs=[...new Set([...(item.supplier_payment_refs||[]),id])]
        item.supplier_paid_at=request.payment_date||new Date().toISOString().slice(0,10)
        items[index]=item
      }
      orderUpdates.push({ref,items})
    }

    const batch=writeBatch(db)
    for(const row of orderUpdates) batch.update(row.ref,{items:row.items,updated_at:Timestamp.now()})
    batch.set(doc(collection(db,'supplier_payments'),id),{
      supplier:String(request.supplier||'').trim(),
      payment_date:request.payment_date||new Date().toISOString().slice(0,10),
      amount:Number(request.amount||0),
      note:String(request.note||'').trim(),
      allocations:allocations.map(a=>({
        order_id:a.order_id,item_index:Number(a.item_index||0),customer_name:a.customer_name||'',
        product_name:a.product_name||'',supplier:a.supplier||request.supplier||'',amount:Number(a.amount||0),
      })),
      created_at:Timestamp.now(),updated_at:Timestamp.now(),
    })
    await batch.commit()
  }catch(err){
    console.error('[Firestore mirror] supplier payment failed after Neon success',err)
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  SupplierPaymentsAPI.createPayment=async function(request={}){
    const supplier=String(request.supplier||'').trim()
    const amount=Number(request.amount||0)
    if(!supplier) throw new Error('請選擇供應商')
    if(!(amount>0)) throw new Error('付款金額必須大於 0')
    if(!Array.isArray(request.lines)||!request.lines.length) throw new Error('請選擇付款明細')
    const id=randomLegacyId()
    const response=await neonPaymentsRuntime('create',{
      id,supplier,payment_date:request.payment_date||new Date().toISOString().slice(0,10),amount,
      note:String(request.note||'').trim(),lines:request.lines,
    })
    const result=response?.result||{}
    await mirrorPayment(id,request,result)
    return {id,amount,allocation_count:Number(result.allocation_count||result.allocations?.length||0)}
  }
}
