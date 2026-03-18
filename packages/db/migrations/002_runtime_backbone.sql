alter table jobs
  add column if not exists claimed_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists last_error text,
  add column if not exists parent_job_id text references jobs(id) on delete set null,
  add column if not exists source_artifact_id text references artifacts(id) on delete set null,
  add column if not exists revision_request_id text references revision_requests(id) on delete set null;

alter table revision_requests
  add column if not exists source_job_id text references jobs(id) on delete set null,
  add column if not exists revision_note text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'instructions'
  ) then
    update revision_requests
    set revision_note = coalesce(revision_note, instructions)
    where revision_note is null;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revision_requests'
      and column_name = 'reason'
  ) then
    update revision_requests
    set revision_note = coalesce(revision_note, reason)
    where revision_note is null;
  end if;
end $$;
