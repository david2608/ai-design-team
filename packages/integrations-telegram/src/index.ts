import type {
  Artifact,
  AttachmentReferenceInput,
  ArtifactVisualAsset,
  TelegramBinding,
  TelegramCallbackAction,
  TelegramFlowResult,
  TelegramGenerationProvider,
  TelegramInboundRequest,
  TelegramOutboundMessage,
  TelegramWebhookRequest
} from "@ai-design-team/types";
export * from "./progress.js";

interface TelegramUser {
  id?: number | string;
  username?: string;
}

interface TelegramChat {
  id: number | string;
  type?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramGetFileResponse {
  ok?: boolean;
  result?: {
    file_path?: string;
    file_size?: number;
  };
}

export interface TelegramCallbackPayload {
  action?: TelegramCallbackAction;
  provider?: TelegramGenerationProvider;
  projectId?: string;
  artifactId?: string;
}

export interface TelegramSendResult {
  ok: boolean;
  messageId?: string;
}

export interface TelegramDeliveryAdapter {
  status: "live" | "placeholder";
  botTokenConfigured: boolean;
  normalizeUpdate(update: TelegramWebhookRequest | unknown): TelegramInboundRequest | null;
  downloadFile(input: {
    attachmentId: string;
    sourceId?: string;
    order: number;
    kind: AttachmentReferenceInput["kind"];
    fileId: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }): Promise<AttachmentReferenceInput | null>;
  sendMessage(message: TelegramOutboundMessage): Promise<TelegramSendResult>;
  editMessage(input: {
    chatId: string;
    messageId: string;
    threadId?: string;
    text: string;
    buttons?: TelegramOutboundMessage["buttons"];
  }): Promise<TelegramSendResult>;
  sendChatAction(input: {
    chatId: string;
    threadId?: string;
    action: "typing" | "upload_photo" | "upload_document";
  }): Promise<void>;
  answerCallbackQuery(input: { callbackQueryId: string; text?: string; showAlert?: boolean }): Promise<void>;
  deliverArtifact(input: { binding: TelegramBinding; artifact: Artifact }): Promise<TelegramSendResult>;
  deliverPlaceholder(projectId: string): Promise<void>;
}

function getString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
}

