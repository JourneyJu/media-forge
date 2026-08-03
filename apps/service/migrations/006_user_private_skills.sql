create table if not exists user_skills (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  description text not null default '',
  category text not null,
  status text not null,
  current_version_id text,
  idempotency_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (owner_user_id, idempotency_key)
);

create table if not exists user_skill_versions (
  id text primary key,
  skill_id text not null references user_skills(id) on delete cascade,
  version text not null,
  manifest_json jsonb not null,
  source_object_key text,
  validation_result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  unique (skill_id, version)
);

alter table user_skills
  add constraint user_skills_current_version_fk
  foreign key (current_version_id) references user_skill_versions(id)
  deferrable initially deferred;

create table if not exists user_skill_assets (
  id text primary key,
  skill_id text not null references user_skills(id) on delete cascade,
  skill_version_id text not null references user_skill_versions(id) on delete cascade,
  owner_user_id text not null,
  asset_key text not null,
  type text not null,
  usage text not null,
  original_name text,
  content_type text,
  size_bytes bigint,
  object_key text,
  preview_object_key text,
  sha256 text,
  width integer,
  height integer,
  status text not null,
  created_at timestamptz not null,
  unique (skill_version_id, asset_key)
);

create table if not exists user_installed_skills (
  user_id text not null,
  skill_id text not null references user_skills(id) on delete cascade,
  skill_version_id text not null references user_skill_versions(id) on delete cascade,
  alias text,
  status text not null,
  installed_at timestamptz not null,
  primary key (user_id, skill_id)
);

create index if not exists user_skills_owner_status_idx
  on user_skills(owner_user_id, status, updated_at desc);

create index if not exists user_skill_assets_owner_idx
  on user_skill_assets(owner_user_id, skill_version_id);
