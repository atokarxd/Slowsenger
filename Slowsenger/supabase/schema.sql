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

-- ═══ Commitments ════════════════════════════════════════════════════════════
-- The same as migrations/20261116_commitments.sql.

-- Commitments ("vállalások") made from messages of a direct conversation: the thesis part of the
-- app. The state machine of docs/BUSINESS_RULES.md is enforced here, so a client cannot skip it:
-- both people of the conversation can read the tables, but every change goes through
-- create_commitment and apply_commitment_action, which check who may do what. The same rules run
-- in the browser too (src/app/core/commitments/lifecycle.ts), for an immediate answer; these
-- functions have the last word, with the same messages.

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  -- The two people of the conversation it comes from: both of them see it
  participant_ids uuid[] not null check (cardinality(participant_ids) = 2),
  title text not null check (length(trim(title)) > 0),
  -- null: the conversation does not say who; it has to be clarified, not guessed
  owner_id uuid references auth.users(id) on delete set null,
  -- null: no deadline was agreed. Without has_time it holds the day (its local midnight).
  due timestamptz,
  has_time boolean not null default false,
  -- overdue is not stored: it is an accepted commitment past its deadline
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'completed', 'rejected', 'withdrawn')),
  origin text not null default 'manual' check (origin in ('manual', 'detected')),
  -- The message it comes from: the creator's copy of it, its text and who wrote it
  source_message_id uuid references public.unified_messages(id) on delete set null,
  source_text text,
  source_author_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  -- null: taken on unasked
  requested_by uuid references auth.users(id) on delete set null,
  -- A change waiting for acceptance: {change: {title?, due?, has_time?, owner_id?}, proposed_by, at}.
  -- The commitment keeps its current values until then.
  pending_change jsonb,
  created_at timestamptz not null default now()
);

