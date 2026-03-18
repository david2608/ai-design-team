import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { loadEnvFiles } from "./env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..", "..", "..");

loadEnvFiles([resolve(rootDir, ".env")]);

const databaseUrl = process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error("POSTGRES_URL is required to run the seed script.");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5
});

const now = new Date().toISOString();

try {
  await sql.begin(async (tx) => {
    await tx`
      insert into projects (
        id, title, brief, status, debug_enabled, metadata, created_at, updated_at
      ) values (
        'project_seed_demo',
        'Seed Demo Project',
        'Persist a first-pass design artifact and deliver it over Telegram.',
        'active',
        false,
        ${tx.json({ seeded: true })},
        ${now},
        ${now}
      )
      on conflict (id) do update
      set
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `;

    await tx`
      insert into project_sources (
        id, project_id, kind, source_ref, requested_by, external_user_id, raw_input, metadata, created_at, updated_at
      ) values (
        'project_source_seed_demo',
        'project_seed_demo',
        'telegram',
        'seed-demo-message',
        'Seed Admin',
        'seed-demo-user',
        ${tx.json({ text: 'Need a clean design concept pack.' })},
        ${tx.json({ seeded: true })},
        ${now},
        ${now}
      )
      on conflict (id) do update
      set
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `;

    await tx`
      insert into project_contexts (
        id, project_id, summary, goals, constraints, audience, metadata, created_at, updated_at
      ) values (
        'project_context_seed_demo',
        'project_seed_demo',
        'Seed context for scaffold verification.',
        ${tx.json(['Create a merged final artifact'])},
        ${tx.json(['Keep the MVP generator-first'])},
        ${tx.json(['Telegram reviewers'])},
        ${tx.json({ seeded: true })},
        ${now},
        ${now}
      )
      on conflict (project_id) do update
      set
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `;

    await tx`
      insert into timeline_events (
        id, project_id, job_id, kind, actor_channel, summary, details, occurred_at, created_at, updated_at
      ) values (
        'timeline_event_seed_demo',
        'project_seed_demo',
        null,
        'project_created',
        'system',
        'Seed scaffold project created.',
        ${tx.json({ seeded: true })},
        ${now},
        ${now},
        ${now}
      )
      on conflict (id) do update
      set
        details = excluded.details,
        updated_at = excluded.updated_at
    `;
  });

  console.log("Seed data applied.");
} finally {
  await sql.end();
}
