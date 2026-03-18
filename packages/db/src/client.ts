import postgres, { type JSONValue, type Sql } from "postgres";

import type {
  Approval,
  Artifact,
  Attachment,
  Job,
  Project,
  ProjectContext,
  ProjectSource,
  RevisionRequest,
  TelegramBinding,
  TelegramInboundEvent,
  TimelineEvent
} from "@ai-design-team/types";
import type { JsonObject } from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";

import { TABLES, nowIso } from "./schema.js";

export interface ClaimJobInput {
  workerId: string;
  queue: string;
  now?: string;
}

export interface JobCancellationResult {
  activeJobsMarked: number;
  queuedJobsCancelled: number;
}

export interface StaleRecoveryResult {
  requeuedJobs: number;
  failedJobs: number;
}

export interface ClaimTelegramInboundEventInput {
  dedupeKey: string;
  updateId?: string;
  callbackQueryId?: string;
  kind: TelegramInboundEvent["kind"];
  chatId: string;
  threadId?: string;
  userId?: string;
  messageId?: string;
  metadata?: JsonObject;
}

export interface ClaimTelegramInboundEventResult {
  event: TelegramInboundEvent;
  isDuplicate: boolean;
}

export interface DatabaseRepositories {
  insertProject(project: Project): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  updateProject(
    projectId: string,
    patch: Partial<
      Pick<Project, "title" | "brief" | "status" | "currentJobId" | "latestArtifactId" | "finalArtifactId" | "debugEnabled" | "metadata">
    >
  ): Promise<Project | null>;

  insertProjectSource(source: ProjectSource): Promise<ProjectSource>;
  getProjectSourceByProjectId(projectId: string): Promise<ProjectSource | null>;

  upsertProjectContext(context: ProjectContext): Promise<ProjectContext>;
  getProjectContextByProjectId(projectId: string): Promise<ProjectContext | null>;

  insertAttachment(attachment: Attachment): Promise<Attachment>;
  listAttachmentsByProjectId(projectId: string): Promise<Attachment[]>;

  insertJob(job: Job): Promise<Job>;
  getJob(jobId: string): Promise<Job | null>;
  listJobsByProjectId(projectId: string): Promise<Job[]>;
  getActiveJobByProjectId(projectId: string): Promise<Job | null>;
  claimNextJob(input: ClaimJobInput): Promise<Job | null>;
  heartbeatJob(jobId: string, claimToken: string): Promise<Job | null>;
  updateJob(
    jobId: string,
    patch: Partial<
      Pick<
        Job,
        | "status"
        | "availableAt"
        | "attemptCount"
        | "claimedBy"
        | "claimToken"
        | "claimedAt"
        | "heartbeatAt"
        | "cancelRequestedAt"
        | "completedAt"
        | "failedAt"
        | "cancelledAt"
        | "lastError"
        | "parentJobId"
        | "sourceArtifactId"
        | "revisionRequestId"
        | "input"
        | "metadata"
      >
    >
  ): Promise<Job | null>;
  requestJobCancellation(projectId: string): Promise<JobCancellationResult>;
  recoverStaleJobs(queue: string, staleBefore: string): Promise<StaleRecoveryResult>;

  insertArtifact(artifact: Artifact): Promise<Artifact>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  listArtifactsByProjectId(projectId: string): Promise<Artifact[]>;
  getLatestDraftArtifactByProjectId(projectId: string): Promise<Artifact | null>;
  getLatestVisibleArtifactByProjectId(projectId: string): Promise<Artifact | null>;
  updateArtifact(
    artifactId: string,
    patch: Partial<Pick<Artifact, "status" | "summary" | "body" | "renderedText" | "metadata">>
  ): Promise<Artifact | null>;

  insertApproval(approval: Approval): Promise<Approval>;
  getApproval(approvalId: string): Promise<Approval | null>;
  getLatestApprovalByProjectId(projectId: string): Promise<Approval | null>;
  updateApproval(
    approvalId: string,
    patch: Partial<Pick<Approval, "status" | "reviewer" | "note" | "decidedAt" | "metadata">>
  ): Promise<Approval | null>;

  insertRevisionRequest(revisionRequest: RevisionRequest): Promise<RevisionRequest>;
  getRevisionRequest(revisionRequestId: string): Promise<RevisionRequest | null>;
  getOpenRevisionByProjectId(projectId: string): Promise<RevisionRequest | null>;
  updateRevisionRequest(
    revisionRequestId: string,
    patch: Partial<
      Pick<RevisionRequest, "status" | "followupJobId" | "resolvedAt" | "sourceJobId" | "revisionNote" | "metadata">
    >
  ): Promise<RevisionRequest | null>;

  insertTimelineEvent(event: TimelineEvent): Promise<TimelineEvent>;
  listTimelineEvents(projectId: string): Promise<TimelineEvent[]>;

  claimTelegramInboundEvent(input: ClaimTelegramInboundEventInput): Promise<ClaimTelegramInboundEventResult>;
  getTelegramInboundEventByDedupeKey(dedupeKey: string): Promise<TelegramInboundEvent | null>;
  updateTelegramInboundEvent(
    eventId: string,
    patch: Partial<
      Pick<TelegramInboundEvent, "status" | "projectId" | "jobId" | "responseAction" | "ackSentAt" | "lastError" | "metadata">
    >
  ): Promise<TelegramInboundEvent | null>;

