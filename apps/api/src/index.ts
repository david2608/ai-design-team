import { getApiEnv } from "./config/env.js";
import { createApiContext } from "./server/context.js";
import { createApiServer } from "./server/router.js";

const env = getApiEnv();
const context = createApiContext(env);
const server = createApiServer(context);
const host = "0.0.0.0";

context.logger.info("api.startup", {
  port: env.apiPort,
  webhookRoute: "/telegram/webhook",
  telegramDeliveryMode: context.telegram.status,
  telegramBotConfigured: context.telegram.botTokenConfigured,
  debugRoutesEnabled: env.debugRoutesEnabled
});

server.listen(env.apiPort, host, () => {
  context.logger.info("API server listening", {
    port: env.apiPort,
    host
  });
});
