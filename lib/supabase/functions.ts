type FunctionEnvelope<T> = {
  data: T | null;
  error: { message?: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function unwrapFunctionData<T>(payload: unknown): T | null {
  if (!isRecord(payload)) return null;

  if ("data" in payload && "error" in payload) {
    return (payload as FunctionEnvelope<T>).data;
  }

  return payload as T;
}

export async function functionErrorMessage(error: unknown, fallback: string) {
  if (isRecord(error) && error.context instanceof Response) {
    try {
      const payload = await error.context.clone().json() as unknown;
      if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
        return payload.error.message;
      }
    } catch {
      // Fall through to the SDK message when the response is not JSON.
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
