import type { StopProjectRequest, StopProjectResponse } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleStopProject(
  context: ApiContext,
  request: StopProjectRequest
): Promise<StopProjectResponse> {
  const cancellation = await context.services.jobs.requestStop(request.projectId);

  return {
    projectId: request.projectId,
    stopRequested: cancellation.activeJobsMarked > 0 || cancellation.queuedJobsCancelled > 0,
    activeJobsMarked: cancellation.activeJobsMarked,
    queuedJobsCancelled: cancellation.queuedJobsCancelled
  };
}
