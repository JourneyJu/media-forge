alter table conversations
  add column if not exists owner_id text,
  add column if not exists context_version integer not null default 0,
  add column if not exists last_interaction_at timestamptz;

update conversations
set owner_id = coalesce(owner_id, nullif(workspace_id, 'default-workspace'), 'local-user')
where owner_id is null;

update conversations c
set last_interaction_at = coalesce(
  (
    select max(m.created_at)
    from conversation_messages m
    where m.conversation_id = c.id and m.role = 'user'
  ),
  c.created_at
)
where c.last_interaction_at is null;

delete from conversations c
where not exists (
  select 1
  from conversation_messages m
  where m.conversation_id = c.id and m.role = 'user'
);

alter table conversations
  alter column owner_id set not null,
  alter column last_interaction_at set not null;

create index if not exists conversations_owner_interaction_idx
  on conversations(owner_id, last_interaction_at desc, id desc)
  where status = 'active';

create table if not exists conversation_turn_requests (
  id text primary key,
  owner_id text not null,
  idempotency_key text not null,
  conversation_id text not null references conversations(id) on delete cascade,
  message_id text not null references conversation_messages(id) on delete cascade,
  run_id text not null references runs(id) on delete cascade,
  created_at timestamptz not null,
  unique (owner_id, idempotency_key)
);

create table if not exists upload_sessions (
  id text primary key,
  owner_id text not null,
  idempotency_key text not null,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  consumed_at timestamptz,
  unique (owner_id, idempotency_key)
);

create table if not exists resources (
  id text primary key,
  owner_id text not null,
  upload_session_id text references upload_sessions(id) on delete set null,
  conversation_id text references conversations(id) on delete cascade,
  status text not null,
  source text not null,
  original_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  original_object_key text not null unique,
  preview_object_key text,
  sha256 text,
  etag text,
  error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists resources_upload_session_idx
  on resources(upload_session_id, created_at);

create index if not exists resources_conversation_idx
  on resources(conversation_id, created_at);

create table if not exists message_resources (
  message_id text not null references conversation_messages(id) on delete cascade,
  resource_id text not null references resources(id) on delete cascade,
  display_order integer not null,
  created_at timestamptz not null,
  primary key (message_id, resource_id)
);

create table if not exists conversation_deletion_outbox (
  id text primary key,
  conversation_id text not null unique references conversations(id) on delete cascade,
  owner_id text not null,
  object_keys_json jsonb not null default '[]'::jsonb,
  status text not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists conversation_deletion_pending_idx
  on conversation_deletion_outbox(status, next_attempt_at);

create index if not exists staged_resources_expiry_idx
  on upload_sessions(status, expires_at);
