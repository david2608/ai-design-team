import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const filesToPrepare = [
  [".env.example", ".env"],
  ["apps/api/.env.example", "apps/api/.env.local"],
  ["apps/worker/.env.example", "apps/worker/.env"],
  ["apps/figma-plugin/.env.example", "apps/figma-plugin/.env"]
];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

for (const [source, target] of filesToPrepare) {
  const sourcePath = resolve(rootDir, source);
  const targetPath = resolve(rootDir, target);

  if (await exists(targetPath)) {
    console.log(`Keeping existing ${target}`);
    continue;
  }

  await copyFile(sourcePath, targetPath);
  console.log(`Created ${target} from ${source}`);
}

console.log("");
console.log("Local setup prepared.");
console.log("Next steps:");
console.log("1. Fill in env vars in .env and app env files.");
console.log("2. Run: pnpm db:migrate");
console.log("3. Run: pnpm db:seed");
console.log("4. Run API: pnpm dev:api");
console.log("5. Run Worker: pnpm dev:worker");
console.log("6. Figma plugin stays as a placeholder in Phase 1.");
