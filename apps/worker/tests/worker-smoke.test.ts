import assert from "node:assert/strict";
import test from "node:test";

import { processClaimedJob } from "../src/runner/worker.js";

import type { Artifact, Job, Project, ProjectSnapshot, TelegramBinding } from "@ai-design-team/types";

function nowIso(): string {
  return new Date().toISOString();
}

test("claimed plain-text job is processed into an artifact and Telegram delivery", async () => {
  const timestamp = nowIso();
  const project: Project = {
    id: "project_1",
    title: "Poster brief",
    brief: "create poster for calligraphy lesson",
    status: "active",
    currentJobId: "job_1",
    latestArtifactId: undefined,
    finalArtifactId: undefined,
    debugEnabled: false,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const binding: TelegramBinding = {
    id: "binding_1",
    projectId: project.id,
    telegramChatId: "chat_1",
    telegramThreadId: undefined,
    telegramUserId: "user_1",
    telegramUsername: "tester",
    deliveryMode: "direct",
    debugEnabled: false,
    awaitingRevisionNote: false,
    pendingRevisionArtifactId: undefined,
    lastInboundMessageId: "message_1",
    lastOutboundMessageId: undefined,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const snapshot: ProjectSnapshot = {
    project,
    telegramBinding: binding,
    jobs: [],
    timeline: []
  };
  const claimedJob: Job = {
    id: "job_1",
    projectId: project.id,
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: timestamp,
    attemptCount: 1,
    maxAttempts: 3,
    claimedBy: "worker_1",
    claimToken: "claim_1",
    claimedAt: timestamp,
    heartbeatAt: timestamp,
    cancelRequestedAt: undefined,
    completedAt: undefined,
    failedAt: undefined,
    cancelledAt: undefined,
    lastError: undefined,
    parentJobId: undefined,
    sourceArtifactId: undefined,
    revisionRequestId: undefined,
    input: {
      brief: project.brief,
      messageText: "create poster for calligraphy lesson"
    },
    metadata: {
      traceId: "telegram:update:500"
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const events: string[] = [];
  let deliveredArtifactId: string | undefined;
  let completedJobId: string | undefined;
  let persistedArtifact: Artifact | undefined;
  const sentTexts: string[] = [];
  const editedTexts: string[] = [];
  const chatActions: string[] = [];

  const context = {
    env: {
      heartbeatIntervalMs: 50,
      runtimeEnabled: true,
      pollIntervalMs: 50,
      staleAfterMs: 1000
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    openAi: {
      provider: "openai",
      model: "gpt-5-mini"
    },
    pipeline: {
      generate: async (_snapshot: unknown, _job: unknown, observer?: { onStageUpdate?: (input: { id: "compose" | "render"; label: string; status: "completed" | "running"; detail: string }) => Promise<void>; onPreview?: (input: { title: string; recommendedDirection: string; bigIdea: string; nextStep: string }) => Promise<void> }) => {
        await observer?.onStageUpdate?.({
          id: "compose",
          label: "Compose",
          status: "completed",
          detail: "Quiet elegance with one expressive typographic gesture."
        });
        await observer?.onPreview?.({
          title: "Calligraphy Lesson Poster Direction",
          recommendedDirection: "Quiet elegance with one expressive typographic gesture.",
          bigIdea: "Let the lettering become the hero visual.",
          nextStep: "Rendering the visual draft now."
        });
        await observer?.onStageUpdate?.({
          id: "render",
          label: "Render",
          status: "running",
          detail: "Turning the direction into a visual artifact."
        });

        return {
          kind: "design_result" as const,
          title: "Calligraphy Lesson Poster Direction",
          summary: "A calm, elegant poster direction.",
          format: "markdown" as const,
          body: {
            recommendedDirection: "Quiet elegance with one expressive typographic gesture.",
            bigIdea: "Let the lettering become the hero visual."
          },
          renderedText: "Calligraphy Lesson Poster Direction"
        };
      }
    },
    telegram: {
      sendChatAction: async (input: { action: string }) => {
        chatActions.push(input.action);
      },
      sendMessage: async (input: { text: string }) => {
        sentTexts.push(input.text);
        events.push("progress_sent");
        return {
          ok: true,
          messageId: "7001"
        };
      },
      editMessage: async (input: { text: string }) => {
        editedTexts.push(input.text);
        events.push("progress_edited");
        return {
          ok: true,
          messageId: "7001"
        };
      },
      deliverArtifact: async (input: { artifact: Artifact }) => {
        deliveredArtifactId = input.artifact.id;
        events.push("delivered");
        return {
          ok: true,
          messageId: "9001"
        };
      },
      deliverPlaceholder: async () => undefined
    },
    services: {
      jobs: {
        claimNext: async () => claimedJob,
        heartbeat: async () => claimedJob,
        complete: async (jobId: string) => {
          completedJobId = jobId;
          events.push("completed");
          return claimedJob;
        },
        fail: async () => claimedJob,
        cancel: async () => claimedJob
      },
      artifacts: {
        createArtifact: async (input: {
          projectId: string;
          jobId: string;
          kind: Artifact["kind"];
          title: string;
          summary: string;
          format: "markdown";
          body: Record<string, unknown>;
          renderedText: string;
        }) => {
          persistedArtifact = {
            id: "artifact_1",
            projectId: input.projectId,
            jobId: input.jobId,
            kind: input.kind,
            status: "draft",
            version: 1,
            title: input.title,
            summary: input.summary,
            format: input.format,
            body: input.body,
            renderedText: input.renderedText,
            metadata: {},
            createdAt: timestamp,
            updatedAt: timestamp
          };
          events.push("artifact_created");
          return persistedArtifact;
        }
      },
      revisions: {
        completeRevision: async () => null
      },
      snapshots: {
        build: async () => snapshot
      }
    },
    database: {
      repositories: {
        getJob: async () => claimedJob,
        updateProject: async () => project,
        updateTelegramBinding: async () => binding,
        insertTimelineEvent: async () => undefined
      }
    }
  };

  const processed = await processClaimedJob(context as never, "worker_1");

  assert.equal(processed, true);
  assert.equal(persistedArtifact?.id, "artifact_1");
  assert.equal(deliveredArtifactId, "artifact_1");
  assert.equal(completedJobId, "job_1");
  assert.equal(sentTexts.length, 1);
  assert.ok(editedTexts.length >= 1);
  assert.deepEqual(chatActions, ["typing", "upload_photo"]);
  assert.equal(events[0], "progress_sent");
  assert.equal(events.includes("artifact_created"), true);
  assert.equal(events.includes("delivered"), true);
  assert.equal(events.at(-1), "completed");
});
