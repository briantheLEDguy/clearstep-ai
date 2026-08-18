import { ApiError, requireUuid } from "./http.ts";

type QueryBuilder = {
  eq: (column: string, value: string) => QueryBuilder;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
};

type QueryClient = {
  from: (table: string) => {
    select: (columns: string) => QueryBuilder;
  };
};

export async function resolveWorkshopSession(
  admin: QueryClient,
  workshopSlug: unknown,
  sessionRef: unknown,
): Promise<string> {
  if (typeof workshopSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(workshopSlug)) {
    throw new ApiError("invalid_request", "workshopSlug is invalid.");
  }
  const sessionId = requireUuid(sessionRef, "sessionRef");
  const { data, error } = await admin
    .from("workshop_sessions")
    .select("id,courses!inner(slug,visibility)")
    .eq("id", sessionId)
    .eq("courses.slug", workshopSlug)
    .eq("courses.visibility", "public")
    .maybeSingle();

  if (error) {
    throw new ApiError("catalog_lookup_failed", "The workshop could not be looked up.", 500);
  }
  if (!data) {
    throw new ApiError("session_not_found", "That workshop session was not found.", 404);
  }
  return sessionId;
}
