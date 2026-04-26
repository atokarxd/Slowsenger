-- 1. Split the profiles policy so any authenticated user can read profiles
--    (needed for user search and chat list display names)
drop policy if exists "profiles_owner_rw" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_owner" on public.profiles;
drop policy if exists "profiles_update_owner" on public.profiles;
drop policy if exists "profiles_delete_owner" on public.profiles;

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

-- 2. Atomically send a direct message and create the reciprocal inbound entry
--    for the recipient. Runs as SECURITY DEFINER to bypass RLS on the
--    recipient's rows while still verifying the caller is authenticated.
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

  -- Sender's outbound thread (upsert, update last_message_at on conflict)
  insert into public.unified_threads (owner_user_id, platform, external_thread_id, title, last_message_at)
  values (
    v_sender_id,
    'messenger',
    'user:' || p_recipient_id,
    (select display_name from public.profiles where id = p_recipient_id),
    now()
  )
  on conflict (owner_user_id, platform, external_thread_id)
  do update set last_message_at = now()
  returning id into v_sender_thread;

  insert into public.unified_messages (thread_id, sender_user_id, content, direction)
  values (v_sender_thread, v_sender_id, p_content, 'outbound');

  -- Recipient's inbound thread (upsert)
  insert into public.unified_threads (owner_user_id, platform, external_thread_id, title, last_message_at)
  values (
    p_recipient_id,
    'messenger',
    'user:' || v_sender_id,
    (select display_name from public.profiles where id = v_sender_id),
    now()
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
