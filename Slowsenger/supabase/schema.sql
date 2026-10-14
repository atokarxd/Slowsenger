-- Full schema for Slowsenger, for a fresh database.
-- An existing database is upgraded with the files in supabase/migrations instead.

create extension if not exists pgcrypto;

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  first_name text,
  last_name text,
  username text,
  birthday date,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Every user has their own copy of a conversation. Direct conversations use
-- external_thread_id = 'user:<other user id>'.
create table if not exists public.unified_threads (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  external_thread_id text not null,
  title text,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.unified_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.unified_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  content text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- One label per conversation: (user_id, thread_id) is the primary key.
create table if not exists public.thread_labels (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.unified_threads(id) on delete cascade,
  label_id uuid not null references public.user_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

create table if not exists public.thread_read_at (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.unified_threads(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

create unique index if not exists idx_profiles_username_unique on public.profiles (username) where username is not null;
create unique index if not exists idx_threads_owner_external on public.unified_threads (owner_user_id, external_thread_id);
create index if not exists idx_threads_owner_last_message on public.unified_threads (owner_user_id, last_message_at desc);
create index if not exists idx_messages_thread_created on public.unified_messages (thread_id, created_at asc);
create index if not exists idx_user_labels_user on public.user_labels (user_id);

-- ─── Functions ───────────────────────────────────────────────────────────────

-- Creates the profile row when a user signs up (data comes from the sign-up metadata).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone, first_name, last_name, username, birthday)
  values (
    new.id,
    new.raw_user_meta_data ->> 'display_name',
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'username',
    nullif(new.raw_user_meta_data ->> 'birthday', '')::date
  )
  on conflict (id) do update
  set
    display_name = excluded.display_name,
    phone = excluded.phone,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    username = excluded.username,
    birthday = excluded.birthday;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

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

-- The caller's own full profile; other users' private columns are not readable (see grants below).
create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- Atomically sends a direct message: writes an outbound copy to the sender's thread and an
-- inbound copy to the recipient's thread. SECURITY DEFINER so it can write the recipient's rows.
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

  insert into public.unified_threads (owner_user_id, external_thread_id, title, last_message_at)
  values (
    v_sender_id,
    'user:' || p_recipient_id,
    (select display_name from public.profiles where id = p_recipient_id),
    now()
  )
  on conflict (owner_user_id, external_thread_id)
  do update set last_message_at = now()
  returning id into v_sender_thread;

  insert into public.unified_messages (thread_id, sender_user_id, content, direction)
  values (v_sender_thread, v_sender_id, p_content, 'outbound');

  insert into public.unified_threads (owner_user_id, external_thread_id, title, last_message_at)
  values (
    p_recipient_id,
    'user:' || v_sender_id,
    (select display_name from public.profiles where id = v_sender_id),
    now()
  )
  on conflict (owner_user_id, external_thread_id)
  do update set last_message_at = now()
  returning id into v_recipient_thread;

  insert into public.unified_messages (thread_id, sender_user_id, content, direction)
  values (v_recipient_thread, v_sender_id, p_content, 'inbound');
end;
$$;

revoke all on function public.send_direct_message(uuid, text) from public, anon;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.unified_threads enable row level security;
alter table public.unified_messages enable row level security;
alter table public.user_labels enable row level security;
alter table public.thread_labels enable row level security;
alter table public.thread_read_at enable row level security;

-- Signed-in users can see other profiles, but only the columns granted below.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, username, avatar_url, created_at) on public.profiles to authenticated;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
using (auth.uid() is not null);

drop policy if exists "profiles_insert_owner" on public.profiles;
create policy "profiles_insert_owner"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_owner" on public.profiles;
create policy "profiles_update_owner"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_owner" on public.profiles;
create policy "profiles_delete_owner"
on public.profiles for delete
using (auth.uid() = id);

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

drop policy if exists "user_labels_owner_rw" on public.user_labels;
create policy "user_labels_owner_rw"
on public.user_labels
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- The conversation and the label must both belong to the caller.
drop policy if exists "thread_labels_owner_rw" on public.thread_labels;
create policy "thread_labels_owner_rw"
on public.thread_labels
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.unified_threads t
    where t.id = thread_labels.thread_id and t.owner_user_id = auth.uid()
  )
  and exists (
    select 1 from public.user_labels l
    where l.id = thread_labels.label_id and l.user_id = auth.uid()
  )
);

drop policy if exists "thread_read_at_owner_rw" on public.thread_read_at;
create policy "thread_read_at_owner_rw"
on public.thread_read_at
for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.unified_threads t
    where t.id = thread_read_at.thread_id and t.owner_user_id = auth.uid()
  )
);
