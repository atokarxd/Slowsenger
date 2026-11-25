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
