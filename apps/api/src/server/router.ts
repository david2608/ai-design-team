import { createServer } from "node:http";
import { URL } from "node:url";

import type {
  CreateApprovalRequest,
  CreateJobRequest,
  CreateProjectRequest,
  CreateRevisionRequest,
  DebugToggleRequest,
  StopProjectRequest,
  TelegramWebhookRequest
} from "@ai-design-team/types";

import { readJsonBody, writeJson } from "../http/json.js";
import { handleCreateApproval } from "../routes/approvals.js";
import { handleDebugToggle } from "../routes/debug.js";
import { handleHealthRoute } from "../routes/health.js";
import { handleCreateJob } from "../routes/jobs.js";
import { handleCreateProject, handleGetProject } from "../routes/projects.js";
import { handleCreateRevision } from "../routes/revisions.js";
import { handleStopProject } from "../routes/stop.js";
import { handleTelegramWebhook } from "../routes/telegram.js";
import type { ApiContext } from "./context.js";

export function createApiServer(context: ApiContext) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, await handleHealthRoute(context));
        return;
      }

      if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        writeJson(response, 202, await handleTelegramWebhook(context, await readJsonBody<TelegramWebhookRequest>(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/projects") {
        writeJson(response, 201, await handleCreateProject(context, await readJsonBody<CreateProjectRequest>(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/jobs") {
        writeJson(response, 201, await handleCreateJob(context, await readJsonBody<CreateJobRequest>(request)));
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/projects/")) {
        const projectId = url.pathname.replace("/projects/", "");
        const project = await handleGetProject(context, projectId);

        writeJson(response, project ? 200 : 404, project ?? { error: "Project not found" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/approvals") {
        const result = await handleCreateApproval(context, await readJsonBody<CreateApprovalRequest>(request));
        writeJson(response, result ? 200 : 404, result ?? { error: "Approval not found" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/revisions") {
        const result = await handleCreateRevision(context, await readJsonBody<CreateRevisionRequest>(request));
        writeJson(response, result ? 201 : 404, result ?? { error: "Artifact not found" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/stop") {
        writeJson(response, 200, await handleStopProject(context, await readJsonBody<StopProjectRequest>(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/debug/toggle") {
        writeJson(response, 200, await handleDebugToggle(context, await readJsonBody<DebugToggleRequest>(request)));
        return;
      }

      writeJson(response, 404, { error: "Route not found" });
    } catch (error) {
      context.logger.error("Unhandled API error", {
        error: error instanceof Error ? error.message : String(error)
      });
      writeJson(response, 500, {
        error: "Internal server error"
      });
    }
  });
}
