export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface AuditFields {
  createdAt: string;
  updatedAt: string;
}

export type SourceChannel = "telegram" | "figma" | "api" | "system";
export type ProjectSourceKind = "telegram" | "figma" | "api" | "system";
export type ProjectStatus =
  | "draft"
  | "active"
  | "awaiting_approval"
  | "revision_requested"
  | "cancel_requested"
  | "completed"
  | "cancelled"
  | "failed";
export type AttachmentKind = "image" | "document" | "figma_selection" | "reference";
export type JobType = "artifact_generation" | "artifact_revision" | "artifact_delivery";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancel_requested" | "cancelled";
export type ArtifactKind = "design_result" | "question" | "system_note";
export type ArtifactStatus = "draft" | "approved" | "disliked" | "revision_requested" | "superseded";
export type ApprovalStatus = "approved" | "disliked" | "revision_requested" | "superseded";
export type RevisionRequestStatus = "queued" | "completed" | "cancelled";
export type TimelineEventKind =
  | "project_created"
  | "job_queued"
  | "job_running"
  | "job_heartbeat"
  | "job_completed"
  | "job_failed"
  | "job_requeued"
  | "job_cancel_requested"
  | "job_cancelled"
  | "artifact_created"
  | "artifact_approved"
  | "artifact_disliked"
  | "revision_requested"
  | "revision_completed"
  | "telegram_delivered"
  | "debug_toggled";
export type TelegramDeliveryMode = "direct" | "thread";
export type ApprovalAction = "like" | "dislike";
export type TelegramInboundKind = "message" | "callback_query";
export type TelegramCommand = "stop" | "debug_on" | "debug_off" | "use_gpt" | "use_gemini";
export type TelegramGenerationProvider = "gemini" | "gpt";
export type TelegramCallbackAction = "like" | "dislike" | "revise" | "provider_gemini" | "provider_gpt";
export type TelegramInboundEventStatus = "processing" | "completed" | "failed";
export type TelegramProjectResolutionMode =
  | "new_project"
  | "continue_project"
  | "awaiting_revision_note"
  | "callback_target"
  | "unresolved";

export interface Project extends AuditFields {
  id: string;
  title: string;
  brief: string;
  status: ProjectStatus;
  currentJobId?: string;
  latestArtifactId?: string;
  finalArtifactId?: string;
  debugEnabled: boolean;
  metadata: JsonObject;
}

export interface ProjectSource extends AuditFields {
  id: string;
  projectId: string;
  kind: ProjectSourceKind;
  sourceRef?: string;
  requestedBy?: string;
  externalUserId?: string;
  rawInput: JsonObject;
  metadata: JsonObject;
}

export interface ProjectContext extends AuditFields {
  id: string;
  projectId: string;
  summary: string;
  goals: string[];
  constraints: string[];
  audience: string[];
  metadata: JsonObject;
}

export interface Attachment extends AuditFields {
  id: string;
  projectId: string;
  sourceId?: string;
  artifactId?: string;
  kind: AttachmentKind;
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  sizeBytes?: number;
  metadata: JsonObject;
}

export interface Job extends AuditFields {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  queue: string;
  availableAt: string;
  attemptCount: number;
  maxAttempts: number;
  claimedBy?: string;
  claimToken?: string;
  claimedAt?: string;
  heartbeatAt?: string;
  cancelRequestedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  lastError?: string;
  parentJobId?: string;
  sourceArtifactId?: string;
  revisionRequestId?: string;
  input: JsonObject;
  metadata: JsonObject;
}

export interface Artifact extends AuditFields {
  id: string;
  projectId: string;
  jobId?: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  version: number;
  title: string;
  summary: string;
  format: string;
  body: JsonObject;
  renderedText?: string;
  metadata: JsonObject;
}

export interface Approval extends AuditFields {
  id: string;
  projectId: string;
  artifactId: string;
  status: ApprovalStatus;
  requestedBy?: string;
  reviewer?: string;
  note?: string;
  decidedAt?: string;
  metadata: JsonObject;
}

