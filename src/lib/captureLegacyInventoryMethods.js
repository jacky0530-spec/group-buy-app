import { InventoryAPI } from './inventory'

const KEY=Symbol.for('group-buy.raw-inventory-methods')
if(!globalThis[KEY]){
  globalThis[KEY]={
    createHelperStockOrder:typeof InventoryAPI.createHelperStockOrder==='function'
      ? InventoryAPI.createHelperStockOrder.bind(InventoryAPI)
      : null,
  }
}

export function getRawInventoryMethods(){
  return globalThis[KEY]||{}
}
