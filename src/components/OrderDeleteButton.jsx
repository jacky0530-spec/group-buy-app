import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getAccountAccess } from '../lib/auth'
import { useAuth } from './AuthGuard'

export default function OrderDeleteButton({ order, onDeleted }) {
  const { user } = useAuth()
  const [isOwner, setIsOwner] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    async function loadRole() {
      if (!user?.uid) {
        if (active) setIsOwner(false)
        return
      }
      const access = await getAccountAccess(user.uid)
      if (active) setIsOwner(access.allowed && access.role === 'owner')
    }
    loadRole()
    return () => { active = false }
  }, [user?.uid])

  if (!isOwner) return null

  async function hardDelete() {
    const who = order?.customer_name || '此客戶'
    const first = window.confirm(`確定要永久刪除「${who}」這筆訂單？\n\n刪除後無法復原，也不會保留任何訂單紀錄。`)
    if (!first) return
    const second = window.confirm('再次確認：這是永久刪除，不是取消或封存。確定繼續？')
    if (!second) return

    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'orders', order.id))
      await onDeleted?.()
    } catch (err) {
      window.alert(`永久刪除失敗：${err.message}\n\n若顯示權限不足，請確認新版 Firestore Rules 已發布。`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      className="btn-icon btn"
      type="button"
      title="永久刪除訂單（僅負責人）"
      onClick={hardDelete}
      disabled={deleting}
      style={{ color:'var(--rose)' }}
    >
      <Trash2 size={12}/>
    </button>
  )
}
