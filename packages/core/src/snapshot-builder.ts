import type { DatabaseRepositories } from "@ai-design-team/db";
import type { ProjectSnapshot } from "@ai-design-team/types";

export interface SnapshotBuilder {
  build(projectId: string): Promise<ProjectSnapshot | null>;
}

export function createSnapshotBuilder(repositories: DatabaseRepositories): SnapshotBuilder {
  return {
    async build(projectId) {
      const project = await repositories.getProject(projectId);
      if (!project) {
        return null;
      }

      const [source, context, telegramBinding, jobs, latestDraftArtifact, latestVisibleArtifact, latestApproval, openRevision, timeline] =
        await Promise.all([
          repositories.getProjectSourceByProjectId(projectId),
          repositories.getProjectContextByProjectId(projectId),
          repositories.getTelegramBindingByProjectId(projectId),
          repositories.listJobsByProjectId(projectId),
          repositories.getLatestDraftArtifactByProjectId(projectId),
          repositories.getLatestVisibleArtifactByProjectId(projectId),
          repositories.getLatestApprovalByProjectId(projectId),
          repositories.getOpenRevisionByProjectId(projectId),
          repositories.listTimelineEvents(projectId)
        ]);

      const latestArtifact = project.latestArtifactId
        ? await repositories.getArtifact(project.latestArtifactId)
        : latestVisibleArtifact ?? undefined;
      const finalArtifact = project.finalArtifactId
        ? await repositories.getArtifact(project.finalArtifactId)
        : latestApproval?.status === "approved"
          ? latestVisibleArtifact ?? undefined
          : undefined;

      return {
        project,
        source: source ?? undefined,
        context: context ?? undefined,
        telegramBinding: telegramBinding ?? undefined,
        latestArtifact: latestArtifact ?? undefined,
        latestDraftArtifact: latestDraftArtifact ?? undefined,
        latestVisibleArtifact: latestVisibleArtifact ?? undefined,
        finalArtifact: finalArtifact ?? undefined,
        latestApproval: latestApproval ?? undefined,
        openRevision: openRevision ?? undefined,
        jobs,
        timeline
      };
    }
  };
}
