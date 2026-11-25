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
