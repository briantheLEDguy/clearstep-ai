export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data, error: null }, { status });
}

export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): Response {
  const error: ApiErrorBody = { code, message };
  if (details !== undefined) error.details = details;
  return Response.json({ data: null, error }, { status });
}

export function methodNotAllowed(allowed = "POST"): Response {
  return new Response(
    JSON.stringify({
      data: null,
      error: { code: "method_not_allowed", message: `Use ${allowed}.` },
    }),
    {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: allowed,
      },
    },
  );
}

export async function readJson<T>(req: Request, maxBytes = 32_768): Promise<T> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError("invalid_content_type", "Expected application/json.", 415);
  }

  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError("payload_too_large", "The request body is too large.", 413);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("invalid_json", "The request body is not valid JSON.", 400);
  }
}

export function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new ApiError("server_not_configured", `Missing server setting: ${name}.`, 503);
  }
  return value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function handleError(error: unknown): Response {
  if (error instanceof ApiError) {
    return fail(error.code, error.message, error.status, error.details);
  }

  console.error(error);
  return fail("internal_error", "The request could not be completed.", 500);
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError("invalid_email", "A valid email address is required.");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError("invalid_email", "A valid email address is required.");
  }
  return email;
}

export function requireUuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError("invalid_request", `${field} must be a UUID.`);
  }
  return value;
}

export function asText(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): string | null {
  const { min = 1, max = 2_000, optional = false } = options;
  if ((value === null || value === undefined || value === "") && optional) return null;
  if (typeof value !== "string") {
    throw new ApiError("invalid_request", `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new ApiError(
      "invalid_request",
      `${field} must be between ${min} and ${max} characters.`,
    );
  }
  return text;
}
