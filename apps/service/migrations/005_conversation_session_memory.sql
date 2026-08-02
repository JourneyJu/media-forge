create table if not exists conversation_memories (
  conversation_id text primary key references conversations(id) on delete cascade,
  context_version integer not null,
  memory_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_memories_updated_idx
  on conversation_memories(updated_at desc);

