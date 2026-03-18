import type { DatabaseRepositories } from "@ai-design-team/db";
import type {
  CreateProjectResponse,
  EnqueueArtifactJobInput,
  JsonObject,
  Job,
  Project,
  ProjectContext,
  ProjectSnapshot,
  ProjectSource,
  TelegramBinding,
  TelegramFlowResult,
  TelegramGenerationProvider,
  TelegramInboundRequest,
  TelegramOutboundMessage,
  TelegramProjectResolution
} from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";
import type { Logger } from "@ai-design-team/utils";

import type { ApprovalLifecycleService } from "./approval-lifecycle.js";
import type { JobLifecycleService } from "./job-lifecycle.js";
import type { ProjectLifecycleService } from "./project-lifecycle.js";
import type { RevisionLifecycleService } from "./revision-lifecycle.js";
import type { SnapshotBuilder } from "./snapshot-builder.js";

function nowIso(): string {
  return new Date().toISOString();
}

const ACTIVE_PROJECT_STATUSES = new Set([
  "active",
  "awaiting_approval",
  "revision_requested"
]);

function trimText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isReferenceOnlyReplyText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "this" ||
    normalized === "this." ||
    normalized === "this!" ||
    normalized === "this?" ||
    normalized === "this one" ||
    normalized === "that" ||
    normalized === "that one" ||
    normalized === "it" ||
    normalized === "same" ||
    normalized === "same one" ||
    normalized === "same thing"
  );
}

function getEffectiveMessageText(input: TelegramInboundRequest): string | undefined {
  const directText = trimText(input.text);
  const repliedText = trimText(input.replyToMessage?.text);

  if (!directText) {
    return repliedText;
  }

  if (repliedText && isReferenceOnlyReplyText(directText)) {
    return repliedText;
  }

  return directText;
}

function toRequestedBy(input: TelegramInboundRequest): string | undefined {
  if (input.username) {
    return input.username;
  }

  return input.userId;
}

function buildTitle(text: string): string {
  return text.slice(0, 60) || "Telegram request";
}

function serializeAttachments(input: TelegramInboundRequest): Array<{
  kind: string;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: JsonObject;
}> {
  return input.attachments.map((attachment) => ({
    kind: attachment.kind,
    fileId: attachment.fileId ?? null,
    fileName: attachment.fileName ?? null,
    mimeType: attachment.mimeType ?? null,
    sizeBytes: attachment.sizeBytes ?? null,
    metadata: attachment.metadata
  }));
}

function replyMessage(input: TelegramInboundRequest, text: string): TelegramOutboundMessage {
  return {
    chatId: input.chatId,
    threadId: input.threadId,
    replyToMessageId: input.messageId,
    text
  };
}

function getPreferredProvider(binding?: TelegramBinding | null): TelegramGenerationProvider {
  return binding?.metadata?.preferredProvider === "gpt" ? "gpt" : "gemini";
}

function buildGenerationBubble(input: TelegramInboundRequest, detail = "Starting the first pass…"): TelegramOutboundMessage {
  return replyMessage(input, `░░░░░░░░░░░░░░░\n\n${detail}`);
}

