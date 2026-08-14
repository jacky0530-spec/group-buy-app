-- 團購百貨管理系統：Supabase / PostgreSQL schema
-- 可重複執行的第一版基礎結構。正式環境前請先備份既有資料。

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('owner','staff')),
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key default (gen_random_uuid()::text),
  name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  category text not null default 'other' check (category in ('daily','frozen','clothing','biscuit','candy','other')),
  supplier text not null default '',
  note text not null default '',
  spec_mode text not null default 'none',
  spec_colors text[] not null default '{}',
  spec_sizes text[] not null default '{}',
  spec_flavors text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists products_active_name_unique
  on public.products (lower(name)) where active = true;
create index if not exists products_active_created_idx
  on public.products (active, created_at desc);

create table if not exists public.customers (
  id text primary key default (gen_random_uuid()::text),
  name text not null,
  line_nick text not null default '',
  fb_name text not null default '',
  phone text not null default '',
  note text not null default '',
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists customers_active_joined_idx
  on public.customers (active, joined_at desc);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_line_idx on public.customers (line_nick);
create index if not exists customers_fb_idx on public.customers (fb_name);

create table if not exists public.orders (
  id text primary key default (gen_random_uuid()::text),
  customer_id text references public.customers(id) on delete restrict,
  customer_name text not null,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','shipped','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','partial_refund','refunded')),
  payable_status text not null default 'unpaid' check (payable_status in ('unpaid','paid')),
  refund_amount numeric(12,2) not null default 0 check (refund_amount >= 0 and refund_amount <= total_amount),
  refunds jsonb not null default '[]'::jsonb check (jsonb_typeof(refunds) = 'array'),
  status_history jsonb not null default '[]'::jsonb check (jsonb_typeof(status_history) = 'array'),
  cancellation_reason text not null default '',
  archived boolean not null default false,
  order_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  archived_at timestamptz
);

create index if not exists orders_order_date_idx on public.orders (order_date desc);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_status_idx on public.orders (status, order_date desc);
create index if not exists orders_payment_idx on public.orders (payment_status, order_date desc);
create index if not exists orders_payable_idx on public.orders (payable_status, order_date desc);

-- RLS helper functions live outside the exposed public schema to avoid recursive accounts policies.
create or replace function private.has_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.accounts a
      where a.id = (select auth.uid())
        and a.disabled is not true
    );
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.accounts a
      where a.id = (select auth.uid())
        and a.disabled is not true
        and a.role = 'owner'
    );
$$;

revoke all on function private.has_access() from public, anon;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.has_access() to authenticated;
grant execute on function private.is_owner() to authenticated;

alter table public.accounts enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;

-- accounts：所有可用帳號可讀；只有 owner 可改角色/停用狀態；建立帳號由 Edge Function 的 service role 處理。
drop policy if exists accounts_select_allowed on public.accounts;
create policy accounts_select_allowed on public.accounts
  for select to authenticated
  using ((select private.has_access()));

drop policy if exists accounts_update_owner on public.accounts;
create policy accounts_update_owner on public.accounts
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- products
drop policy if exists products_select_allowed on public.products;
create policy products_select_allowed on public.products
  for select to authenticated
  using ((select private.has_access()));

drop policy if exists products_insert_allowed on public.products;
create policy products_insert_allowed on public.products
  for insert to authenticated
  with check ((select private.has_access()));

drop policy if exists products_update_allowed on public.products;
create policy products_update_allowed on public.products
  for update to authenticated
  using ((select private.has_access()))
  with check ((select private.has_access()));

-- customers
drop policy if exists customers_select_allowed on public.customers;
create policy customers_select_allowed on public.customers
  for select to authenticated
  using ((select private.has_access()));

drop policy if exists customers_insert_allowed on public.customers;
create policy customers_insert_allowed on public.customers
  for insert to authenticated
  with check ((select private.has_access()));

