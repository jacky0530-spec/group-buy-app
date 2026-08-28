import { arrayUnion, collection, doc, getDoc, getDocs, runTransaction, Timestamp } from 'firebase/firestore'
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
  bestEffortNeonStockOrderState,
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

const now=()=>Timestamp.now()
const nowISO=()=>new Date().toISOString()

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

function stockGroups(order){
  const groups=new Map()
  for(const item of order?.items||[]){
    if(item?.fulfillment_type!=='stock'&&!item?.stock_inventory_id) continue
    const inventoryId=String(item.stock_inventory_id||'').trim()
    if(!inventoryId) continue
    const qty=Math.max(1,Math.trunc(Number(item.qty||1)))
    groups.set(inventoryId,(groups.get(inventoryId)||0)+qty)
  }
  return [...groups.entries()].map(([inventoryId,qty])=>({inventoryId,qty}))
}

async function healNeonStockFromFirestore(groups){
  for(const group of groups){
    try{
      const inventory=await readFirestoreDocument('stock_inventory',group.inventoryId)
      if(inventory) await bestEffortNeonInventorySync(inventory)
    }catch(err){
      console.error(`[Neon heal] stock_inventory/${group.inventoryId}`,err)
    }
  }
}

async function updateStockOrderStatus(id,status,{reason=''}={}){
  const ref=doc(db,'orders',id)
  let groups=[]
  let wasCancelled=false
  await runTransaction(db,async tx=>{
    const orderSnap=await tx.get(ref)
    if(!orderSnap.exists()) throw new Error('找不到訂單')
    const order=orderSnap.data()
    groups=stockGroups(order)
    wasCancelled=order.status==='cancelled'
    const nextCancelled=status==='cancelled'
    const shouldRestore=!wasCancelled&&nextCancelled&&order.stock_inventory_state!=='restored'
    const shouldConsume=wasCancelled&&!nextCancelled&&order.stock_inventory_state==='restored'

    const inventoryRows=[]
    for(const group of groups){
      const inventoryRef=doc(db,'stock_inventory',group.inventoryId)
      const snap=await tx.get(inventoryRef)
      if(!snap.exists()) throw new Error(`找不到現貨庫存 ${group.inventoryId}`)
      inventoryRows.push({ ...group,ref:inventoryRef,data:snap.data() })
    }

    if(shouldConsume){
      for(const row of inventoryRows){
        const available=Math.max(0,Number(row.data.available_qty||0))
        if(available<row.qty) throw new Error(`現貨不足，無法恢復訂單。目前可售 ${available} 件，需要 ${row.qty} 件`)
      }
    }

    if(shouldRestore){
      for(const row of inventoryRows){
        const available=Math.max(0,Number(row.data.available_qty||0))
        tx.update(row.ref,{available_qty:available+row.qty,updated_at:now()})
      }
    }else if(shouldConsume){
      for(const row of inventoryRows){
        const available=Math.max(0,Number(row.data.available_qty||0))
        tx.update(row.ref,{available_qty:available-row.qty,updated_at:now()})
      }
    }

    const patch={
      status,
      updated_at:now(),
      status_history:arrayUnion({status,at:nowISO(),note:reason||''}),
    }
    if(status==='shipped'){
      patch.shipped_at=now();patch.cancelled_at=null;patch.cancellation_reason=''
      if(!['partial_refund','refunded'].includes(order.payment_status)) patch.payment_status='paid'
    }else if(status==='cancelled'){
      patch.cancelled_at=now();patch.cancellation_reason=reason||''
    }else if(status==='pending'){
      patch.shipped_at=null;patch.cancelled_at=null;patch.cancellation_reason=''
    }
    if(groups.length){
      if(shouldRestore) patch.stock_inventory_state='restored'
      else if(shouldConsume) patch.stock_inventory_state='consumed'
      else if(!order.stock_inventory_state) patch.stock_inventory_state=nextCancelled?'restored':'consumed'
      patch.stock_inventory_state_at=now()
    }
    tx.update(ref,patch)
  })

  await syncOrderId(id)
  if(groups.length&&wasCancelled!== (status==='cancelled')){
    const neonResult=await bestEffortNeonStockOrderState({order_id:id,cancelled:status==='cancelled'})
    if(!neonResult) await healNeonStockFromFirestore(groups)
  }
}

function wrapOrders(){
  const originalUpdateStatus=OrdersAPI.updateStatus
  const singleIdMethods=[
    'create','update','updateArrival','updatePayment','updatePayable',
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

  if(typeof originalUpdateStatus==='function'){
    OrdersAPI.updateStatus=async function(id,status,options={}){
      try{
        const snap=await getDoc(doc(db,'orders',id))
        const groups=snap.exists()?stockGroups(snap.data()):[]
        if(groups.length) return await updateStockOrderStatus(id,status,options)
      }catch(err){
        if(String(err?.message||'').includes('現貨不足')||String(err?.message||'').includes('找不到現貨庫存')) throw err
        console.error('[stock status] inspect failed, using normal status path',err)
      }
      const result=await originalUpdateStatus.apply(this,[id,status,options])
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

  if(typeof OrdersAPI.batchUpdateStatus==='function'){
    const original=OrdersAPI.batchUpdateStatus
    OrdersAPI.batchUpdateStatus=async function(ids,status,...rest){
      const targetIds=Array.isArray(ids)?ids:[]
      if(status==='cancelled'||status==='pending'){
        for(const id of targetIds) await OrdersAPI.updateStatus(id,status,...rest)
        return
      }
      const result=await original.apply(this,[ids,status,...rest])
      for(const id of targetIds) await syncOrderId(id)
      return result
    }
  }

  if(typeof OrdersAPI.updateVirtual==='function'){
    const original=OrdersAPI.updateVirtual
    OrdersAPI.updateVirtual=async function(...args){
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
