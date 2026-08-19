type FunctionEnvelope<T> = {
  data?: T | null;
  error?: { code?: unknown; message?: unknown } | null;
};

export type FunctionErrorDetails = {
  code: string;
  message: string;
};

export class FunctionApiError extends Error {
  readonly code: string;

  constructor(message: string, code = "function_request_failed") {
    super(message);
    this.name = "FunctionApiError";
    this.code = code;
  }
}

export function isFunctionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function envelopeError(value: FunctionEnvelope<unknown>, fallback: string, fallbackCode: string): FunctionErrorDetails | null {
  if (!isFunctionRecord(value.error)) return null;

  return {
    message: typeof value.error.message === "string" ? value.error.message : fallback,
    code: typeof value.error.code === "string" ? value.error.code : fallbackCode,
  };
}

export function unwrapFunctionData<T>(payload: unknown): T | null {
  if (!isFunctionRecord(payload)) return null;

  if ("data" in payload && "error" in payload) {
    const details = envelopeError(payload as FunctionEnvelope<T>, "The request could not be completed.", "function_request_failed");
    if (details) throw new FunctionApiError(details.message, details.code);
    return (payload as FunctionEnvelope<T>).data ?? null;
  }

  return payload as T;
}

export async function functionErrorDetails(
  error: unknown,
  fallback: string,
  fallbackCode = "function_request_failed",
): Promise<FunctionErrorDetails> {
  if (error instanceof FunctionApiError) {
    return { code: error.code, message: error.message };
  }

  if (isFunctionRecord(error) && error.context instanceof Response) {
    try {
      const payload = await error.context.clone().json() as unknown;
      if (isFunctionRecord(payload)) {
        const details = envelopeError(payload, fallback, fallbackCode);
        if (details) return details;
      }
    } catch {
      // Fall through to the SDK message when the response is not JSON.
    }
  }

  return {
    code: fallbackCode,
    message: error instanceof Error && error.message ? error.message : fallback,
  };
}

export async function functionErrorMessage(error: unknown, fallback: string) {
  return (await functionErrorDetails(error, fallback)).message;
}