export interface RevisionRequest extends AuditFields {
  id: string;
  projectId: string;
  artifactId: string;
  sourceJobId?: string;
  approvalId?: string;
  status: RevisionRequestStatus;
  requestedBy?: string;
  revisionNote: string;
  followupJobId?: string;
  resolvedAt?: string;
  metadata: JsonObject;
}

export interface TimelineEvent extends AuditFields {
  id: string;
  projectId: string;
  jobId?: string;
  artifactId?: string;
  kind: TimelineEventKind;
  actorChannel: SourceChannel;
  summary: string;
  details: JsonObject;
  occurredAt: string;
}

export interface TelegramBinding extends AuditFields {
  id: string;
  projectId: string;
  telegramChatId: string;
  telegramThreadId?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  deliveryMode: TelegramDeliveryMode;
  debugEnabled: boolean;
  awaitingRevisionNote: boolean;
  pendingRevisionArtifactId?: string;
  lastInboundMessageId?: string;
  lastOutboundMessageId?: string;
  metadata: JsonObject;
}

export interface ProjectSnapshot {
  project: Project;
  source?: ProjectSource;
  context?: ProjectContext;
  telegramBinding?: TelegramBinding;
  latestArtifact?: Artifact;
  latestDraftArtifact?: Artifact;
  latestVisibleArtifact?: Artifact;
  finalArtifact?: Artifact;
  latestApproval?: Approval;
  openRevision?: RevisionRequest;
  jobs: Job[];
  timeline: TimelineEvent[];
}

export interface TelegramAttachmentMetadata {
  kind: AttachmentKind | "telegram_photo";
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  metadata: JsonObject;
}

export interface TelegramProjectResolution {
  mode: TelegramProjectResolutionMode;
  projectId?: string;
  bindingId?: string;
  artifactId?: string;
}

export interface TelegramReplyReference {
  messageId?: string;
  text?: string;
  userId?: string;
  username?: string;
}

export interface TelegramInboundRequest {
  source: "telegram";
  updateId: string;
  dedupeKey: string;
  kind: TelegramInboundKind;
  text?: string;
  command?: TelegramCommand;
  callbackAction?: TelegramCallbackAction;
  callbackQueryId?: string;
  callbackData?: string;
  callbackProvider?: TelegramGenerationProvider;
  chatId: string;
  threadId?: string;
  userId?: string;
  username?: string;
  messageId?: string;
  replyToMessage?: TelegramReplyReference;
  attachments: TelegramAttachmentMetadata[];
  metadata: JsonObject;
  projectResolution?: TelegramProjectResolution;
}

export interface TelegramInboundEvent extends AuditFields {
  id: string;
  dedupeKey: string;
  updateId?: string;
  callbackQueryId?: string;
  kind: TelegramInboundKind;
  status: TelegramInboundEventStatus;
  chatId: string;
  threadId?: string;
  userId?: string;
  messageId?: string;
  projectId?: string;
  jobId?: string;
  responseAction?: TelegramFlowResult["action"];
  ackSentAt?: string;
  lastError?: string;
  metadata: JsonObject;
}

export interface TelegramOutboundButton {
  text: string;
  callbackData: string;
}

export interface ArtifactVisualAsset {
  kind: "photo" | "document";
  mimeType: string;
  fileName: string;
  base64Data: string;
  width?: number;
  height?: number;
  source: "gemini" | "openai" | "local_svg";
  prompt?: string;
}

export interface TelegramOutboundMessage {
  chatId: string;
  threadId?: string;
  text: string;
  replyToMessageId?: string;
  media?: ArtifactVisualAsset;
  buttons?: TelegramOutboundButton[][];
}

