import { existsSync, readFileSync } from "node:fs";

export interface EnvDefinition {
  name: string;
  required?: boolean;
  defaultValue?: string;
}

export type EnvShape = Record<string, string>;

export function loadEnvFiles(paths: string[]): void {
  for (const path of paths) {
    if (existsSync(path)) {
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
}

export function readEnv(definitions: EnvDefinition[]): EnvShape {
  const entries = definitions.map((definition) => {
    const value = process.env[definition.name] ?? definition.defaultValue;

    if (definition.required && value === undefined) {
      throw new Error(`Missing environment variable: ${definition.name}`);
    }

    return [definition.name, value ?? ""] as const;
  });

  return Object.fromEntries(entries);
}

export function getStringEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] ?? defaultValue;

  if (value === undefined) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function getOptionalEnv(name: string): string | undefined {
  return process.env[name];
}

export function getNumberEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return parsed;
}

export function getBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  return rawValue === "true";
}
