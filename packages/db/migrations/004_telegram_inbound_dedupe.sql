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

create index if not exists idx_telegram_inbound_events_update_id
  on telegram_inbound_events(update_id);

create index if not exists idx_telegram_inbound_events_callback_query_id
  on telegram_inbound_events(callback_query_id);
