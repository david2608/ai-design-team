import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramFlowService } from "../src/telegram-flow.js";

import type {
  Approval,
  Artifact,
  Job,
  Project,
  ProjectContext,
  ProjectSource,
  RevisionRequest,
  TelegramBinding,
  TelegramInboundRequest,
  TimelineEvent
} from "@ai-design-team/types";

function nowIso(): string {
  return new Date().toISOString();
}

function makeProject(id: string, status: Project["status"], brief = `brief for ${id}`): Project {
  const timestamp = nowIso();
  return {
    id,
    title: brief,
    brief,
    status,
    currentJobId: undefined,
    latestArtifactId: undefined,
    finalArtifactId: undefined,
    debugEnabled: false,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function makeBinding(projectId: string, updatedAt = nowIso(), patch: Partial<TelegramBinding> = {}): TelegramBinding {
  return {
    id: `binding_${projectId}`,
    projectId,
    telegramChatId: "chat_1",
    telegramThreadId: undefined,
    telegramUserId: "user_1",
    telegramUsername: "tester",
    deliveryMode: "direct",
    debugEnabled: false,
    awaitingRevisionNote: false,
    pendingRevisionArtifactId: undefined,
    lastInboundMessageId: undefined,
    lastOutboundMessageId: undefined,
    metadata: {},
    createdAt: updatedAt,
    updatedAt,
    ...patch
  };
}

function makeInbound(text: string, patch: Partial<TelegramInboundRequest> = {}): TelegramInboundRequest {
  return {
    source: "telegram",
    updateId: `update_${Math.random().toString(36).slice(2, 8)}`,
    dedupeKey: `telegram:update:${Math.random().toString(36).slice(2, 8)}`,
    kind: "message",
    text,
    chatId: "chat_1",
    userId: "user_1",
    username: "tester",
    messageId: `${Date.now()}`,
    attachments: [],
    metadata: {},
    ...patch
  };
}

function createHarness(input?: {
  projects?: Project[];
  bindings?: TelegramBinding[];
  activeJobByProjectId?: Record<string, Job | null>;
}) {
  const projects = new Map<string, Project>((input?.projects ?? []).map((project) => [project.id, project]));
  const bindings = new Map<string, TelegramBinding>((input?.bindings ?? []).map((binding) => [binding.projectId, binding]));
  const contexts = new Map<string, ProjectContext>();
  const jobs = new Map<string, Job>();
  const queuedJobs: Job[] = [];
  const createdProjects: Project[] = [];
  const createdRevisions: Array<{ projectId: string; artifactId?: string; revisionNote: string; followupJobId: string }> = [];

  let projectCounter = 0;
  let jobCounter = 0;

  const repositories = {
    listTelegramBindingsByConversation: async () =>
      Array.from(bindings.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    getProject: async (projectId: string) => projects.get(projectId) ?? null,
    getTelegramBindingByProjectId: async (projectId: string) => bindings.get(projectId) ?? null,
    updateTelegramBinding: async (bindingId: string, patch: Partial<TelegramBinding>) => {
      const binding = Array.from(bindings.values()).find((value) => value.id === bindingId);
      assert.ok(binding);
      Object.assign(binding, patch, {
        updatedAt: nowIso()
      });
      bindings.set(binding.projectId, binding);
      return binding;
    },
    updateProject: async (projectId: string, patch: Partial<Project>) => {
      const project = projects.get(projectId);
      assert.ok(project);
      Object.assign(project, patch, {
        updatedAt: nowIso()
      });
      projects.set(projectId, project);
      return project;
    },
    getProjectContextByProjectId: async (projectId: string) => contexts.get(projectId) ?? null,
    upsertProjectContext: async (context: ProjectContext) => {
      contexts.set(context.projectId, context);
      return context;
    },
    insertProjectSource: async (source: ProjectSource) => source,
    insertAttachment: async () => ({
      id: "attachment_1"
    }),
    insertTimelineEvent: async (event: TimelineEvent) => event,
    getActiveJobByProjectId: async (projectId: string) => input?.activeJobByProjectId?.[projectId] ?? null
  };

  const service = createTelegramFlowService(repositories as never, {
    approvals: {
      recordAction: async () =>
        ({
          approval: {
            id: "approval_1",
            projectId: "project_1",
            artifactId: "artifact_1",
            status: "approved",
            metadata: {},
            createdAt: nowIso(),
            updatedAt: nowIso()
          } as Approval,
          artifact: {
            id: "artifact_1",
            projectId: "project_1",
            kind: "design_result",
            status: "approved",
            version: 1,
            title: "Artifact",
            summary: "summary",
            format: "markdown",
            body: {},
            metadata: {},
            createdAt: nowIso(),
            updatedAt: nowIso()
          } as Artifact
        }) satisfies { approval: Approval; artifact: Artifact }
    },
    jobs: {
      enqueue: async (enqueueInput) => {
        const timestamp = nowIso();
        const job: Job = {
          id: `job_${++jobCounter}`,
          projectId: enqueueInput.projectId,
          type: enqueueInput.type,
          status: "queued",
          queue: enqueueInput.queue ?? "default",
          availableAt: timestamp,
          attemptCount: 0,
          maxAttempts: enqueueInput.maxAttempts ?? 3,
          input: enqueueInput.input ?? {},
          metadata: enqueueInput.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp
        };
        queuedJobs.push(job);
        jobs.set(job.id, job);
        return job;
      },
      requestStop: async () => ({
        activeJobsMarked: 1,
        queuedJobsCancelled: 0
      })
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    projects: {
      createProject: async (projectInput) => {
        const timestamp = nowIso();
        const project = makeProject(`project_${++projectCounter}`, "active", projectInput.brief);
        project.createdAt = timestamp;
        project.updatedAt = timestamp;
        projects.set(project.id, project);
        createdProjects.push(project);

        const binding = makeBinding(project.id, timestamp, {
          telegramChatId: projectInput.telegramBinding?.telegramChatId ?? "chat_1",
          telegramThreadId: projectInput.telegramBinding?.telegramThreadId,
          telegramUserId: projectInput.telegramBinding?.telegramUserId,
          telegramUsername: projectInput.telegramBinding?.telegramUsername,
          awaitingRevisionNote: projectInput.telegramBinding?.awaitingRevisionNote ?? false,
          pendingRevisionArtifactId: projectInput.telegramBinding?.pendingRevisionArtifactId,
          metadata: projectInput.telegramBinding?.metadata ?? {}
        });
        bindings.set(project.id, binding);

        const initialJob: Job = {
          id: `job_${++jobCounter}`,
          projectId: project.id,
          type: "artifact_generation",
          status: "queued",
          queue: "default",
          availableAt: timestamp,
          attemptCount: 0,
          maxAttempts: 3,
          input: {
            brief: projectInput.brief,
            provider: projectInput.telegramBinding?.metadata?.preferredProvider ?? "gemini"
          },
          metadata: {
            provider: projectInput.telegramBinding?.metadata?.preferredProvider ?? "gemini"
          },
          createdAt: timestamp,
          updatedAt: timestamp
        };
        queuedJobs.push(initialJob);
        jobs.set(initialJob.id, initialJob);
        project.currentJobId = initialJob.id;

        const source: ProjectSource = {
          id: `source_${project.id}`,
          projectId: project.id,
          kind: "telegram",
          rawInput: {},
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp
        };
        const context: ProjectContext = {
          id: `context_${project.id}`,
          projectId: project.id,
          summary: projectInput.brief,
          goals: [],
          constraints: [],
          audience: [],
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp
        };
        contexts.set(project.id, context);

        return {
          project,
          source,
          context,
          initialJob,
          telegramBinding: binding
        };
      }
    },
    revisions: {
      createRevision: async (revisionInput, enqueueJob) => {
        const followupJob = await enqueueJob({
          projectId: revisionInput.projectId,
          type: "artifact_revision",
          sourceArtifactId: revisionInput.artifactId,
          input: {
            revisionNote: revisionInput.revisionNote
          },
          metadata: revisionInput.metadata ?? {}
        });
        createdRevisions.push({
          projectId: revisionInput.projectId,
          artifactId: revisionInput.artifactId,
          revisionNote: revisionInput.revisionNote,
          followupJobId: followupJob.id
        });
        return {
          revision: {
            id: `revision_${createdRevisions.length}`,
            projectId: revisionInput.projectId,
            artifactId: revisionInput.artifactId ?? "artifact_1",
            status: "queued",
            revisionNote: revisionInput.revisionNote,
            followupJobId: followupJob.id,
            metadata: {},
            createdAt: nowIso(),
            updatedAt: nowIso()
          } as RevisionRequest,
          followupJob,
          artifact: {
            id: revisionInput.artifactId ?? "artifact_1",
            projectId: revisionInput.projectId,
            kind: "design_result",
            status: "revision_requested",
            version: 1,
            title: "Artifact",
            summary: "summary",
            format: "markdown",
            body: {},
            metadata: {},
            createdAt: nowIso(),
            updatedAt: nowIso()
          } as Artifact
        };
      }
    },
    snapshots: {
      build: async () => null
    }
  });

  return {
    service,
    projects,
    bindings,
    queuedJobs,
    createdProjects,
    createdRevisions
  };
}

test("first prompt creates a new project and queues one job", async () => {
  const harness = createHarness();
  const result = await harness.service.handleInbound(makeInbound("create poster for dance class"));

  assert.equal(result.action, "project_created");
  assert.equal(harness.createdProjects.length, 1);
  assert.equal(harness.queuedJobs.length, 1);
  assert.equal(result.outboundMessages[0]?.buttons, undefined);
  assert.match(result.outboundMessages[0]?.text ?? "", /^░+/);
});

test("second plain prompt after awaiting approval result continues the same project", async () => {
  const project = makeProject("project_existing", "awaiting_approval", "first brief");
  const binding = makeBinding(project.id, "2026-03-16T10:00:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound(makeInbound("now make it feel more editorial"));

  assert.equal(result.action, "project_continued");
  assert.equal(result.projectId, project.id);
  assert.equal(harness.createdProjects.length, 0);
  assert.equal(harness.queuedJobs.length, 1);
});

test("replying with 'this' reuses the replied-to message text instead of the literal word", async () => {
  const harness = createHarness();
  const result = await harness.service.handleInbound(
    makeInbound("this", {
      replyToMessage: {
        messageId: "411",
        text: "design poster for Ruben Malayan calligraphy lesson",
        userId: "user_1",
        username: "tester"
      }
    })
  );

  assert.equal(result.action, "project_created");
  assert.equal(harness.createdProjects[0]?.brief, "design poster for Ruben Malayan calligraphy lesson");
  assert.equal(harness.queuedJobs[0]?.input.provider, "gemini");
  assert.equal(harness.queuedJobs[0]?.input.brief, "design poster for Ruben Malayan calligraphy lesson");
});

test("plain prompt after Like starts a fresh project", async () => {
  const project = makeProject("project_liked", "completed", "liked brief");
  const binding = makeBinding(project.id, "2026-03-16T11:00:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound(makeInbound("design a skincare launch poster"));

  assert.equal(result.action, "project_created");
  assert.equal(result.projectId, harness.createdProjects[0]?.id);
  assert.equal(harness.createdProjects.length, 1);
});

test("second plain prompt after a completed result starts a fresh project", async () => {
  const project = makeProject("project_completed", "completed", "completed brief");
  const binding = makeBinding(project.id, "2026-03-16T11:30:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound(makeInbound("design a moody tea brand direction"));

  assert.equal(result.action, "project_created");
  assert.equal(harness.createdProjects.length, 1);
});

test("plain prompt after Dislike starts a fresh project", async () => {
  const project = makeProject("project_disliked", "completed", "disliked brief");
  const binding = makeBinding(project.id, "2026-03-16T12:00:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound(makeInbound("new concept for coffee packaging"));

  assert.equal(result.action, "project_created");
  assert.equal(harness.createdProjects.length, 1);
});

test("plain prompt while waiting for revision note is treated as a revision note", async () => {
  const project = makeProject("project_revision", "revision_requested", "poster concept");
  const binding = makeBinding(project.id, "2026-03-16T13:00:00.000Z", {
    awaitingRevisionNote: true,
    pendingRevisionArtifactId: "artifact_9"
  });
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound(makeInbound("make it warmer and less crowded"));

  assert.equal(result.action, "revision_requested");
  assert.equal(result.projectId, project.id);
  assert.equal(harness.createdRevisions.length, 1);
  assert.equal(harness.createdRevisions[0]?.artifactId, "artifact_9");
});

test("revise callback queues the next pass immediately for the current result", async () => {
  const project = makeProject("project_revise_button", "awaiting_approval", "poster concept");
  const binding = makeBinding(project.id, "2026-03-16T13:30:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound({
    source: "telegram",
    updateId: "update_revise_button",
    dedupeKey: "telegram:callback:revise_button",
    kind: "callback_query",
    callbackAction: "revise",
    chatId: "chat_1",
    userId: "user_1",
    username: "tester",
    messageId: "902",
    attachments: [],
    metadata: {},
    projectResolution: {
      mode: "callback_target",
      projectId: project.id,
      artifactId: "artifact_11"
    }
  });

  assert.equal(result.action, "revision_requested");
  assert.equal(result.jobId, harness.createdRevisions[0]?.followupJobId);
  assert.equal(harness.createdRevisions.length, 1);
  assert.equal(harness.createdRevisions[0]?.artifactId, "artifact_11");
  assert.equal(harness.bindings.get(project.id)?.awaitingRevisionNote, false);
  assert.equal(result.callbackNotice, "Revising.");
});

test("plain prompt after stop starts fresh instead of attaching to cancel requested project", async () => {
  const project = makeProject("project_stopped", "cancel_requested", "stopped brief");
  const binding = makeBinding(project.id, "2026-03-16T14:00:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound(makeInbound("start a fresh hero direction for my cafe"));

  assert.equal(result.action, "project_created");
  assert.equal(harness.createdProjects.length, 1);
});

test("use_gpt command updates the project binding for future messages", async () => {
  const project = makeProject("project_provider", "awaiting_approval", "brief");
  const binding = makeBinding(project.id, "2026-03-16T15:00:00.000Z");
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound({
    source: "telegram",
    updateId: "update_provider",
    dedupeKey: "telegram:update:provider",
    kind: "message",
    text: "use_gpt",
    command: "use_gpt",
    chatId: "chat_1",
    userId: "user_1",
    username: "tester",
    messageId: "900",
    attachments: [],
    metadata: {}
  });

  assert.equal(result.action, "provider_switched");
  assert.equal(harness.bindings.get(project.id)?.metadata.preferredProvider, "gpt");
  assert.equal(result.outboundMessages[0]?.buttons, undefined);
});

test("use_gemini command updates the project binding for future messages", async () => {
  const project = makeProject("project_provider_gemini", "awaiting_approval", "brief");
  const binding = makeBinding(project.id, "2026-03-16T15:10:00.000Z", {
    metadata: {
      preferredProvider: "gpt"
    }
  });
  const harness = createHarness({
    projects: [project],
    bindings: [binding]
  });

  const result = await harness.service.handleInbound({
    source: "telegram",
    updateId: "update_provider_gemini",
    dedupeKey: "telegram:update:provider_gemini",
    kind: "message",
    text: "use_gemini",
    command: "use_gemini",
    chatId: "chat_1",
    userId: "user_1",
    username: "tester",
    messageId: "901",
    attachments: [],
    metadata: {}
  });

  assert.equal(result.action, "provider_switched");
  assert.equal(harness.bindings.get(project.id)?.metadata.preferredProvider, "gemini");
});

test("new projects inherit the latest conversation provider preference and queue jobs with it", async () => {
  const completedProject = makeProject("project_old", "completed", "old brief");
  const existingBinding = makeBinding(completedProject.id, "2026-03-16T16:00:00.000Z", {
    metadata: {
      preferredProvider: "gpt"
    }
  });
  const harness = createHarness({
    projects: [completedProject],
    bindings: [existingBinding]
  });

  const result = await harness.service.handleInbound(makeInbound("design a premium tea poster"));

  assert.equal(result.action, "project_created");
  assert.equal(harness.createdProjects.length, 1);
  assert.equal(harness.queuedJobs[0]?.metadata.provider, "gpt");
  assert.equal(harness.bindings.get(harness.createdProjects[0]!.id)?.metadata.preferredProvider, "gpt");
});
