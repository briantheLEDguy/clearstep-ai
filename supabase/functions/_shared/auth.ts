import { ApiError } from "./http.ts";

export type AuthenticatedUser = {
  id: string;
  email: string;
};

type Claims = Record<string, unknown> | null | undefined;

export function requireUser(claims: Claims): AuthenticatedUser {
  const id = typeof claims?.id === "string"
    ? claims.id
    : typeof claims?.sub === "string"
    ? claims.sub
    : null;
  const email = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : null;

  if (!id || !email) {
    throw new ApiError("authentication_required", "Sign in with an email address to continue.", 401);
  }

  return { id, email };
}

export async function optionalUserId(
  req: Request,
  adminClient: {
    auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  },
): Promise<string | null> {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;

  const { data, error } = await adminClient.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}
