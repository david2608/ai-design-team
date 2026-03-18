import type { CreateProjectRequest, CreateProjectResponse, GetProjectResponse } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleCreateProject(
  context: ApiContext,
  request: CreateProjectRequest
): Promise<CreateProjectResponse> {
  return context.services.projects.createProject(request);
}

export async function handleGetProject(
  context: ApiContext,
  projectId: string
): Promise<GetProjectResponse | null> {
  return context.services.snapshots.build(projectId);
}
