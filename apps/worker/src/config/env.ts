import { resolve } from "node:path";

import { getBooleanEnv, getNumberEnv, getStringEnv, loadEnvFiles } from "@ai-design-team/utils";

loadEnvFiles([resolve(process.cwd(), ".env"), resolve(process.cwd(), "apps/worker/.env")]);

export interface WorkerEnv {
  databaseUrl: string;
  logLevel: string;
  geminiModel: string;
  geminiImageModel: string;
  geminiApiKey: string;
  openAiModel: string;
  openAiImageModel: string;
  openAiApiKey: string;
  openAiAllowStub: boolean;
  telegramBotToken: string;
  runtimeEnabled: boolean;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
}

export function getWorkerEnv(): WorkerEnv {
  return {
    databaseUrl: getStringEnv("POSTGRES_URL"),
    logLevel: getStringEnv("LOG_LEVEL", "info"),
    geminiModel: getStringEnv("GEMINI_MODEL", "gemini-2.5-pro"),
    geminiImageModel: getStringEnv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"),
    geminiApiKey: getStringEnv("GEMINI_API_KEY", ""),
    openAiModel: getStringEnv("OPENAI_MODEL", "gpt-5-mini"),
    openAiImageModel: getStringEnv("OPENAI_IMAGE_MODEL", "gpt-image-1.5"),
    openAiApiKey: getStringEnv("OPENAI_API_KEY", ""),
    openAiAllowStub: getBooleanEnv("OPENAI_ALLOW_STUB", true),
    telegramBotToken: getStringEnv("TELEGRAM_BOT_TOKEN", "telegram-token"),
    runtimeEnabled: getBooleanEnv("WORKER_RUNTIME_ENABLED", true),
    pollIntervalMs: getNumberEnv("WORKER_POLL_INTERVAL_MS", 2500),
    heartbeatIntervalMs: getNumberEnv("WORKER_HEARTBEAT_INTERVAL_MS", 10000),
    staleAfterMs: getNumberEnv("JOB_STALE_AFTER_MS", 30000)
  };
}