  upsertTelegramBinding(binding: TelegramBinding): Promise<TelegramBinding>;
  getTelegramBindingByProjectId(projectId: string): Promise<TelegramBinding | null>;
  listTelegramBindingsByConversation(input: {
    chatId: string;
    threadId?: string;
    userId?: string;
  }): Promise<TelegramBinding[]>;
  updateTelegramBinding(
    bindingId: string,
    patch: Partial<
      Pick<
        TelegramBinding,
        | "telegramUserId"
        | "telegramUsername"
        | "debugEnabled"
        | "awaitingRevisionNote"
        | "pendingRevisionArtifactId"
        | "lastInboundMessageId"
        | "lastOutboundMessageId"
        | "metadata"
      >
    >
  ): Promise<TelegramBinding | null>;
}

export interface DatabaseClient {
  sql: Sql;
  repositories: DatabaseRepositories;
  dispose(): Promise<void>;
}

const PROJECT_COLUMNS = `
  id, title, brief, status,
  current_job_id as "currentJobId",
  latest_artifact_id as "latestArtifactId",
  final_artifact_id as "finalArtifactId",
  debug_enabled as "debugEnabled",
  metadata,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const JOB_COLUMNS = `
  id, project_id as "projectId", type, status, queue, available_at as "availableAt",
  attempt_count as "attemptCount", max_attempts as "maxAttempts",
  claimed_by as "claimedBy", claim_token as "claimToken",
  claimed_at as "claimedAt", heartbeat_at as "heartbeatAt",
  cancel_requested_at as "cancelRequestedAt",
  completed_at as "completedAt", failed_at as "failedAt", cancelled_at as "cancelledAt",
  last_error as "lastError",
  parent_job_id as "parentJobId", source_artifact_id as "sourceArtifactId",
  revision_request_id as "revisionRequestId",
  input, metadata, created_at as "createdAt", updated_at as "updatedAt"
`;

const ARTIFACT_COLUMNS = `
  id, project_id as "projectId", job_id as "jobId", kind, status, version, title, summary, format, body,
  rendered_text as "renderedText", metadata, created_at as "createdAt", updated_at as "updatedAt"
`;

const APPROVAL_COLUMNS = `
  id, project_id as "projectId", artifact_id as "artifactId", status,
  requested_by as "requestedBy", reviewer, note, decided_at as "decidedAt",
  metadata, created_at as "createdAt", updated_at as "updatedAt"
`;

const REVISION_COLUMNS = `
  id, project_id as "projectId", artifact_id as "artifactId", source_job_id as "sourceJobId",
  approval_id as "approvalId", status, requested_by as "requestedBy",
  revision_note as "revisionNote", followup_job_id as "followupJobId",
  resolved_at as "resolvedAt", metadata, created_at as "createdAt", updated_at as "updatedAt"
`;

const TIMELINE_COLUMNS = `
  id, project_id as "projectId", job_id as "jobId", artifact_id as "artifactId",
  kind, actor_channel as "actorChannel", summary, details, occurred_at as "occurredAt",
  created_at as "createdAt", updated_at as "updatedAt"
`;

const TELEGRAM_BINDING_COLUMNS = `
  id, project_id as "projectId", telegram_chat_id as "telegramChatId", telegram_thread_id as "telegramThreadId",
  telegram_user_id as "telegramUserId", telegram_username as "telegramUsername",
  delivery_mode as "deliveryMode", debug_enabled as "debugEnabled",
  awaiting_revision_note as "awaitingRevisionNote",
  pending_revision_artifact_id as "pendingRevisionArtifactId",
  last_inbound_message_id as "lastInboundMessageId",
  last_outbound_message_id as "lastOutboundMessageId",
  metadata, created_at as "createdAt", updated_at as "updatedAt"
`;

const TELEGRAM_INBOUND_EVENT_COLUMNS = `
  id, dedupe_key as "dedupeKey", update_id as "updateId", callback_query_id as "callbackQueryId",
  kind, status, chat_id as "chatId", thread_id as "threadId", user_id as "userId", message_id as "messageId",
  project_id as "projectId", job_id as "jobId", response_action as "responseAction",
  ack_sent_at as "ackSentAt", last_error as "lastError", metadata,
  created_at as "createdAt", updated_at as "updatedAt"