async function persistInboundSource(
  repositories: DatabaseRepositories,
  input: TelegramInboundRequest,
  projectId: string,
  continued: boolean
): Promise<ProjectSource> {
  const timestamp = nowIso();
  const source: ProjectSource = {
    id: createId("project_source"),
    projectId,
    kind: "telegram",
    sourceRef: input.updateId,
    requestedBy: toRequestedBy(input),
    externalUserId: input.userId,
    rawInput: {
      kind: input.kind,
      text: input.text ?? null,
      effectiveText: getEffectiveMessageText(input) ?? null,
      command: input.command ?? null,
      callbackAction: input.callbackAction ?? null,
      messageId: input.messageId ?? null,
      replyToMessage: input.replyToMessage
        ? {
            messageId: input.replyToMessage.messageId ?? null,
            text: input.replyToMessage.text ?? null,
            userId: input.replyToMessage.userId ?? null,
            username: input.replyToMessage.username ?? null
          }
        : null,
      attachments: serializeAttachments(input)
    },
    metadata: {
      continued
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await repositories.insertProjectSource(source);

  for (const attachment of input.attachments) {
    await repositories.insertAttachment({
      id: createId("attachment"),
      projectId,
      sourceId: source.id,
      artifactId: undefined,
      kind: attachment.kind === "telegram_photo" ? "image" : attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      storageKey: attachment.fileId,
      sizeBytes: attachment.sizeBytes,
      metadata: {
        ...attachment.metadata,
        source: "telegram"
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  return source;
}

async function touchBinding(
  repositories: DatabaseRepositories,
  binding: TelegramBinding,
  input: TelegramInboundRequest,
  patch: Partial<TelegramBinding> = {}
): Promise<TelegramBinding> {
  const updated = await repositories.updateTelegramBinding(binding.id, {
    telegramUserId: input.userId,
    telegramUsername: input.username,
    lastInboundMessageId: input.messageId,
    ...patch
  });

  return updated ?? binding;
}

export interface TelegramFlowService {
  resolveProject(input: TelegramInboundRequest): Promise<TelegramProjectResolution>;
  handleInbound(input: TelegramInboundRequest): Promise<TelegramFlowResult>;
}

export interface TelegramFlowDependencies {
  approvals: ApprovalLifecycleService;
  jobs: JobLifecycleService;
  logger?: Logger;
  projects: ProjectLifecycleService;
  revisions: RevisionLifecycleService;
  snapshots: SnapshotBuilder;
}

export function createTelegramFlowService(
  repositories: DatabaseRepositories,
  dependencies: TelegramFlowDependencies
): TelegramFlowService {
  const logger = dependencies.logger;

  function logInfo(message: string, metadata?: Record<string, unknown>): void {
    logger?.info(message, metadata);
  }

  function logWarn(message: string, metadata?: Record<string, unknown>): void {
    logger?.warn(message, metadata);
  }

  async function resolveProject(input: TelegramInboundRequest): Promise<TelegramProjectResolution> {
    if (input.projectResolution?.projectId) {
      const binding = await repositories.getTelegramBindingByProjectId(input.projectResolution.projectId);
      if (
        binding &&
        binding.telegramChatId === input.chatId &&
        (binding.telegramThreadId ?? null) === (input.threadId ?? null)
      ) {
        return {
          ...input.projectResolution,
          bindingId: binding.id
        };
      }

      if (input.kind === "callback_query") {
        return {
          mode: "unresolved",
          projectId: input.projectResolution.projectId,
          artifactId: input.projectResolution.artifactId
        };
      }
    }

    const bindings = await repositories.listTelegramBindingsByConversation({
      chatId: input.chatId,
      threadId: input.threadId,
      userId: input.userId
    });

    for (const binding of bindings) {
      const project = await repositories.getProject(binding.projectId);
      if (!project) {
        continue;
      }

      if (binding.awaitingRevisionNote) {
        return {
          mode: "awaiting_revision_note",
          projectId: project.id,
          bindingId: binding.id,
          artifactId: binding.pendingRevisionArtifactId
        };
      }

      if (ACTIVE_PROJECT_STATUSES.has(project.status)) {
        return {
          mode: "continue_project",
          projectId: project.id,
          bindingId: binding.id,
          artifactId: project.latestArtifactId
        };
      }

      return {
        mode: "new_project"
      };
    }

    return {
      mode: "new_project"
    };
  }

  async function getBindingForResolution(resolution: TelegramProjectResolution): Promise<TelegramBinding | null> {
    if (!resolution.projectId) {
      return null;
    }

    return repositories.getTelegramBindingByProjectId(resolution.projectId);
  }

  async function resolveConversationPreferredProvider(input: TelegramInboundRequest): Promise<TelegramGenerationProvider> {
    const bindings = await repositories.listTelegramBindingsByConversation({
      chatId: input.chatId,
      threadId: input.threadId,
      userId: input.userId
    });

    return getPreferredProvider(bindings[0]);
  }

  async function queueFollowupJob(
    project: Project,
    input: TelegramInboundRequest,
    provider: TelegramGenerationProvider,
    sourceId?: string
  ): Promise<Job> {
    const effectiveMessageText = getEffectiveMessageText(input);
    const enqueueInput: EnqueueArtifactJobInput = {
      projectId: project.id,
      type: "artifact_generation",
      input: {
        brief: project.brief,
        messageText: effectiveMessageText ?? null,
        sourceKind: "telegram",
        updateId: input.updateId,
        messageId: input.messageId ?? null,
        replyToMessageText: input.replyToMessage?.text ?? null,
        replyToMessageId: input.replyToMessage?.messageId ?? null,
        provider,
        sourceId: sourceId ?? null
      },
      metadata: {
        traceId: input.dedupeKey,
        source: "telegram",
        provider,
        sourceId: sourceId ?? null
      }
    };

    const job = await dependencies.jobs.enqueue(enqueueInput);
    await repositories.updateProject(project.id, {
      currentJobId: job.id,
      status: "active"
    });
    logInfo("telegram.flow.job_queued", {
      projectId: project.id,
      jobId: job.id,
      mode: "continue_project"
    });

    return job;
  }

  async function appendToExistingProject(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest
  ): Promise<TelegramFlowResult> {
    if (!resolution.projectId || !resolution.bindingId) {
      logWarn("telegram.flow.no_project_for_continue", {
        mode: resolution.mode,
        chatId: input.chatId,
        threadId: input.threadId ?? null
      });
      logInfo("telegram.flow.fallback_new_project", {
        reason: "continue_resolution_missing",
        traceId: input.dedupeKey
      });
      const created = await createNewProject(input);
      return {
        accepted: true,
        action: "project_created",
        projectId: created.project.id,
        jobId: created.initialJob.id,
        resolution: {
          mode: "new_project",
          projectId: created.project.id,
          bindingId: created.telegramBinding?.id
        },
        outboundMessages: [buildGenerationBubble(input)]
      };
    }

    const [project, binding, existingContext] = await Promise.all([
      repositories.getProject(resolution.projectId),
      repositories.getTelegramBindingByProjectId(resolution.projectId),
      repositories.getProjectContextByProjectId(resolution.projectId)
    ]);

    if (!project || !binding) {
      logWarn("telegram.flow.continue_target_missing", {
        projectId: resolution.projectId,
        bindingId: resolution.bindingId
      });
      logInfo("telegram.flow.fallback_new_project", {
        reason: "continue_target_missing",
        traceId: input.dedupeKey,
        projectId: resolution.projectId
      });
      const created = await createNewProject(input);
      return {
        accepted: true,
        action: "project_created",
        projectId: created.project.id,
        jobId: created.initialJob.id,
        resolution: {
          mode: "new_project",
          projectId: created.project.id,
          bindingId: created.telegramBinding?.id
        },
        outboundMessages: [buildGenerationBubble(input)]
      };
    }

    const messageText = getEffectiveMessageText(input) ?? "";
    const updatedBrief = [project.brief, `Follow-up request: ${messageText}`].filter(Boolean).join("\n\n");
    const timestamp = nowIso();
    const context: ProjectContext = {
      id: existingContext?.id ?? createId("project_context"),
      projectId: project.id,
      summary: existingContext
        ? [existingContext.summary, `Latest Telegram input: ${messageText}`].join("\n\n")
        : updatedBrief,
      goals: existingContext?.goals ?? [],
      constraints: existingContext?.constraints ?? [],
      audience: existingContext?.audience ?? [],
      metadata: {
        ...(existingContext?.metadata ?? {}),
        lastTelegramUpdateId: input.updateId
      },
      createdAt: existingContext?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    await repositories.updateProject(project.id, {
      brief: updatedBrief,
      status: "active"
    });
    await repositories.upsertProjectContext(context);
    const source = await persistInboundSource(repositories, input, project.id, true);
    await touchBinding(repositories, binding, input, {
      awaitingRevisionNote: false,
      pendingRevisionArtifactId: undefined
    });

    const job = await queueFollowupJob(
      {
        ...project,
        brief: updatedBrief,
        status: "active",
        updatedAt: timestamp
      },
      input,
      getPreferredProvider(binding),
      source.id
    );

    return {
      accepted: true,
      action: "project_continued",
      projectId: project.id,
      jobId: job.id,
      resolution,
      outboundMessages: [buildGenerationBubble(input, "Continuing the next pass…")]
    };
  }

  async function createNewProject(input: TelegramInboundRequest): Promise<CreateProjectResponse> {
    const messageText = getEffectiveMessageText(input) ?? "Untitled Telegram request";
    const preferredProvider = await resolveConversationPreferredProvider(input);
    const created = await dependencies.projects.createProject({
      title: buildTitle(messageText),
      brief: messageText,
      source: {
        kind: "telegram",
        sourceRef: input.updateId,
        requestedBy: toRequestedBy(input),
        externalUserId: input.userId,
        rawInput: {
          kind: input.kind,
          text: messageText,
          replyToMessage: input.replyToMessage
            ? {
                messageId: input.replyToMessage.messageId ?? null,
                text: input.replyToMessage.text ?? null,
                userId: input.replyToMessage.userId ?? null,
                username: input.replyToMessage.username ?? null
              }
            : null,
          messageId: input.messageId ?? null,
          attachments: serializeAttachments(input)
        }
      },
      attachments: input.attachments.map((attachment) => ({
        kind: attachment.kind === "telegram_photo" ? "image" : attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        storageKey: attachment.fileId,
        sizeBytes: attachment.sizeBytes,
        metadata: {
          ...attachment.metadata,
          source: "telegram"
        }
      })),
      telegramBinding: {
        telegramChatId: input.chatId,
        telegramThreadId: input.threadId,
        telegramUserId: input.userId,
        telegramUsername: input.username,
        deliveryMode: input.threadId ? "thread" : "direct",
        debugEnabled: false,
        awaitingRevisionNote: false,
        pendingRevisionArtifactId: undefined,
        lastInboundMessageId: input.messageId,
        metadata: {
          preferredProvider
        }
      },
      metadata: {
        traceId: input.dedupeKey
      }
    });
    logInfo("telegram.flow.job_queued", {
      projectId: created.project.id,
      jobId: created.initialJob.id,
      mode: "new_project"
    });
    return created;
  }

  async function handleStop(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest
  ): Promise<TelegramFlowResult> {
    if (!resolution.projectId) {
      return {
        accepted: true,
        action: "stop_not_found",
        resolution,
        outboundMessages: [replyMessage(input, "No active job to stop.")]
      };
    }

    const activeJob = await repositories.getActiveJobByProjectId(resolution.projectId);
    if (!activeJob) {
      logInfo("telegram.flow.stop_no_active_job", {
        projectId: resolution.projectId
      });
      return {
        accepted: true,
        action: "stop_not_found",
        resolution,
        outboundMessages: [replyMessage(input, "No active job to stop.")]
      };
    }

    await dependencies.jobs.requestStop(resolution.projectId);
    const binding = await getBindingForResolution(resolution);
    if (binding) {
      await touchBinding(repositories, binding, input, {
        awaitingRevisionNote: false,
        pendingRevisionArtifactId: undefined
      });
    }

    return {
      accepted: true,
      action: "stop_requested",
      projectId: resolution.projectId,
      resolution,
      outboundMessages: [replyMessage(input, "Stopping the current pass.")]
    };
  }

  async function handleDebugToggle(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest,
    enabled: boolean
  ): Promise<TelegramFlowResult> {
    const bindings = resolution.projectId
      ? [await repositories.getTelegramBindingByProjectId(resolution.projectId)].filter(Boolean)
      : await repositories.listTelegramBindingsByConversation({
          chatId: input.chatId,
          threadId: input.threadId,
          userId: input.userId
        });
    const binding = bindings[0] ?? null;

    if (!binding) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: [replyMessage(input, "No active Telegram project in this chat yet.")]
      };
    }

    await touchBinding(repositories, binding, input, {
      debugEnabled: enabled
    });
    await repositories.insertTimelineEvent({
      id: createId("timeline_event"),
      projectId: binding.projectId,
      kind: "debug_toggled",
      actorChannel: "telegram",
      summary: enabled ? "Telegram debug enabled." : "Telegram debug disabled.",
      details: {
        enabled
      },
      occurredAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    return {
      accepted: true,
      action: "debug_toggled",
      projectId: binding.projectId,
      resolution: {
        mode: "continue_project",
        projectId: binding.projectId,
        bindingId: binding.id
      },
      outboundMessages: [
        replyMessage(
          input,
          enabled
            ? "Debug mode is on for this project. I’ll show the workflow as it runs."
            : "Debug mode is off for this project."
        )
      ]
    };
  }

  async function handleProviderCommand(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest,
    provider: TelegramGenerationProvider
  ): Promise<TelegramFlowResult> {
    const bindings = resolution.projectId
      ? [await repositories.getTelegramBindingByProjectId(resolution.projectId)].filter(Boolean)
      : await repositories.listTelegramBindingsByConversation({
          chatId: input.chatId,
          threadId: input.threadId,
          userId: input.userId
        });
    const binding = bindings[0] ?? null;

    if (!binding) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: [replyMessage(input, "Send a prompt first, then I can keep that model for this thread.")]
      };
    }

    await touchBinding(repositories, binding, input, {
      metadata: {
        ...binding.metadata,
        preferredProvider: provider
      }
    });

    return {
      accepted: true,
      action: "provider_switched",
      projectId: binding.projectId,
      resolution: {
        mode: "continue_project",
        projectId: binding.projectId,
        bindingId: binding.id
      },
      outboundMessages: [
        replyMessage(
          input,
          provider === "gpt" ? "GPT is set for future messages in this thread." : "Gemini is set for future messages in this thread."
        )
      ]
    };
  }

  async function handleProviderCallback(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest
  ): Promise<TelegramFlowResult> {
    const provider = input.callbackProvider;
    if (!resolution.projectId || !provider) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: [],
        callbackNotice: "Provider not found."
      };
    }

    const binding = await getBindingForResolution(resolution);
    if (!binding) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: [],
        callbackNotice: "Project not found."
      };
    }

    await touchBinding(repositories, binding, input, {
      metadata: {
        ...binding.metadata,
        preferredProvider: provider
      }
    });

    return {
      accepted: true,
      action: "provider_switched",
      projectId: resolution.projectId,
      resolution,
      outboundMessages: [],
      callbackNotice: provider === "gemini" ? "Gemini set for new messages." : "GPT set for new messages."
    };
  }

  async function handleApprovalCallback(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest
  ): Promise<TelegramFlowResult> {
    if (!resolution.projectId || !input.callbackAction) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: []
      };
    }

    if (
      input.callbackAction !== "like" &&
      input.callbackAction !== "dislike" &&
      input.callbackAction !== "revise"
    ) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: [],
        callbackNotice: "Unsupported action."
      };
    }

    const binding = await getBindingForResolution(resolution);
    if (!binding) {
      return {
        accepted: true,
        action: "noop",
        resolution,
        outboundMessages: []
      };
    }

    if (input.callbackAction === "revise") {
      const result = await dependencies.revisions.createRevision(
        {
          projectId: resolution.projectId,
          artifactId: resolution.artifactId,
          requestedBy: toRequestedBy(input),
          revisionNote: "Generate the next pass for the current result and strengthen it while preserving continuity.",
          metadata: {
            source: "telegram",
            traceId: input.dedupeKey,
            provider: getPreferredProvider(binding),
            mode: "button_revise"
          }
        },
        (enqueueInput) => dependencies.jobs.enqueue(enqueueInput)
      );

      if (!result) {
        return {
          accepted: true,
          action: "noop",
          projectId: resolution.projectId,
          resolution,
          outboundMessages: [replyMessage(input, "I could not find the latest result to revise.")],
          callbackNotice: "Result not found."
        };
      }

      await touchBinding(repositories, binding, input, {
        awaitingRevisionNote: false,
        pendingRevisionArtifactId: undefined
      });

      return {
        accepted: true,
        action: "revision_requested",
        projectId: resolution.projectId,
        jobId: result.followupJob.id,
        artifactId: result.artifact.id,
        resolution,
        outboundMessages: [buildGenerationBubble(input, "Revising the current result…")],
        callbackNotice: "Revising."
      };
    }

    const result = await dependencies.approvals.recordAction({
      projectId: resolution.projectId,
      artifactId: resolution.artifactId,
      action: input.callbackAction,
      reviewer: toRequestedBy(input),
      metadata: {
        source: "telegram"
      }
    });

    if (!result) {
      return {
        accepted: true,
        action: "noop",
        projectId: resolution.projectId,
        resolution,
        outboundMessages: [replyMessage(input, "I could not find the latest result for that action.")],
        callbackNotice: "Result not found."
      };
    }

    await touchBinding(repositories, binding, input, {
      awaitingRevisionNote: false,
      pendingRevisionArtifactId: undefined
    });

    return {
      accepted: true,
      action: input.callbackAction === "like" ? "artifact_liked" : "artifact_disliked",
      projectId: resolution.projectId,
      artifactId: result?.artifact.id ?? resolution.artifactId,
      resolution,
      outboundMessages: [],
      callbackNotice: input.callbackAction === "like" ? "Finished." : "Closed."
    };
  }

  async function handleRevisionNote(
    resolution: TelegramProjectResolution,
    input: TelegramInboundRequest
  ): Promise<TelegramFlowResult> {
    if (!resolution.projectId || !resolution.bindingId) {
      logWarn("telegram.flow.revision_target_missing", {
        projectId: resolution.projectId ?? null,
        bindingId: resolution.bindingId ?? null,
        traceId: input.dedupeKey
      });
      logInfo("telegram.flow.fallback_new_project", {
        reason: "revision_resolution_missing",
        traceId: input.dedupeKey
      });
      const created = await createNewProject(input);
      return {
        accepted: true,
        action: "project_created",
        projectId: created.project.id,
        jobId: created.initialJob.id,
        resolution: {
          mode: "new_project",
          projectId: created.project.id,
          bindingId: created.telegramBinding?.id
        },
        outboundMessages: [buildGenerationBubble(input)]
      };
    }

    const binding = await repositories.getTelegramBindingByProjectId(resolution.projectId);
    if (!binding) {
      logWarn("telegram.flow.revision_binding_missing", {
        projectId: resolution.projectId,
        bindingId: resolution.bindingId,
        traceId: input.dedupeKey
      });
      logInfo("telegram.flow.fallback_new_project", {
        reason: "revision_binding_missing",
        traceId: input.dedupeKey,
        projectId: resolution.projectId
      });
      const created = await createNewProject(input);
      return {
        accepted: true,
        action: "project_created",
        projectId: created.project.id,
        jobId: created.initialJob.id,
        resolution: {
          mode: "new_project",
          projectId: created.project.id,
          bindingId: created.telegramBinding?.id
        },
        outboundMessages: [buildGenerationBubble(input)]
      };
    }

    const source = await persistInboundSource(repositories, input, resolution.projectId, true);
    const result = await dependencies.revisions.createRevision(
      {
        projectId: resolution.projectId,
        artifactId: resolution.artifactId,
        requestedBy: toRequestedBy(input),
        revisionNote: getEffectiveMessageText(input) ?? "",
        metadata: {
          source: "telegram",
          traceId: input.dedupeKey,
          provider: getPreferredProvider(binding),
          sourceId: source.id,
          messageId: input.messageId ?? null
        }
      },
      (enqueueInput) => dependencies.jobs.enqueue(enqueueInput)
    );

    if (!result) {
      logWarn("telegram.flow.revision_create_failed", {
        projectId: resolution.projectId,
        artifactId: resolution.artifactId ?? null,
        traceId: input.dedupeKey
      });
      logInfo("telegram.flow.fallback_new_project", {
        reason: "revision_create_failed",
        traceId: input.dedupeKey,
        projectId: resolution.projectId
      });
      const created = await createNewProject(input);
      return {
        accepted: true,
        action: "project_created",
        projectId: created.project.id,
        jobId: created.initialJob.id,
        resolution: {
          mode: "new_project",
          projectId: created.project.id,
          bindingId: created.telegramBinding?.id
        },
        outboundMessages: [buildGenerationBubble(input)]
      };
    }

    await touchBinding(repositories, binding, input, {
      awaitingRevisionNote: false,
      pendingRevisionArtifactId: undefined
    });

    return {
      accepted: true,
      action: "revision_requested",
      projectId: resolution.projectId,
      jobId: result?.followupJob.id,
      artifactId: result?.artifact.id ?? resolution.artifactId,
      resolution,
      outboundMessages: [buildGenerationBubble(input, "Revising the current result…")]
    };
  }

  async function resolveSnapshot(projectId?: string): Promise<ProjectSnapshot | null> {
    if (!projectId) {
      return null;
    }

    return dependencies.snapshots.build(projectId);
  }

  return {
    resolveProject,

    async handleInbound(input) {
      const resolvedInput: TelegramInboundRequest = {
        ...input,
        projectResolution: await resolveProject(input)
      };
      const resolution = resolvedInput.projectResolution!;
      const messageText = getEffectiveMessageText(resolvedInput);
      logInfo("telegram.flow.resolved", {
        updateId: resolvedInput.updateId,
        dedupeKey: resolvedInput.dedupeKey,
        mode: resolution.mode,
        projectId: resolution.projectId ?? null,
        bindingId: resolution.bindingId ?? null,
        awaitingRevisionNote: resolution.mode === "awaiting_revision_note",
        hasText: Boolean(messageText),
        hasReplyReference: Boolean(trimText(resolvedInput.replyToMessage?.text))
      });

      if (resolvedInput.command === "stop") {
        return handleStop(resolution, resolvedInput);
      }

      if (resolvedInput.command === "debug_on") {
        return handleDebugToggle(resolution, resolvedInput, true);
      }

      if (resolvedInput.command === "debug_off") {
        return handleDebugToggle(resolution, resolvedInput, false);
      }

      if (resolvedInput.command === "use_gpt") {
        return handleProviderCommand(resolution, resolvedInput, "gpt");
      }

      if (resolvedInput.command === "use_gemini") {
        return handleProviderCommand(resolution, resolvedInput, "gemini");
      }

      if (resolvedInput.callbackProvider) {
        return handleProviderCallback(resolution, resolvedInput);
      }

      if (resolvedInput.callbackAction) {
        return handleApprovalCallback(resolution, resolvedInput);
      }

      if (!messageText) {
        logInfo("telegram.flow.noop_empty_message", {
          updateId: resolvedInput.updateId,
          dedupeKey: resolvedInput.dedupeKey
        });
        return {
          accepted: true,
          action: "noop",
          resolution,
          outboundMessages: []
        };
      }

      if (resolution.mode === "awaiting_revision_note") {
        logInfo("telegram.flow.branch_revision_note", {
          projectId: resolution.projectId,
          artifactId: resolution.artifactId ?? null
        });
        return handleRevisionNote(resolution, resolvedInput);
      }

      if (resolution.mode === "continue_project") {
        logInfo("telegram.flow.branch_continue_project", {
          projectId: resolution.projectId
        });
        return appendToExistingProject(resolution, resolvedInput);
      }

      logInfo("telegram.flow.branch_new_project", {
        previousProjectId: resolution.projectId ?? null
      });
      const created = await createNewProject(resolvedInput);
      const snapshot = await resolveSnapshot(created.project.id);
      const binding = snapshot?.telegramBinding ?? created.telegramBinding;
      if (binding) {
        await touchBinding(repositories, binding, resolvedInput);
      }

      return {
        accepted: true,
        action: "project_created",
        projectId: created.project.id,
        jobId: created.initialJob.id,
        resolution: {
          mode: "new_project",
          projectId: created.project.id,
          bindingId: created.telegramBinding?.id
        },
        outboundMessages: [buildGenerationBubble(resolvedInput)]
      };
    }
  };
}
