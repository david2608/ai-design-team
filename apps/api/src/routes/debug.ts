import type { DebugToggleRequest, DebugToggleResponse } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleDebugToggle(
  context: ApiContext,
  request: DebugToggleRequest
): Promise<DebugToggleResponse> {
  let binding = request.bindingId
    ? await context.database.repositories.updateTelegramBinding(request.bindingId, {
        debugEnabled: request.enabled
      })
    : null;

  if (!binding && request.projectId) {
    const existing = await context.database.repositories.getTelegramBindingByProjectId(request.projectId);
    if (existing) {
      binding = await context.database.repositories.updateTelegramBinding(existing.id, {
        debugEnabled: request.enabled
      });
    }
  }

  if (binding) {
    return {
      scope: "telegram_binding",
      enabled: request.enabled,
      projectId: binding.projectId,
      bindingId: binding.id
    };
  }

  return {
    scope: "project",
    enabled: request.enabled,
    projectId: request.projectId
  };
}
