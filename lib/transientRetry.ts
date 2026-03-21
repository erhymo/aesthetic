const RETRYABLE_ERROR_PARTS = [
  "https://www.googleapis.com/oauth2/v4/token",
  "econnreset",
  "eai_again",
  "enotfound",
  "etimedout",
  "socket hang up",
  "fetch failed",
  "und_err_connect_timeout",
];

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown summary error";
}

export function isRetryableGoogleAuthError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return RETRYABLE_ERROR_PARTS.some((part) => message.includes(part));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableGoogleAuthError(error) || attempt === maxAttempts) {
        throw error;
      }

      const message = getErrorMessage(error);
      console.warn(
        `[summary] transient error during ${operationName}; retrying (${attempt + 1}/${maxAttempts})`,
        message,
      );

      await sleep(attempt * 500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown summary error");
}

