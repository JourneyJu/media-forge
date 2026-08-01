create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  account text not null unique,
  email text,
  phone text,
  display_name text not null,
  status text not null default 'active',
  password_hash text not null,
  password_hash_algorithm text not null,
  password_hash_params jsonb not null default '{}'::jsonb,
  must_change_password boolean not null default false,
  password_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id text primary key,
  tenant_id text references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create unique index if not exists roles_system_code_unique on roles(code) where tenant_id is null;

create table if not exists permissions (
  code text primary key,
  description text not null
);

create table if not exists role_permissions (
  role_id text not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists tenant_memberships (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role_id text not null references roles(id),
  status text not null default 'active',
  permission_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  session_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists oauth_clients (
  id text primary key,
  client_id text not null unique,
  client_secret_hash text,
  client_type text not null,
  redirect_uris_json jsonb not null default '[]'::jsonb,
  allowed_scopes_json jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists oauth_authorization_codes (
  id text primary key,
  client_id text not null references oauth_clients(client_id),
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  code_challenge text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists oauth_refresh_tokens (
  id text primary key,
  client_id text not null,
  user_id text not null references users(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  token_hash text not null unique,
  family_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz
);

create table if not exists audit_events (
  id text primary key,
  tenant_id text references tenants(id) on delete set null,
  actor_user_id text references users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
