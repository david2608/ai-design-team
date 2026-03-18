import { getWorkerEnv } from "./config/env.js";
import { createWorkerContext } from "./runner/context.js";
import { startWorker } from "./runner/worker.js";

const env = getWorkerEnv();
const context = createWorkerContext(env);

context.logger.info("worker.startup", {
  runtimeEnabled: env.runtimeEnabled,
  pollIntervalMs: env.pollIntervalMs,
  heartbeatIntervalMs: env.heartbeatIntervalMs,
  staleAfterMs: env.staleAfterMs,
  telegramDeliveryMode: context.telegram.status,
  telegramBotConfigured: context.telegram.botTokenConfigured,
  openAiModel: env.openAiModel,
  openAiImageModel: env.openAiImageModel,
  openAiLiveImageGeneration: context.openAi.status === "live"
});

if (!env.runtimeEnabled) {
  context.logger.info("Worker scaffold is in placeholder mode", {
    runtimeEnabled: env.runtimeEnabled
  });
} else {
  void startWorker(context);
}
