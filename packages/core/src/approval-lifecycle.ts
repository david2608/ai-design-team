import type { DatabaseRepositories } from "@ai-design-team/db";
import type {
  Approval,
  Artifact,
  CreateApprovalRequest
} from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";

function nowIso(): string {
  return new Date().toISOString();
}

async function resolveTargetArtifact(
  repositories: DatabaseRepositories,
  projectId: string,
  artifactId?: string
): Promise<Artifact | null> {
  if (artifactId) {
    return repositories.getArtifact(artifactId);
  }

  return repositories.getLatestVisibleArtifactByProjectId(projectId);
}

export interface ApprovalLifecycleService {
  recordAction(input: CreateApprovalRequest): Promise<{ approval: Approval; artifact: Artifact } | null>;
}

export function createApprovalLifecycleService(repositories: DatabaseRepositories): ApprovalLifecycleService {
  return {
    async recordAction(input) {
      const artifact = await resolveTargetArtifact(repositories, input.projectId, input.artifactId);
      if (!artifact) {
        return null;
      }

      const timestamp = nowIso();
      const approval: Approval = {
        id: createId("approval"),
        projectId: input.projectId,
        artifactId: artifact.id,
        status: input.action === "like" ? "approved" : "disliked",
        requestedBy: input.reviewer,
        reviewer: input.reviewer,
        note: input.note,
        decidedAt: timestamp,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      await repositories.insertApproval(approval);

      const updatedArtifact =
        input.action === "like"
          ? await repositories.updateArtifact(artifact.id, { status: "approved" })
          : await repositories.updateArtifact(artifact.id, { status: "disliked" });

      if (!updatedArtifact) {
        return null;
      }

      await repositories.updateProject(input.projectId, {
        status: "completed",
        finalArtifactId: input.action === "like" ? updatedArtifact.id : undefined,
        currentJobId: undefined
      });

      await repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId: input.projectId,
        artifactId: updatedArtifact.id,
        kind: input.action === "like" ? "artifact_approved" : "artifact_disliked",
        actorChannel: "api",
        summary: input.action === "like" ? "Artifact approved." : "Artifact disliked.",
        details: {
          approvalId: approval.id
        },
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        approval,
        artifact: updatedArtifact
      };
    }
  };
}
