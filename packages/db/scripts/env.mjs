import { existsSync, readFileSync } from "node:fs";

export function loadEnvFiles(paths) {
  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }

    const contents = readFileSync(path, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const name = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      process.env[name] = value;
    }
  }
}
