import type { ApprovalResponse, CreateApprovalRequest } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleCreateApproval(
  context: ApiContext,
  request: CreateApprovalRequest
): Promise<ApprovalResponse | null> {
  const result = await context.services.approvals.recordAction(request);
  return result ? { approval: result.approval, artifact: result.artifact } : null;
}