export interface TelegramFlowResult {
  accepted: boolean;
  action:
    | "noop"
    | "project_created"
    | "project_continued"
    | "revision_requested"
    | "stop_requested"
    | "stop_not_found"
    | "debug_toggled"
    | "artifact_liked"
    | "artifact_disliked"
    | "revision_prompted"
    | "provider_switched";
  projectId?: string;
  jobId?: string;
  artifactId?: string;
  resolution: TelegramProjectResolution;
  outboundMessages: TelegramOutboundMessage[];
  callbackNotice?: string;
}

export interface CreateProjectInput {
  title: string;
  brief: string;
  source: {
    kind: ProjectSourceKind;
    sourceRef?: string;
    requestedBy?: string;
    externalUserId?: string;
    rawInput?: JsonObject;
  };
  context?: {
    summary?: string;
    goals?: string[];
    constraints?: string[];
    audience?: string[];
    metadata?: JsonObject;
  };
  attachments?: Array<{
    kind: AttachmentKind;
    fileName?: string;
    mimeType?: string;
    storageKey?: string;
    sizeBytes?: number;
    metadata?: JsonObject;
  }>;
  telegramBinding?: {
    telegramChatId: string;
    telegramThreadId?: string;
    telegramUserId?: string;
    telegramUsername?: string;
    deliveryMode?: TelegramDeliveryMode;
    debugEnabled?: boolean;
    awaitingRevisionNote?: boolean;
    pendingRevisionArtifactId?: string;
    lastInboundMessageId?: string;
    metadata?: JsonObject;
  };
  metadata?: JsonObject;
}

export interface EnqueueArtifactJobInput {
  projectId: string;
  type: JobType;
  queue?: string;
  sourceArtifactId?: string;
  parentJobId?: string;
  revisionRequestId?: string;
  input?: JsonObject;
  maxAttempts?: number;
  availableAt?: string;
  metadata?: JsonObject;
}

export interface CreateArtifactInput {
  projectId: string;
  jobId?: string;
  kind: ArtifactKind;
  title: string;
  summary: string;
  format: string;
  body?: JsonObject;
  renderedText?: string;
  version?: number;
  metadata?: JsonObject;
}

export interface RecordApprovalActionInput {
  projectId: string;
  artifactId?: string;
  action: ApprovalAction;
  reviewer?: string;
  note?: string;
  metadata?: JsonObject;
}

export interface CreateRevisionInput {
  projectId: string;
  artifactId?: string;
  requestedBy?: string;
  revisionNote: string;
  metadata?: JsonObject;
}

export interface CreateProjectRequest extends CreateProjectInput {}

export interface CreateProjectResponse {
  project: Project;
  source: ProjectSource;
  context: ProjectContext;
  initialJob: Job;
  telegramBinding?: TelegramBinding;
}

export interface GetProjectResponse extends ProjectSnapshot {}

export interface TelegramWebhookRequest {
  [key: string]: JsonValue;
}

export interface TelegramWebhookResponse {
  accepted: boolean;
  action?: TelegramFlowResult["action"];
  projectId?: string;
  jobId?: string;
}

export interface CreateJobRequest extends EnqueueArtifactJobInput {}

export interface CreateJobResponse {
  job: Job;
}

export interface CreateApprovalRequest extends RecordApprovalActionInput {}

export interface ApprovalResponse {
  approval: Approval;
  artifact: Artifact;
}

export interface CreateRevisionRequest extends CreateRevisionInput {}

export interface RevisionResponse {
  revision: RevisionRequest;
  followupJob: Job;
}

export interface StopProjectRequest {
  projectId: string;
  reason?: string;
}

export interface StopProjectResponse {
  projectId: string;
  stopRequested: boolean;
  activeJobsMarked: number;
  queuedJobsCancelled: number;
}

export interface DebugToggleRequest {
  projectId?: string;
  bindingId?: string;
  enabled: boolean;
}

export interface DebugToggleResponse {
  scope: "project" | "telegram_binding";
  enabled: boolean;
  projectId?: string;
  bindingId?: string;
}

export interface HealthResponse {
  ok: true;
  service: "api" | "worker";
  timestamp: string;
}

export interface SnapshotBuildResult {
  snapshot: ProjectSnapshot;
}
