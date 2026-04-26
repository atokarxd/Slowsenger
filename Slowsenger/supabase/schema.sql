-- Core schema for Slowsenger unified inbox (Messenger + Instagram)

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  phone text,
  first_name text,
  last_name text,
  username text,
  birthday date,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.linked_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('messenger', 'instagram')),
  external_user_id text not null,
  external_username text,
  status text not null default 'connected' check (status in ('connected', 'revoked')),
  created_at timestamptz not null default now(),
  unique (user_id, platform, external_user_id)
);

create table if not exists public.unified_threads (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('messenger', 'instagram')),
  external_thread_id text not null,
  title text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_user_id, platform, external_thread_id)
);

create table if not exists public.unified_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.unified_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_external_id text,
  content text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists birthday date;

create or replace function public.get_login_email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public
as $$
  select p.email
  from public.profiles p
  where p.username = p_username
  limit 1;
$$;

revoke all on function public.get_login_email_for_username(text) from public;
grant execute on function public.get_login_email_for_username(text) to anon, authenticated;

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.profiles p
    where p.username = p_username
  );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function public.send_direct_message(
  p_recipient_id uuid,
  p_content      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id        uuid := auth.uid();
  v_sender_thread    uuid;
  v_recipient_thread uuid;
begin
  if v_sender_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_recipient_id = v_sender_id then
    raise exception 'Cannot send a message to yourself';
  end if;

  insert into public.unified_threads (owner_user_id, platform, external_thread_id, title, last_message_at)
  values (
    v_sender_id, 'messenger', 'user:' || p_recipient_id,
    (select display_name from public.profiles where id = p_recipient_id), now()
  )
  on conflict (owner_user_id, platform, external_thread_id)
  do update set last_message_at = now()
  returning id into v_sender_thread;

  insert into public.unified_messages (thread_id, sender_user_id, content, direction)
  values (v_sender_thread, v_sender_id, p_content, 'outbound');

  insert into public.unified_threads (owner_user_id, platform, external_thread_id, title, last_message_at)
  values (
    p_recipient_id, 'messenger', 'user:' || v_sender_id,
    (select display_name from public.profiles where id = v_sender_id), now()
  )
  on conflict (owner_user_id, platform, external_thread_id)
  do update set last_message_at = now()
  returning id into v_recipient_thread;

  insert into public.unified_messages (thread_id, sender_user_id, content, direction)
  values (v_recipient_thread, v_sender_id, p_content, 'inbound');
end;
$$;

revoke all on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

create index if not exists idx_linked_accounts_user on public.linked_accounts (user_id);
create index if not exists idx_threads_owner_last_message on public.unified_threads (owner_user_id, last_message_at desc);
create index if not exists idx_messages_thread_created on public.unified_messages (thread_id, created_at asc);
create unique index if not exists idx_profiles_email_unique on public.profiles (email) where email is not null;
create unique index if not exists idx_profiles_username_unique on public.profiles (username) where username is not null;

alter table public.profiles enable row level security;
alter table public.linked_accounts enable row level security;
alter table public.unified_threads enable row level security;
alter table public.unified_messages enable row level security;

drop policy if exists "profiles_owner_rw" on public.profiles;

create policy "profiles_select_authenticated"
on public.profiles for select
using (auth.uid() is not null);

create policy "profiles_insert_owner"
on public.profiles for insert
with check (auth.uid() = id);

create policy "profiles_update_owner"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "profiles_delete_owner"
on public.profiles for delete
using (auth.uid() = id);

drop policy if exists "linked_accounts_owner_rw" on public.linked_accounts;
create policy "linked_accounts_owner_rw"
on public.linked_accounts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "threads_owner_rw" on public.unified_threads;
create policy "threads_owner_rw"
on public.unified_threads
for all
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

drop policy if exists "messages_owner_rw" on public.unified_messages;
create policy "messages_owner_rw"
on public.unified_messages
for all
using (
  exists (
    select 1
    from public.unified_threads t
    where t.id = unified_messages.thread_id
      and t.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.unified_threads t
    where t.id = unified_messages.thread_id
      and t.owner_user_id = auth.uid()
  )
);
