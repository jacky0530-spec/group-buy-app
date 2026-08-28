import { InventoryAPI } from './inventory'
import { neonInventoryRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-inventory-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true

  if(typeof InventoryAPI.listStock==='function'){
    const firestoreListStock=InventoryAPI.listStock
    InventoryAPI.listStock=async function(){
      try{
        const result=await neonInventoryRuntime('list_stock')
        if(Array.isArray(result?.rows)) return result.rows
        throw new Error('Neon 現貨回傳格式錯誤')
      }catch(err){
        console.error('[Neon read fallback] stock inventory',err)
        return firestoreListStock.apply(this,arguments)
      }
    }
  }

  if(typeof InventoryAPI.listExtras==='function'){
    const firestoreListExtras=InventoryAPI.listExtras
    InventoryAPI.listExtras=async function(){
      try{
        const result=await neonInventoryRuntime('list_extras')
        if(Array.isArray(result?.rows)) return result.rows
        throw new Error('Neon 額外叫貨回傳格式錯誤')
      }catch(err){
        console.error('[Neon read fallback] stock purchase extras',err)
        return firestoreListExtras.apply(this,arguments)
      }
    }
  }
}
