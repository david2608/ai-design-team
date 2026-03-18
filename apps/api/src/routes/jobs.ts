import type { CreateJobRequest, CreateJobResponse } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleCreateJob(
  context: ApiContext,
  request: CreateJobRequest
): Promise<CreateJobResponse> {
  const job = await context.services.jobs.enqueue(request);
  await context.database.repositories.updateProject(request.projectId, {
    currentJobId: job.id,
    status: job.type === "artifact_revision" ? "revision_requested" : "active"
  });

  return { job };
}
