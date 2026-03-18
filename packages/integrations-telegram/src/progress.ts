export type TelegramWorkflowNodeStatus = "queued" | "running" | "completed" | "failed";

export interface TelegramWorkflowNodeView {
  id: string;
  label: string;
  status: TelegramWorkflowNodeStatus;
  detail?: string;
  handoffToLabel?: string;
}

export interface TelegramProgressPreview {
  title: string;
  recommendedDirection: string;
  bigIdea?: string;
  nextStep?: string;
}

export type TelegramProgressState = "generating" | "refining" | "completed";

function iconForStatus(status: TelegramWorkflowNodeStatus): string {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "◌";
    case "failed":
      return "✕";
    default:
      return "·";
  }
}

function labelForStatus(status: TelegramWorkflowNodeStatus): string {
  switch (status) {
    case "completed":
      return "completed";
    case "running":
      return "running";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

function trimLine(value?: string, maxLength = 120): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function renderProgressBar(progressValue = 0, width = 15): string {
  const progress = Math.max(0, Math.min(1, progressValue));
  const filledCount = progress >= 1 ? width : Math.max(0, Math.min(width - 1, Math.floor(progress * width)));
  return `${"█".repeat(filledCount)}${"░".repeat(width - filledCount)}`;
}

function phaseLabel(state: TelegramProgressState): string {
  switch (state) {
    case "refining":
      return "refining";
    case "completed":
      return "completed";
    default:
      return "generating";
  }
}

function revealText(value: string | undefined, progressValue: number, minVisible = 18): string | undefined {
  const normalized = trimLine(value, 220);
  if (!normalized) {
    return undefined;
  }

  const progress = Math.max(0, Math.min(1, progressValue));
  if (progress >= 0.995) {
    return normalized;
  }

  const visibleCount = Math.max(minVisible, Math.ceil(normalized.length * progress));
  if (visibleCount >= normalized.length) {
    return normalized;
  }

  const slice = normalized.slice(0, visibleCount);
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf(","));
  const clipped = (lastBreak >= minVisible ? slice.slice(0, lastBreak) : slice).trim();
  return clipped ? `${clipped}…` : undefined;
}

export function formatCompactProgressMessage(input: {
  headline?: string;
  activeLabel?: string;
  activeDetail?: string;
  preview?: TelegramProgressPreview;
  progressValue?: number;
  progressState?: TelegramProgressState;
  finished?: boolean;
  failed?: boolean;
}): string {
  const lines: string[] = [];
  const progressState = input.finished ? "completed" : input.progressState ?? (input.preview ? "refining" : "generating");
  const progressValue = input.finished ? 1 : input.progressValue ?? 0;
  const progressLine = renderProgressBar(progressValue);

  if (input.failed) {
    lines.push("This pass hit a problem before delivery.", "I kept the thread alive. Send the prompt again and I’ll retry cleanly.");
    return lines.join("\n");
  }

  if (input.finished) {
    lines.push(progressLine);
    if (input.preview) {
      lines.push("", input.preview.title);
      const stableDirection = trimLine(input.preview.recommendedDirection, 220);
      if (stableDirection) {
        lines.push("", stableDirection);
      }
    }
    return lines.join("\n");
  }

  if (input.preview) {
    const previewProgress = progressState === "refining" ? Math.max(progressValue, 0.58) : progressValue;
    const recommendedDirection = revealText(input.preview.recommendedDirection, previewProgress, 26);
    const bigIdea = revealText(input.preview.bigIdea, Math.max(0, previewProgress - 0.12), 24);
    const nextStep =
      progressState === "refining"
        ? trimLine(input.preview.nextStep ?? "Stabilizing the first draft.")
        : trimLine(input.preview.nextStep ?? "Building the first draft.");
    lines.push(progressLine, "", input.preview.title);

    if (recommendedDirection) {
      lines.push("", recommendedDirection);
    }

    if (bigIdea) {
      lines.push("", bigIdea);
    }

    lines.push("", nextStep!);
    return lines.join("\n");
  }

  lines.push(progressLine, "", input.headline ?? "On it now.");
  if (input.activeLabel) {
    lines.push(
      "",
      `${phaseLabel(progressState)} · ${input.activeLabel}${input.activeDetail ? ` — ${trimLine(input.activeDetail, 96)}` : ""}`
    );
  }
  lines.push("", "I’ll send the direction as soon as the first draft is ready.");

  return lines.join("\n");
}

export function formatDebugWorkflowMessage(input: {
  nodes: TelegramWorkflowNodeView[];
  preview?: TelegramProgressPreview;
  heading?: string;
  footer?: string;
  progressValue?: number;
  progressState?: TelegramProgressState;
}): string {
  const progressState = input.progressState ?? (input.preview ? "refining" : "generating");
  const progressLine = `${renderProgressBar(input.progressValue ?? 0)} ${phaseLabel(progressState)}`;
  const lines: string[] = [progressLine, "", input.heading ?? "Team workflow"];

  for (const [index, node] of input.nodes.entries()) {
    lines.push(
      "",
      `${index + 1}. ${node.label} [${labelForStatus(node.status)}]`,
      `   ${iconForStatus(node.status)} ${trimLine(node.detail ?? "Waiting in queue.", 100) ?? "Waiting in queue."}`
    );

    if (node.handoffToLabel && node.status !== "failed") {
      lines.push(`   handoff -> ${node.handoffToLabel}`);
    }
  }

  if (input.preview) {
    lines.push(
      "",
      "Live draft",
      input.preview.title,
      input.preview.recommendedDirection
    );

    if (input.preview.bigIdea) {
      lines.push(input.preview.bigIdea);
    }

    if (input.preview.nextStep) {
      lines.push(input.preview.nextStep);
    }
  }

  if (input.footer) {
    lines.push("", trimLine(input.footer, 120)!);
  }

  return lines.join("\n");
}
