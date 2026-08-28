import { InventoryAPI } from './inventory'
import { neonInventoryRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-inventory-read-installed')

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
}
