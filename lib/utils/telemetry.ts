type TelemetryLevel = "info" | "warn" | "error";

type TelemetryContext = Record<string, unknown>;

export type TelemetryEvent = {
  timestamp: string;
  level: TelemetryLevel;
  event: string;
  message: string;
  context?: TelemetryContext;
};

const MAX_EVENTS = 200;
const telemetryBuffer: TelemetryEvent[] = [];

export function logTelemetry(
  level: TelemetryLevel,
  event: string,
  message: string,
  context?: TelemetryContext,
) {
  const payload: TelemetryEvent = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    context,
  };

  telemetryBuffer.push(payload);
  if (telemetryBuffer.length > MAX_EVENTS) {
    telemetryBuffer.shift();
  }

  if (level === "error") {
    console.error(`[telemetry] ${event}: ${message}`, context ?? {});
    return;
  }

  if (level === "warn") {
    console.warn(`[telemetry] ${event}: ${message}`, context ?? {});
    return;
  }

  console.log(`[telemetry] ${event}: ${message}`, context ?? {});
}

export function getRecentTelemetryEvents(limit = 50) {
  return telemetryBuffer.slice(-Math.max(1, limit));
}
