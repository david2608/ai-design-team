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
  debug_enabled boolean not null default false,
  awaiting_revision_note boolean not null default false,
  pending_revision_artifact_id text,
  last_inbound_message_id text,
  last_outbound_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists telegram_inbound_events (
  id text primary key,
  dedupe_key text not null unique,
  update_id text,
  callback_query_id text,
  kind text not null,
  status text not null,
  chat_id text not null,
  thread_id text,
  user_id text,
  message_id text,
  project_id text references projects(id) on delete set null,
  job_id text references jobs(id) on delete set null,
  response_action text,
  ack_sent_at timestamptz,
  last_error text,
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
      and table_name = 'projects'
      and column_name = 'status'
      and udt_name = 'project_status_enum'
  ) then
    alter table projects alter column status drop default;
    alter table projects alter column status type text using status::text;
    alter table projects alter column status set default 'draft';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'status'
      and udt_name = 'job_status_enum'
  ) then
    alter table jobs alter column status drop default;
    alter table jobs alter column status type text using status::text;
    alter table jobs alter column status set default 'queued';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'status'
      and udt_name = 'approval_status_enum'
  ) then
    alter table approvals alter column status drop default;
    alter table approvals alter column status type text using status::text;
    alter table approvals alter column status set default 'superseded';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'status'
      and udt_name = 'revision_request_status_enum'
  ) then
    alter table revision_requests alter column status drop default;
    alter table revision_requests alter column status type text using status::text;
    alter table revision_requests alter column status set default 'queued';
  end if;
end $$;

alter table if exists projects
  add column if not exists latest_artifact_id text,
  add column if not exists final_artifact_id text,
  add column if not exists debug_enabled boolean not null default false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'source_channel'
  ) then
    alter table projects alter column source_channel drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'latest_output_artifact_id'
  ) then
    update projects
    set latest_artifact_id = coalesce(latest_artifact_id, latest_output_artifact_id)
    where latest_output_artifact_id is not null;
  end if;
end $$;

update projects
set status = case status
  when 'created' then 'draft'
  when 'classified' then 'draft'
  when 'running' then 'active'
  when 'waiting_for_review' then 'awaiting_approval'
  when 'approved' then 'completed'
  else status
end
where status in ('created', 'classified', 'running', 'waiting_for_review', 'approved');

alter table if exists jobs
  add column if not exists type text not null default 'artifact_generation',
  add column if not exists queue text not null default 'default',
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists claimed_by text,
  add column if not exists claim_token text,
  add column if not exists claimed_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists last_error text,
  add column if not exists parent_job_id text,
  add column if not exists source_artifact_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'source_channel'
  ) then
    alter table jobs alter column source_channel drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'title'
  ) then
    alter table jobs alter column title drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'instructions'
  ) then
    alter table jobs alter column instructions drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'started_at'
  ) then
    update jobs
    set claimed_at = coalesce(claimed_at, started_at)
    where started_at is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'last_heartbeat_at'
  ) then
    update jobs
    set heartbeat_at = coalesce(heartbeat_at, last_heartbeat_at)
    where last_heartbeat_at is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'error_message'
  ) then
    update jobs
    set last_error = coalesce(last_error, error_message)
    where error_message is not null;
  end if;
end $$;

update jobs
set type = case
  when revision_request_id is not null then 'artifact_revision'
  else 'artifact_generation'
end
where type is null
   or type = '';

update jobs
set available_at = coalesce(available_at, created_at, now())
where available_at is null;

update jobs
set status = case status
  when 'done' then 'completed'
  else status
end
where status = 'done';

alter table if exists approvals
  add column if not exists artifact_id text,
  add column if not exists requested_by text,
  add column if not exists reviewer text,
  add column if not exists note text,
  add column if not exists decided_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'job_id'
  ) then
    alter table approvals alter column job_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'output_artifact_id'
  ) then
    alter table approvals alter column output_artifact_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'source_channel'
  ) then
    alter table approvals alter column source_channel drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'title'
  ) then
    alter table approvals alter column title drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'instructions'
  ) then
    alter table approvals alter column instructions drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'requested_by_user_id'
  ) then
    update approvals
    set requested_by = coalesce(requested_by, requested_by_user_id)
    where requested_by_user_id is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'reviewer_user_id'
  ) then
    update approvals
    set reviewer = coalesce(reviewer, reviewer_user_id)
    where reviewer_user_id is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'decision_note'
  ) then
    update approvals
    set note = coalesce(note, decision_note)
    where decision_note is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'approvals'
      and column_name = 'reviewed_at'
  ) then
    update approvals
    set decided_at = coalesce(decided_at, reviewed_at)
    where reviewed_at is not null;
  end if;
end $$;

update approvals
set status = case status
  when 'pending' then 'superseded'
  when 'cancelled' then 'superseded'
  else status
end
where status in ('pending', 'cancelled');

alter table if exists revision_requests
  add column if not exists artifact_id text,
  add column if not exists source_job_id text,
  add column if not exists requested_by text,
  add column if not exists revision_note text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'job_id'
  ) then
    alter table revision_requests alter column job_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'output_artifact_id'
  ) then
    alter table revision_requests alter column output_artifact_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'reason'
  ) then
    alter table revision_requests alter column reason drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'requested_changes'
  ) then
    alter table revision_requests alter column requested_changes drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'job_id'
  ) then
    update revision_requests
    set source_job_id = coalesce(source_job_id, job_id)
    where job_id is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'requested_by_user_id'
  ) then
    update revision_requests
    set requested_by = coalesce(requested_by, requested_by_user_id)
    where requested_by_user_id is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'reason'
  ) then
    update revision_requests
    set revision_note = coalesce(revision_note, reason)
    where reason is not null;
  end if;
end $$;

update revision_requests
set status = case status
  when 'open' then 'queued'
  when 'accepted' then 'completed'
  when 'implemented' then 'completed'
  when 'rejected' then 'cancelled'
  else status
end
where status in ('open', 'accepted', 'implemented', 'rejected');

alter table if exists telegram_bindings
  add column if not exists debug_enabled boolean not null default false,
  add column if not exists awaiting_revision_note boolean not null default false,
  add column if not exists pending_revision_artifact_id text,
  add column if not exists last_inbound_message_id text,
  add column if not exists last_outbound_message_id text;

create index if not exists idx_jobs_claiming on jobs(queue, status, available_at, created_at);
create index if not exists idx_jobs_recovery on jobs(queue, status, heartbeat_at, attempt_count);
create index if not exists idx_artifacts_project on artifacts(project_id, version desc, created_at desc);
create index if not exists idx_timeline_project on timeline_events(project_id, occurred_at asc);
create index if not exists idx_telegram_bindings_conversation on telegram_bindings(telegram_chat_id, telegram_thread_id, updated_at desc);
create index if not exists idx_telegram_inbound_events_update_id on telegram_inbound_events(update_id);
create index if not exists idx_telegram_inbound_events_callback_query_id on telegram_inbound_events(callback_query_id);
