import { collection, doc, getDoc, getDocs, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { CustomersAPI, OrdersAPI, ProductsAPI, SupplierPaymentsAPI } from './db'
import { InventoryAPI } from './inventory'
import {
  bestEffortNeonCustomersSync,
  bestEffortNeonExtraReceive,
  bestEffortNeonExtraSync,
  bestEffortNeonHelperSync,
  bestEffortNeonInventorySync,
  bestEffortNeonOrderDelete,
  bestEffortNeonOrderSync,
  bestEffortNeonPaymentSync,
  bestEffortNeonStockConsume,
  bestEffortNeonStockSet,
  bestEffortNeonSync,
  neonRuntime,
} from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-dual-write-installed')

function clean(value){
  if(value==null) return value
  if(value instanceof Timestamp) return value.toDate().toISOString()
  if(typeof value?.toDate==='function') return value.toDate().toISOString()
  if(Array.isArray(value)) return value.map(clean)
  if(typeof value==='object'){
    const out={}
    for(const [key,item] of Object.entries(value)) out[key]=clean(item)
    return out
  }
  return value
}

async function readFirestoreDocument(collectionName,id){
  if(!id) return null
  const snap=await getDoc(doc(db,collectionName,id))
  if(!snap.exists()) return null
  return {id:snap.id,...clean(snap.data())}
}

async function syncFirestoreDocument(collectionName,id,action){
  if(!id) return null
  try{
    const row=await readFirestoreDocument(collectionName,id)
    if(!row) return null
    return await bestEffortNeonSync(action,row)
  }catch(err){
    console.error(`[Neon dual-write] ${collectionName}/${id} readback failed`,err)
    return null
  }
}

async function syncOrderId(id){
  if(!id) return null
  try{
    const row=await readFirestoreDocument('orders',id)
    if(!row) return null
    return await bestEffortNeonOrderSync(row)
  }catch(err){
    console.error(`[Neon dual-write] orders/${id} readback failed`,err)
    return null
  }
}

function wrapCrud(api,collectionName,action){
  for(const method of ['create','update','archive','restore']){
    const original=api[method]
    if(typeof original!=='function') continue
    api[method]=async function(...args){
      const result=await original.apply(this,args)
      const id=method==='create'?result?.id:args[0]
      await syncFirestoreDocument(collectionName,id,action)
      return result
    }
  }
}

function wrapCustomerImport(){
  const original=CustomersAPI.importRows
  if(typeof original!=='function') return
  CustomersAPI.importRows=async function(...args){
    const result=await original.apply(this,args)
    try{
      const snap=await getDocs(collection(db,'customers'))
      const rows=snap.docs.map(d=>({id:d.id,...clean(d.data())}))
      await bestEffortNeonCustomersSync(rows)
    }catch(err){
      console.error('[Neon dual-write] customer import resync failed',err)
    }
    return result
  }
}

function wrapOrders(){
  const singleIdMethods=[
    'create','update','updateArrival','updateStatus','updatePayment','updatePayable',
    'applyRefund','clearRefunds','archive','unarchive','updateItemQty',
  ]
  for(const method of singleIdMethods){
    const original=OrdersAPI[method]
    if(typeof original!=='function') continue
    OrdersAPI[method]=async function(...args){
      const result=await original.apply(this,args)
      const id=method==='create'?result?.id:args[0]
      await syncOrderId(id)
      return result
    }
  }

  if(typeof OrdersAPI.batchCreate==='function'){
    const original=OrdersAPI.batchCreate
    OrdersAPI.batchCreate=async function(...args){
      const result=await original.apply(this,args)
      for(const row of result||[]) await syncOrderId(row?.id)
      return result
    }
  }

  for(const method of ['batchUpdateStatus','updateVirtual']){
    const original=OrdersAPI[method]
    if(typeof original!=='function') continue
    OrdersAPI[method]=async function(...args){
      const result=await original.apply(this,args)
      const ids=Array.isArray(args[0])?args[0]:[]
      for(const id of ids) await syncOrderId(id)
      return result
    }
  }

  if(typeof OrdersAPI.bulkHardDelete==='function'){
    const original=OrdersAPI.bulkHardDelete
    OrdersAPI.bulkHardDelete=async function(...args){
      const ids=Array.isArray(args[0])?args[0]:[]
      const result=await original.apply(this,args)
      await bestEffortNeonOrderDelete(ids)
      return result
    }
  }
}

function wrapSupplierPayments(){
  const original=SupplierPaymentsAPI.createPayment
  if(typeof original!=='function') return
  SupplierPaymentsAPI.createPayment=async function(...args){
    const request=args[0]||{}
    const result=await original.apply(this,args)
    const orderIds=[...new Set((request.lines||[]).map(line=>line?.order_id).filter(Boolean))]
    for(const id of orderIds) await syncOrderId(id)
    try{
      const payment=await readFirestoreDocument('supplier_payments',result?.id)
      if(payment) await bestEffortNeonPaymentSync(payment)
    }catch(err){
      console.error(`[Neon dual-write] supplier_payments/${result?.id||''} readback failed`,err)
    }
    return result
  }
}

function wrapInventory(){
  if(typeof InventoryAPI.createExtraPurchase==='function'){
    const original=InventoryAPI.createExtraPurchase
    InventoryAPI.createExtraPurchase=async function(...args){
      const id=await original.apply(this,args)
      try{
        const row=await readFirestoreDocument('stock_purchase_extras',id)
        if(row) await bestEffortNeonExtraSync(row)
      }catch(err){console.error(`[Neon dual-write] stock_purchase_extras/${id} readback failed`,err)}
      return id
    }
  }

  if(typeof InventoryAPI.receiveExtraPurchase==='function'){
    const original=InventoryAPI.receiveExtraPurchase
    InventoryAPI.receiveExtraPurchase=async function(...args){
      const extraId=args[0]
      const result=await original.apply(this,args)
      try{
        const extra=await readFirestoreDocument('stock_purchase_extras',extraId)
        if(extra) await bestEffortNeonExtraSync(extra)
        const received=await bestEffortNeonExtraReceive({
          extra_id:extraId,
          qty:Number(result?.received||0),
          note:extra?.note||'額外叫貨入庫',
        })
        if(!received){
          const inventory=await readFirestoreDocument('stock_inventory',result?.inventory_id)
          if(inventory) await bestEffortNeonInventorySync(inventory)
        }
      }catch(err){console.error('[Neon dual-write] receive extra purchase transaction failed',err)}
      return result
    }
  }

  if(typeof InventoryAPI.adjustAvailable==='function'){
    const original=InventoryAPI.adjustAvailable
    InventoryAPI.adjustAvailable=async function(...args){
      const inventoryId=args[0]
      const result=await original.apply(this,args)
      try{
        const inventory=await readFirestoreDocument('stock_inventory',inventoryId)
        if(inventory){
          const adjusted=await bestEffortNeonStockSet({
            product_id:inventory.product_id,
            spec:inventory.spec||{},
            available_qty:Number(inventory.available_qty||0),
            note:inventory.adjustment_note||String(args[2]||'手動調整庫存'),
          })
          if(!adjusted) await bestEffortNeonInventorySync(inventory)
        }
      }catch(err){console.error(`[Neon dual-write] stock_inventory/${inventoryId} adjustment failed`,err)}
      return result
    }
  }

  if(typeof InventoryAPI.createHelperStockOrder==='function'){
    const original=InventoryAPI.createHelperStockOrder
    InventoryAPI.createHelperStockOrder=async function(...args){
      const request=args[0]||{}
      const orderId=await original.apply(this,args)
      await syncOrderId(orderId)
      try{
        const consumed=await bestEffortNeonStockConsume({
          order_id:orderId,
          product_id:request.inventory?.product_id,
          spec:request.inventory?.spec||{},
          qty:Number(request.qty||1),
          note:'小幫手現貨開單',
        })
        if(!consumed){
          const inventory=await readFirestoreDocument('stock_inventory',request.inventory?.id)
          if(inventory) await bestEffortNeonInventorySync(inventory)
        }
        const order=await readFirestoreDocument('orders',orderId)
        if(order?.helper_entry_id){
          const entry=await readFirestoreDocument('helper_entries',order.helper_entry_id)
          if(entry) await bestEffortNeonHelperSync(entry)
        }
      }catch(err){console.error('[Neon dual-write] helper stock order transaction failed',err)}
      return orderId
    }
  }
}

function wrapNeonFirstList(api,action,label){
  const firestoreList=api.list
  if(typeof firestoreList!=='function') return
  api.list=async function(options={}){
    try{
      const result=await neonRuntime(action,{includeArchived:options?.includeArchived===true})
      if(Array.isArray(result?.rows)) return result.rows
      throw new Error('Neon 回傳格式錯誤')
    }catch(err){
      console.error(`[Neon read fallback] ${label}`,err)
      return firestoreList.apply(this,[options])
    }
  }
}

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  wrapCrud(CustomersAPI,'customers','sync_customer')
  wrapCrud(ProductsAPI,'products','sync_product')
  wrapCustomerImport()
  wrapOrders()
  wrapSupplierPayments()
  wrapInventory()
  wrapNeonFirstList(CustomersAPI,'list_customers','customers')
  wrapNeonFirstList(ProductsAPI,'list_products','products')
}