-- The history of every commitment; only ever appended to.
create table if not exists public.commitment_events (
  id bigint generated always as identity primary key,
  commitment_id uuid not null references public.commitments(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  from_status text not null,
  to_status text not null,
  reason text,
  -- For changes: the values before and after, with the keys of pending_change.change
  before jsonb,
  after jsonb
);

create index if not exists idx_commitments_participants on public.commitments using gin (participant_ids);
create index if not exists idx_commitment_events_commitment on public.commitment_events (commitment_id, id);

-- ─── Rules ───────────────────────────────────────────────────────────────────

-- When it is due: the end of the day when no time was agreed (24 hours after its midnight, so on the
-- two daylight-saving days of the year it is an hour off the local end of the day).
create or replace function public.commitment_deadline(p_due timestamptz, p_has_time boolean)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_due is null then null
    when p_has_time then p_due
    else p_due + interval '1 day' - interval '1 millisecond'
  end;
$$;

-- The status to show: an accepted commitment past its deadline is overdue.
create or replace function public.commitment_effective_status(c public.commitments, p_now timestamptz)
returns text
language sql
stable
as $$
  select case
    when c.status = 'accepted' and public.commitment_deadline(c.due, c.has_time) < p_now then 'overdue'
    else c.status
  end;
$$;

-- Who has to accept the pending change: a new owner takes it on themselves, the owner asks the one
-- who asked for it, anyone else asks the owner.
create or replace function public.commitment_change_approver(c public.commitments)
returns uuid
language sql
stable
as $$
  select case
    when c.pending_change is null then null
    when c.pending_change -> 'change' ? 'owner_id' then (c.pending_change -> 'change' ->> 'owner_id')::uuid
    when (c.pending_change ->> 'proposed_by')::uuid = c.owner_id then c.requested_by
    else c.owner_id
  end;
$$;

-- A change with only the fields it may set.
create or replace function public.commitment_clean_change(p_change jsonb)
returns jsonb
language sql
immutable
as $$
  select
    (case when p_change ? 'title' then jsonb_build_object('title', trim(p_change ->> 'title')) else '{}'::jsonb end)
    || (case when p_change ? 'due' then jsonb_build_object('due', p_change -> 'due') else '{}'::jsonb end)
    || (case when p_change ? 'has_time' then jsonb_build_object('has_time', p_change -> 'has_time') else '{}'::jsonb end)
    || (case when p_change ? 'owner_id' then jsonb_build_object('owner_id', p_change -> 'owner_id') else '{}'::jsonb end);
$$;

-- Whether the change would change anything.
create or replace function public.commitment_change_changes(c public.commitments, p_change jsonb)
returns boolean
language sql
stable
as $$
  select coalesce(
    (p_change ? 'title' and (p_change ->> 'title') is distinct from c.title)
    or (p_change ? 'due' and (p_change ->> 'due')::timestamptz is distinct from c.due)
    or (p_change ? 'has_time' and (p_change ->> 'has_time')::boolean is distinct from c.has_time)
    or (p_change ? 'owner_id' and (p_change ->> 'owner_id')::uuid is distinct from c.owner_id),
    false);
$$;

-- The values the change replaces, for the history (no owner when there was none).
create or replace function public.commitment_values(c public.commitments, p_change jsonb)
returns jsonb
language sql
stable
as $$
  select
    (case when p_change ? 'title' then jsonb_build_object('title', c.title) else '{}'::jsonb end)
    || (case when p_change ? 'due' then jsonb_build_object('due', c.due) else '{}'::jsonb end)
    || (case when p_change ? 'has_time' then jsonb_build_object('has_time', c.has_time) else '{}'::jsonb end)
    || (case when p_change ? 'owner_id' and c.owner_id is not null then jsonb_build_object('owner_id', c.owner_id) else '{}'::jsonb end);
$$;

create or replace function public.commitment_with_change(c public.commitments, p_change jsonb)
returns public.commitments
language plpgsql
stable
as $$
begin
  if p_change ? 'title' then c.title := p_change ->> 'title'; end if;
  if p_change ? 'due' then c.due := (p_change ->> 'due')::timestamptz; end if;
  if p_change ? 'has_time' then c.has_time := (p_change ->> 'has_time')::boolean; end if;
  if p_change ? 'owner_id' then c.owner_id := (p_change ->> 'owner_id')::uuid; end if;
  return c;
end;
$$;

-- ─── Changes ─────────────────────────────────────────────────────────────────

-- A proposal from a message of the caller's direct conversation with p_partner_id; the owner still
-- has to accept it. The message's text and author are taken from the message itself.
create or replace function public.create_commitment(
  p_partner_id uuid,
  p_title text,
  p_owner_id uuid,
  p_due timestamptz,
  p_has_time boolean,
  p_source_message_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_text text;
  v_author uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  -- Only with someone the caller has a conversation with
  if p_partner_id is null or p_partner_id = v_me
    or not exists (select 1 from public.profiles where id = p_partner_id)
    or not exists (
      select 1 from public.unified_threads
      where owner_user_id = v_me and external_thread_id = 'user:' || p_partner_id
    ) then
    raise exception 'Unknown conversation partner.';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'A commitment needs a title.';
  end if;
  if p_owner_id is not null and p_owner_id not in (v_me, p_partner_id) then
    raise exception 'The owner has to be in the conversation.';
  end if;

  if p_source_message_id is not null then
    -- Only a message of the caller's own copy of this conversation
    select m.content, m.sender_user_id into v_text, v_author
    from public.unified_messages m
    join public.unified_threads t on t.id = m.thread_id
    where m.id = p_source_message_id
      and t.owner_user_id = v_me
      and t.external_thread_id = 'user:' || p_partner_id;
    if not found then
      raise exception 'The message is not in this conversation.';
    end if;
  end if;

  insert into public.commitments (
    participant_ids, title, owner_id, due, has_time, status, origin,
    source_message_id, source_text, source_author_id, created_by, requested_by
  )
  values (
    array[v_me, p_partner_id], trim(p_title), p_owner_id, p_due, coalesce(p_has_time, false), 'proposed', 'manual',
    p_source_message_id, v_text, v_author, v_me,
    -- Asked for by whoever wrote the message, unless the owner wrote it themselves
    case when v_author is not null and v_author is distinct from p_owner_id then v_author end
  )
  returning id into v_id;

  insert into public.commitment_events (commitment_id, actor_id, action, from_status, to_status)
  values (v_id, v_me, 'create', 'proposed', 'proposed');

  return v_id;
end;
$$;

-- One step of the state machine as the caller: accept, reject, claim, complete, withdraw,
-- propose_change, accept_change or reject_change. p_payload: {reason} for reject and withdraw,
-- {owner_id} for claim, {change: {title?, due?, has_time?, owner_id?}} for propose_change.
create or replace function public.apply_commitment_action(
  p_commitment_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  c public.commitments;
  v_from text;
  v_is_owner boolean;
  v_change jsonb;
  v_reason text;
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select * into c from public.commitments where id = p_commitment_id for update;
  if not found or not (v_actor = any(c.participant_ids)) then
    raise exception 'Commitment not found.';
  end if;

  v_from := public.commitment_effective_status(c, v_now);
  v_is_owner := c.owner_id is not distinct from v_actor;
  p_payload := coalesce(p_payload, '{}'::jsonb);

  if v_from in ('completed', 'rejected', 'withdrawn') then
    raise exception 'A % commitment cannot change any more.', v_from;
  end if;

  case p_action
    when 'accept' then
      if v_from <> 'proposed' then raise exception 'Only a proposal can be accepted.'; end if;
      if c.owner_id is null then raise exception 'Nobody is named yet: take it on first.'; end if;
      if not v_is_owner then raise exception 'Only the person it is meant for can accept it.'; end if;
      c.status := 'accepted';

    when 'reject' then
      if v_from <> 'proposed' then
        raise exception 'Only a proposal can be rejected; withdraw an accepted commitment instead.';
      end if;
      if not (v_is_owner or (c.owner_id is null and c.created_by = v_actor)) then
        raise exception 'Only the person it is meant for can reject it.';
      end if;
      c.status := 'rejected';
      v_reason := nullif(trim(p_payload ->> 'reason'), '');

    when 'claim' then
      if v_from <> 'proposed' then raise exception 'Only a proposal can be taken on.'; end if;
      if c.owner_id is not null then raise exception 'It already has an owner.'; end if;
      if (p_payload ->> 'owner_id')::uuid is distinct from v_actor then
        raise exception 'You can only take it on yourself.';
      end if;
      -- Still a proposal: accepting it is a separate step
      c.owner_id := v_actor;

    when 'complete' then
      if v_from not in ('accepted', 'overdue') then raise exception 'Only an accepted commitment can be completed.'; end if;
      if not v_is_owner then raise exception 'Only the owner can mark it completed.'; end if;
      -- Also when overdue: lateness does not prevent completion
      c.status := 'completed';

    when 'withdraw' then
      if v_from not in ('accepted', 'overdue') then
        raise exception 'Only an accepted commitment can be withdrawn; reject a proposal instead.';
      end if;
      if not v_is_owner then raise exception 'Only the owner can withdraw it.'; end if;
      v_reason := nullif(trim(p_payload ->> 'reason'), '');
      if v_reason is null then raise exception 'Say why it is withdrawn: it stays on record.'; end if;
      c.status := 'withdrawn';

    when 'propose_change' then
      if v_from not in ('proposed', 'accepted', 'overdue') then raise exception 'This commitment cannot be changed.'; end if;
      if c.pending_change is not null then raise exception 'A change is already waiting for an answer.'; end if;
      v_change := public.commitment_clean_change(coalesce(p_payload -> 'change', '{}'::jsonb));
      if v_change ? 'title' and nullif(v_change ->> 'title', '') is null then
        raise exception 'A commitment needs a title.';
      end if;
      if v_change ? 'owner_id' and not ((v_change ->> 'owner_id')::uuid = any(c.participant_ids)) then
        raise exception 'The owner has to be in the conversation.';
      end if;
      if not public.commitment_change_changes(c, v_change) then
        raise exception 'The change does not change anything.';
      end if;
      if v_is_owner and c.requested_by is null and not (v_change ? 'owner_id') then
        -- Taken on unasked: the owner may change it, but as a new version on record
        v_before := public.commitment_values(c, v_change);
        c := public.commitment_with_change(c, v_change);
      else
        c.pending_change := jsonb_build_object('change', v_change, 'proposed_by', v_actor, 'at', v_now);
      end if;
      v_after := v_change;

    when 'accept_change' then
      if c.pending_change is null then raise exception 'There is no change waiting.'; end if;
      if public.commitment_change_approver(c) is distinct from v_actor then
        raise exception 'Someone else has to accept this change.';
      end if;
      v_change := c.pending_change -> 'change';
      v_before := public.commitment_values(c, v_change);
      c := public.commitment_with_change(c, v_change);
      c.pending_change := null;
      v_after := v_change;

    when 'reject_change' then
      if c.pending_change is null then raise exception 'There is no change waiting.'; end if;
      if public.commitment_change_approver(c) is distinct from v_actor
        and (c.pending_change ->> 'proposed_by')::uuid is distinct from v_actor then
        raise exception 'Only the one asked or the one asking can turn the change down.';
      end if;
      v_after := c.pending_change -> 'change';
      c.pending_change := null;

    else
      raise exception 'Unknown action: %', p_action;
  end case;

  update public.commitments
  set title = c.title, owner_id = c.owner_id, due = c.due, has_time = c.has_time,
      status = c.status, pending_change = c.pending_change
  where id = c.id;

  insert into public.commitment_events (commitment_id, at, actor_id, action, from_status, to_status, reason, before, after)
  values (c.id, v_now, v_actor, p_action, v_from, public.commitment_effective_status(c, v_now), v_reason, v_before, v_after);
end;
$$;

revoke all on function public.create_commitment(uuid, text, uuid, timestamptz, boolean, uuid) from public, anon;
grant execute on function public.create_commitment(uuid, text, uuid, timestamptz, boolean, uuid) to authenticated;
revoke all on function public.apply_commitment_action(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_commitment_action(uuid, text, jsonb) to authenticated;

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table public.commitments enable row level security;
alter table public.commitment_events enable row level security;

-- Read only, and only by the two people of the conversation; changes go through the functions above.
-- All revoked first: Supabase grants everything by default, truncate too, which RLS does not cover.
revoke all on public.commitments, public.commitment_events from anon, authenticated;
grant select on public.commitments, public.commitment_events to authenticated;

drop policy if exists "commitments_select_participants" on public.commitments;
create policy "commitments_select_participants"
on public.commitments for select
using (auth.uid() = any(participant_ids));

drop policy if exists "commitment_events_select_participants" on public.commitment_events;
create policy "commitment_events_select_participants"
on public.commitment_events for select
using (
  exists (
    select 1 from public.commitments c
    where c.id = commitment_events.commitment_id and auth.uid() = any(c.participant_ids)
  )
);

-- ═══ Chat features ═══════════════════════════════════════════════════════════
-- What the chat learned in the offline version (SlowsengerOffline), in the database: replies, GIFs and
-- files, commitment invite cards, group conversations, nicknames, and messages sent later.
-- Run it once in the Supabase SQL editor; running it again changes nothing. It is also at the end of
-- schema.sql, so the two must be kept the same.
--
-- Two parts need Supabase services and are skipped (with a notice) where those are missing:
--   * the chat-files Storage bucket and its policies (attached files);
--   * the pg_cron job that sends scheduled messages every minute. Without it they still go out while
--     their sender has the app open (deliver_my_due_messages), as in the offline version.

-- ─── Messages: what a message can carry besides its text ─────────────────────

alter table public.unified_messages
  -- The message is a commitment card: it shows this commitment (content is its plain-text summary)
  add column if not exists commitment_id uuid references public.commitments(id) on delete set null,
  -- A GIF ({kind: 'gif', giphyId, title, url, width, height}) or a file ({kind: 'file', fileId, name,
  -- size, type}; fileId is its path in the chat-files bucket)
  add column if not exists attachment jsonb,
  -- The message it answers: {sender_user_id, created_at, preview}, the same in every copy
  add column if not exists reply_to jsonb;

-- ─── Groups ──────────────────────────────────────────────────────────────────
-- Every member has their own copy of a group conversation, as with direct ones: a thread with
-- external_thread_id = 'group:<group id>', and a copy of each message in it.

create table if not exists public.chat_groups (
  id uuid primary key default gen_random_uuid(),
  -- The members' first names at the start ("Anna, Péter")
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_group_members (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_chat_group_members_user on public.chat_group_members (user_id);

-- ─── Nicknames ───────────────────────────────────────────────────────────────
-- A nickname someone has in a conversation; everyone in the conversation sees it. conversation is
-- 'dm:<id>:<id>' (the two people, the smaller id first) or 'group:<group id>' (conversationKey in
-- src/app/core/supabase/conversation-key.ts).

create table if not exists public.conversation_nicknames (
  conversation text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (length(nickname) between 1 and 40),
  set_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (conversation, user_id)
);

-- ─── Send later ──────────────────────────────────────────────────────────────

-- A message waiting to be sent at send_at, to a person or into a group; only its sender sees it until then.
create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- A person's id or a group's (no foreign key: it may be either)
  recipient_user_id uuid not null,
  content text not null check (length(trim(content)) > 0),
  send_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_scheduled_messages_due on public.scheduled_messages (send_at);
create index if not exists idx_scheduled_messages_sender on public.scheduled_messages (sender_user_id, recipient_user_id);

-- ─── Who is in a conversation ────────────────────────────────────────────────

-- SECURITY DEFINER: the membership table's own policy uses it, and it must not run into itself.
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_group_members where group_id = p_group_id and user_id = p_user_id
  );
$$;

-- The key of two people's conversation, the same for both of them (conversationKey in the client).
create or replace function public.dm_key(p_a uuid, p_b uuid)
returns text
language sql
immutable
as $$
  select 'dm:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text;
$$;

-- Whether someone takes part in a conversation, given by its key: a member of the group, or one of the
-- two (different, existing) people of a 'dm:' key written the way dm_key writes it.
create or replace function public.in_conversation(p_user_id uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_a uuid;
  v_b uuid;
begin
  if p_user_id is null or p_key is null then
    return false;
  end if;
  if p_key like 'group:%' then
    return public.is_group_member(substr(p_key, 7)::uuid, p_user_id);
  end if;
  v_parts := string_to_array(p_key, ':');
  if cardinality(v_parts) <> 3 or v_parts[1] <> 'dm' then
    return false;
  end if;
  v_a := v_parts[2]::uuid;
  v_b := v_parts[3]::uuid;
  return p_key = public.dm_key(v_a, v_b)
    and v_a <> v_b
    and p_user_id in (v_a, v_b)
    and (select count(*) from public.profiles where id in (v_a, v_b)) = 2;
exception
  when invalid_text_representation then
    return false;
end;
$$;

-- ─── Sending ─────────────────────────────────────────────────────────────────

-- What a reply may keep of the message it answers, and nothing else.
create or replace function public.clean_reply_ref(p_reply jsonb)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_reply is null or jsonb_typeof(p_reply) <> 'object' then
    return null;
  end if;
  return jsonb_build_object(
    'sender_user_id', (p_reply ->> 'sender_user_id')::uuid,
    'created_at', (p_reply ->> 'created_at')::timestamptz,
    'preview', left(coalesce(p_reply ->> 'preview', ''), 140)
  );
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'The message replied to is not valid.';
end;
$$;

-- What an attachment may say about itself, and nothing else. A file must be in the folder of the
-- conversation it is sent into (p_folder), which only that conversation's people can read.
create or replace function public.clean_attachment(p_attachment jsonb, p_folder text)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_attachment is null then
    return null;
  end if;
  if p_attachment ->> 'kind' = 'gif' and coalesce(p_attachment ->> 'url', '') ~ '^https://[a-z0-9.]*giphy\.com/' then
    return jsonb_build_object(
      'kind', 'gif',
      'giphyId', left(coalesce(p_attachment ->> 'giphyId', ''), 64),
      'title', left(coalesce(p_attachment ->> 'title', ''), 140),
      'url', left(p_attachment ->> 'url', 500),
      'width', coalesce((p_attachment ->> 'width')::int, 200),
      'height', coalesce((p_attachment ->> 'height')::int, 200)
    );
  end if;
  if p_attachment ->> 'kind' = 'file' and (p_attachment ->> 'fileId') like p_folder || '/%' then
    return jsonb_build_object(
      'kind', 'file',
      'fileId', p_attachment ->> 'fileId',
      'name', left(coalesce(nullif(p_attachment ->> 'name', ''), 'file'), 200),
      'size', coalesce((p_attachment ->> 'size')::bigint, 0),
      'type', left(coalesce(nullif(p_attachment ->> 'type', ''), 'application/octet-stream'), 100)
    );
  end if;
  raise exception 'The attachment is not valid.';
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'The attachment is not valid.';
end;
$$;

-- Writes a message from p_sender_id into every copy of the conversation: the sender's (outbound) and the
-- recipient's, or every group member's (inbound). All copies have the same created_at, by which a reply
-- finds the answered message in each copy. Returns the id of the sender's copy. Not callable from the
-- client: send_direct_message, send_commitment_invite and the send-later functions use it, after
-- checking who is asking.
create or replace function public.deliver_message(
  p_sender_id uuid,
  p_recipient_id uuid,
  p_content text,
  p_commitment_id uuid default null,
  p_attachment jsonb default null,
  p_reply_to jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_group public.chat_groups;
  v_member uuid;
  v_thread uuid;
  v_id uuid;
  v_sent uuid;
begin
  if p_sender_id is null or p_recipient_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_sender_id = p_recipient_id then
    raise exception 'Cannot send a message to yourself';
  end if;

  select * into v_group from public.chat_groups where id = p_recipient_id;
  if found then
    if not public.is_group_member(v_group.id, p_sender_id) then
      raise exception 'new row violates row-level security policy';
    end if;
    for v_member in
      select user_id from public.chat_group_members where group_id = v_group.id order by user_id
    loop
      insert into public.unified_threads (owner_user_id, external_thread_id, title, last_message_at)
      values (v_member, 'group:' || v_group.id, v_group.name, v_now)
      on conflict (owner_user_id, external_thread_id) do update set last_message_at = v_now
      returning id into v_thread;
      insert into public.unified_messages
        (thread_id, sender_user_id, content, direction, created_at, commitment_id, attachment, reply_to)
      values
        (v_thread, p_sender_id, p_content, case when v_member = p_sender_id then 'outbound' else 'inbound' end,
         v_now, p_commitment_id, p_attachment, p_reply_to)
      returning id into v_id;
      if v_member = p_sender_id then
        v_sent := v_id;
      end if;
    end loop;
    return v_sent;
  end if;

  if not exists (select 1 from public.profiles where id = p_recipient_id) then
    raise exception 'Recipient not found';
  end if;

  insert into public.unified_threads (owner_user_id, external_thread_id, title, last_message_at)
  values (p_sender_id, 'user:' || p_recipient_id, (select display_name from public.profiles where id = p_recipient_id), v_now)
  on conflict (owner_user_id, external_thread_id) do update set last_message_at = v_now
  returning id into v_thread;
  insert into public.unified_messages
    (thread_id, sender_user_id, content, direction, created_at, commitment_id, attachment, reply_to)
  values (v_thread, p_sender_id, p_content, 'outbound', v_now, p_commitment_id, p_attachment, p_reply_to)
  returning id into v_sent;

  insert into public.unified_threads (owner_user_id, external_thread_id, title, last_message_at)
  values (p_recipient_id, 'user:' || p_sender_id, (select display_name from public.profiles where id = p_sender_id), v_now)
  on conflict (owner_user_id, external_thread_id) do update set last_message_at = v_now
  returning id into v_thread;
  insert into public.unified_messages
    (thread_id, sender_user_id, content, direction, created_at, commitment_id, attachment, reply_to)
  values (v_thread, p_sender_id, p_content, 'inbound', v_now, p_commitment_id, p_attachment, p_reply_to);

  return v_sent;
end;
$$;

revoke all on function public.deliver_message(uuid, uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- Sends a message as the caller to a person or into a group they are in; with p_reply_to it answers
-- that message, with p_attachment a GIF or a file goes with it. Replaces the two-argument version.
drop function if exists public.send_direct_message(uuid, text);

create or replace function public.send_direct_message(
  p_recipient_id uuid,
  p_content text,
  p_reply_to jsonb default null,
  p_attachment jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  v_key := case
    when exists (select 1 from public.chat_groups where id = p_recipient_id) then 'group:' || p_recipient_id
    else public.dm_key(v_me, p_recipient_id)
  end;
  perform public.deliver_message(
    v_me, p_recipient_id, p_content, null,
    public.clean_attachment(p_attachment, replace(v_key, ':', '_')),
    public.clean_reply_ref(p_reply_to)
  );
end;
$$;

revoke all on function public.send_direct_message(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.send_direct_message(uuid, text, jsonb, jsonb) to authenticated;

-- ─── Commitment invites ──────────────────────────────────────────────────────

-- An invite: a proposal for the caller and p_partner_id, and a card for it in their conversation, made
-- together. The card (the caller's copy) is the commitment's source message. Asked for by the caller,
-- unless they are the one to do it. Returns the commitment's id.
create or replace function public.send_commitment_invite(
  p_partner_id uuid,
  p_title text,
  p_owner_id uuid,
  p_due timestamptz,
  p_has_time boolean,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_text text;
  v_card uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.chat_groups where id = p_partner_id) then
    raise exception 'Commitment invites are one-to-one for now.';
  end if;
  if p_partner_id is null or p_partner_id = v_me
    or not exists (select 1 from public.profiles where id = p_partner_id) then
    raise exception 'Unknown conversation partner.';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'A commitment needs a title.';
  end if;
  if p_owner_id is not null and p_owner_id not in (v_me, p_partner_id) then
    raise exception 'The owner has to be in the conversation.';
  end if;

  insert into public.commitments (
    participant_ids, title, owner_id, due, has_time, status, origin, created_by, requested_by
  )
  values (
    array[v_me, p_partner_id], trim(p_title), p_owner_id, p_due, coalesce(p_has_time, false), 'proposed', 'manual',
    v_me, case when p_owner_id = v_me then null else v_me end
  )
  returning id into v_id;

  insert into public.commitment_events (commitment_id, actor_id, action, from_status, to_status)
  values (v_id, v_me, 'create', 'proposed', 'proposed');

  v_text := coalesce(nullif(trim(p_content), ''), 'Commitment invite: ' || trim(p_title));
  v_card := public.deliver_message(v_me, p_partner_id, v_text, v_id);
  update public.commitments
  set source_message_id = v_card, source_text = v_text, source_author_id = v_me
  where id = v_id;

  return v_id;
end;
$$;

revoke all on function public.send_commitment_invite(uuid, text, uuid, timestamptz, boolean, text) from public, anon;
grant execute on function public.send_commitment_invite(uuid, text, uuid, timestamptz, boolean, text) to authenticated;

-- ─── Groups: start, list, leave ──────────────────────────────────────────────

-- Starts a group of the caller and at least two others with its first message: a group only comes about
-- (and shows in the others' lists) once something is written in it. If these very people already have a
-- group, the message goes there. Returns {id, name, member_ids}.
create or replace function public.create_group_with_message(p_member_ids uuid[], p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_others uuid[];
  v_all uuid[];
  v_group uuid;
  v_name text;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  -- The others, each once, in the order given, only existing people
  select coalesce(array_agg(person order by first_at), '{}') into v_others
  from (
    select m.person, min(m.position) as first_at
    from unnest(p_member_ids) with ordinality as m(person, position)
    where m.person is distinct from v_me and exists (select 1 from public.profiles where id = m.person)
    group by m.person
  ) given;
  if cardinality(v_others) < 2 then
    raise exception 'Pick at least two people.';
  end if;
  if nullif(trim(p_content), '') is null then
    raise exception 'Write something to start the group.';
  end if;
  v_all := array_prepend(v_me, v_others);

  -- These people's group, if they have one
  select g.id, g.name into v_group, v_name
  from public.chat_groups g
  where (select array_agg(user_id order by user_id) from public.chat_group_members where group_id = g.id)
      = (select array_agg(person order by person) from unnest(v_all) as person)
  order by g.created_at
  limit 1;

  if v_group is null then
    select string_agg(coalesce(split_part(p.display_name, ' ', 1), '?'), ', ' order by o.position)
    into v_name
    from unnest(v_others) with ordinality as o(person, position)
    join public.profiles p on p.id = o.person;
    insert into public.chat_groups (name, created_by) values (v_name, v_me) returning id into v_group;
    insert into public.chat_group_members (group_id, user_id) select v_group, person from unnest(v_all) as person;
  end if;

  perform public.deliver_message(v_me, v_group, p_content);
  return jsonb_build_object('id', v_group, 'name', v_name, 'member_ids', to_jsonb(v_all));
end;
$$;

revoke all on function public.create_group_with_message(uuid[], text) from public, anon;
grant execute on function public.create_group_with_message(uuid[], text) to authenticated;

-- The caller's groups, with everyone in them (the caller too), oldest first.
create or replace function public.my_groups()
returns table (group_id uuid, group_name text, member_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name,
    array(select m2.user_id from public.chat_group_members m2 where m2.group_id = g.id order by m2.joined_at, m2.user_id)
  from public.chat_groups g
  join public.chat_group_members m on m.group_id = g.id and m.user_id = auth.uid()
  order by g.created_at;
$$;

revoke all on function public.my_groups() from public, anon;
grant execute on function public.my_groups() to authenticated;

-- Leaves a group: the caller is no longer in it, and their own copy of it goes (the thread, with its
-- messages, label and read mark; their messages waiting to be sent to it; their nickname there). The
-- others keep the group; the last one to leave deletes it, with its nicknames.
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_key text := 'group:' || p_group_id;
begin
  if v_me is null or not public.is_group_member(p_group_id, v_me) then
    raise exception 'new row violates row-level security policy';
  end if;
  delete from public.chat_group_members where group_id = p_group_id and user_id = v_me;
  delete from public.unified_threads where owner_user_id = v_me and external_thread_id = v_key;
  delete from public.scheduled_messages where sender_user_id = v_me and recipient_user_id = p_group_id;
  delete from public.conversation_nicknames where conversation = v_key and user_id = v_me;
  if not exists (select 1 from public.chat_group_members where group_id = p_group_id) then
    delete from public.conversation_nicknames where conversation = v_key;
    delete from public.chat_groups where id = p_group_id;
  end if;
end;
$$;

revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

-- ─── Nicknames: set ──────────────────────────────────────────────────────────

-- Gives p_user_id a nickname in a conversation both they and the caller are in; an empty one takes it
-- away (and returns null).
create or replace function public.set_nickname(p_conversation text, p_user_id uuid, p_nickname text)
returns public.conversation_nicknames
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_value text := left(trim(coalesce(p_nickname, '')), 40);
  v_row public.conversation_nicknames;
begin
  if not public.in_conversation(v_me, p_conversation) or not public.in_conversation(p_user_id, p_conversation) then
    raise exception 'new row violates row-level security policy';
  end if;
  delete from public.conversation_nicknames where conversation = p_conversation and user_id = p_user_id;
  if v_value = '' then
    return null;
  end if;
  insert into public.conversation_nicknames (conversation, user_id, nickname, set_by)
  values (p_conversation, p_user_id, v_value, v_me)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_nickname(text, uuid, text) from public, anon;
grant execute on function public.set_nickname(text, uuid, text) to authenticated;

-- ─── Send later: sending ─────────────────────────────────────────────────────

-- Sends every scheduled message whose time has come (of the caller only, or of everyone), each as its
-- sender, earliest first, and takes it off the list. One that cannot be sent any more (its recipient or
-- group gone) is dropped. Returns how many it went through.
create or replace function public.deliver_scheduled(p_sender_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_messages;
  v_count integer := 0;
begin
  for v_row in
    select * from public.scheduled_messages
    where send_at <= now() and (p_sender_id is null or sender_user_id = p_sender_id)
    order by send_at
    for update skip locked
  loop
    begin
      perform public.deliver_message(v_row.sender_user_id, v_row.recipient_user_id, v_row.content);
    exception
      when others then
        null; -- nothing to deliver to any more
    end;
    delete from public.scheduled_messages where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.deliver_scheduled(uuid) from public, anon, authenticated;

-- Everyone's, for the minutely pg_cron job (not callable from the client).
create or replace function public.deliver_due_messages()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.deliver_scheduled(null);
$$;

revoke all on function public.deliver_due_messages() from public, anon, authenticated;

-- The caller's own, which an open app asks for every minute: messages go out even without pg_cron.
create or replace function public.deliver_my_due_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return 0;
  end if;
  return public.deliver_scheduled(auth.uid());
end;
$$;

revoke all on function public.deliver_my_due_messages() from public, anon;
grant execute on function public.deliver_my_due_messages() to authenticated;

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table public.chat_groups enable row level security;
alter table public.chat_group_members enable row level security;
alter table public.conversation_nicknames enable row level security;
alter table public.scheduled_messages enable row level security;

-- Groups, members and nicknames change only through the functions above
revoke all on public.chat_groups, public.chat_group_members, public.conversation_nicknames from anon, authenticated;
grant select on public.chat_groups, public.chat_group_members, public.conversation_nicknames to authenticated;
-- Scheduled messages: their sender adds, reads and cancels them; nobody edits them
revoke all on public.scheduled_messages from anon, authenticated;
grant select, insert, delete on public.scheduled_messages to authenticated;

drop policy if exists "chat_groups_select_members" on public.chat_groups;
create policy "chat_groups_select_members"
on public.chat_groups for select
using (public.is_group_member(id, auth.uid()));

drop policy if exists "chat_group_members_select_members" on public.chat_group_members;
create policy "chat_group_members_select_members"
on public.chat_group_members for select
using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "conversation_nicknames_select_participants" on public.conversation_nicknames;
create policy "conversation_nicknames_select_participants"
on public.conversation_nicknames for select
using (public.in_conversation(auth.uid(), conversation));

drop policy if exists "scheduled_messages_sender_select" on public.scheduled_messages;
create policy "scheduled_messages_sender_select"
on public.scheduled_messages for select
using (auth.uid() = sender_user_id);

drop policy if exists "scheduled_messages_sender_insert" on public.scheduled_messages;
create policy "scheduled_messages_sender_insert"
on public.scheduled_messages for insert
with check (
  auth.uid() = sender_user_id
  and send_at > now()
  and recipient_user_id <> auth.uid()
  and (
    exists (select 1 from public.profiles where id = recipient_user_id)
    or public.is_group_member(recipient_user_id, auth.uid())
  )
);

drop policy if exists "scheduled_messages_sender_delete" on public.scheduled_messages;
create policy "scheduled_messages_sender_delete"
on public.scheduled_messages for delete
using (auth.uid() = sender_user_id);

-- ─── Live updates ────────────────────────────────────────────────────────────
-- The chat follows new messages, and the cards follow their commitments (the other person accepting an
-- invite shows at once). Realtime sends each row only to those its select policy lets read it.

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here: live updates skipped.';
    return;
  end if;
  foreach v_table in array array['unified_messages', 'commitments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- ─── Attached files: the chat-files Storage bucket ───────────────────────────
-- Private, up to 10 MB a file, one folder per conversation (its key with '_' for ':', so 'dm_<id>_<id>'
-- or 'group_<id>'). Only the people of a conversation can put files in its folder or read them.

do $$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'No Supabase Storage here: the chat-files bucket is skipped.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('chat-files', 'chat-files', false, 10485760)
  on conflict (id) do nothing;

  execute 'drop policy if exists "chat_files_read_participants" on storage.objects';
  execute $policy$
    create policy "chat_files_read_participants" on storage.objects
    for select to authenticated
    using (bucket_id = 'chat-files'
      and public.in_conversation(auth.uid(), replace((storage.foldername(name))[1], '_', ':')))
  $policy$;

  execute 'drop policy if exists "chat_files_upload_participants" on storage.objects';
  execute $policy$
    create policy "chat_files_upload_participants" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'chat-files'
      and public.in_conversation(auth.uid(), replace((storage.foldername(name))[1], '_', ':')))
  $policy$;
end;
$$;

-- ─── Send later on the server: every minute (pg_cron) ────────────────────────

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here: scheduled messages go out while their sender has the app open.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('slowsenger-send-later', '* * * * *', 'select public.deliver_due_messages()');
exception
  when others then
    raise notice 'Could not schedule the send-later job (%). Switch on pg_cron (Database → Extensions) and run: select cron.schedule(''slowsenger-send-later'', ''* * * * *'', ''select public.deliver_due_messages()'');', sqlerrm;
end;
$$;

-- ═══ AI features ═════════════════════════════════════════════════════════════
-- Consent to the AI, and the recognizer's suggestions, for the Edge Functions recognize-commitments
-- (suggests commitments from a direct conversation's new messages) and summarize-chat (sums up the
-- unread messages of a conversation). Both send the conversation's text to Anthropic (Claude), so they
-- run only where everyone in the conversation has turned on AI suggestions in their profile.
-- Run it once in the Supabase SQL editor; running it again changes nothing. It is also at the end of
-- schema.sql, so the two must be kept the same.

-- ─── Consent ─────────────────────────────────────────────────────────────────

-- Turned on by the user in their profile settings. Private like the phone number: others cannot read it
-- (the column grants of profiles leave it out); conversation_ai_allowed only says whether everyone agreed.
alter table public.profiles add column if not exists ai_consent boolean not null default false;

-- Whether the AI may read a conversation of the caller: everyone in it has turned on AI suggestions.
-- False for a conversation the caller is not in.
create or replace function public.conversation_ai_allowed(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
begin
  if not public.in_conversation(auth.uid(), p_key) then
    return false;
  end if;
  if p_key like 'group:%' then
    return not exists (
      select 1
      from public.chat_group_members m
      join public.profiles p on p.id = m.user_id
      where m.group_id = substr(p_key, 7)::uuid and not p.ai_consent
    );
  end if;
  v_parts := string_to_array(p_key, ':');
  return (
    select count(*) from public.profiles
    where id in (v_parts[2]::uuid, v_parts[3]::uuid) and ai_consent
  ) = 2;
end;
$$;

revoke all on function public.conversation_ai_allowed(text) from public, anon;
grant execute on function public.conversation_ai_allowed(text) to authenticated;

-- ─── The recognizer's suggestions ────────────────────────────────────────────

-- What a suggestion was made from, the same however often the recognizer reads it and from whichever
-- copy of the conversation: '<conversation>|<author>|<the message's time>|<item>'. A second suggestion
-- for the same message and item is not made.
alter table public.commitments add column if not exists source_key text;
create unique index if not exists idx_commitments_source_key
  on public.commitments (source_key) where source_key is not null;

-- A card from the app itself (no sender) into both copies of a direct conversation, at the same moment:
-- inbound for both, so it shows for both in the middle. Internal: record_detected_commitment uses it.
create or replace function public.deliver_system_card(p_a uuid, p_b uuid, p_content text, p_commitment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_owner uuid;
  v_other uuid;
  v_thread uuid;
begin
  foreach v_owner in array array[p_a, p_b] loop
    v_other := case when v_owner = p_a then p_b else p_a end;
    insert into public.unified_threads (owner_user_id, external_thread_id, title, last_message_at)
    values (v_owner, 'user:' || v_other, (select display_name from public.profiles where id = v_other), v_now)
    on conflict (owner_user_id, external_thread_id) do update set last_message_at = v_now
    returning id into v_thread;
    insert into public.unified_messages (thread_id, sender_user_id, content, direction, created_at, commitment_id)
    values (v_thread, null, p_content, 'inbound', v_now, p_commitment_id);
  end loop;
end;
$$;

revoke all on function public.deliver_system_card(uuid, uuid, text, uuid) from public, anon, authenticated;

-- A commitment the recognizer suggests, from a message of a direct conversation of p_actor_id (whose new
-- message started the recognizer; the Edge Function has checked who they are): a proposal for the two of
-- them, origin 'detected', created by nobody, with a card for it in their conversation. p_source_message_id
-- is p_actor_id's copy of the message it is based on, p_item_key tells apart several suggestions from one
-- message (the owner). Returns the new commitment's id, or null if it had been suggested before. Only the
-- server may call it: a client cannot pass anything off as the recognizer's.
create or replace function public.record_detected_commitment(
  p_actor_id uuid,
  p_source_message_id uuid,
  p_item_key text,
  p_title text,
  p_owner_id uuid,
  p_requested_by uuid,
  p_card_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message record;
  v_partner uuid;
  v_key text;
  v_id uuid;
begin
  select m.id, m.content, m.sender_user_id, m.created_at, t.external_thread_id
  into v_message
  from public.unified_messages m
  join public.unified_threads t on t.id = m.thread_id
  where m.id = p_source_message_id and t.owner_user_id = p_actor_id;
  if not found or v_message.external_thread_id not like 'user:%' then
    raise exception 'The message is not in a direct conversation of this user.';
  end if;
  v_partner := substr(v_message.external_thread_id, 6)::uuid;
  if nullif(trim(p_title), '') is null then
    raise exception 'A commitment needs a title.';
  end if;
  if p_owner_id is not null and p_owner_id not in (p_actor_id, v_partner) then
    raise exception 'The owner has to be in the conversation.';
  end if;
  if p_requested_by is not null and p_requested_by not in (p_actor_id, v_partner) then
    raise exception 'The one asking has to be in the conversation.';
  end if;

  v_key := public.dm_key(p_actor_id, v_partner)
    || '|' || coalesce(v_message.sender_user_id::text, '')
    || '|' || to_char(v_message.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || '|' || coalesce(p_item_key, '');

  insert into public.commitments (
    participant_ids, title, owner_id, status, origin,
    source_message_id, source_text, source_author_id, created_by, requested_by, source_key
  )
  values (
    array[p_actor_id, v_partner], trim(p_title), p_owner_id, 'proposed', 'detected',
    v_message.id, v_message.content, v_message.sender_user_id, null, p_requested_by, v_key
  )
  on conflict (source_key) where source_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.commitment_events (commitment_id, actor_id, action, from_status, to_status)
  values (v_id, null, 'create', 'proposed', 'proposed');

  perform public.deliver_system_card(
    p_actor_id, v_partner, coalesce(nullif(trim(p_card_text), ''), 'Suggested commitment: ' || trim(p_title)), v_id
  );
  return v_id;
end;
$$;

revoke all on function public.record_detected_commitment(uuid, uuid, text, text, uuid, uuid, text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_detected_commitment(uuid, uuid, text, text, uuid, uuid, text) to service_role;
  end if;
end;
$$;

-- ═══ Suggestion dates ═════════════════════════════════════════════════════════
-- The recognizer's suggestions with the day and time that was said ("holnap 11-kor"): record_detected_commitment
-- takes the deadline too, so the card and the calendar show it. Run after 20261125_ai_features.sql, once,
-- in the Supabase SQL editor; running it again changes nothing. It is also at the end of schema.sql, so
-- the two must be kept the same. The old call (without the deadline) still works, with no deadline.

drop function if exists public.record_detected_commitment(uuid, uuid, text, text, uuid, uuid, text);

-- As in 20261125_ai_features.sql, with p_due and p_has_time (the deadline said; null: none was said).
create or replace function public.record_detected_commitment(
  p_actor_id uuid,
  p_source_message_id uuid,
  p_item_key text,
  p_title text,
  p_owner_id uuid,
  p_requested_by uuid,
  p_card_text text,
  p_due timestamptz default null,
  p_has_time boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message record;
  v_partner uuid;
  v_key text;
  v_id uuid;
begin
  select m.id, m.content, m.sender_user_id, m.created_at, t.external_thread_id
  into v_message
  from public.unified_messages m
  join public.unified_threads t on t.id = m.thread_id
  where m.id = p_source_message_id and t.owner_user_id = p_actor_id;
  if not found or v_message.external_thread_id not like 'user:%' then
    raise exception 'The message is not in a direct conversation of this user.';
  end if;
  v_partner := substr(v_message.external_thread_id, 6)::uuid;
  if nullif(trim(p_title), '') is null then
    raise exception 'A commitment needs a title.';
  end if;
  if p_owner_id is not null and p_owner_id not in (p_actor_id, v_partner) then
    raise exception 'The owner has to be in the conversation.';
  end if;
  if p_requested_by is not null and p_requested_by not in (p_actor_id, v_partner) then
    raise exception 'The one asking has to be in the conversation.';
  end if;

  v_key := public.dm_key(p_actor_id, v_partner)
    || '|' || coalesce(v_message.sender_user_id::text, '')
    || '|' || to_char(v_message.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || '|' || coalesce(p_item_key, '');

  insert into public.commitments (
    participant_ids, title, owner_id, due, has_time, status, origin,
    source_message_id, source_text, source_author_id, created_by, requested_by, source_key
  )
  values (
    array[p_actor_id, v_partner], trim(p_title), p_owner_id, p_due, p_due is not null and coalesce(p_has_time, false),
    'proposed', 'detected', v_message.id, v_message.content, v_message.sender_user_id, null, p_requested_by, v_key
  )
  on conflict (source_key) where source_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.commitment_events (commitment_id, actor_id, action, from_status, to_status)
  values (v_id, null, 'create', 'proposed', 'proposed');

  perform public.deliver_system_card(
    p_actor_id, v_partner, coalesce(nullif(trim(p_card_text), ''), 'Suggested commitment: ' || trim(p_title)), v_id
  );
  return v_id;
end;
$$;

revoke all on function public.record_detected_commitment(uuid, uuid, text, text, uuid, uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_detected_commitment(uuid, uuid, text, text, uuid, uuid, text, timestamptz, boolean)
      to service_role;
  end if;
end;
$$;
