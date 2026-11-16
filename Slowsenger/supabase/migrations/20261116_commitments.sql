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
