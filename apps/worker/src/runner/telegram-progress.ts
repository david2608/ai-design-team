import {
  formatCompactProgressMessage,
  formatDebugWorkflowMessage
} from "@ai-design-team/integrations-telegram";
import type {
  TelegramWorkflowNodeView,
  TelegramProgressPreview
} from "@ai-design-team/integrations-telegram";
import type {
  ArtifactPipelinePreview,
  ArtifactPipelineStageId,
  ArtifactPipelineStageUpdate
} from "@ai-design-team/ai";
import type { TelegramBinding, Artifact } from "@ai-design-team/types";
import type { WorkerContext } from "./context.js";

interface ProgressTrackerInput {
  context: WorkerContext;
  binding: TelegramBinding;
  traceId: string;
  workerId: string;
  projectId: string;
  jobId: string;
}

type TrackerMode = "compact" | "debug";
type ProgressState = "generating" | "refining" | "completed";

const NODE_ORDER: Array<{ id: ArtifactPipelineStageId | "deliver"; label: string }> = [
  { id: "intake", label: "Intake" },
  { id: "intent", label: "Intent" },
  { id: "clarify", label: "Clarify" },
  { id: "compose", label: "Compose" },
  { id: "render", label: "Render" },
  { id: "deliver", label: "Deliver" }
];

function nextLabelFor(id: ArtifactPipelineStageId | "deliver"): string | undefined {
  const index = NODE_ORDER.findIndex((node) => node.id === id);
  if (index === -1 || index === NODE_ORDER.length - 1) {
    return undefined;
  }

  return NODE_ORDER[index + 1]?.label;
}

function createNodes(): TelegramWorkflowNodeView[] {
  return NODE_ORDER.map((node) => ({
    id: node.id,
    label: node.label,
    status: "queued",
    detail: "Waiting in queue.",
    handoffToLabel: nextLabelFor(node.id)
  }));
}

function findNode(
  nodes: TelegramWorkflowNodeView[],
  id: ArtifactPipelineStageId | "deliver"
): TelegramWorkflowNodeView {
  const node = nodes.find((entry) => entry.id === id);
  if (!node) {
    throw new Error(`Missing workflow node ${id}`);
  }

  return node;
}

function describeActiveNode(nodes: TelegramWorkflowNodeView[]): {
  label?: string;
  detail?: string;
} {
  const activeNode = nodes.find((node) => node.status === "running");
  if (activeNode) {
    return {
      label: activeNode.label,
      detail: activeNode.detail
    };
  }

  const completedNode = [...nodes].reverse().find((node) => node.status === "completed");
  return completedNode
    ? {
        label: completedNode.label,
        detail: completedNode.detail
      }
    : {};
}

function describeProgress(nodes: TelegramWorkflowNodeView[], hasPreview: boolean, finished: boolean): {
  value: number;
  state: ProgressState;
} {
  if (finished) {
    return {
      value: 1,
      state: "completed"
    };
  }

  const total = NODE_ORDER.length;
  const runningIndex = nodes.findIndex((node) => node.status === "running");
  const completedCount = nodes.filter((node) => node.status === "completed").length;

  let value = completedCount / total;
  if (runningIndex >= 0) {
    value = (runningIndex + 0.45) / total;
  }

  if (hasPreview) {
    value = Math.max(value, 0.58);
  }

  return {
    value: Math.max(0.04, Math.min(0.98, value)),
    state: hasPreview ? "refining" : "generating"
  };
}

class TelegramProgressTracker {
  private readonly mode: TrackerMode;
  private readonly nodes = createNodes();
  private preview?: TelegramProgressPreview;
  private messageId?: string;
  private lastRenderedText?: string;
  private readonly replyToMessageId?: string;

  constructor(private readonly input: ProgressTrackerInput) {
    this.mode = input.binding.debugEnabled ? "debug" : "compact";
    this.replyToMessageId = input.binding.lastInboundMessageId;
  }

  async start(): Promise<void> {
    const intakeNode = findNode(this.nodes, "intake");
    intakeNode.status = "running";
    intakeNode.detail = "Brief received. Starting the first pass now.";

    await this.input.context.telegram.sendChatAction({
      chatId: this.input.binding.telegramChatId,
      threadId: this.input.binding.telegramThreadId,
      action: "typing"
    });

    const message = await this.input.context.telegram.sendMessage({
      chatId: this.input.binding.telegramChatId,
      threadId: this.input.binding.telegramThreadId,
      replyToMessageId: this.replyToMessageId,
      text: this.render()
    });

    this.messageId = message.messageId;
    this.lastRenderedText = this.render();
    this.input.context.logger.info("telegram.progress.sent", {
      traceId: this.input.traceId,
      workerId: this.input.workerId,
      projectId: this.input.projectId,
      jobId: this.input.jobId,
      chatId: this.input.binding.telegramChatId,
      messageId: this.messageId ?? null,
      mode: this.mode
    });
  }

