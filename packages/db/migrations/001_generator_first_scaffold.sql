create table if not exists projects (
  id text primary key,
  title text not null,
  brief text not null,
  status text not null,
  current_job_id text,
  latest_artifact_id text,
  final_artifact_id text,
  debug_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists project_sources (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  kind text not null,
  source_ref text,
  requested_by text,
  external_user_id text,
  raw_input jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists project_contexts (
  id text primary key,
  project_id text not null unique references projects(id) on delete cascade,
  summary text not null,
  goals jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '[]'::jsonb,
  audience jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists attachments (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  source_id text references project_sources(id) on delete set null,
  artifact_id text,
  kind text not null,
  file_name text,
  mime_type text,
  storage_key text,
  size_bytes integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists jobs (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  type text not null,
  status text not null,
  queue text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null,
  claimed_by text,
  claim_token text,
  claim_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  input jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists artifacts (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  job_id text references jobs(id) on delete set null,
  kind text not null,
  status text not null,
  version integer not null default 1,
  title text not null,
  summary text not null,
  format text not null,
  body jsonb not null default '{}'::jsonb,
  rendered_text text,
  is_final boolean not null default false,
  merged_from_artifact_ids jsonb not null default '[]'::jsonb,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists approvals (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  artifact_id text not null references artifacts(id) on delete cascade,
  status text not null,
  requested_by text,
  reviewer text,
  note text,
  decided_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists revision_requests (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  artifact_id text not null references artifacts(id) on delete cascade,
  approval_id text references approvals(id) on delete set null,
  status text not null,
  requested_by text,
  reason text not null,
  instructions text not null,
  followup_job_id text references jobs(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists timeline_events (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  job_id text references jobs(id) on delete set null,
  artifact_id text references artifacts(id) on delete set null,
  kind text not null,
  actor_channel text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists telegram_bindings (
  id text primary key,
  project_id text not null unique references projects(id) on delete cascade,
  telegram_chat_id text not null,
  telegram_thread_id text,
  telegram_user_id text,
  telegram_username text,
  delivery_mode text not null,
  last_outbound_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'queue'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'available_at'
  ) then
    create index if not exists idx_jobs_claiming on jobs(queue, status, available_at, created_at);
  end if;
end $$;

create index if not exists idx_artifacts_project on artifacts(project_id, version desc, created_at desc);
create index if not exists idx_timeline_project on timeline_events(project_id, occurred_at asc);
