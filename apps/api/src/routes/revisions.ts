import type { CreateRevisionRequest, RevisionResponse } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleCreateRevision(
  context: ApiContext,
  request: CreateRevisionRequest
): Promise<RevisionResponse | null> {
  const result = await context.services.revisions.createRevision(request, (input) =>
    context.services.jobs.enqueue(input)
  );

  return result
    ? {
        revision: result.revision,
        followupJob: result.followupJob
      }
    : null;
}
