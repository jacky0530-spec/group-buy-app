import { supabase } from './supabase'

function normalizeUser(user) {
  if (!user) return null
  const displayName =
    user.user_metadata?.display_name ||
    user.email?.split('@')[0] ||
    '使用者'
  return {
    ...user,
    uid: user.id,
    displayName,
  }
}

function normalizeAuthError(error) {
  if (!error) return new Error('登入失敗')
  const err = new Error(error.message || '登入失敗')
  const code = String(error.code || '').toLowerCase()
  const status = Number(error.status || 0)

  if (code.includes('invalid_credentials')) err.code = 'auth/invalid-credential'
  else if (code.includes('email_not_confirmed')) err.code = 'auth/email-not-confirmed'
  else if (code.includes('invalid_email')) err.code = 'auth/invalid-email'
  else if (status === 429 || code.includes('rate')) err.code = 'auth/too-many-requests'
  else err.code = error.code || 'auth/unknown'

  return err
}

export async function getAccountAccess(uid) {
  if (!uid) return { allowed: false, role: null, account: null }
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', uid)
    .maybeSingle()

  if (error || !data) {
    return { allowed: false, role: null, account: null }
  }

  return {
    allowed: data.disabled !== true,
    role: data.role || 'staff',
    account: data,
  }
}

export async function isEmailAllowed(uid) {
  const access = await getAccountAccess(uid)
  return access.allowed
}

export async function loginWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw normalizeAuthError(error)

  const user = normalizeUser(data.user)
  const access = await getAccountAccess(user?.id)
  if (!access.allowed) {
    await supabase.auth.signOut()
    throw new Error('此帳號沒有存取權限或已被停用，請聯繫管理員。')
  }
  return user
}

export async function logout() {
  const { error } = await supabase.auth.signOut()
  if (error) throw normalizeAuthError(error)
}

export function onAuthChange(callback) {
  let active = true

  supabase.auth.getSession().then(({ data }) => {
    if (active) callback(normalizeUser(data.session?.user || null))
  })

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (active) callback(normalizeUser(session?.user || null))
  })

  return () => {
    active = false
    data.subscription.unsubscribe()
  }
}

export async function createAccountUser({
  email,
  password,
  display_name,
  role = 'staff',
}) {
  const { data, error } = await supabase.functions.invoke('create-account', {
    body: { email, password, display_name, role },
  })
  if (error) throw new Error(error.message || '建立帳號失敗')
  if (data?.error) throw new Error(data.error)
  return data
}
