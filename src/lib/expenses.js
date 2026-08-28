import { neonRuntime } from './neonRuntime'

export const EXPENSE_TYPES = [
  { id:'shipping', label:'運費', sign:1 },
  { id:'other', label:'其他費用', sign:1 },
  { id:'discount', label:'退費折讓', sign:-1 },
]

export function expenseSignedAmount(row) {
  const amount = Math.abs(Number(row?.amount || 0))
  return row?.type === 'discount' ? -amount : amount
}

function randomLegacyId(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes=new Uint8Array(20)
  if(globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes,b=>chars[b%chars.length]).join('')
}

export const ExpensesAPI = {
  async list({ includeArchived = false } = {}) {
    const result = await neonRuntime('list_expenses',{ includeArchived })
    if (!Array.isArray(result?.rows)) throw new Error('Neon 費用回傳格式錯誤')
    return result.rows
  },
  async create(data) {
    const id=randomLegacyId()
    const at=new Date().toISOString()
    const row={
      id,
      month:String(data.month || ''),
      supplier:String(data.supplier || '').trim(),
      type:String(data.type || 'shipping'),
      amount:Math.abs(Number(data.amount || 0)),
      note:String(data.note || '').trim(),
      active:true,
      created_at:at,
      updated_at:at,
    }
    const result=await neonRuntime('write_expense',{op:'create',id,row})
    return {...row,...(result?.result||{})}
  },
  async update(id, data) {
    const clean={...data}
    if(data.amount!=null) clean.amount=Math.abs(Number(data.amount||0))
    return (await neonRuntime('write_expense',{op:'update',id,data:clean}))?.result
  },
  async archive(id) {
    return (await neonRuntime('write_expense',{op:'archive',id}))?.result
  },
}
