alter table telegram_bindings
  add column if not exists debug_enabled boolean not null default false,
  add column if not exists awaiting_revision_note boolean not null default false,
  add column if not exists pending_revision_artifact_id text references artifacts(id) on delete set null,
  add column if not exists last_inbound_message_id text;

create index if not exists idx_telegram_bindings_conversation
  on telegram_bindings(telegram_chat_id, telegram_thread_id, updated_at desc);
