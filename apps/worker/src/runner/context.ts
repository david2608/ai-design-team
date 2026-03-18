import {
  createArtifactLifecycleService,
  createJobLifecycleService,
  createRevisionLifecycleService,
  createSnapshotBuilder
} from "@ai-design-team/core";
import { createDatabaseClient } from "@ai-design-team/db";
import { createArtifactGenerationPipeline, createGeminiAdapter } from "@ai-design-team/ai";
import { createOpenAiAdapter } from "@ai-design-team/integrations-openai";
import { createTelegramDeliveryAdapter } from "@ai-design-team/integrations-telegram";
import { createLogger } from "@ai-design-team/utils";

import type { WorkerEnv } from "../config/env.js";

export function createWorkerContext(env: WorkerEnv) {
  const database = createDatabaseClient(env.databaseUrl);
  const logger = createLogger(env.logLevel as "debug" | "info" | "warn" | "error", "worker");
  const gemini = createGeminiAdapter({
    apiKey: env.geminiApiKey,
    reasoningModel: env.geminiModel,
    imageModel: env.geminiImageModel
  });
  const openAi = createOpenAiAdapter({
    apiKey: env.openAiApiKey,
    imageModel: env.openAiImageModel,
    allowStub: env.openAiAllowStub
  });
  const pipeline = createArtifactGenerationPipeline({
    gemini,
    openAi
  });
  const telegram = createTelegramDeliveryAdapter(env.telegramBotToken);

  return {
    env,
    logger,
    database,
    gemini,
    openAi,
    pipeline,
    telegram,
    services: {
      artifacts: createArtifactLifecycleService(database.repositories),
      jobs: createJobLifecycleService(database.repositories),
      revisions: createRevisionLifecycleService(database.repositories),
      snapshots: createSnapshotBuilder(database.repositories)
    }
  };
}

export type WorkerContext = ReturnType<typeof createWorkerContext>;
