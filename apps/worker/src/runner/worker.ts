import { createId } from "@ai-design-team/utils";

import type { Job } from "@ai-design-team/types";
import type { WorkerContext } from "./context.js";
import { createTelegramProgressTracker } from "./telegram-progress.js";

function nowIso(): string {
  return new Date().toISOString();
}

function getJobTraceId(job: Pick<Job, "id" | "metadata">): string {
  const traceId = job.metadata?.traceId;
  return typeof traceId === "string" && traceId.trim() ? traceId : `job:${job.id}`;
}

async function checkCancellation(context: WorkerContext, jobId: string): Promise<Job | null> {
  const refreshedJob = await context.database.repositories.getJob(jobId);
  if (!refreshedJob) {
    context.logger.warn("worker.job.cancel_check_missing", {
      traceId: `job:${jobId}`,
      jobId
    });
    return null;
  }

  if (refreshedJob.status === "cancel_requested") {
    context.logger.info("worker.job.cancel_requested", {
      traceId: getJobTraceId(refreshedJob),
      jobId,
      projectId: refreshedJob.projectId
    });
    await context.services.jobs.cancel(jobId, "Cancellation requested by API stop flow.");
    await context.database.repositories.updateProject(refreshedJob.projectId, {
      status: "cancelled",
      currentJobId: undefined
    });
    return null;
  }

  return refreshedJob;
}

