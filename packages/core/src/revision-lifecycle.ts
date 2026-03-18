import type { DatabaseRepositories } from "@ai-design-team/db";
import type {
  Artifact,
  CreateRevisionInput,
  EnqueueArtifactJobInput,
  Job,
  RevisionRequest
} from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";

function nowIso(): string {
  return new Date().toISOString();
}

export interface RevisionLifecycleService {
  createRevision(
    input: CreateRevisionInput,
    enqueueJob: (input: EnqueueArtifactJobInput) => Promise<Job>
  ): Promise<{ revision: RevisionRequest; followupJob: Job; artifact: Artifact } | null>;
  completeRevision(revisionRequestId: string): Promise<RevisionRequest | null>;
}

export function createRevisionLifecycleService(repositories: DatabaseRepositories): RevisionLifecycleService {
  return {
    async createRevision(input, enqueueJob) {
      const artifact = input.artifactId
        ? await repositories.getArtifact(input.artifactId)
        : await repositories.getLatestVisibleArtifactByProjectId(input.projectId);

      if (!artifact) {
        return null;
      }

      const timestamp = nowIso();
      const revision: RevisionRequest = {
        id: createId("revision_request"),
        projectId: input.projectId,
        artifactId: artifact.id,
        sourceJobId: artifact.jobId,
        approvalId: undefined,
        status: "queued",
        requestedBy: input.requestedBy,
        revisionNote: input.revisionNote,
        followupJobId: undefined,
        resolvedAt: undefined,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      await repositories.insertRevisionRequest(revision);

      const followupJob = await enqueueJob({
        projectId: input.projectId,
        type: "artifact_revision",
        parentJobId: artifact.jobId,
        sourceArtifactId: artifact.id,
        revisionRequestId: revision.id,
        input: {
          revisionNote: input.revisionNote,
          sourceArtifactId: artifact.id,
          sourceId: typeof input.metadata?.sourceId === "string" ? input.metadata.sourceId : null,
          messageId: typeof input.metadata?.messageId === "string" ? input.metadata.messageId : null
        },
        metadata: input.metadata ?? {}
      });

      await repositories.updateRevisionRequest(revision.id, {
        followupJobId: followupJob.id
      });
      await repositories.updateArtifact(artifact.id, {
        status: "revision_requested"
      });
      await repositories.updateProject(input.projectId, {
        status: "revision_requested",
        currentJobId: followupJob.id
      });
      await repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId: input.projectId,
        jobId: followupJob.id,
        artifactId: artifact.id,
        kind: "revision_requested",
        actorChannel: "api",
        summary: "Revision requested and followup job queued.",
        details: {
          revisionRequestId: revision.id
        },
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        revision: {
          ...revision,
          followupJobId: followupJob.id
        },
        followupJob,
        artifact
      };
    },

    async completeRevision(revisionRequestId) {
      const revision = await repositories.updateRevisionRequest(revisionRequestId, {
        status: "completed",
        resolvedAt: nowIso()
      });

      if (revision) {
        const timestamp = nowIso();
        await repositories.insertTimelineEvent({
          id: createId("timeline_event"),
          projectId: revision.projectId,
          jobId: revision.followupJobId,
          artifactId: revision.artifactId,
          kind: "revision_completed",
          actorChannel: "system",
          summary: "Revision job completed.",
          details: {
            revisionRequestId: revision.id
          },
          occurredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      return revision;
    }
  };
}
