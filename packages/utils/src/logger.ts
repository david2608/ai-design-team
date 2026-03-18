export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

function shouldLog(current: LogLevel, requested: LogLevel): boolean {
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  return order.indexOf(requested) >= order.indexOf(current);
}

export function createLogger(level: LogLevel = "info", scope = "app"): Logger {
  const write =
    (requested: LogLevel) =>
    (message: string, metadata?: Record<string, unknown>) => {
      if (!shouldLog(level, requested)) {
        return;
      }

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: requested,
          scope,
          message,
          metadata
        })
      );
    };

  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error")
  };
}
