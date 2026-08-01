create table if not exists model_connections (
  id text primary key,
  name text not null,
  adapter_type text not null,
  base_url text not null,
  api_key_ciphertext text,
  api_key_nonce text,
  api_key_auth_tag text,
  encryption_key_version integer not null default 1,
  status text not null default 'draft',
  last_tested_at timestamptz,
  last_test_status text not null default 'untested',
  last_error_code text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint model_connections_adapter_check check (adapter_type in ('openai_compatible')),
  constraint model_connections_status_check check (status in ('draft', 'active', 'disabled')),
  constraint model_connections_test_status_check check (last_test_status in ('untested', 'success', 'failed'))
);

create table if not exists model_configs (
  id text primary key,
  connection_id text not null references model_connections(id),
  display_name text not null,
  model_id text not null,
  modality text not null,
  supports_text_input boolean not null default true,
  supports_image_input boolean not null default false,
  supports_structured_output boolean not null default true,
  context_window integer,
  max_output_tokens integer,
  temperature_default numeric(3, 2) not null default 0.5,
  timeout_ms integer not null default 60000,
  status text not null default 'draft',
  last_validated_at timestamptz,
  last_validation_status text not null default 'untested',
  last_error_code text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (connection_id, model_id),
  constraint model_configs_modality_check check (modality in ('text', 'multimodal')),
  constraint model_configs_status_check check (status in ('draft', 'active', 'disabled')),
  constraint model_configs_validation_status_check check (last_validation_status in ('untested', 'success', 'failed')),
  constraint model_configs_image_capability_check check (modality = 'multimodal' or supports_image_input = false)
);

create table if not exists model_routes (
  route_key text primary key,
  model_config_id text references model_configs(id),
  updated_by text,
  updated_at timestamptz,
  version integer not null default 1,
  constraint model_routes_key_check check (route_key in ('text_generation', 'multimodal_generation'))
);

insert into model_routes (route_key)
values ('text_generation'), ('multimodal_generation')
on conflict (route_key) do nothing;

create table if not exists generation_usage_events (
  id text primary key,
  user_id text not null,
  run_id text not null unique,
  generation_type text not null,
  status text not null,
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  constraint generation_usage_status_check check (status in ('accepted', 'completed', 'failed'))
);

create index if not exists generation_usage_user_time_idx
  on generation_usage_events (user_id, accepted_at desc);

create table if not exists model_usage_logs (
  id text primary key,
  user_id text not null,
  run_id text,
  model_config_id text references model_configs(id),
  route_key text not null,
  adapter_type text not null,
  provider_request_id text,
  attempt_no integer not null default 1,
  status text not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  tokens_available boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  constraint model_usage_status_check check (status in ('running', 'succeeded', 'failed'))
);

create index if not exists model_usage_user_time_idx
  on model_usage_logs (user_id, started_at desc);

create index if not exists model_usage_model_time_idx
  on model_usage_logs (model_config_id, started_at desc);
