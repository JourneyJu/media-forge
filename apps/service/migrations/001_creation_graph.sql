create table if not exists conversations (
  id text primary key,
  workspace_id text not null,
  title text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists conversation_messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  resource_ids_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null
);

create table if not exists conversation_resources (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  asset_id text not null,
  source text not null,
  created_at timestamptz not null
);

create table if not exists runs (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  type text not null,
  status text not null,
  current_step text not null,
  lock_version integer not null default 1,
  plan_json jsonb not null,
  steps_json jsonb not null default '[]'::jsonb,
  waiting_for_json jsonb,
  result_artifact_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);

create table if not exists graph_runs (
  id text primary key,
  run_id text not null unique references runs(id) on delete cascade,
  graph_name text not null,
  graph_version text not null,
  context_version integer not null,
  context_json jsonb not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);

create table if not exists run_events (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  event_no integer not null,
  type text not null,
  payload_json jsonb not null,
  created_at timestamptz not null,
  unique (run_id, event_no)
);

create table if not exists run_clarifications (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  idempotency_key text not null,
  answers_json jsonb not null,
  created_at timestamptz not null,
  unique (run_id, idempotency_key)
);

create table if not exists agent_tasks (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  agent_name text not null,
  node_name text not null,
  status text not null,
  attempt_no integer not null default 1,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null
);

create table if not exists agent_outputs (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  agent_task_id text not null references agent_tasks(id) on delete cascade,
  type text not null,
  schema_version text not null,
  payload_json jsonb not null,
  created_at timestamptz not null
);

create table if not exists artifacts (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  run_id text not null references runs(id) on delete cascade,
  type text not null,
  title text not null,
  payload_json jsonb not null,
  article_id text,
  article_version_id text,
  created_at timestamptz not null,
  unique (run_id, type)
);

create table if not exists run_dispatch_outbox (
  id text primary key,
  run_id text not null unique references runs(id) on delete cascade,
  queue_name text not null,
  payload_json jsonb not null,
  status text not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  dispatched_at timestamptz
);

create index if not exists run_events_run_id_event_no_idx
  on run_events(run_id, event_no);

create index if not exists outbox_pending_idx
  on run_dispatch_outbox(status, next_attempt_at);