`;

function toJsonValue(value: JsonObject): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  const sql = postgres(databaseUrl, {
    max: 4,
    idle_timeout: 5
  });

  const repositories: DatabaseRepositories = {
    async insertProject(project) {
      await sql`
        insert into ${sql(TABLES.projects)} (
          id, title, brief, status, current_job_id, latest_artifact_id, final_artifact_id, debug_enabled, metadata, created_at, updated_at
        ) values (
          ${project.id}, ${project.title}, ${project.brief}, ${project.status}, ${project.currentJobId ?? null},
          ${project.latestArtifactId ?? null}, ${project.finalArtifactId ?? null}, ${project.debugEnabled},
          ${sql.json(toJsonValue(project.metadata))}, ${project.createdAt}, ${project.updatedAt}
        )
      `;

      return project;
    },

    async getProject(projectId) {
      const rows = await sql<Project[]>`select ${sql.unsafe(PROJECT_COLUMNS)} from ${sql(TABLES.projects)} where id = ${projectId} limit 1`;
      return rows[0] ?? null;
    },

    async updateProject(projectId, patch) {
      const hasTitle = Object.prototype.hasOwnProperty.call(patch, "title");
      const hasBrief = Object.prototype.hasOwnProperty.call(patch, "brief");
      const hasStatus = Object.prototype.hasOwnProperty.call(patch, "status");
      const hasCurrentJobId = Object.prototype.hasOwnProperty.call(patch, "currentJobId");
      const hasLatestArtifactId = Object.prototype.hasOwnProperty.call(patch, "latestArtifactId");
      const hasFinalArtifactId = Object.prototype.hasOwnProperty.call(patch, "finalArtifactId");
      const hasDebugEnabled = Object.prototype.hasOwnProperty.call(patch, "debugEnabled");
      const hasMetadata = Object.prototype.hasOwnProperty.call(patch, "metadata");
      const rows = await sql<Project[]>`
        update ${sql(TABLES.projects)}
        set
          title = case when ${hasTitle} then ${patch.title ?? null} else title end,
          brief = case when ${hasBrief} then ${patch.brief ?? null} else brief end,
          status = case when ${hasStatus} then ${patch.status ?? null} else status end,
          current_job_id = case when ${hasCurrentJobId} then ${patch.currentJobId ?? null} else current_job_id end,
          latest_artifact_id = case when ${hasLatestArtifactId} then ${patch.latestArtifactId ?? null} else latest_artifact_id end,
          final_artifact_id = case when ${hasFinalArtifactId} then ${patch.finalArtifactId ?? null} else final_artifact_id end,
          debug_enabled = case when ${hasDebugEnabled} then ${patch.debugEnabled ?? null} else debug_enabled end,
          metadata = case when ${hasMetadata} then ${sql.json(toJsonValue(patch.metadata ?? {}))} else metadata end,
          updated_at = ${nowIso()}
        where id = ${projectId}
        returning ${sql.unsafe(PROJECT_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async insertProjectSource(source) {
      await sql`
        insert into ${sql(TABLES.projectSources)} (
          id, project_id, kind, source_ref, requested_by, external_user_id, raw_input, metadata, created_at, updated_at
        ) values (
          ${source.id}, ${source.projectId}, ${source.kind}, ${source.sourceRef ?? null}, ${source.requestedBy ?? null},
          ${source.externalUserId ?? null}, ${sql.json(toJsonValue(source.rawInput))},
          ${sql.json(toJsonValue(source.metadata))}, ${source.createdAt}, ${source.updatedAt}
        )
      `;

      return source;
    },

    async getProjectSourceByProjectId(projectId) {
      const rows = await sql<ProjectSource[]>`
        select
          id, project_id as "projectId", kind, source_ref as "sourceRef",
          requested_by as "requestedBy", external_user_id as "externalUserId",
          raw_input as "rawInput", metadata, created_at as "createdAt", updated_at as "updatedAt"
        from ${sql(TABLES.projectSources)}
        where project_id = ${projectId}
        order by created_at asc
        limit 1
      `;

      return rows[0] ?? null;
    },

    async upsertProjectContext(context) {
      const rows = await sql<ProjectContext[]>`
        insert into ${sql(TABLES.projectContexts)} (
          id, project_id, summary, goals, constraints, audience, metadata, created_at, updated_at
        ) values (
          ${context.id}, ${context.projectId}, ${context.summary},
          ${sql.json(context.goals)}, ${sql.json(context.constraints)}, ${sql.json(context.audience)},
          ${sql.json(toJsonValue(context.metadata))}, ${context.createdAt}, ${context.updatedAt}
        )
        on conflict (project_id) do update
        set
          summary = excluded.summary,
          goals = excluded.goals,
          constraints = excluded.constraints,
          audience = excluded.audience,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
        returning
          id, project_id as "projectId", summary, goals, constraints, audience, metadata,
          created_at as "createdAt", updated_at as "updatedAt"
      `;

      return rows[0]!;
    },

    async getProjectContextByProjectId(projectId) {
      const rows = await sql<ProjectContext[]>`
        select
          id, project_id as "projectId", summary, goals, constraints, audience, metadata,
          created_at as "createdAt", updated_at as "updatedAt"
        from ${sql(TABLES.projectContexts)}
        where project_id = ${projectId}
        limit 1
      `;

      return rows[0] ?? null;
    },

    async insertAttachment(attachment) {
      await sql`
        insert into ${sql(TABLES.attachments)} (
          id, project_id, source_id, artifact_id, kind, file_name, mime_type, storage_key, size_bytes, metadata, created_at, updated_at
        ) values (
          ${attachment.id}, ${attachment.projectId}, ${attachment.sourceId ?? null}, ${attachment.artifactId ?? null},
          ${attachment.kind}, ${attachment.fileName ?? null}, ${attachment.mimeType ?? null},
          ${attachment.storageKey ?? null}, ${attachment.sizeBytes ?? null},
          ${sql.json(toJsonValue(attachment.metadata))}, ${attachment.createdAt}, ${attachment.updatedAt}
        )
      `;

      return attachment;
    },

    async listAttachmentsByProjectId(projectId) {
      return sql<Attachment[]>`
        select
          id, project_id as "projectId", source_id as "sourceId", artifact_id as "artifactId",
          kind, file_name as "fileName", mime_type as "mimeType", storage_key as "storageKey", size_bytes as "sizeBytes",
          metadata, created_at as "createdAt", updated_at as "updatedAt"
        from ${sql(TABLES.attachments)}
        where project_id = ${projectId}
        order by created_at asc
      `;
    },

    async insertJob(job) {
      await sql`
        insert into ${sql(TABLES.jobs)} (
          id, project_id, type, status, queue, available_at, attempt_count, max_attempts,
          claimed_by, claim_token, claimed_at, heartbeat_at, cancel_requested_at,
          completed_at, failed_at, cancelled_at, last_error, parent_job_id, source_artifact_id, revision_request_id,
          input, metadata, created_at, updated_at
        ) values (
          ${job.id}, ${job.projectId}, ${job.type}, ${job.status}, ${job.queue}, ${job.availableAt},
          ${job.attemptCount}, ${job.maxAttempts}, ${job.claimedBy ?? null}, ${job.claimToken ?? null},
          ${job.claimedAt ?? null}, ${job.heartbeatAt ?? null}, ${job.cancelRequestedAt ?? null},
          ${job.completedAt ?? null}, ${job.failedAt ?? null}, ${job.cancelledAt ?? null}, ${job.lastError ?? null},
          ${job.parentJobId ?? null}, ${job.sourceArtifactId ?? null}, ${job.revisionRequestId ?? null},
          ${sql.json(toJsonValue(job.input))}, ${sql.json(toJsonValue(job.metadata))}, ${job.createdAt}, ${job.updatedAt}
        )
      `;

      return job;
    },

    async getJob(jobId) {
      const rows = await sql<Job[]>`select ${sql.unsafe(JOB_COLUMNS)} from ${sql(TABLES.jobs)} where id = ${jobId} limit 1`;
      return rows[0] ?? null;
    },

    async listJobsByProjectId(projectId) {
      return sql<Job[]>`
        select ${sql.unsafe(JOB_COLUMNS)}
        from ${sql(TABLES.jobs)}
        where project_id = ${projectId}
        order by created_at asc
      `;
    },

    async getActiveJobByProjectId(projectId) {
      const rows = await sql<Job[]>`
        select ${sql.unsafe(JOB_COLUMNS)}
        from ${sql(TABLES.jobs)}
        where project_id = ${projectId}
          and status in ('queued', 'running', 'cancel_requested')
        order by created_at desc
        limit 1
      `;

      return rows[0] ?? null;
    },

    async claimNextJob(input) {
      const currentTime = input.now ?? nowIso();
      const claimToken = createId("claim");

      const rows = await sql<Job[]>`
        update ${sql(TABLES.jobs)}
        set
          status = 'running',
          claimed_by = ${input.workerId},
          claim_token = ${claimToken},
          claimed_at = ${currentTime},
          heartbeat_at = ${currentTime},
          attempt_count = attempt_count + 1,
          updated_at = ${currentTime}
        where id = (
          select id
          from ${sql(TABLES.jobs)}
          where queue = ${input.queue}
            and status = 'queued'
            and available_at <= ${currentTime}
          order by available_at asc, created_at asc
          for update skip locked
          limit 1
        )
        returning ${sql.unsafe(JOB_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async heartbeatJob(jobId, claimToken) {
      const currentTime = nowIso();
      const rows = await sql<Job[]>`
        update ${sql(TABLES.jobs)}
        set
          heartbeat_at = ${currentTime},
          updated_at = ${currentTime}
        where id = ${jobId}
          and claim_token = ${claimToken}
          and status in ('running', 'cancel_requested')
        returning ${sql.unsafe(JOB_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async updateJob(jobId, patch) {
      const rows = await sql<Job[]>`
        update ${sql(TABLES.jobs)}
        set
          status = coalesce(${patch.status ?? null}, status),
          available_at = coalesce(${patch.availableAt ?? null}, available_at),
          attempt_count = coalesce(${patch.attemptCount ?? null}, attempt_count),
          claimed_by = coalesce(${patch.claimedBy ?? null}, claimed_by),
          claim_token = coalesce(${patch.claimToken ?? null}, claim_token),
          claimed_at = coalesce(${patch.claimedAt ?? null}, claimed_at),
          heartbeat_at = coalesce(${patch.heartbeatAt ?? null}, heartbeat_at),
          cancel_requested_at = coalesce(${patch.cancelRequestedAt ?? null}, cancel_requested_at),
          completed_at = coalesce(${patch.completedAt ?? null}, completed_at),
          failed_at = coalesce(${patch.failedAt ?? null}, failed_at),
          cancelled_at = coalesce(${patch.cancelledAt ?? null}, cancelled_at),
          last_error = coalesce(${patch.lastError ?? null}, last_error),
          parent_job_id = coalesce(${patch.parentJobId ?? null}, parent_job_id),
          source_artifact_id = coalesce(${patch.sourceArtifactId ?? null}, source_artifact_id),
          revision_request_id = coalesce(${patch.revisionRequestId ?? null}, revision_request_id),
          input = coalesce(${patch.input ? sql.json(toJsonValue(patch.input)) : null}, input),
          metadata = coalesce(${patch.metadata ? sql.json(toJsonValue(patch.metadata)) : null}, metadata),
          updated_at = ${nowIso()}
        where id = ${jobId}
        returning ${sql.unsafe(JOB_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async requestJobCancellation(projectId) {
      const currentTime = nowIso();
      const activeResult = await sql`
        update ${sql(TABLES.jobs)}
        set
          status = 'cancel_requested',
          cancel_requested_at = ${currentTime},
          updated_at = ${currentTime}
        where project_id = ${projectId}
          and status = 'running'
      `;

      const queuedResult = await sql`
        update ${sql(TABLES.jobs)}
        set
          status = 'cancelled',
          cancel_requested_at = ${currentTime},
          cancelled_at = ${currentTime},
          updated_at = ${currentTime}
        where project_id = ${projectId}
          and status = 'queued'
      `;

      return {
        activeJobsMarked: activeResult.count,
        queuedJobsCancelled: queuedResult.count
      };
    },

    async recoverStaleJobs(queue, staleBefore) {
      const failedResult = await sql`
        update ${sql(TABLES.jobs)}
        set
          status = 'failed',
          failed_at = ${nowIso()},
          last_error = coalesce(last_error, 'Job exceeded max attempts after stale recovery.'),
          updated_at = ${nowIso()}
        where queue = ${queue}
          and status = 'running'
          and heartbeat_at is not null
          and heartbeat_at < ${staleBefore}
          and attempt_count >= max_attempts
      `;

      const requeuedResult = await sql`
        update ${sql(TABLES.jobs)}
        set
          status = 'queued',
          claimed_by = null,
          claim_token = null,
          claimed_at = null,
          heartbeat_at = null,
          available_at = ${nowIso()},
          last_error = coalesce(last_error, 'Job requeued after stale heartbeat recovery.'),
          updated_at = ${nowIso()}
        where queue = ${queue}
          and status = 'running'
          and heartbeat_at is not null
          and heartbeat_at < ${staleBefore}
          and attempt_count < max_attempts
      `;

      return {
        requeuedJobs: requeuedResult.count,
        failedJobs: failedResult.count
      };
    },

    async insertArtifact(artifact) {
      await sql`
        insert into ${sql(TABLES.artifacts)} (
          id, project_id, job_id, kind, status, version, title, summary, format, body, rendered_text, metadata, created_at, updated_at
        ) values (
          ${artifact.id}, ${artifact.projectId}, ${artifact.jobId ?? null}, ${artifact.kind}, ${artifact.status}, ${artifact.version},
          ${artifact.title}, ${artifact.summary}, ${artifact.format}, ${sql.json(toJsonValue(artifact.body))},
          ${artifact.renderedText ?? null}, ${sql.json(toJsonValue(artifact.metadata))}, ${artifact.createdAt}, ${artifact.updatedAt}
        )
      `;

      return artifact;
    },

    async getArtifact(artifactId) {
      const rows = await sql<Artifact[]>`select ${sql.unsafe(ARTIFACT_COLUMNS)} from ${sql(TABLES.artifacts)} where id = ${artifactId} limit 1`;
      return rows[0] ?? null;
    },

    async listArtifactsByProjectId(projectId) {
      return sql<Artifact[]>`
        select ${sql.unsafe(ARTIFACT_COLUMNS)}
        from ${sql(TABLES.artifacts)}
        where project_id = ${projectId}
        order by version desc, created_at desc
      `;
    },

    async getLatestDraftArtifactByProjectId(projectId) {
      const rows = await sql<Artifact[]>`
        select ${sql.unsafe(ARTIFACT_COLUMNS)}
        from ${sql(TABLES.artifacts)}
        where project_id = ${projectId}
          and status = 'draft'
        order by version desc, created_at desc
        limit 1
      `;

      return rows[0] ?? null;
    },

    async getLatestVisibleArtifactByProjectId(projectId) {
      const rows = await sql<Artifact[]>`
        select ${sql.unsafe(ARTIFACT_COLUMNS)}
        from ${sql(TABLES.artifacts)}
        where project_id = ${projectId}
          and kind <> 'system_note'
          and status <> 'superseded'
        order by version desc, created_at desc
        limit 1
      `;

      return rows[0] ?? null;
    },

    async updateArtifact(artifactId, patch) {
      const rows = await sql<Artifact[]>`
        update ${sql(TABLES.artifacts)}
        set
          status = coalesce(${patch.status ?? null}, status),
          summary = coalesce(${patch.summary ?? null}, summary),
          body = coalesce(${patch.body ? sql.json(toJsonValue(patch.body)) : null}, body),
          rendered_text = coalesce(${patch.renderedText ?? null}, rendered_text),
          metadata = coalesce(${patch.metadata ? sql.json(toJsonValue(patch.metadata)) : null}, metadata),
          updated_at = ${nowIso()}
        where id = ${artifactId}
        returning ${sql.unsafe(ARTIFACT_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async insertApproval(approval) {
      await sql`
        insert into ${sql(TABLES.approvals)} (
          id, project_id, artifact_id, status, requested_by, reviewer, note, decided_at, metadata, created_at, updated_at
        ) values (
          ${approval.id}, ${approval.projectId}, ${approval.artifactId}, ${approval.status}, ${approval.requestedBy ?? null},
          ${approval.reviewer ?? null}, ${approval.note ?? null}, ${approval.decidedAt ?? null},
          ${sql.json(toJsonValue(approval.metadata))}, ${approval.createdAt}, ${approval.updatedAt}
        )
      `;

      return approval;
    },

    async getApproval(approvalId) {
      const rows = await sql<Approval[]>`select ${sql.unsafe(APPROVAL_COLUMNS)} from ${sql(TABLES.approvals)} where id = ${approvalId} limit 1`;
      return rows[0] ?? null;
    },

    async getLatestApprovalByProjectId(projectId) {
      const rows = await sql<Approval[]>`
        select ${sql.unsafe(APPROVAL_COLUMNS)}
        from ${sql(TABLES.approvals)}
        where project_id = ${projectId}
        order by created_at desc
        limit 1
      `;

      return rows[0] ?? null;
    },

    async updateApproval(approvalId, patch) {
      const rows = await sql<Approval[]>`
        update ${sql(TABLES.approvals)}
        set
          status = coalesce(${patch.status ?? null}, status),
          reviewer = coalesce(${patch.reviewer ?? null}, reviewer),
          note = coalesce(${patch.note ?? null}, note),
          decided_at = coalesce(${patch.decidedAt ?? null}, decided_at),
          metadata = coalesce(${patch.metadata ? sql.json(toJsonValue(patch.metadata)) : null}, metadata),
          updated_at = ${nowIso()}
        where id = ${approvalId}
        returning ${sql.unsafe(APPROVAL_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async insertRevisionRequest(revisionRequest) {
      await sql`
        insert into ${sql(TABLES.revisionRequests)} (
          id, project_id, artifact_id, source_job_id, approval_id, status, requested_by, revision_note, followup_job_id,
          resolved_at, metadata, created_at, updated_at
        ) values (
          ${revisionRequest.id}, ${revisionRequest.projectId}, ${revisionRequest.artifactId}, ${revisionRequest.sourceJobId ?? null},
          ${revisionRequest.approvalId ?? null}, ${revisionRequest.status}, ${revisionRequest.requestedBy ?? null},
          ${revisionRequest.revisionNote}, ${revisionRequest.followupJobId ?? null}, ${revisionRequest.resolvedAt ?? null},
          ${sql.json(toJsonValue(revisionRequest.metadata))}, ${revisionRequest.createdAt}, ${revisionRequest.updatedAt}
        )
      `;

      return revisionRequest;
    },

    async getRevisionRequest(revisionRequestId) {
      const rows = await sql<RevisionRequest[]>`
        select ${sql.unsafe(REVISION_COLUMNS)}
        from ${sql(TABLES.revisionRequests)}
        where id = ${revisionRequestId}
        limit 1
      `;

      return rows[0] ?? null;
    },

    async getOpenRevisionByProjectId(projectId) {
      const rows = await sql<RevisionRequest[]>`
        select ${sql.unsafe(REVISION_COLUMNS)}
        from ${sql(TABLES.revisionRequests)}
        where project_id = ${projectId}
          and status = 'queued'
        order by created_at desc
        limit 1
      `;

      return rows[0] ?? null;
    },

    async updateRevisionRequest(revisionRequestId, patch) {
      const rows = await sql<RevisionRequest[]>`
        update ${sql(TABLES.revisionRequests)}
        set
          status = coalesce(${patch.status ?? null}, status),
          followup_job_id = coalesce(${patch.followupJobId ?? null}, followup_job_id),
          source_job_id = coalesce(${patch.sourceJobId ?? null}, source_job_id),
          revision_note = coalesce(${patch.revisionNote ?? null}, revision_note),
          resolved_at = coalesce(${patch.resolvedAt ?? null}, resolved_at),
          metadata = coalesce(${patch.metadata ? sql.json(toJsonValue(patch.metadata)) : null}, metadata),
          updated_at = ${nowIso()}
        where id = ${revisionRequestId}
        returning ${sql.unsafe(REVISION_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async insertTimelineEvent(event) {
      await sql`
        insert into ${sql(TABLES.timelineEvents)} (
          id, project_id, job_id, artifact_id, kind, actor_channel, summary, details, occurred_at, created_at, updated_at
        ) values (
          ${event.id}, ${event.projectId}, ${event.jobId ?? null}, ${event.artifactId ?? null}, ${event.kind},
          ${event.actorChannel}, ${event.summary}, ${sql.json(toJsonValue(event.details))},
          ${event.occurredAt}, ${event.createdAt}, ${event.updatedAt}
        )
      `;

      return event;
    },

    async listTimelineEvents(projectId) {
      return sql<TimelineEvent[]>`
        select ${sql.unsafe(TIMELINE_COLUMNS)}
        from ${sql(TABLES.timelineEvents)}
        where project_id = ${projectId}
        order by occurred_at asc, created_at asc
      `;
    },

    async claimTelegramInboundEvent(input) {
      const event: TelegramInboundEvent = {
        id: createId("telegram_inbound_event"),
        dedupeKey: input.dedupeKey,
        updateId: input.updateId,
        callbackQueryId: input.callbackQueryId,
        kind: input.kind,
        status: "processing",
        chatId: input.chatId,
        threadId: input.threadId,
        userId: input.userId,
        messageId: input.messageId,
        projectId: undefined,
        jobId: undefined,
        responseAction: undefined,
        ackSentAt: undefined,
        lastError: undefined,
        metadata: input.metadata ?? {},
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      const insertedRows = await sql<TelegramInboundEvent[]>`
        insert into ${sql(TABLES.telegramInboundEvents)} (
          id, dedupe_key, update_id, callback_query_id, kind, status, chat_id, thread_id,
          user_id, message_id, project_id, job_id, response_action, ack_sent_at, last_error,
          metadata, created_at, updated_at
        ) values (
          ${event.id}, ${event.dedupeKey}, ${event.updateId ?? null}, ${event.callbackQueryId ?? null},
          ${event.kind}, ${event.status}, ${event.chatId}, ${event.threadId ?? null}, ${event.userId ?? null},
          ${event.messageId ?? null}, ${event.projectId ?? null}, ${event.jobId ?? null},
          ${event.responseAction ?? null}, ${event.ackSentAt ?? null}, ${event.lastError ?? null},
          ${sql.json(toJsonValue(event.metadata))}, ${event.createdAt}, ${event.updatedAt}
        )
        on conflict (dedupe_key) do nothing
        returning ${sql.unsafe(TELEGRAM_INBOUND_EVENT_COLUMNS)}
      `;

      if (insertedRows[0]) {
        return {
          event: insertedRows[0],
          isDuplicate: false
        };
      }

      const existing = await repositories.getTelegramInboundEventByDedupeKey(input.dedupeKey);
      if (!existing) {
        throw new Error(`Telegram inbound event ${input.dedupeKey} was not found after conflict`);
      }

      return {
        event: existing,
        isDuplicate: true
      };
    },

    async getTelegramInboundEventByDedupeKey(dedupeKey) {
      const rows = await sql<TelegramInboundEvent[]>`
        select ${sql.unsafe(TELEGRAM_INBOUND_EVENT_COLUMNS)}
        from ${sql(TABLES.telegramInboundEvents)}
        where dedupe_key = ${dedupeKey}
        limit 1
      `;

      return rows[0] ?? null;
    },

    async updateTelegramInboundEvent(eventId, patch) {
      const hasStatus = Object.prototype.hasOwnProperty.call(patch, "status");
      const hasProjectId = Object.prototype.hasOwnProperty.call(patch, "projectId");
      const hasJobId = Object.prototype.hasOwnProperty.call(patch, "jobId");
      const hasResponseAction = Object.prototype.hasOwnProperty.call(patch, "responseAction");
      const hasAckSentAt = Object.prototype.hasOwnProperty.call(patch, "ackSentAt");
      const hasLastError = Object.prototype.hasOwnProperty.call(patch, "lastError");
      const hasMetadata = Object.prototype.hasOwnProperty.call(patch, "metadata");
      const rows = await sql<TelegramInboundEvent[]>`
        update ${sql(TABLES.telegramInboundEvents)}
        set
          status = case when ${hasStatus} then ${patch.status ?? null} else status end,
          project_id = case when ${hasProjectId} then ${patch.projectId ?? null} else project_id end,
          job_id = case when ${hasJobId} then ${patch.jobId ?? null} else job_id end,
          response_action = case when ${hasResponseAction} then ${patch.responseAction ?? null} else response_action end,
          ack_sent_at = case when ${hasAckSentAt} then ${patch.ackSentAt ?? null} else ack_sent_at end,
          last_error = case when ${hasLastError} then ${patch.lastError ?? null} else last_error end,
          metadata = case when ${hasMetadata} then ${sql.json(toJsonValue(patch.metadata ?? {}))} else metadata end,
          updated_at = ${nowIso()}
        where id = ${eventId}
        returning ${sql.unsafe(TELEGRAM_INBOUND_EVENT_COLUMNS)}
      `;

      return rows[0] ?? null;
    },

    async upsertTelegramBinding(binding) {
      const rows = await sql<TelegramBinding[]>`
        insert into ${sql(TABLES.telegramBindings)} (
          id, project_id, telegram_chat_id, telegram_thread_id, telegram_user_id, telegram_username,
          delivery_mode, debug_enabled, awaiting_revision_note, pending_revision_artifact_id,
          last_inbound_message_id, last_outbound_message_id, metadata, created_at, updated_at
        ) values (
          ${binding.id}, ${binding.projectId}, ${binding.telegramChatId}, ${binding.telegramThreadId ?? null},
          ${binding.telegramUserId ?? null}, ${binding.telegramUsername ?? null}, ${binding.deliveryMode},
          ${binding.debugEnabled}, ${binding.awaitingRevisionNote}, ${binding.pendingRevisionArtifactId ?? null},
          ${binding.lastInboundMessageId ?? null}, ${binding.lastOutboundMessageId ?? null},
          ${sql.json(toJsonValue(binding.metadata))},
          ${binding.createdAt}, ${binding.updatedAt}
        )
        on conflict (project_id) do update
        set
          telegram_chat_id = excluded.telegram_chat_id,
          telegram_thread_id = excluded.telegram_thread_id,
          telegram_user_id = excluded.telegram_user_id,
          telegram_username = excluded.telegram_username,
          delivery_mode = excluded.delivery_mode,
          debug_enabled = excluded.debug_enabled,
          awaiting_revision_note = excluded.awaiting_revision_note,
          pending_revision_artifact_id = excluded.pending_revision_artifact_id,
          last_inbound_message_id = excluded.last_inbound_message_id,
          last_outbound_message_id = excluded.last_outbound_message_id,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
        returning ${sql.unsafe(TELEGRAM_BINDING_COLUMNS)}
      `;

      return rows[0]!;
    },

    async getTelegramBindingByProjectId(projectId) {
      const rows = await sql<TelegramBinding[]>`
        select ${sql.unsafe(TELEGRAM_BINDING_COLUMNS)}
        from ${sql(TABLES.telegramBindings)}
        where project_id = ${projectId}
        limit 1
      `;

      return rows[0] ?? null;
    },

    async listTelegramBindingsByConversation(input) {
      const rows =
        input.threadId === undefined
          ? await sql<TelegramBinding[]>`
              select ${sql.unsafe(TELEGRAM_BINDING_COLUMNS)}
              from ${sql(TABLES.telegramBindings)}
              where telegram_chat_id = ${input.chatId}
                and telegram_thread_id is null
              order by updated_at desc, created_at desc
            `
          : await sql<TelegramBinding[]>`
              select ${sql.unsafe(TELEGRAM_BINDING_COLUMNS)}
              from ${sql(TABLES.telegramBindings)}
              where telegram_chat_id = ${input.chatId}
                and telegram_thread_id = ${input.threadId}
              order by updated_at desc, created_at desc
            `;

      if (!input.userId) {
        return rows;
      }

      const exactUser = rows.filter((binding) => binding.telegramUserId === input.userId);
      return exactUser.length > 0 ? exactUser : rows;
    },

    async updateTelegramBinding(bindingId, patch) {
      const hasTelegramUserId = Object.prototype.hasOwnProperty.call(patch, "telegramUserId");
      const hasTelegramUsername = Object.prototype.hasOwnProperty.call(patch, "telegramUsername");
      const hasDebugEnabled = Object.prototype.hasOwnProperty.call(patch, "debugEnabled");
      const hasAwaitingRevisionNote = Object.prototype.hasOwnProperty.call(patch, "awaitingRevisionNote");
      const hasPendingRevisionArtifactId = Object.prototype.hasOwnProperty.call(patch, "pendingRevisionArtifactId");
      const hasLastInboundMessageId = Object.prototype.hasOwnProperty.call(patch, "lastInboundMessageId");
      const hasLastOutboundMessageId = Object.prototype.hasOwnProperty.call(patch, "lastOutboundMessageId");
      const hasMetadata = Object.prototype.hasOwnProperty.call(patch, "metadata");
      const rows = await sql<TelegramBinding[]>`
        update ${sql(TABLES.telegramBindings)}
        set
          telegram_user_id = case when ${hasTelegramUserId} then ${patch.telegramUserId ?? null} else telegram_user_id end,
          telegram_username = case when ${hasTelegramUsername} then ${patch.telegramUsername ?? null} else telegram_username end,
          debug_enabled = case when ${hasDebugEnabled} then ${patch.debugEnabled ?? null} else debug_enabled end,
          awaiting_revision_note = case when ${hasAwaitingRevisionNote} then ${patch.awaitingRevisionNote ?? null} else awaiting_revision_note end,
          pending_revision_artifact_id = case when ${hasPendingRevisionArtifactId} then ${patch.pendingRevisionArtifactId ?? null} else pending_revision_artifact_id end,
          last_inbound_message_id = case when ${hasLastInboundMessageId} then ${patch.lastInboundMessageId ?? null} else last_inbound_message_id end,
          last_outbound_message_id = case when ${hasLastOutboundMessageId} then ${patch.lastOutboundMessageId ?? null} else last_outbound_message_id end,
          metadata = case when ${hasMetadata} then ${sql.json(toJsonValue(patch.metadata ?? {}))} else metadata end,
          updated_at = ${nowIso()}
        where id = ${bindingId}
        returning ${sql.unsafe(TELEGRAM_BINDING_COLUMNS)}
      `;

      return rows[0] ?? null;
    }
  };

  return {
    sql,
    repositories,
    async dispose() {
      await sql.end();
    }
  };
}
