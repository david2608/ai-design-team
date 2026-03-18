import type { TelegramWebhookRequest, TelegramWebhookResponse } from "@ai-design-team/types";
import { deliverTelegramFlowResult } from "@ai-design-team/integrations-telegram";
import { nowIso } from "@ai-design-team/db";

import type { ApiContext } from "../server/context.js";

async function deliverFlowResultAsync(
  context: ApiContext,
  traceId: string,
  eventId: string,
  dedupeKey: string,
  callbackQueryId: string | undefined,
  result: {
    action?: TelegramWebhookResponse["action"];
    projectId?: string;
    jobId?: string;
    accepted: boolean;
  },
  flowResult: Parameters<typeof deliverTelegramFlowResult>[1]
): Promise<void> {
  try {
    context.logger.info("telegram.ack.attempt", {
      traceId,
      dedupeKey,
      projectId: result.projectId,
      jobId: result.jobId,
      chatId: flowResult.outboundMessages[0]?.chatId ?? null,
      callbackQueryId: callbackQueryId ?? null,
      messageCount: flowResult.outboundMessages.length
    });
    await deliverTelegramFlowResult(context.telegram, flowResult, callbackQueryId);
    await context.database.repositories.updateTelegramInboundEvent(eventId, {
      ackSentAt: nowIso()
    });
    context.logger.info("telegram.ack.sent", {
      traceId,
      dedupeKey,
      projectId: result.projectId,
      jobId: result.jobId,
      chatId: flowResult.outboundMessages[0]?.chatId ?? null,
      action: result.action
    });
  } catch (error) {
    await context.database.repositories.updateTelegramInboundEvent(eventId, {
      lastError: error instanceof Error ? error.message : String(error)
    });
    context.logger.error("telegram.ack.failed", {
      traceId,
      eventId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function handleTelegramWebhook(
  context: ApiContext,
  payload: TelegramWebhookRequest
): Promise<TelegramWebhookResponse> {
  const inbound = context.telegram.normalizeUpdate(payload);

  if (!inbound) {
    context.logger.warn("telegram.update.unsupported", {
      traceId: "telegram:unsupported",
      reason: "unsupported_update_type"
    });
    return {
      accepted: true,
      action: "noop"
    };
  }

  const traceId = inbound.dedupeKey;

  context.logger.info("telegram.update.normalized", {
    traceId,
    dedupeKey: inbound.dedupeKey,
    kind: inbound.kind,
    command: inbound.command ?? null,
    callbackAction: inbound.callbackAction ?? null,
    hasText: Boolean(inbound.text?.trim()),
    attachmentCount: inbound.attachments.length
  });

  context.logger.info("telegram.update.recognized", {
    traceId,
    branch:
      inbound.callbackAction
        ? "callback"
        : inbound.command
          ? "command"
          : inbound.text?.trim()
            ? "plain_text"
            : "empty_message"
  });

  context.logger.info("telegram.update.received", {
    traceId,
    dedupeKey: inbound.dedupeKey,
    updateId: inbound.updateId,
    callbackQueryId: inbound.callbackQueryId,
    chatId: inbound.chatId,
    messageId: inbound.messageId
  });

  const claimed = await context.database.repositories.claimTelegramInboundEvent({
    dedupeKey: inbound.dedupeKey,
    updateId: inbound.updateId,
    callbackQueryId: inbound.callbackQueryId,
    kind: inbound.kind,
    chatId: inbound.chatId,
    threadId: inbound.threadId,
    userId: inbound.userId,
    messageId: inbound.messageId,
    metadata: {
      command: inbound.command ?? null,
      callbackAction: inbound.callbackAction ?? null
    }
  });

  if (claimed.isDuplicate) {
    context.logger.warn("telegram.update.duplicate_ignored", {
      traceId,
      dedupeKey: inbound.dedupeKey,
      eventId: claimed.event.id,
      status: claimed.event.status,
      ackSentAt: claimed.event.ackSentAt ?? null
    });
    return {
      accepted: true,
      action: claimed.event.responseAction,
      projectId: claimed.event.projectId,
      jobId: claimed.event.jobId
    };
  }

  let result;
  try {
    result = await context.services.telegram.handleInbound(inbound);
  } catch (error) {
    await context.database.repositories.updateTelegramInboundEvent(claimed.event.id, {
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
  await context.database.repositories.updateTelegramInboundEvent(claimed.event.id, {
    status: "completed",
    projectId: result.projectId,
    jobId: result.jobId,
    responseAction: result.action
  });
  if (result.jobId) {
    context.logger.info("telegram.job.queued", {
      traceId,
      dedupeKey: inbound.dedupeKey,
      projectId: result.projectId,
      jobId: result.jobId,
      action: result.action
    });
  } else {
    context.logger.info("telegram.flow.completed_without_job", {
      traceId,
      dedupeKey: inbound.dedupeKey,
      projectId: result.projectId ?? null,
      action: result.action
    });
  }
  setImmediate(() => {
    void deliverFlowResultAsync(
      context,
      traceId,
      claimed.event.id,
      inbound.dedupeKey,
      inbound.callbackQueryId,
      {
        accepted: result.accepted,
        action: result.action,
        projectId: result.projectId,
        jobId: result.jobId
      },
      result
    );
  });

  return {
    accepted: result.accepted,
    action: result.action,
    projectId: result.projectId,
    jobId: result.jobId
  };
}
