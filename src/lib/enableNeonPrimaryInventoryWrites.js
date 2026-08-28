import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { InventoryAPI, normalizeStockSpec, stockSpecLabel } from './inventory'
import { neonInventoryRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-primary-inventory-writes-installed')
const nowISO=()=>new Date().toISOString()

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

async function mirror(label,fn){
  try{return await fn()}
  catch(err){console.error(`[Firestore mirror] ${label} failed after Neon success`,err);return null}
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  const firestoreReceive=InventoryAPI.receiveExtraPurchase
  const firestoreAdjust=InventoryAPI.adjustAvailable

  InventoryAPI.createExtraPurchase=async function({product,spec={},qty=1,note=''}){
    const amount=Math.max(1,Number(qty||1))
    if(!product?.id) throw new Error('請選擇商品')
    if(!Number.isInteger(amount)) throw new Error('額外叫貨數量必須是整數')
    const cleanSpec=normalizeStockSpec(spec)
    const id=randomLegacyId()
    const createdAt=nowISO()
    const row={
      id,product_id:product.id,product_name:product.name||'',supplier:product.supplier||'',
      spec:cleanSpec,spec_label:stockSpecLabel(cleanSpec),ordered_qty:amount,received_qty:0,
      unit_cost:Number(product.cost||0),note:String(note||'').trim(),status:'ordered',
      created_at:createdAt,updated_at:createdAt,
    }
    await neonInventoryRuntime('sync_extra',{row})
    await mirror('InventoryAPI.createExtraPurchase',()=>setDoc(doc(db,'stock_purchase_extras',id),{
      product_id:row.product_id,product_name:row.product_name,supplier:row.supplier,spec:row.spec,spec_label:row.spec_label,
      ordered_qty:row.ordered_qty,received_qty:0,unit_cost:row.unit_cost,note:row.note,status:'ordered',
      created_at:Timestamp.now(),updated_at:Timestamp.now(),
    }))
    return id
  }

  InventoryAPI.receiveExtraPurchase=async function(extraId){
    const list=await neonInventoryRuntime('list_extras')
    const extra=(list?.rows||[]).find(row=>row.id===extraId)
    if(!extra) throw new Error('Neon 找不到額外叫貨紀錄')
    const incoming=Math.max(0,Number(extra.ordered_qty||0)-Number(extra.received_qty||0))
    if(incoming<=0) throw new Error('此筆額外叫貨已全部入庫')
    const primary=await neonInventoryRuntime('receive_extra',{extra_id:extraId,qty:incoming,note:extra.note||'額外叫貨入庫'})
    await mirror('InventoryAPI.receiveExtraPurchase',()=>firestoreReceive.call(this,extraId))
    return {
      inventory_id:extra.stock_inventory_id||null,
      received:incoming,
      available:Number(primary?.result?.available_qty||0),
    }
  }

  InventoryAPI.adjustAvailable=async function(inventoryId,nextQty,note=''){
    const qty=Number(nextQty)
    if(!Number.isInteger(qty)||qty<0) throw new Error('現貨數量必須是 0 以上整數')
    const list=await neonInventoryRuntime('list_stock')
    const inventory=(list?.rows||[]).find(row=>row.id===inventoryId)
    if(!inventory) throw new Error('Neon 找不到要調整的庫存')
    const primary=await neonInventoryRuntime('set_stock',{
      product_id:inventory.product_id,spec:inventory.spec||{},available_qty:qty,note:String(note||'').trim()||'後台手動調整',
    })
    await mirror('InventoryAPI.adjustAvailable',()=>firestoreAdjust.call(this,inventoryId,qty,note))
    return primary?.result
  }
}
