import type { DatabaseRepositories } from "@ai-design-team/db";
import type {
  CreateProjectInput,
  CreateProjectResponse,
  Job,
  Project,
  ProjectContext,
  ProjectSource,
  TelegramBinding,
  TimelineEvent
} from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";

function nowIso(): string {
  return new Date().toISOString();
}

export interface ProjectLifecycleService {
  createProject(input: CreateProjectInput): Promise<CreateProjectResponse>;
}

export function createProjectLifecycleService(repositories: DatabaseRepositories): ProjectLifecycleService {
  return {
    async createProject(input) {
      const timestamp = nowIso();
      const preferredProvider =
        input.telegramBinding?.metadata?.preferredProvider === "gpt" ? "gpt" : "gemini";

      const project: Project = {
        id: createId("project"),
        title: input.title,
        brief: input.brief,
        status: "active",
        currentJobId: undefined,
        latestArtifactId: undefined,
        finalArtifactId: undefined,
        debugEnabled: false,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const source: ProjectSource = {
        id: createId("project_source"),
        projectId: project.id,
        kind: input.source.kind,
        sourceRef: input.source.sourceRef,
        requestedBy: input.source.requestedBy,
        externalUserId: input.source.externalUserId,
        rawInput: input.source.rawInput ?? {},
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const context: ProjectContext = {
        id: createId("project_context"),
        projectId: project.id,
        summary: input.context?.summary ?? input.brief,
        goals: input.context?.goals ?? [],
        constraints: input.context?.constraints ?? [],
        audience: input.context?.audience ?? [],
        metadata: input.context?.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const initialJob: Job = {
        id: createId("job"),
        projectId: project.id,
        type: "artifact_generation",
        status: "queued",
        queue: "default",
        availableAt: timestamp,
        attemptCount: 0,
        maxAttempts: 3,
        claimedBy: undefined,
        claimToken: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
        cancelRequestedAt: undefined,
        completedAt: undefined,
        failedAt: undefined,
        cancelledAt: undefined,
        lastError: undefined,
        parentJobId: undefined,
        sourceArtifactId: undefined,
        revisionRequestId: undefined,
        input: {
          brief: input.brief,
          sourceKind: input.source.kind,
          provider: preferredProvider
        },
        metadata: {
          provider: preferredProvider,
          traceId: typeof input.metadata?.traceId === "string" ? input.metadata.traceId : null,
          sourceRef: input.source.sourceRef ?? null
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };

      project.currentJobId = initialJob.id;

      await repositories.insertProject(project);
      await repositories.insertProjectSource(source);
      await repositories.upsertProjectContext(context);
      await repositories.insertJob(initialJob);
      await repositories.updateProject(project.id, {
        currentJobId: initialJob.id,
        status: "active"
      });

      for (const attachmentInput of input.attachments ?? []) {
        await repositories.insertAttachment({
          id: createId("attachment"),
          projectId: project.id,
          sourceId: source.id,
          artifactId: undefined,
          kind: attachmentInput.kind,
          fileName: attachmentInput.fileName,
          mimeType: attachmentInput.mimeType,
          storageKey: attachmentInput.storageKey,
          sizeBytes: attachmentInput.sizeBytes,
          metadata: attachmentInput.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      let telegramBinding: TelegramBinding | undefined;
      if (input.telegramBinding) {
        telegramBinding = await repositories.upsertTelegramBinding({
          id: createId("telegram_binding"),
          projectId: project.id,
          telegramChatId: input.telegramBinding.telegramChatId,
          telegramThreadId: input.telegramBinding.telegramThreadId,
          telegramUserId: input.telegramBinding.telegramUserId,
          telegramUsername: input.telegramBinding.telegramUsername,
          deliveryMode: input.telegramBinding.deliveryMode ?? "thread",
          debugEnabled: input.telegramBinding.debugEnabled ?? false,
          awaitingRevisionNote: input.telegramBinding.awaitingRevisionNote ?? false,
          pendingRevisionArtifactId: input.telegramBinding.pendingRevisionArtifactId,
          lastInboundMessageId: input.telegramBinding.lastInboundMessageId,
          lastOutboundMessageId: undefined,
          metadata: input.telegramBinding.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      const events: TimelineEvent[] = [
        {
          id: createId("timeline_event"),
          projectId: project.id,
          kind: "project_created",
          actorChannel: source.kind === "system" ? "system" : source.kind,
          summary: "Project created.",
          details: { sourceKind: source.kind },
          occurredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: createId("timeline_event"),
          projectId: project.id,
          jobId: initialJob.id,
          kind: "job_queued",
          actorChannel: "system",
          summary: "Initial artifact generation job queued.",
          details: { queue: initialJob.queue },
          occurredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ];

      for (const event of events) {
        await repositories.insertTimelineEvent(event);
      }

      return {
        project,
        source,
        context,
        initialJob,
        telegramBinding
      };
    }
  };
}
