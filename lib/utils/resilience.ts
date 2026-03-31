import { logTelemetry } from "@/lib/utils/telemetry";

type QueryLikeResult<T> = {
  data: T | null;
  error: unknown | null;
};

type RetryOptions = {
  retries?: number;
  delayMs?: number;
  operationName?: string;
  context?: Record<string, unknown>;
};

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong.",
) {
  if (!error) {
    return fallback;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message ?? fallback);
  }

  return fallback;
}

export function isTransientError(error: unknown) {
  const message = getErrorMessage(error, "").toLowerCase();
  return (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("temporarily") ||
    message.includes("connection") ||
    message.includes("socket")
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function retryQuery<T>(
  operation: () => Promise<QueryLikeResult<T>>,
  options: RetryOptions = {},
): Promise<QueryLikeResult<T>> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 500;
  const operationName = options.operationName ?? "unknown_operation";

  let attempt = 0;
  let lastResult: QueryLikeResult<T> | null = null;

  while (attempt <= retries) {
    let result: QueryLikeResult<T>;
    try {
      result = await operation();
    } catch (error) {
      result = { data: null, error };
    }

    if (!result.error || !isTransientError(result.error)) {
      if (result.error) {
        logTelemetry(
          "error",
          "retry_query_terminal_failure",
          getErrorMessage(result.error),
          {
            operationName,
            attempt,
            retries,
            ...options.context,
          },
        );
      }

      return result;
    }

    lastResult = result;
    attempt += 1;

    logTelemetry(
      "warn",
      "retry_query_retrying",
      getErrorMessage(result.error, "Retrying request."),
      {
        operationName,
        attempt,
        retries,
        ...options.context,
      },
    );

    if (attempt <= retries) {
      await wait(delayMs * attempt);
    }
  }

  if (lastResult?.error) {
    logTelemetry(
      "error",
      "retry_query_failed_after_retries",
      getErrorMessage(lastResult.error),
      {
        operationName,
        retries,
        ...options.context,
      },
    );
  }

  return (
    lastResult ?? {
      data: null,
      error: new Error("Request failed."),
    }
  );
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
