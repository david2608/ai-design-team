import type { HealthResponse } from "@ai-design-team/types";

import type { ApiContext } from "../server/context.js";

export async function handleHealthRoute(_context: ApiContext): Promise<HealthResponse> {
  return {
    ok: true,
    service: "api",
    timestamp: new Date().toISOString()
  };
}
