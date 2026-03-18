import assert from "node:assert/strict";
import test from "node:test";

import type { TelegramFlowResult, TelegramInboundEvent, TelegramInboundRequest } from "@ai-design-team/types";

import { handleTelegramWebhook } from "../src/routes/telegram.js";

function createEvent(input: {
  id: string;
  dedupeKey: string;
  kind: TelegramInboundEvent["kind"];
  updateId?: string;
  callbackQueryId?: string;
  chatId: string;
  messageId?: string;
}): TelegramInboundEvent {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    dedupeKey: input.dedupeKey,
    updateId: input.updateId,
    callbackQueryId: input.callbackQueryId,
    kind: input.kind,
    status: "processing",
    chatId: input.chatId,
    threadId: undefined,
    userId: undefined,
    messageId: input.messageId,
    projectId: undefined,
    jobId: undefined,
    responseAction: undefined,
    ackSentAt: undefined,
    lastError: undefined,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createContext(input: {
  inbound: TelegramInboundRequest;
  flowResult: TelegramFlowResult;
}) {
  const events = new Map<string, TelegramInboundEvent>();
  let handledCount = 0;
  let sentMessageCount = 0;
  let answeredCallbackCount = 0;

  const context = {
    telegram: {
      status: "live" as const,
      botTokenConfigured: true,
      normalizeUpdate: () => input.inbound,
      sendMessage: async () => {
        sentMessageCount += 1;
        return {
          ok: true,
          messageId: `message_${sentMessageCount}`
        };
      },
      answerCallbackQuery: async () => {
        answeredCallbackCount += 1;
      }
    },
    services: {
      telegram: {
        handleInbound: async () => {
          handledCount += 1;
          return input.flowResult;
        }
      }
    },
    database: {
      repositories: {
        claimTelegramInboundEvent: async (claim: {
          dedupeKey: string;
          updateId?: string;
          callbackQueryId?: string;
          kind: TelegramInboundEvent["kind"];
          chatId: string;
          messageId?: string;
        }) => {
          const existing = events.get(claim.dedupeKey);
          if (existing) {
            return {
              event: existing,
              isDuplicate: true
            };
          }

          const event = createEvent({
            id: `event_${events.size + 1}`,
            dedupeKey: claim.dedupeKey,
            kind: claim.kind,
            updateId: claim.updateId,
            callbackQueryId: claim.callbackQueryId,
            chatId: claim.chatId,
            messageId: claim.messageId
          });
          events.set(claim.dedupeKey, event);
          return {
            event,
            isDuplicate: false
          };
        },
        updateTelegramInboundEvent: async (
          eventId: string,
          patch: Partial<
            Pick<TelegramInboundEvent, "status" | "projectId" | "jobId" | "responseAction" | "ackSentAt" | "lastError">
          >
        ) => {
          const event = Array.from(events.values()).find((value) => value.id === eventId);
          assert.ok(event);
          Object.assign(event, patch);
          return event;
        }
      }
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  };

  return {
    context,
    getHandledCount: () => handledCount,
    getSentMessageCount: () => sentMessageCount,
    getAnsweredCallbackCount: () => answeredCallbackCount
  };
}

test("same Telegram message update only queues one business action and one acknowledgement", async () => {
  const inbound: TelegramInboundRequest = {
    source: "telegram",
    updateId: "101",
    dedupeKey: "telegram:update:101",
    kind: "message",
    text: "create poster for design meetup",
    chatId: "chat_1",
    messageId: "500",
    attachments: [],
    metadata: {}
  };
  const flowResult: TelegramFlowResult = {
    accepted: true,
    action: "project_created",
    projectId: "project_1",
    jobId: "job_1",
    resolution: {
      mode: "new_project",
      projectId: "project_1"
    },
    outboundMessages: [
      {
        chatId: "chat_1",
        text: "Got it. I have your brief. I'm preparing a first design draft now."
      }
    ]
  };
  const harness = createContext({ inbound, flowResult });

  await handleTelegramWebhook(harness.context as never, { update_id: 101 });
  await handleTelegramWebhook(harness.context as never, { update_id: 101 });
  await flushAsyncWork();

  assert.equal(harness.getHandledCount(), 1);
  assert.equal(harness.getSentMessageCount(), 1);
});

test("same Telegram callback query only answers once", async () => {
  const inbound: TelegramInboundRequest = {
    source: "telegram",
    updateId: "202",
    dedupeKey: "telegram:callback:cb_1",
    kind: "callback_query",
    callbackAction: "like",
    callbackQueryId: "cb_1",
    chatId: "chat_1",
    messageId: "501",
    attachments: [],
    metadata: {}
  };
  const flowResult: TelegramFlowResult = {
    accepted: true,
    action: "artifact_liked",
    projectId: "project_1",
    artifactId: "artifact_1",
    resolution: {
      mode: "callback_target",
      projectId: "project_1",
      artifactId: "artifact_1"
    },
    outboundMessages: [],
    callbackNotice: "Saved."
  };
  const harness = createContext({ inbound, flowResult });

  await handleTelegramWebhook(harness.context as never, { update_id: 202 });
  await handleTelegramWebhook(harness.context as never, { update_id: 202 });
  await flushAsyncWork();

  assert.equal(harness.getHandledCount(), 1);
  assert.equal(harness.getAnsweredCallbackCount(), 1);
});
