alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists birthday date;

create unique index if not exists idx_profiles_email_unique on public.profiles (email) where email is not null;
create unique index if not exists idx_profiles_username_unique on public.profiles (username) where username is not null;

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
