export function normalizePhoneLast2(value) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  // 末碼是人工辨識欄位，不強制只能兩碼，也不移除前導 0。
  // 例如 00、000、007 都必須依使用者輸入原樣保存。
  if (/^\d+$/.test(raw)) return raw
  return raw
}

export function derivePhoneLast2(phone) {
  const digits = String(phone || '').replace(/\D/g,'')
  return digits.length >= 2 ? digits.slice(-2) : ''
}

export function getCustomerPhoneLast2(customer) {
  return normalizePhoneLast2(customer?.phone_last2 || derivePhoneLast2(customer?.phone))
}

export function customerMatchesSearch(customer, search) {
  const q = String(search || '').trim().toLowerCase()
  if (!q) return true
  const last2 = getCustomerPhoneLast2(customer).toLowerCase()
  return [
    customer?.name,
    customer?.line_nick,
    customer?.fb_name,
    customer?.phone,
    last2,
    customer?.note,
  ].some(value => String(value || '').toLowerCase().includes(q))
}

export function filterCustomers(customers, search) {
  const q = String(search || '').trim().toLowerCase()
  return (customers || [])
    .filter(customer => customerMatchesSearch(customer,q))
    .sort((a,b) => {
      if (!q) return String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant')
      const aLast = getCustomerPhoneLast2(a).toLowerCase()
      const bLast = getCustomerPhoneLast2(b).toLowerCase()
      const aScore = aLast === q ? 0 : String(a.name || '').toLowerCase().startsWith(q) ? 1 : 2
      const bScore = bLast === q ? 0 : String(b.name || '').toLowerCase().startsWith(q) ? 1 : 2
      return aScore - bScore || String(a.name || '').localeCompare(String(b.name || ''),'zh-Hant')
    })
}

export function customerSecondaryLabel(customer) {
  const parts = []
  const last2 = getCustomerPhoneLast2(customer)
  if (last2) parts.push(`末碼 ${last2}`)
  if (customer?.phone) parts.push(customer.phone)
  if (customer?.line_nick) parts.push(`Line: ${customer.line_nick}`)
  else if (customer?.fb_name) parts.push(`FB: ${customer.fb_name}`)
  return parts.join(' ｜ ')
}
