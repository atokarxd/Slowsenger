create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_email boolean;
  has_phone boolean;
  has_first_name boolean;
  has_last_name boolean;
  has_username boolean;
  has_birthday boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'email'
  ) into has_email;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'phone'
  ) into has_phone;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'first_name'
  ) into has_first_name;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'last_name'
  ) into has_last_name;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'username'
  ) into has_username;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'birthday'
  ) into has_birthday;

  if has_email and has_phone and has_first_name and has_last_name and has_username and has_birthday then
    insert into public.profiles (
      id,
      display_name,
      email,
      phone,
      first_name,
      last_name,
      username,
      birthday,
      avatar_url
    )
    values (
      new.id,
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'email',
      nullif(new.raw_user_meta_data ->> 'phone', ''),
      new.raw_user_meta_data ->> 'first_name',
      new.raw_user_meta_data ->> 'last_name',
      new.raw_user_meta_data ->> 'username',
      nullif(new.raw_user_meta_data ->> 'birthday', '')::date,
      null
    )
    on conflict (id) do update
    set
      display_name = excluded.display_name,
      email = excluded.email,
      phone = excluded.phone,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      username = excluded.username,
      birthday = excluded.birthday,
      avatar_url = excluded.avatar_url;
  else
    insert into public.profiles (
      id,
      display_name,
      avatar_url
    )
    values (
      new.id,
      new.raw_user_meta_data ->> 'display_name',
      null
    )
    on conflict (id) do update
    set
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
