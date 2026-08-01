alter table generation_usage_events
  add column if not exists generation_id text,
  add column if not exists idempotency_key text,
  add column if not exists model_call_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update generation_usage_events
set generation_id = coalesce(generation_id, id),
    started_at = coalesce(started_at, accepted_at),
    updated_at = coalesce(completed_at, accepted_at, created_at),
    status = case status
      when 'accepted' then 'running'
      when 'completed' then 'succeeded'
      else status
    end;

alter table generation_usage_events
  alter column generation_id set not null,
  alter column started_at set not null,
  drop constraint generation_usage_status_check,
  add constraint generation_usage_status_check
    check (status in ('running', 'succeeded', 'failed', 'cancelled'));

create unique index if not exists generation_usage_generation_id_uidx
  on generation_usage_events (generation_id);

create index if not exists generation_usage_status_time_idx
  on generation_usage_events (status, started_at desc);

alter table model_usage_logs
  add column if not exists call_id text,
  add column if not exists generation_event_id text references generation_usage_events(id),
  add column if not exists generation_id text,
  add column if not exists step_id text,
  add column if not exists provider text,
  add column if not exists model_id text,
  add column if not exists token_status text,
  add column if not exists duration_ms integer,
  add column if not exists updated_at timestamptz not null default now();

update model_usage_logs l
set call_id = coalesce(l.call_id, l.id),
    provider = coalesce(l.provider, l.adapter_type),
    model_id = coalesce(l.model_id, m.model_id),
    token_status = coalesce(l.token_status, case when l.tokens_available then 'reported' else 'unavailable' end),
    duration_ms = coalesce(l.duration_ms, l.latency_ms),
    updated_at = coalesce(l.completed_at, l.started_at, l.created_at)
from model_configs m
where m.id = l.model_config_id;

update model_usage_logs l
set generation_event_id = coalesce(l.generation_event_id, g.id),
    generation_id = coalesce(l.generation_id, g.generation_id)
from generation_usage_events g
where g.run_id = l.run_id;

alter table model_usage_logs
  alter column call_id set not null,
  alter column provider set not null,
  alter column model_id set not null,
  alter column token_status set not null,
  add constraint model_usage_token_status_check
    check (token_status in ('reported', 'unavailable'));

create unique index if not exists model_usage_call_id_uidx
  on model_usage_logs (call_id);

create unique index if not exists model_usage_attempt_uidx
  on model_usage_logs (generation_id, step_id, attempt_no)
  where generation_id is not null and step_id is not null;

create index if not exists model_usage_status_time_idx
  on model_usage_logs (status, started_at desc);