function formatTelegramArtifact(artifact: Artifact): string {
  const body = artifact.body as Record<string, unknown>;
  const title = artifact.title;

  if (artifact.kind === "question") {
    const question = getString(body, "question") ?? artifact.summary;
    const options = getStringArray(body, "options");
    const needFromYou = getString(body, "needFromYou");

    return [
      title,
      "",
      question,
      options.length > 0 ? "" : undefined,
      ...options.map((option) => `- ${option}`),
      needFromYou ? "" : undefined,
      needFromYou ? `Reply with: ${needFromYou}` : undefined
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n");
  }

  const sections: string[] = [
    title,
    "",
    "Recommended direction",
    getString(body, "recommendedDirection") ?? artifact.summary,
    "",
    "Big idea",
    getString(body, "bigIdea") ?? artifact.summary
  ];

  const visualDirection = getString(body, "visualDirection");
  if (visualDirection) {
    sections.push("", "Visual direction", visualDirection);
  }

  const layoutIdea = getString(body, "layoutIdea");
  if (layoutIdea) {
    sections.push("", "Layout / composition", layoutIdea);
  }

  const copyDirection = getString(body, "copyDirection");
  if (copyDirection) {
    sections.push("", "Copy direction", copyDirection);
  }

  const finalPrompt = getString(body, "finalPrompt");
  if (finalPrompt) {
    sections.push("", "Final prompt", finalPrompt);
  }

  const styleOptions = getStringArray(body, "styleOptions");
  if (styleOptions.length > 0) {
    sections.push("", finalPrompt ? "Style options" : "Alternatives", ...styleOptions.map((option) => `- ${option}`));
  }

  const alternatives = getStringArray(body, "alternatives");
  if (alternatives.length > 0) {
    sections.push("", "Other routes", ...alternatives.map((option) => `- ${option}`));
  }

  const needFromYou = getString(body, "needFromYou");
  if (needFromYou) {
    sections.push("", "Need from you", needFromYou);
  }

  const nextAction = getString(body, "nextAction");
  if (nextAction) {
    sections.push("", "Next action", nextAction);
  }

  const assumptions = getStringArray(body, "assumptions");
  if (assumptions.length > 0) {
    sections.push("", "Assuming", ...assumptions.map((assumption) => `- ${assumption}`));
  }

  return sections.join("\n");
}

function toIdString(value?: string | number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

function buildDedupeKey(input: {
  updateId?: string;
  callbackQueryId?: string;
  chatId?: string;
  threadId?: string;
  messageId?: string;
}): string {
  if (input.callbackQueryId) {
    return `telegram:callback:${input.callbackQueryId}`;
  }

  if (input.updateId) {
    return `telegram:update:${input.updateId}`;
  }

  if (input.chatId && input.messageId) {
    return `telegram:message:${input.chatId}:${input.threadId ?? "main"}:${input.messageId}`;
  }

  return `telegram:fallback:${Date.now()}`;
}

function parseCommand(text?: string): TelegramInboundRequest["command"] {
  const trimmed = text?.trim().toLowerCase();
  if (trimmed === "use_gpt" || trimmed === "use_gemini") {
    return trimmed;
  }

  const token = text?.trim().split(/\s+/, 1)[0];
  if (!token?.startsWith("/")) {
    return undefined;
  }

  const normalized = token.slice(1).split("@", 1)[0]?.toLowerCase();
  if (
    normalized === "stop" ||
    normalized === "debug_on" ||
    normalized === "debug_off" ||
    normalized === "use_gpt" ||
    normalized === "use_gemini"
  ) {
    return normalized;
  }

  return undefined;
}

function getMessageText(message?: TelegramMessage): string | undefined {
  const value = message?.text ?? message?.caption;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getReplyReference(message?: TelegramMessage): TelegramInboundRequest["replyToMessage"] {
  const reply = message?.reply_to_message;
  if (!reply) {
    return undefined;
  }

  return {
    messageId: toIdString(reply.message_id),
    text: getMessageText(reply),
    userId: toIdString(reply.from?.id),
    username: reply.from?.username
  };
}

export function encodeTelegramCallbackData(
  action: TelegramCallbackAction,
  projectId: string,
  artifactId?: string
): string {
  const actionCode =
    action === "like"
      ? "l"
      : action === "dislike"
        ? "d"
        : action === "revise"
          ? "r"
          : action === "provider_gemini"
            ? "pg"
            : "po";
  // Telegram callback_data is limited to 64 bytes, so new button payloads only
  // carry the project id. Approval and revision handlers can resolve the latest
  // visible artifact by project when needed.
  const version = actionCode === "pg" || actionCode === "po" ? "v3" : "v2";
  return [version, actionCode, projectId].join("|");
}

export function decodeTelegramCallbackData(data?: string): TelegramCallbackPayload | null {
  if (!data) {
    return null;
  }

  const parts = data.split("|");
  const [version] = parts;

  if (version === "v3") {
    const [, actionCode, projectId] = parts;
    const provider = actionCode === "pg" ? "gemini" : actionCode === "po" ? "gpt" : undefined;
    if (!provider) {
      return null;
    }

    return {
      provider,
      projectId: projectId || undefined
    };
  }

  if (version === "v2") {
    const [, actionCode, projectId] = parts;
    const action =
      actionCode === "l" ? "like" : actionCode === "d" ? "dislike" : actionCode === "r" ? "revise" : undefined;
    if (!action) {
      return null;
    }

    return {
      action,
      projectId: projectId || undefined,
      artifactId: undefined
    };
  }

  const [, action, projectId, artifactId] = parts;
  if (version !== "v1") {
    return null;
  }

  if (action !== "like" && action !== "dislike" && action !== "revise") {
    return null;
  }

  return {
    action,
    projectId: projectId || undefined,
    artifactId: artifactId || undefined
  };
}

function extractAttachments(message?: TelegramMessage): TelegramInboundRequest["attachments"] {
  if (!message) {
    return [];
  }

  const attachments: TelegramInboundRequest["attachments"] = [];

  if (message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1]!;
    attachments.push({
      kind: "telegram_photo",
      fileId: photo.file_id,
      sizeBytes: photo.file_size,
      metadata: {
        width: photo.width ?? null,
        height: photo.height ?? null
      }
    });
  }

  if (message.document) {
    attachments.push({
      kind: "document",
      fileId: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
      sizeBytes: message.document.file_size,
      metadata: {}
    });
  }

  return attachments;
}

function buildInlineKeyboard(buttons?: TelegramOutboundMessage["buttons"]): Record<string, unknown> | undefined {
  if (!buttons || buttons.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: buttons.map((row) =>
      row.map((button) => ({
        text: button.text,
        callback_data: button.callbackData
      }))
    )
  };
}

function buildInlineKeyboardJson(buttons?: TelegramOutboundMessage["buttons"]): string | undefined {
  const keyboard = buildInlineKeyboard(buttons);
  return keyboard ? JSON.stringify(keyboard) : undefined;
}

async function postTelegram(botToken: string, method: string, payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram ${method} failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function postTelegramMultipart(
  botToken: string,
  method: string,
  payload: Record<string, string | Blob | undefined>
): Promise<any> {
  const form = new FormData();

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === "") {
      continue;
    }

    form.append(key, value);
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram ${method} failed: ${response.status} ${body}`);
  }

  return response.json();
}

function clipCaption(text: string, maxLength = 900): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function getVisualAsset(artifact: Artifact): ArtifactVisualAsset | null {
  const body = artifact.body as Record<string, unknown>;
  const raw = body.visualAsset;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (
    (candidate.kind !== "photo" && candidate.kind !== "document") ||
    typeof candidate.mimeType !== "string" ||
    typeof candidate.fileName !== "string" ||
    typeof candidate.base64Data !== "string" ||
    (candidate.source !== "gemini" && candidate.source !== "openai" && candidate.source !== "local_svg")
  ) {
    return null;
  }

  return {
    kind: candidate.kind,
    mimeType: candidate.mimeType,
    fileName: candidate.fileName,
    base64Data: candidate.base64Data,
    width: typeof candidate.width === "number" ? candidate.width : undefined,
    height: typeof candidate.height === "number" ? candidate.height : undefined,
    source: candidate.source,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : undefined
  };
}

function buildArtifactCaption(artifact: Artifact, debugEnabled: boolean): string {
  const body = artifact.body as Record<string, unknown>;
  const recommendedDirection = getString(body, "recommendedDirection") ?? artifact.summary;
  const bigIdea = getString(body, "bigIdea");
  const nextAction = getString(body, "nextAction");
  const lines = [
    artifact.title,
    "",
    recommendedDirection
  ];

  if (bigIdea) {
    lines.push("", `Big idea: ${bigIdea}`);
  }

  if (nextAction) {
    lines.push("", `Next: ${nextAction}`);
  }

  if (debugEnabled) {
    lines.push("", `Debug • project=${artifact.projectId} artifact=${artifact.id} version=${artifact.version}`);
  }

  return clipCaption(lines.join("\n"));
}

class BotApiTelegramDeliveryAdapter implements TelegramDeliveryAdapter {
  constructor(private readonly botToken: string) {}

  get botTokenConfigured(): boolean {
    return Boolean(this.botToken && this.botToken !== "telegram-token");
  }

  get status(): "live" | "placeholder" {
    return this.botTokenConfigured ? "live" : "placeholder";
  }

  normalizeUpdate(rawUpdate: TelegramWebhookRequest | unknown): TelegramInboundRequest | null {
    const update = rawUpdate as TelegramUpdate | undefined;
    if (!update) {
      return null;
    }

    if (update.message?.chat?.id !== undefined) {
      const message = update.message;
      const messageText = getMessageText(message);
      const updateId = toIdString(update.update_id) ?? `message-${message.message_id}`;
      const chatId = toIdString(message.chat.id)!;
      const threadId = toIdString(message.message_thread_id);
      const messageId = toIdString(message.message_id);
      return {
        source: "telegram",
        updateId,
        dedupeKey: buildDedupeKey({
          updateId,
          chatId,
          threadId,
          messageId
        }),
        kind: "message",
        text: messageText,
        command: parseCommand(messageText),
        chatId,
        threadId,
        userId: toIdString(message.from?.id),
        username: message.from?.username,
        messageId,
        replyToMessage: getReplyReference(message),
        attachments: extractAttachments(message),
        metadata: {
          chatType: message.chat.type ?? null
        }
      };
    }

    if (update.callback_query?.message?.chat?.id !== undefined) {
      const callback = update.callback_query;
      const callbackPayload = decodeTelegramCallbackData(callback.data);
      const updateId = toIdString(update.update_id) ?? `callback-${callback.id}`;
      const chatId = toIdString(callback.message?.chat.id)!;
      const threadId = toIdString(callback.message?.message_thread_id);
      const messageId = toIdString(callback.message?.message_id);
      return {
        source: "telegram",
        updateId,
        dedupeKey: buildDedupeKey({
          updateId,
          callbackQueryId: callback.id,
          chatId,
          threadId,
          messageId
        }),
        kind: "callback_query",
        text: getMessageText(callback.message),
        callbackAction: callbackPayload?.action,
        callbackProvider: callbackPayload?.provider,
        callbackQueryId: callback.id,
        callbackData: callback.data,
        chatId,
        threadId,
        userId: toIdString(callback.from?.id),
        username: callback.from?.username,
        messageId,
        attachments: [],
        metadata: {
          callbackData: callback.data ?? null
        },
        projectResolution: callbackPayload?.projectId
          ? {
              mode: "callback_target",
              projectId: callbackPayload.projectId,
              artifactId: callbackPayload.artifactId
            }
          : undefined
      };
    }

    return null;
  }

  async downloadFile(input: {
    attachmentId: string;
    sourceId?: string;
    order: number;
    kind: AttachmentReferenceInput["kind"];
    fileId: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }): Promise<AttachmentReferenceInput | null> {
    if (!this.botTokenConfigured) {
      return null;
    }

    const file = (await postTelegram(this.botToken, "getFile", {
      file_id: input.fileId
    })) as TelegramGetFileResponse;
    const filePath = file.result?.file_path;
    if (!filePath) {
      return null;
    }

    const response = await fetch(`https://api.telegram.org/file/bot${this.botToken}/${filePath}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram file download failed: ${response.status} ${body}`);
    }

    const fileBytes = Buffer.from(await response.arrayBuffer());
    const fileName = input.fileName ?? filePath.split("/").at(-1) ?? `${input.fileId}.bin`;
    const mimeType = input.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream";

    return {
      attachmentId: input.attachmentId,
      sourceId: input.sourceId,
      order: input.order,
      kind: input.kind,
      fileName,
      mimeType,
      storageKey: input.fileId,
      sizeBytes: input.sizeBytes ?? file.result?.file_size,
      base64Data: fileBytes.toString("base64")
    };
  }

  async sendMessage(message: TelegramOutboundMessage): Promise<TelegramSendResult> {
    if (!this.botTokenConfigured) {
      console.log("[telegram placeholder send]", message.text);
      return { ok: false };
    }

    if (message.media) {
      const fileBytes = Uint8Array.from(Buffer.from(message.media.base64Data, "base64"));
      const file = new Blob([fileBytes], {
        type: message.media.mimeType
      });
      const method = message.media.kind === "photo" ? "sendPhoto" : "sendDocument";
      const mediaField = message.media.kind === "photo" ? "photo" : "document";
      const result = await postTelegramMultipart(this.botToken, method, {
        chat_id: message.chatId,
        message_thread_id: message.threadId,
        reply_to_message_id: message.replyToMessageId,
        caption: clipCaption(message.text),
        reply_markup: buildInlineKeyboardJson(message.buttons),
        [mediaField]: new File([file], message.media.fileName, {
          type: message.media.mimeType
        })
      });

      return {
        ok: Boolean(result?.ok),
        messageId: toIdString(result?.result?.message_id)
      };
    }

    const result = await postTelegram(this.botToken, "sendMessage", {
      chat_id: message.chatId,
      message_thread_id: message.threadId,
      reply_to_message_id: message.replyToMessageId,
      text: message.text,
      reply_markup: buildInlineKeyboard(message.buttons)
    });

    return {
      ok: Boolean(result?.ok),
      messageId: toIdString(result?.result?.message_id)
    };
  }

  async editMessage(input: {
    chatId: string;
    messageId: string;
    threadId?: string;
    text: string;
    buttons?: TelegramOutboundMessage["buttons"];
  }): Promise<TelegramSendResult> {
    if (!this.botTokenConfigured) {
      console.log("[telegram placeholder edit]", input.text);
      return {
        ok: false,
        messageId: input.messageId
      };
    }

    const result = await postTelegram(this.botToken, "editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      reply_markup: buildInlineKeyboard(input.buttons)
    });

    return {
      ok: Boolean(result?.ok),
      messageId: toIdString(result?.result?.message_id) ?? input.messageId
    };
  }

  async sendChatAction(input: {
    chatId: string;
    threadId?: string;
    action: "typing" | "upload_photo" | "upload_document";
  }): Promise<void> {
    if (!this.botTokenConfigured) {
      return;
    }

    await postTelegram(this.botToken, "sendChatAction", {
      chat_id: input.chatId,
      message_thread_id: input.threadId,
      action: input.action
    });
  }

  async answerCallbackQuery(input: { callbackQueryId: string; text?: string; showAlert?: boolean }): Promise<void> {
    if (!this.botTokenConfigured) {
      console.log("[telegram placeholder callback]", input.text ?? "");
      return;
    }

    await postTelegram(this.botToken, "answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: input.showAlert ?? false
    });
  }

  async deliverArtifact(input: { binding: TelegramBinding; artifact: Artifact }): Promise<TelegramSendResult> {
    const visualAsset = getVisualAsset(input.artifact);
    const debugFooter = input.binding.debugEnabled
      ? `\n\n[debug] project=${input.binding.projectId} artifact=${input.artifact.id} version=${input.artifact.version}`
      : "";
    const text = visualAsset ? buildArtifactCaption(input.artifact, input.binding.debugEnabled) : `${formatTelegramArtifact(input.artifact)}${debugFooter}`;
    return this.sendMessage({
      chatId: input.binding.telegramChatId,
      threadId: input.binding.telegramThreadId,
      text,
      replyToMessageId: input.binding.lastInboundMessageId,
      media: visualAsset ?? undefined,
      buttons:
        input.artifact.kind === "design_result"
          ? [
              [
                {
                  text: "Finish",
                  callbackData: encodeTelegramCallbackData("like", input.binding.projectId, input.artifact.id)
                },
                {
                  text: "Revise",
                  callbackData: encodeTelegramCallbackData("revise", input.binding.projectId, input.artifact.id)
                }
              ]
            ]
          : undefined
    });
  }

  async deliverPlaceholder(projectId: string): Promise<void> {
    console.log(
      `[telegram placeholder] project=${projectId} configured=${this.botTokenConfigured ? "yes" : "no"}`
    );
  }
}

export function createTelegramDeliveryAdapter(botToken: string): TelegramDeliveryAdapter {
  return new BotApiTelegramDeliveryAdapter(botToken);
}

export async function deliverTelegramFlowResult(
  adapter: TelegramDeliveryAdapter,
  result: TelegramFlowResult,
  callbackQueryId?: string
): Promise<void> {
  if (callbackQueryId) {
    await adapter.answerCallbackQuery({
      callbackQueryId,
      text: result.callbackNotice
    });
  }

  for (const message of result.outboundMessages) {
    await adapter.sendMessage(message);
  }
}
