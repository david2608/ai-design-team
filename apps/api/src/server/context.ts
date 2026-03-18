import {
  createApprovalLifecycleService,
  createArtifactLifecycleService,
  createJobLifecycleService,
  createProjectLifecycleService,
  createRevisionLifecycleService,
  createSnapshotBuilder,
  createTelegramFlowService
} from "@ai-design-team/core";
import { createDatabaseClient } from "@ai-design-team/db";
import { createTelegramDeliveryAdapter } from "@ai-design-team/integrations-telegram";
import { createLogger } from "@ai-design-team/utils";

import type { ApiEnv } from "../config/env.js";

export function createApiContext(env: ApiEnv) {
  const database = createDatabaseClient(env.databaseUrl);
  const logger = createLogger(env.logLevel as "debug" | "info" | "warn" | "error", "api");
  const telegram = createTelegramDeliveryAdapter(env.telegramBotToken);
  const projects = createProjectLifecycleService(database.repositories);
  const jobs = createJobLifecycleService(database.repositories);
  const artifacts = createArtifactLifecycleService(database.repositories);
  const approvals = createApprovalLifecycleService(database.repositories);
  const revisions = createRevisionLifecycleService(database.repositories);
  const snapshots = createSnapshotBuilder(database.repositories);

  return {
    env,
    logger,
    database,
    telegram,
    services: {
      projects,
      jobs,
      artifacts,
      approvals,
      revisions,
      snapshots,
      telegram: createTelegramFlowService(database.repositories, {
        approvals,
        jobs,
        logger,
        projects,
        revisions,
        snapshots
      })
    }
  };
}

export type ApiContext = ReturnType<typeof createApiContext>;
