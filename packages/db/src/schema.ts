export const TABLES = {
  projects: "projects",
  projectSources: "project_sources",
  projectContexts: "project_contexts",
  attachments: "attachments",
  jobs: "jobs",
  artifacts: "artifacts",
  approvals: "approvals",
  revisionRequests: "revision_requests",
  timelineEvents: "timeline_events",
  telegramBindings: "telegram_bindings",
  telegramInboundEvents: "telegram_inbound_events"
} as const;

export function nowIso(): string {
  return new Date().toISOString();
}
