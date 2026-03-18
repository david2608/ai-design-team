import { resolve } from "node:path";

import { getBooleanEnv, getNumberEnv, getStringEnv, loadEnvFiles } from "@ai-design-team/utils";

loadEnvFiles([resolve(process.cwd(), ".env"), resolve(process.cwd(), "apps/api/.env.local")]);

export interface ApiEnv {
  apiPort: number;
  databaseUrl: string;
  logLevel: string;
  debugRoutesEnabled: boolean;
  telegramBotToken: string;
}

export function getApiEnv(): ApiEnv {
  const hostedPort = getNumberEnv("PORT", 3000);
  return {
    apiPort: getNumberEnv("API_PORT", hostedPort),
    databaseUrl: getStringEnv("POSTGRES_URL"),
    logLevel: getStringEnv("LOG_LEVEL", "info"),
    debugRoutesEnabled: getBooleanEnv("DEBUG_ROUTES_ENABLED", false),
    telegramBotToken: getStringEnv("TELEGRAM_BOT_TOKEN", "telegram-token")
  };
}
