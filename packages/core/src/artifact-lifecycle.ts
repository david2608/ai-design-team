import type { DatabaseRepositories } from "@ai-design-team/db";
import type { Artifact, CreateArtifactInput } from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";

function nowIso(): string {
  return new Date().toISOString();
}

export interface ArtifactLifecycleService {
  createArtifact(input: CreateArtifactInput): Promise<Artifact>;
  getLatestDraft(projectId: string): Promise<Artifact | null>;
  getLatestVisible(projectId: string): Promise<Artifact | null>;
  markApproved(artifactId: string): Promise<Artifact | null>;
  markDisliked(artifactId: string): Promise<Artifact | null>;
  markRevisionRequested(artifactId: string): Promise<Artifact | null>;
}

export function createArtifactLifecycleService(repositories: DatabaseRepositories): ArtifactLifecycleService {
  return {
    async createArtifact(input) {
      const timestamp = nowIso();
      const latestVisible = await repositories.getLatestVisibleArtifactByProjectId(input.projectId);
      const artifact: Artifact = {
        id: createId("artifact"),
        projectId: input.projectId,
        jobId: input.jobId,
        kind: input.kind,
        status: "draft",
        version: input.version ?? (latestVisible?.version ?? 0) + 1,
        title: input.title,
        summary: input.summary,
        format: input.format,
        body: input.body ?? {},
        renderedText: input.renderedText,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      await repositories.insertArtifact(artifact);
      await repositories.updateProject(artifact.projectId, {
        latestArtifactId: artifact.id,
        status: artifact.kind === "design_result" ? "awaiting_approval" : "active"
      });
      await repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId: artifact.projectId,
        jobId: artifact.jobId,
        artifactId: artifact.id,
        kind: "artifact_created",
        actorChannel: "system",
        summary: "Artifact persisted.",
        details: {
          kind: artifact.kind,
          version: artifact.version
        },
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return artifact;
    },

    async getLatestDraft(projectId) {
      return repositories.getLatestDraftArtifactByProjectId(projectId);
    },

    async getLatestVisible(projectId) {
      return repositories.getLatestVisibleArtifactByProjectId(projectId);
    },

    async markApproved(artifactId) {
      return repositories.updateArtifact(artifactId, { status: "approved" });
    },

    async markDisliked(artifactId) {
      return repositories.updateArtifact(artifactId, { status: "disliked" });
    },

    async markRevisionRequested(artifactId) {
      return repositories.updateArtifact(artifactId, { status: "revision_requested" });
    }
  };
}
