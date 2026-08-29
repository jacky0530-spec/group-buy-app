import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CustomersAPI } from '../lib/db'
import { HelperAPI } from '../lib/helper'
import { getCustomerPhoneLast2 } from '../lib/customerSearch'
import { useAuth } from './AuthGuard'

const SEARCH_HINT_RE = /(客戶|買家|姓名|手機|末碼|Line|FB|備註)/i
const NOTE_ATTR = 'data-customer-search-note'

const clean = value => String(value ?? '').trim()

function isCustomerSearchResult(element) {
  let parent = element.parentElement
  for (let depth = 0; parent && parent !== document.body && depth < 6; depth += 1, parent = parent.parentElement) {
    const inputs = parent.querySelectorAll('input[placeholder]')
    if (Array.from(inputs).some(input => SEARCH_HINT_RE.test(input.getAttribute('placeholder') || ''))) return true
  }
  return false
}

function findCustomerForElement(element, customers) {
  const content = clean(element.textContent).toLowerCase()
  if (!content) return null

  const nameMatches = customers.filter(customer => {
    const name = clean(customer?.name).toLowerCase()
    return name && content.includes(name)
  })
  if (!nameMatches.length) return null

  const lastMatches = nameMatches.filter(customer => {
    const last = clean(getCustomerPhoneLast2(customer)).toLowerCase()
    return last && content.includes(last)
  })
  if (lastMatches.length === 1) return lastMatches[0]
  if (nameMatches.length === 1) return nameMatches[0]
  return null
}

function appendNote(element, customer) {
  if (element.querySelector(`[${NOTE_ATTR}]`)) return
  const note = clean(customer?.note)
  if (!note) return

  const line = document.createElement('div')
  line.setAttribute(NOTE_ATTR, '1')
  line.textContent = `備註：${note}`
  line.style.marginTop = '4px'
  line.style.fontSize = '12px'
  line.style.lineHeight = '1.45'
  line.style.fontWeight = '800'
  line.style.color = '#b45309'
  line.style.whiteSpace = 'normal'
  line.style.wordBreak = 'break-word'

  // 訂單開立的 dropdown-item 本身是 flex，將備註放入主要文字區塊，
  // 其他搜尋結果按鈕則直接放在最下方。
  if (element.classList?.contains('dropdown-item')) {
    const host = Array.from(element.children).find(child => child.tagName === 'DIV') || element
    host.appendChild(line)
  } else {
    element.appendChild(line)
  }
}

function decorateCustomerSearchResults(customers) {
  if (!customers.length) return
  document.querySelectorAll('button, .dropdown-item').forEach(element => {
    if (element.hasAttribute(NOTE_ATTR) || element.querySelector(`[${NOTE_ATTR}]`)) return
    if (!isCustomerSearchResult(element)) return
    const customer = findCustomerForElement(element, customers)
    if (customer) appendNote(element, customer)
  })
}

export default function CustomerSearchNotes() {
  const { user, account } = useAuth()
  const { pathname } = useLocation()
  const [customers, setCustomers] = useState([])
  const frameRef = useRef(0)

  useEffect(() => {
    let active = true
    if (!user?.uid || !account?.role) {
      setCustomers([])
      return () => { active = false }
    }

    const load = async () => {
      try {
        const rows = account.role === 'helper'
          ? await HelperAPI.customers()
          : await CustomersAPI.list({ includeArchived:true })
        if (active) setCustomers(Array.isArray(rows) ? rows : [])
      } catch {
        if (active) setCustomers([])
      }
    }
    load()
    return () => { active = false }
  }, [user?.uid, account?.role, pathname])

  useEffect(() => {
    if (!customers.length) return undefined

    const schedule = () => {
      if (frameRef.current) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        decorateCustomerSearchResults(customers)
      })
    }

    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList:true, subtree:true })
    return () => {
      observer.disconnect()
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [customers, pathname])

  return null
}
