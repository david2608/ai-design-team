import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { loadEnvFiles } from "./env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(scriptDir, "..", "migrations");
const rootDir = resolve(scriptDir, "..", "..", "..");

loadEnvFiles([resolve(rootDir, ".env")]);

const databaseUrl = process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error("POSTGRES_URL is required to run migrations.");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5
});

try {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migrationPath = resolve(migrationsDir, migrationFile);
    const migrationSql = await readFile(migrationPath, "utf8");
    console.log(`Applying migration ${migrationFile}`);
    await sql.unsafe(migrationSql);
  }

  console.log(`Applied ${migrationFiles.length} migration(s).`);
} finally {
  await sql.end();
}
