import { createClient } from 'npm:@supabase/supabase-js@2.111.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization') || ''

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Supabase server secrets are missing' }, 500)
  }
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: '缺少登入憑證' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authHeader.slice('Bearer '.length)
  const { data: userResult, error: userError } = await admin.auth.getUser(token)
  const caller = userResult?.user
  if (userError || !caller) return json({ error: '登入憑證無效' }, 401)

  const { data: callerAccount, error: callerAccountError } = await admin
    .from('accounts')
    .select('role,disabled')
    .eq('id', caller.id)
    .maybeSingle()

  if (callerAccountError) return json({ error: callerAccountError.message }, 500)
  if (!callerAccount || callerAccount.disabled || callerAccount.role !== 'owner') {
    return json({ error: '只有負責人可以建立帳號' }, 403)
  }

  let body: { email?: string; password?: string; display_name?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: '請求格式錯誤' }, 400)
  }

  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const displayName = String(body.display_name || '').trim()
  const role = body.role === 'owner' ? 'owner' : 'staff'

  if (!email || !displayName) return json({ error: '姓名與 Email 為必填' }, 400)
  if (password.length < 6) return json({ error: '密碼至少 6 碼' }, 400)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })

  if (createError || !created.user) {
    return json({ error: createError?.message || '建立 Auth 使用者失敗' }, 400)
  }

  const { error: accountError } = await admin.from('accounts').insert({
    id: created.user.id,
    email,
    display_name: displayName,
    role,
    disabled: false,
  })

  if (accountError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: accountError.message }, 500)
  }

  return json({
    id: created.user.id,
    email,
    display_name: displayName,
    role,
  })
})