drop policy if exists customers_update_allowed on public.customers;
create policy customers_update_allowed on public.customers
  for update to authenticated
  using ((select private.has_access()))
  with check ((select private.has_access()));

-- orders
drop policy if exists orders_select_allowed on public.orders;
create policy orders_select_allowed on public.orders
  for select to authenticated
  using ((select private.has_access()));

drop policy if exists orders_insert_allowed on public.orders;
create policy orders_insert_allowed on public.orders
  for insert to authenticated
  with check ((select private.has_access()));

drop policy if exists orders_update_allowed on public.orders;
create policy orders_update_allowed on public.orders
  for update to authenticated
  using ((select private.has_access()))
  with check ((select private.has_access()));

-- Data API least-privilege grants. No DELETE is granted;歷史資料只能封存。
revoke all on public.accounts, public.products, public.customers, public.orders from anon;
revoke all on public.accounts, public.products, public.customers, public.orders from authenticated;

grant select on public.accounts to authenticated;
grant update (role, disabled, display_name, updated_at) on public.accounts to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update on public.orders to authenticated;

-- 訂單狀態原子更新
create or replace function public.set_order_status(
  p_order_id text,
  p_status text,
  p_reason text default ''
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  update public.orders
  set
    status = p_status,
    updated_at = now(),
    status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('status', p_status, 'at', now(), 'note', coalesce(p_reason, ''))
    ),
    shipped_at = case
      when p_status = 'shipped' then now()
      when p_status = 'pending' then null
      else shipped_at
    end,
    cancelled_at = case when p_status = 'cancelled' then now() else null end,
    cancellation_reason = case when p_status = 'cancelled' then coalesce(p_reason, '') else '' end
  where id = p_order_id;

  if not found then
    raise exception '找不到訂單';
  end if;
end;
$$;

create or replace function public.batch_set_order_status(
  p_ids text[],
  p_status text
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  affected integer;
begin
  update public.orders
  set
    status = p_status,
    updated_at = now(),
    status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('status', p_status, 'at', now(), 'note', '批次更新')
    ),
    shipped_at = case
      when p_status = 'shipped' then now()
      when p_status = 'pending' then null
      else shipped_at
    end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
  where id = any(p_ids);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.apply_order_refund(
  p_order_id text,
  p_amount numeric,
  p_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_total numeric;
  v_old numeric;
  v_new numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '退款金額必須大於 0';
  end if;

  select total_amount, refund_amount
  into v_total, v_old
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception '找不到訂單';
  end if;

  v_old := coalesce(v_old, 0);
  v_new := v_old + p_amount;

  if v_new > v_total then
    raise exception '累積退款金額不可超過訂單總額';
  end if;

  update public.orders
  set
    refund_amount = v_new,
    payment_status = case when v_new >= v_total then 'refunded' else 'partial_refund' end,
    refunded_at = now(),
    refunds = coalesce(refunds, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('amount', p_amount, 'note', coalesce(p_note, ''), 'at', now())
    ),
    updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.clear_order_refunds(p_order_id text)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  update public.orders
  set
    refund_amount = 0,
    refunds = '[]'::jsonb,
    refunded_at = null,
    payment_status = 'paid',
    updated_at = now()
  where id = p_order_id;

  if not found then
    raise exception '找不到訂單';
  end if;
end;
$$;

revoke all on function public.set_order_status(text,text,text) from public, anon;
revoke all on function public.batch_set_order_status(text[],text) from public, anon;
revoke all on function public.apply_order_refund(text,numeric,text) from public, anon;
revoke all on function public.clear_order_refunds(text) from public, anon;
grant execute on function public.set_order_status(text,text,text) to authenticated;
grant execute on function public.batch_set_order_status(text[],text) to authenticated;
grant execute on function public.apply_order_refund(text,numeric,text) to authenticated;
grant execute on function public.clear_order_refunds(text) to authenticated;
