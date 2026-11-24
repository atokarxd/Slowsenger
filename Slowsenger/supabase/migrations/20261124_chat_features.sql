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
