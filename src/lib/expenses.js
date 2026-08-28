import { addDoc, collection, getDocs, getDoc, orderBy, query, Timestamp, updateDoc, doc } from 'firebase/firestore'
import { db } from './firebase'
import { bestEffortNeonSync, neonRuntime } from './neonRuntime'

const now = () => Timestamp.now()

function normalize(snap) {
  const data = { id:snap.id, ...snap.data() }
  for (const field of ['created_at','updated_at','archived_at']) {
    const value = data[field]
    if (value?.toDate) data[field] = value.toDate().toISOString()
  }
  return data
}

async function syncExpense(id) {
  try {
    const snap = await getDoc(doc(db,'expenses',id))
    if (!snap.exists()) return null
    return await bestEffortNeonSync('sync_expense', normalize(snap))
  } catch (err) {
    console.error(`[Neon dual-write] expenses/${id} readback failed`,err)
    return null
  }
}

async function listFirestore(includeArchived) {
  const snap = await getDocs(query(collection(db,'expenses'), orderBy('month','desc')))
  const rows = snap.docs.map(normalize)
  return includeArchived ? rows : rows.filter(row => row.active !== false)
}

export const EXPENSE_TYPES = [
  { id:'shipping', label:'運費', sign:1 },
  { id:'other', label:'其他費用', sign:1 },
  { id:'discount', label:'退費折讓', sign:-1 },
]

export function expenseSignedAmount(row) {
  const amount = Math.abs(Number(row?.amount || 0))
  return row?.type === 'discount' ? -amount : amount
}

export const ExpensesAPI = {
  async list({ includeArchived = false } = {}) {
    try {
      const result = await neonRuntime('list_expenses',{ includeArchived })
      if (Array.isArray(result?.rows)) return result.rows
      throw new Error('Neon 回傳格式錯誤')
    } catch (err) {
      console.error('[Neon read fallback] expenses',err)
      return listFirestore(includeArchived)
    }
  },
  async create(data) {
    const payload = {
      month:String(data.month || ''),
      supplier:String(data.supplier || '').trim(),
      type:String(data.type || 'shipping'),
      amount:Math.abs(Number(data.amount || 0)),
      note:String(data.note || '').trim(),
      active:true,
      created_at:now(),
      updated_at:now(),
    }
    const ref = await addDoc(collection(db,'expenses'), payload)
    await syncExpense(ref.id)
    return { id:ref.id, ...payload }
  },
  async update(id, data) {
    await updateDoc(doc(db,'expenses',id), {
      ...data,
      amount:data.amount == null ? undefined : Math.abs(Number(data.amount || 0)),
      updated_at:now(),
    })
    await syncExpense(id)
  },
  async archive(id) {
    await updateDoc(doc(db,'expenses',id), { active:false, archived_at:now(), updated_at:now() })
    await syncExpense(id)
  },
}
