alter table users add column if not exists username text;
alter table users add column if not exists username_normalized text;
alter table users add column if not exists role text;
alter table users add column if not exists last_login_at timestamptz;
alter table users add column if not exists failed_login_count integer not null default 0;
alter table users add column if not exists locked_until timestamptz;

update users
set username = account,
    username_normalized = lower(account)
where username is null or username_normalized is null;

update users u
set role = case
  when exists (
    select 1
    from tenant_memberships m
    join roles r on r.id = m.role_id
    where m.user_id = u.id
      and m.status = 'active'
      and r.code in ('owner', 'admin')
  ) then 'admin'
  else 'user'
end
where role is null;

alter table users alter column username set not null;
alter table users alter column username_normalized set not null;
alter table users alter column role set not null;

create unique index if not exists users_username_normalized_unique
  on users (username_normalized);

alter table auth_sessions alter column tenant_id drop not null;
alter table oauth_refresh_tokens alter column tenant_id drop not null;
alter table oauth_refresh_tokens add column if not exists session_id text references auth_sessions(id) on delete cascade;

create index if not exists auth_sessions_user_active_idx
  on auth_sessions (user_id, expires_at)
  where revoked_at is null;

create index if not exists oauth_refresh_tokens_user_active_idx
  on oauth_refresh_tokens (user_id, expires_at)
  where status = 'active';