  async handleStage(update: ArtifactPipelineStageUpdate): Promise<void> {
    const node = findNode(this.nodes, update.id);
    node.status = update.status;
    node.detail = update.detail ?? node.detail;
    await this.sync();
  }

  async handlePreview(preview: ArtifactPipelinePreview): Promise<void> {
    this.preview = {
      title: preview.title,
      recommendedDirection: preview.recommendedDirection,
      bigIdea: preview.bigIdea,
      nextStep: preview.nextStep
    };
    await this.sync();
  }

  async markDeliveryRunning(artifact: Artifact): Promise<void> {
    const node = findNode(this.nodes, "deliver");
    node.status = "running";
    node.detail =
      artifact.kind === "question"
        ? "Sending a short blocking question to Telegram."
        : "Sending the first pass back to Telegram.";

    const visualAsset =
      artifact.kind === "design_result" && artifact.body && typeof artifact.body === "object"
        ? (artifact.body as Record<string, unknown>).visualAsset
        : undefined;
    const isDocument =
      visualAsset &&
      typeof visualAsset === "object" &&
      (visualAsset as Record<string, unknown>).kind === "document";

    await this.input.context.telegram.sendChatAction({
      chatId: this.input.binding.telegramChatId,
      threadId: this.input.binding.telegramThreadId,
      action: artifact.kind === "question" ? "typing" : isDocument ? "upload_document" : "upload_photo"
    });
    await this.sync();
  }

  async markDeliveryComplete(): Promise<void> {
    const node = findNode(this.nodes, "deliver");
    node.status = "completed";
    node.detail = "Delivered successfully in Telegram.";
    await this.sync(true);
  }

  async markFailed(errorMessage: string): Promise<void> {
    const runningNode =
      this.nodes.find((node) => node.status === "running") ??
      findNode(this.nodes, "deliver");
    runningNode.status = "failed";
    runningNode.detail = errorMessage;
    await this.sync(false, true);
  }

  private render(finished = false, failed = false): string {
    const progress = describeProgress(this.nodes, Boolean(this.preview), finished);

    if (this.mode === "debug") {
      return formatDebugWorkflowMessage({
        nodes: this.nodes,
        preview: this.preview,
        progressValue: progress.value,
        progressState: progress.state,
        footer: failed
          ? "The run failed before delivery."
          : finished
            ? "The latest node states are final for this pass."
            : undefined
      });
    }

    const active = describeActiveNode(this.nodes);
    return formatCompactProgressMessage({
      headline: "On it now.",
      activeLabel: active.label,
      activeDetail: active.detail,
      preview: this.preview,
      progressValue: progress.value,
      progressState: progress.state,
      finished,
      failed
    });
  }

  private async sync(finished = false, failed = false): Promise<void> {
    const text = this.render(finished, failed);

    if (!this.messageId) {
      return;
    }

    if (text === this.lastRenderedText) {
      return;
    }

    try {
      await this.input.context.telegram.editMessage({
        chatId: this.input.binding.telegramChatId,
        threadId: this.input.binding.telegramThreadId,
        messageId: this.messageId,
        text
      });
      this.lastRenderedText = text;
      this.input.context.logger.info("telegram.progress.updated", {
        traceId: this.input.traceId,
        workerId: this.input.workerId,
        projectId: this.input.projectId,
        jobId: this.input.jobId,
        chatId: this.input.binding.telegramChatId,
        messageId: this.messageId,
        mode: this.mode
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("message is not modified")) {
        this.lastRenderedText = text;
        return;
      }

      this.input.context.logger.warn("telegram.progress.update_failed", {
        traceId: this.input.traceId,
        workerId: this.input.workerId,
        projectId: this.input.projectId,
        jobId: this.input.jobId,
        chatId: this.input.binding.telegramChatId,
        messageId: this.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function createTelegramProgressTracker(input: ProgressTrackerInput): TelegramProgressTracker {
  return new TelegramProgressTracker(input);
}
