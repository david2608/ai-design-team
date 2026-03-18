import type {
  ClaimJobInput,
  DatabaseRepositories,
  JobCancellationResult,
  StaleRecoveryResult
} from "@ai-design-team/db";
import type { EnqueueArtifactJobInput, Job } from "@ai-design-team/types";
import { createId } from "@ai-design-team/utils";

function nowIso(): string {
  return new Date().toISOString();
}

export interface JobLifecycleService {
  enqueue(input: EnqueueArtifactJobInput): Promise<Job>;
  claimNext(input: ClaimJobInput): Promise<Job | null>;
  heartbeat(jobId: string, claimToken: string): Promise<Job | null>;
  complete(jobId: string): Promise<Job | null>;
  fail(jobId: string, lastError: string): Promise<Job | null>;
  cancel(jobId: string, reason?: string): Promise<Job | null>;
  requestStop(projectId: string): Promise<JobCancellationResult>;
  recover(queue: string, staleAfterMs: number): Promise<StaleRecoveryResult>;
}

export function createJobLifecycleService(repositories: DatabaseRepositories): JobLifecycleService {
  return {
    async enqueue(input) {
      const timestamp = nowIso();
      const job: Job = {
        id: createId("job"),
        projectId: input.projectId,
        type: input.type,
        status: "queued",
        queue: input.queue ?? "default",
        availableAt: input.availableAt ?? timestamp,
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 3,
        claimedBy: undefined,
        claimToken: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
        cancelRequestedAt: undefined,
        completedAt: undefined,
        failedAt: undefined,
        cancelledAt: undefined,
        lastError: undefined,
        parentJobId: input.parentJobId,
        sourceArtifactId: input.sourceArtifactId,
        revisionRequestId: input.revisionRequestId,
        input: input.input ?? {},
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp
      };

      await repositories.insertJob(job);
      await repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId: job.projectId,
        jobId: job.id,
        kind: "job_queued",
        actorChannel: "system",
        summary: "Job queued.",
        details: {
          type: job.type,
          queue: job.queue
        },
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return job;
    },

    async claimNext(input) {
      const job = await repositories.claimNextJob(input);
      if (!job) {
        return null;
      }

      const timestamp = nowIso();
      await repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId: job.projectId,
        jobId: job.id,
        kind: "job_running",
        actorChannel: "system",
        summary: "Worker claimed and started job.",
        details: {
          workerId: input.workerId,
          queue: input.queue
        },
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      await repositories.updateProject(job.projectId, {
        currentJobId: job.id,
        status: job.type === "artifact_revision" ? "revision_requested" : "active"
      });

      return job;
    },

    async heartbeat(jobId, claimToken) {
      return repositories.heartbeatJob(jobId, claimToken);
    },

    async complete(jobId) {
      const job = await repositories.updateJob(jobId, {
        status: "completed",
        completedAt: nowIso()
      });

      if (job) {
        const timestamp = nowIso();
        await repositories.insertTimelineEvent({
          id: createId("timeline_event"),
          projectId: job.projectId,
          jobId: job.id,
          kind: "job_completed",
          actorChannel: "system",
          summary: "Job completed.",
          details: {},
          occurredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      return job;
    },

    async fail(jobId, lastError) {
      const job = await repositories.updateJob(jobId, {
        status: "failed",
        failedAt: nowIso(),
        lastError
      });

      if (job) {
        const timestamp = nowIso();
        await repositories.insertTimelineEvent({
          id: createId("timeline_event"),
          projectId: job.projectId,
          jobId: job.id,
          kind: "job_failed",
          actorChannel: "system",
          summary: "Job failed.",
          details: {
            lastError
          },
          occurredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        await repositories.updateProject(job.projectId, {
          status: "failed"
        });
      }

      return job;
    },

    async cancel(jobId, reason) {
      const job = await repositories.updateJob(jobId, {
        status: "cancelled",
        cancelledAt: nowIso(),
        lastError: reason
      });

      if (job) {
        const timestamp = nowIso();
        await repositories.insertTimelineEvent({
          id: createId("timeline_event"),
          projectId: job.projectId,
          jobId: job.id,
          kind: "job_cancelled",
          actorChannel: "system",
          summary: "Job cancelled.",
          details: {
            reason: reason ?? ""
          },
          occurredAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      return job;
    },

    async requestStop(projectId) {
      const result = await repositories.requestJobCancellation(projectId);
      await repositories.updateProject(projectId, {
        status: result.activeJobsMarked > 0 ? "cancel_requested" : "cancelled"
      });

      const timestamp = nowIso();
      await repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId,
        kind: "job_cancel_requested",
        actorChannel: "system",
        summary: "Stop requested for project jobs.",
        details: {
          activeJobsMarked: result.activeJobsMarked,
          queuedJobsCancelled: result.queuedJobsCancelled
        },
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return result;
    },

    async recover(queue, staleAfterMs) {
      const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
      return repositories.recoverStaleJobs(queue, staleBefore);
    }
  };
}