export async function processClaimedJob(context: WorkerContext, workerId: string): Promise<boolean> {
  const claimedJob = await context.services.jobs.claimNext({
    workerId,
    queue: "default"
  });

  if (!claimedJob || !claimedJob.claimToken) {
    context.logger.debug("worker.job.none_available", {
      workerId,
      queue: "default",
      reason: claimedJob ? "missing_claim_token" : "no_eligible_job"
    });
    return false;
  }

  const traceId = getJobTraceId(claimedJob);
  context.logger.info("worker.job.claimed", {
    traceId,
    workerId,
    jobId: claimedJob.id,
    projectId: claimedJob.projectId,
    type: claimedJob.type,
    attemptCount: claimedJob.attemptCount
  });

  const heartbeat = setInterval(() => {
    void context.services.jobs
      .heartbeat(claimedJob.id, claimedJob.claimToken!)
      .then(() => {
        context.logger.debug("worker.job.heartbeat", {
          traceId,
          workerId,
          jobId: claimedJob.id
        });
      })
      .catch((error) => {
        context.logger.error("worker.job.heartbeat_failed", {
          traceId,
          workerId,
          jobId: claimedJob.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }, context.env.heartbeatIntervalMs);

  let progressTracker: ReturnType<typeof createTelegramProgressTracker> | null = null;

  try {
    let currentJob = await checkCancellation(context, claimedJob.id);
    if (!currentJob) {
      context.logger.info("worker.job.cancelled_before_processing", {
        traceId,
        workerId,
        jobId: claimedJob.id,
        projectId: claimedJob.projectId
      });
      return true;
    }

    context.logger.info("worker.job.processing_started", {
      traceId,
      workerId,
      jobId: currentJob.id,
      projectId: currentJob.projectId,
      type: currentJob.type
    });

    const snapshot = await context.services.snapshots.build(currentJob.projectId);
    if (!snapshot) {
      throw new Error(`Project ${currentJob.projectId} was not found`);
    }

    progressTracker = snapshot.telegramBinding
      ? createTelegramProgressTracker({
          context,
          binding: snapshot.telegramBinding,
          traceId,
          workerId,
          projectId: snapshot.project.id,
          jobId: currentJob.id
        })
      : null;

    if (progressTracker) {
      await progressTracker.start();
    }

    currentJob = await checkCancellation(context, currentJob.id);
    if (!currentJob) {
      context.logger.info("worker.job.cancelled_before_generation", {
        traceId,
        workerId,
        jobId: claimedJob.id,
        projectId: claimedJob.projectId
      });
      return true;
    }

    const pipelineResult = await context.pipeline.generate(snapshot, currentJob, {
      onStageUpdate: async (update) => {
        await progressTracker?.handleStage(update);
      },
      onPreview: async (preview) => {
        await progressTracker?.handlePreview(preview);
      }
    });
    if (!pipelineResult) {
      context.logger.warn("worker.job.no_artifact_generated", {
        traceId,
        workerId,
        jobId: currentJob.id,
        projectId: currentJob.projectId,
        reason: "artifact_generation_returned_nothing"
      });
      throw new Error("Artifact generation returned nothing.");
    }

    currentJob = await checkCancellation(context, currentJob.id);
    if (!currentJob) {
      context.logger.info("worker.job.cancelled_after_generation", {
        traceId,
        workerId,
        jobId: claimedJob.id,
        projectId: claimedJob.projectId
      });
      return true;
    }

    const artifact = await context.services.artifacts.createArtifact({
      projectId: snapshot.project.id,
      jobId: currentJob.id,
      kind: pipelineResult.kind,
      title: pipelineResult.title,
      summary: pipelineResult.summary,
      format: pipelineResult.format,
      body: pipelineResult.body,
      renderedText: pipelineResult.renderedText
    });

    context.logger.info("worker.artifact.created", {
      traceId,
      workerId,
      jobId: currentJob.id,
      projectId: currentJob.projectId,
      artifactId: artifact.id,
      artifactKind: artifact.kind
    });

    if (currentJob.revisionRequestId && artifact.kind === "design_result") {
      await context.services.revisions.completeRevision(currentJob.revisionRequestId);
    }

    currentJob = await checkCancellation(context, currentJob.id);
    if (!currentJob) {
      context.logger.info("worker.job.cancelled_after_artifact", {
        traceId,
        workerId,
        jobId: claimedJob.id,
        projectId: claimedJob.projectId
      });
      return true;
    }

    if (snapshot.telegramBinding) {
      if (artifact.kind === "question" && currentJob.revisionRequestId && currentJob.sourceArtifactId) {
        await context.database.repositories.updateTelegramBinding(snapshot.telegramBinding.id, {
          awaitingRevisionNote: true,
          pendingRevisionArtifactId: currentJob.sourceArtifactId
        });
      }

      context.logger.info("telegram.result_send.attempt", {
        traceId,
        workerId,
        projectId: snapshot.project.id,
        jobId: currentJob.id,
        artifactId: artifact.id,
        chatId: snapshot.telegramBinding.telegramChatId
      });
      await progressTracker?.markDeliveryRunning(artifact);
      const delivery = await context.telegram.deliverArtifact({
        binding: snapshot.telegramBinding,
        artifact
      });

      if (!delivery.ok) {
        context.logger.warn("telegram.result_send.failed", {
          traceId,
          workerId,
          projectId: snapshot.project.id,
          jobId: currentJob.id,
          artifactId: artifact.id,
          chatId: snapshot.telegramBinding.telegramChatId,
          reason: "telegram_adapter_returned_not_ok"
        });
        await progressTracker?.markFailed("Telegram did not accept the outgoing result message.");
      } else {
        context.logger.info("telegram.result_send.sent", {
          traceId,
          workerId,
          projectId: snapshot.project.id,
          jobId: currentJob.id,
          artifactId: artifact.id,
          chatId: snapshot.telegramBinding.telegramChatId,
          messageId: delivery.messageId ?? null
        });
        await progressTracker?.markDeliveryComplete();
      }

      if (delivery.messageId) {
        await context.database.repositories.updateTelegramBinding(snapshot.telegramBinding.id, {
          lastOutboundMessageId: delivery.messageId
        });
      }
      await context.database.repositories.insertTimelineEvent({
        id: createId("timeline_event"),
        projectId: snapshot.project.id,
        jobId: currentJob.id,
        artifactId: artifact.id,
        kind: "telegram_delivered",
        actorChannel: "telegram",
        summary: "Artifact delivered to Telegram.",
        details: {
          bindingId: snapshot.telegramBinding.id,
          delivered: delivery.ok
        },
        occurredAt: nowIso(),
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    } else {
      context.logger.warn("telegram.result_send.skipped", {
        traceId,
        workerId,
        projectId: snapshot.project.id,
        jobId: currentJob.id,
        reason: "no_telegram_binding"
      });
      await context.telegram.deliverPlaceholder(snapshot.project.id);
    }
    await context.services.jobs.complete(currentJob.id);
    const nextProjectStatus =
      artifact.kind === "question"
        ? currentJob.type === "artifact_revision"
          ? "revision_requested"
          : "active"
        : "awaiting_approval";
    await context.database.repositories.updateProject(snapshot.project.id, {
      status: nextProjectStatus,
      latestArtifactId: artifact.id,
      currentJobId: undefined
    });
    await context.database.repositories.insertTimelineEvent({
      id: createId("timeline_event"),
      projectId: snapshot.project.id,
      jobId: currentJob.id,
      artifactId: artifact.id,
      kind: "job_completed",
      actorChannel: "system",
      summary: "Worker completed runtime backbone job.",
      details: {
        workerId,
        provider: typeof currentJob.metadata?.provider === "string" ? currentJob.metadata.provider : "gemini",
        visualSource: (artifact.body as { visualAsset?: { source?: string } }).visualAsset?.source ?? null
      },
      occurredAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    context.logger.info("worker.job.finished", {
      traceId,
      workerId,
      jobId: currentJob.id,
      projectId: snapshot.project.id,
      artifactId: artifact.id,
      nextProjectStatus
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const snapshot = await context.services.snapshots.build(claimedJob.projectId).catch(() => null);
    if (snapshot?.telegramBinding) {
      await progressTracker?.markFailed(message);
    }
    await context.services.jobs.fail(claimedJob.id, message);
    context.logger.error("worker.job.failed", {
      traceId,
      workerId,
      jobId: claimedJob.id,
      projectId: claimedJob.projectId,
      error: message
    });
    return true;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function startWorker(context: WorkerContext): Promise<void> {
  const workerId = createId("worker");

  context.logger.info("worker.loop.started", {
    workerId,
    runtimeEnabled: context.env.runtimeEnabled,
    queue: "default",
    pollIntervalMs: context.env.pollIntervalMs
  });

  while (true) {
    try {
      const recovery = await context.services.jobs.recover("default", context.env.staleAfterMs);
      if (recovery.requeuedJobs > 0 || recovery.failedJobs > 0) {
        context.logger.warn("worker.jobs.recovered", {
          workerId,
          requeuedJobs: recovery.requeuedJobs,
          failedJobs: recovery.failedJobs
        });
      }
    } catch (error) {
      context.logger.error("worker.recovery.failed", {
        workerId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await processClaimedJob(context, workerId);
    } catch (error) {
      context.logger.error("worker.loop.iteration_failed", {
        workerId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await new Promise((resolve) => setTimeout(resolve, context.env.pollIntervalMs));
  }
}
