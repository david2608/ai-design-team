import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelegramDeliveryAdapter,
  decodeTelegramCallbackData,
  encodeTelegramCallbackData
} from "../src/index.ts";

test("encodeTelegramCallbackData keeps new callback payloads within Telegram limits", () => {
  const projectId = "project_12ee0b79d29a441fa5cfb84d8e1ab066";
  const artifactId = "artifact_995e42be4b07437daf8a2bb934a65a32";
  const payload = encodeTelegramCallbackData("revise", projectId, artifactId);

  assert.ok(Buffer.byteLength(payload, "utf8") <= 64, `callback_data too long: ${payload}`);
  assert.deepEqual(decodeTelegramCallbackData(payload), {
    action: "revise",
    projectId,
    artifactId: undefined
  });
});

test("decodeTelegramCallbackData remains compatible with legacy callback payloads", () => {
  assert.deepEqual(
    decodeTelegramCallbackData("v1|like|project_12ee0b79d29a441fa5cfb84d8e1ab066|artifact_995e42be4b07437daf8a2bb934a65a32"),
    {
      action: "like",
      projectId: "project_12ee0b79d29a441fa5cfb84d8e1ab066",
      artifactId: "artifact_995e42be4b07437daf8a2bb934a65a32"
    }
  );
});

test("encodeTelegramCallbackData remains compatible with legacy provider switch callbacks", () => {
  const projectId = "project_12ee0b79d29a441fa5cfb84d8e1ab066";
  const payload = encodeTelegramCallbackData("provider_gemini", projectId);

  assert.ok(Buffer.byteLength(payload, "utf8") <= 64, `callback_data too long: ${payload}`);
  assert.deepEqual(decodeTelegramCallbackData(payload), {
    provider: "gemini",
    projectId
  });
});

test("normalizeUpdate includes replied-to message text so reply-based prompts can reuse it", () => {
  const adapter = createTelegramDeliveryAdapter("telegram-token");
  const inbound = adapter.normalizeUpdate({
    update_id: 221552999,
    message: {
      message_id: 901,
      text: "this",
      chat: {
        id: 545046322,
        type: "private"
      },
      from: {
        id: 123
      },
      reply_to_message: {
        message_id: 877,
        caption: "dragon in water",
        chat: {
          id: 545046322,
          type: "private"
        },
        from: {
          id: 456,
          username: "design_bot"
        }
      }
    }
  });

  assert.equal(inbound?.text, "this");
  assert.deepEqual(inbound?.replyToMessage, {
    messageId: "877",
    text: "dragon in water",
    userId: "456",
    username: "design_bot"
  });
});
