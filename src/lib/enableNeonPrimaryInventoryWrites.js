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

async function neonHelperStockOrder(payload){
  try{return await neonInventoryRuntime('create_helper_stock_order',payload)}
  catch(firstErr){
    console.warn('[Neon primary] helper stock order first attempt failed; retrying with same IDs',firstErr)
    return neonInventoryRuntime('create_helper_stock_order',payload)
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  InventoryAPI.listStock=async function(){
    const result=await neonInventoryRuntime('list_stock')
    if(!Array.isArray(result?.rows)) throw new Error('Neon 現貨回傳格式錯誤')
    return result.rows
  }

  InventoryAPI.listExtras=async function(){
    const result=await neonInventoryRuntime('list_extras')
    if(!Array.isArray(result?.rows)) throw new Error('Neon 額外叫貨回傳格式錯誤')
    return result.rows
  }

  InventoryAPI.listMovements=async function(limit=200){
    const result=await neonInventoryRuntime('list_movements',{limit})
    if(!Array.isArray(result?.rows)) throw new Error('Neon 庫存流水回傳格式錯誤')
    return result.rows
  }

  InventoryAPI.createExtraPurchase=async function({product,spec={},qty=1,note=''}){
    const amount=Math.max(1,Number(qty||1))
    if(!product?.id) throw new Error('請選擇商品')
    if(!Number.isInteger(amount)) throw new Error('額外叫貨數量必須是整數')
    const cleanSpec=normalizeStockSpec(spec)
    const id=randomLegacyId(),createdAt=nowISO()
    const row={id,product_id:product.id,product_name:product.name||'',supplier:product.supplier||'',spec:cleanSpec,spec_label:stockSpecLabel(cleanSpec),ordered_qty:amount,received_qty:0,unit_cost:Number(product.cost||0),note:String(note||'').trim(),status:'ordered',created_at:createdAt,updated_at:createdAt}
    await neonInventoryRuntime('sync_extra',{row})
    return id
  }

  InventoryAPI.receiveExtraPurchase=async function(extraId){
    const list=await neonInventoryRuntime('list_extras')
    const extra=(list?.rows||[]).find(row=>row.id===extraId)
    if(!extra) throw new Error('Neon 找不到額外叫貨紀錄')
    const incoming=Math.max(0,Number(extra.ordered_qty||0)-Number(extra.received_qty||0))
    if(incoming<=0) throw new Error('此筆額外叫貨已全部入庫')
    const primary=await neonInventoryRuntime('receive_extra',{extra_id:extraId,qty:incoming,note:extra.note||'額外叫貨入庫'})
    return {inventory_id:extra.stock_inventory_id||null,received:incoming,available:Number(primary?.result?.available_qty||0)}
  }

  InventoryAPI.adjustAvailable=async function(inventoryId,nextQty,note=''){
    const qty=Number(nextQty)
    if(!Number.isInteger(qty)||qty<0) throw new Error('現貨數量必須是 0 以上整數')
    const list=await neonInventoryRuntime('list_stock')
    const inventory=(list?.rows||[]).find(row=>row.id===inventoryId)
    if(!inventory) throw new Error('Neon 找不到要調整的庫存')
    const primary=await neonInventoryRuntime('set_stock',{product_id:inventory.product_id,spec:inventory.spec||{},available_qty:qty,note:String(note||'').trim()||'後台手動調整'})
    return primary?.result
  }

  InventoryAPI.createHelperStockOrder=async function({uid,displayName='',customer,inventory,qty=1,note=''}){
    const amount=Number(qty)
    if(!uid) throw new Error('登入狀態失效')
    if(!customer?.id) throw new Error('請選擇客戶')
    if(!inventory?.id||!inventory?.product_id) throw new Error('請選擇現貨商品')
    if(!Number.isInteger(amount)||amount<1) throw new Error('數量至少為 1')
    const orderId=randomLegacyId(),helperEntryId=randomLegacyId()
    const primary=await neonHelperStockOrder({order_id:orderId,helper_entry_id:helperEntryId,customer_id:customer.id,product_id:inventory.product_id,spec:inventory.spec||{},qty:amount,note:String(note||'').trim(),display_name:displayName})
    const result=primary?.result||{}
    if(result.order_id!==orderId) throw new Error('Neon 現貨訂單 ID 驗證失敗')
    return orderId
  }
}
