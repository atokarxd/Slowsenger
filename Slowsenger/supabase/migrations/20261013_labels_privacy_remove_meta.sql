-- 1. Defines the label and read-tracking tables (they existed only in the live DB, not in the repo).
-- 2. Removes the leftover Meta (Messenger / Instagram) integration.
-- 3. Stops exposing private profile data (email, phone, birthday) to other users.
--
-- Run the whole file at once in the Supabase SQL editor. It is a single transaction:
-- if any statement fails, nothing is changed.
--
-- WARNING: permanently deletes linked Meta accounts, synced Messenger/Instagram threads,
-- and the email copy in public.profiles (the real email stays in auth.users).

begin;

-- ─── 1. Labels and read tracking ─────────────────────────────────────────────
-- Created here if missing; if they were created by hand earlier, their policies and
-- foreign keys are replaced below so both cases end up with the same rules.

create table if not exists public.user_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- One label per conversation: (user_id, thread_id) is unique.
create table if not exists public.thread_labels (
  user_id uuid not null,
  thread_id uuid not null,
  label_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

create table if not exists public.thread_read_at (
  user_id uuid not null,
  thread_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('user_labels', 'thread_labels', 'thread_read_at')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'f'
      and conrelid in ('public.user_labels'::regclass, 'public.thread_labels'::regclass, 'public.thread_read_at'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- Remove rows that would violate the new constraints.
delete from public.user_labels l
where not exists (select 1 from auth.users u where u.id = l.user_id);

delete from public.thread_labels tl
where not exists (
    select 1 from public.unified_threads t
    where t.id = tl.thread_id and t.owner_user_id = tl.user_id
  )
  or not exists (
    select 1 from public.user_labels l
    where l.id = tl.label_id and l.user_id = tl.user_id
  );

delete from public.thread_read_at r
where not exists (
  select 1 from public.unified_threads t
  where t.id = r.thread_id and t.owner_user_id = r.user_id
);

delete from public.thread_labels a
using public.thread_labels b
where a.user_id = b.user_id and a.thread_id = b.thread_id and a.ctid < b.ctid;

delete from public.thread_read_at a
using public.thread_read_at b
where a.user_id = b.user_id and a.thread_id = b.thread_id and a.ctid < b.ctid;

-- Needed for upsert(onConflict: 'user_id,thread_id') when a hand-made table lacks it
-- (redundant with the primary key on a freshly created table, but harmless).
create unique index if not exists idx_thread_labels_user_thread on public.thread_labels (user_id, thread_id);
create unique index if not exists idx_thread_read_at_user_thread on public.thread_read_at (user_id, thread_id);

alter table public.user_labels
  add constraint user_labels_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.thread_labels
  add constraint thread_labels_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint thread_labels_thread_id_fkey
  foreign key (thread_id) references public.unified_threads(id) on delete cascade,
  add constraint thread_labels_label_id_fkey
  foreign key (label_id) references public.user_labels(id) on delete cascade;

alter table public.thread_read_at
  add constraint thread_read_at_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint thread_read_at_thread_id_fkey
  foreign key (thread_id) references public.unified_threads(id) on delete cascade;

create index if not exists idx_user_labels_user on public.user_labels (user_id);

alter table public.user_labels enable row level security;
alter table public.thread_labels enable row level security;
alter table public.thread_read_at enable row level security;

create policy "user_labels_owner_rw"
on public.user_labels
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- The conversation and the label must both belong to the caller.
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

-- ─── 2. Remove the Meta integration ──────────────────────────────────────────

drop table if exists public.linked_accounts;

-- Only internal direct threads ("user:<uuid>") remain. Synced Meta threads can no longer
-- be answered; their messages, labels and read markers are removed by cascade.
delete from public.unified_threads where external_thread_id not like 'user:%';

alter table public.unified_messages drop column if exists sender_external_id;
alter table public.unified_messages drop column if exists external_message_id;

-- Also drops the old (owner_user_id, platform, external_thread_id) unique constraint.
alter table public.unified_threads drop column if exists platform;

create unique index if not exists idx_threads_owner_external
  on public.unified_threads (owner_user_id, external_thread_id);

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

  -- Sender's outbound thread
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

  -- Recipient's inbound thread
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

-- ─── 3. Profiles: keep private data private ──────────────────────────────────

-- Anyone could look up a user's email by username. Login is email-only now.
drop function if exists public.get_login_email_for_username(text);

-- The email lives in auth.users; this copy was readable by every signed-in user.
-- Also drops idx_profiles_email_unique.
alter table public.profiles drop column if exists email;

-- Other users may only read these columns. The caller's own full row comes from get_my_profile().
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, username, avatar_url, created_at) on public.profiles to authenticated;

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

-- Make PostgREST pick up the dropped columns and functions right away.
notify pgrst, 'reload schema';

commit;
