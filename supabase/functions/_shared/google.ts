import { encodeBase64Url, sha256Hex } from "./crypto.ts";
import { rpc, type RpcClient } from "./db.ts";
import { ApiError, env, errorMessage } from "./http.ts";
import type { EmailMessage } from "./email.ts";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

type GoogleConnection = {
  connection_id: string;
  connected_email: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string;
  scopes: string[];
  status: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  email?: string;
  verified_email?: boolean;
};

export class GoogleEmailHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, retryable: boolean, retryAfterSeconds: number | null) {
    super(`Gmail rejected the message before accepting it (HTTP ${status}).`);
    this.name = "GoogleEmailHttpError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isKnownUnsentGoogleEmailError(
  error: unknown,
): error is GoogleEmailHttpError {
  return error instanceof GoogleEmailHttpError;
}

async function parseGoogleResponse<T>(response: Response, operation: string): Promise<T> {
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = { raw: body.slice(0, 500) };
  }
  if (!response.ok) {
    console.error("Google API error", operation, response.status, parsed);
    throw new ApiError(
      "google_api_error",
      `Google ${operation} failed.`,
      response.status >= 500 ? 503 : 502,
    );
  }
  return parsed as T;
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env("GOOGLE_CLIENT_ID"),
    client_secret: env("GOOGLE_CLIENT_SECRET"),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseGoogleResponse<GoogleTokenResponse>(response, "OAuth token exchange");
}

export async function googleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return parseGoogleResponse<GoogleUserInfo>(response, "user profile lookup");
}

export async function persistGoogleConnection(
  admin: RpcClient,
  actorUserId: string,
  connectedEmail: string,
  tokens: GoogleTokenResponse,
): Promise<unknown> {
  if (!tokens.access_token || !tokens.expires_in) {
    throw new ApiError("google_oauth_failed", "Google did not return an access token.", 502);
  }
  if (!tokens.refresh_token) {
    throw new ApiError(
      "google_refresh_token_missing",
      "Google did not return offline access. Reconnect the Workspace account.",
      502,
    );
  }
  const scopes = (tokens.scope ?? GOOGLE_SCOPES.join(" ")).split(/\s+/u).filter(Boolean);
  return rpc(admin, "save_google_connection", {
    p_actor_user_id: actorUserId,
    p_connected_email: connectedEmail,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_token_expires_at: new Date(Date.now() + tokens.expires_in * 1_000).toISOString(),
    p_scopes: scopes,
  });
}

async function getAccessToken(
  admin: RpcClient,
  forceRefresh = false,
): Promise<{ accessToken: string; sender: string }> {
  const workspaceEmail = env("GOOGLE_WORKSPACE_EMAIL").toLowerCase();
  const connection = await rpc<GoogleConnection>(admin, "get_google_connection", {
    p_connected_email: workspaceEmail,
  });

  if (!connection || connection.status !== "active") {
    throw new ApiError(
      "google_connection_required",
      "Connect the Google Workspace account before processing automation.",
      503,
    );
  }

  if (!forceRefresh && new Date(connection.token_expires_at).getTime() > Date.now() + 90_000) {
    return {
      accessToken: connection.access_token,
      sender: connection.connected_email,
    };
  }

  if (!connection.refresh_token) {
    await rpc(admin, "update_google_access_token", {
      p_connection_id: connection.connection_id,
      p_access_token: null,
      p_token_expires_at: connection.token_expires_at,
      p_refresh_token: null,
      p_status: "reauthorization_required",
    });
    throw new ApiError("google_reauthorization_required", "Reconnect Google Workspace.", 503);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await parseGoogleResponse<GoogleTokenResponse>(response, "token refresh");
  if (!tokens.access_token || !tokens.expires_in) {
    throw new ApiError("google_token_refresh_failed", "Google returned no refreshed access token.", 503);
  }

  await rpc(admin, "update_google_access_token", {
    p_connection_id: connection.connection_id,
    p_access_token: tokens.access_token,
    p_token_expires_at: new Date(Date.now() + tokens.expires_in * 1_000).toISOString(),
    p_refresh_token: tokens.refresh_token ?? null,
    p_status: "active",
  });

  return { accessToken: tokens.access_token, sender: connection.connected_email };
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function messageIdFor(sender: string, deliveryId: string): string {
  const compactId = deliveryId.replaceAll("-", "").toLowerCase();
  const domain = sender.split("@").at(-1)?.toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(compactId) || !domain || !/^[a-z0-9.-]+$/u.test(domain)) {
    throw new ApiError("email_delivery_id_invalid", "Email delivery identifier is invalid.", 500);
  }
  return `<clearstep.${compactId}@${domain}>`;
}

function mimeMessage(message: EmailMessage, sender: string, rfc822MessageId: string): string {
  const boundary = `clearstep_${crypto.randomUUID().replaceAll("-", "")}`;
  const subject = `=?UTF-8?B?${utf8Base64(safeHeader(message.subject))}?=`;
  return [
    `From: Clearstep <${safeHeader(sender)}>`,
    `To: ${safeHeader(message.to)}`,
    `Subject: ${subject}`,
    `Message-ID: ${safeHeader(rfc822MessageId)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(message.html),
    `--${boundary}--`,
  ].join("\r\n");
}

export type PreparedGoogleEmail = {
  accessToken: string;
  raw: string;
  rfc822MessageId: string;
};

export async function prepareGoogleEmail(
  admin: RpcClient,
  message: EmailMessage,
  deliveryId: string,
): Promise<PreparedGoogleEmail> {
  const { accessToken, sender } = await getAccessToken(admin);
  const rfc822MessageId = messageIdFor(sender, deliveryId);
  return {
    accessToken,
    raw: encodeBase64Url(mimeMessage(message, sender, rfc822MessageId)),
    rfc822MessageId,
  };
}

export async function sendPreparedGoogleEmail(
  admin: RpcClient,
  prepared: PreparedGoogleEmail,
): Promise<{ message_id: string }> {
  const send = (accessToken: string) =>
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: prepared.raw }),
    });

  let response = await send(prepared.accessToken);
  if (response.status === 401) {
    let refreshed: { accessToken: string; sender: string };
    try {
      refreshed = await getAccessToken(admin, true);
    } catch (error) {
      if (isKnownUnsentGoogleEmailError(error)) throw error;
      throw new GoogleEmailHttpError(401, true, 60);
    }
    // A transport failure on this second send is ambiguous and must remain
    // outside the known-unsent refresh error handling.
    response = await send(refreshed.accessToken);
  }
  if (!response.ok) {
    const retryable = response.status === 401 || response.status === 429 || response.status >= 500;
    throw new GoogleEmailHttpError(
      response.status,
      retryable,
      retryAfterSeconds(response.headers.get("retry-after")),
    );
  }
  const result = await parseGoogleResponse<{ id: string }>(response, "email send");
  return { message_id: result.id };
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400, Math.ceil(seconds));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(86_400, Math.max(0, Math.ceil((date - Date.now()) / 1_000)));
}

export async function sendGoogleEmail(
  admin: RpcClient,
  message: EmailMessage,
): Promise<{ message_id: string }> {
  const prepared = await prepareGoogleEmail(admin, message, crypto.randomUUID());
  return sendPreparedGoogleEmail(admin, prepared);
}

export type CalendarPayload = {
  session_id: string;
  conference_revision: string;
  attendee_email?: string;
  attendee_name?: string | null;
  course_title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  format: "online" | "in_person" | "hybrid";
  venue?: string | null;
  google_event_id?: string | null;
};

export type CalendarEnrollmentRemovalPayload = {
  session_id: string;
  attendee_email: string;
  google_event_id: string;
};

type GoogleEvent = {
  id: string;
  etag?: string;
  hangoutLink?: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
    createRequest?: {
      requestId?: string;
      status?: { statusCode?: "pending" | "success" | "failure" };
    };
  };
};

function meetUrl(event: GoogleEvent): string | null {
  return event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ??
    null;
}

async function conferenceRequestId(sessionId: string, conferenceRevision: string): Promise<string> {
  if (!conferenceRevision.trim()) {
    throw new ApiError(
      "google_conference_revision_missing",
      "The Calendar session revision is missing.",
      500,
    );
  }
  const transitionHash = await sha256Hex(`${sessionId}:${conferenceRevision}`);
  return `clearstep-${transitionHash.slice(0, 32)}`;
}

function conferenceRecoveryRevision(event: GoogleEvent, payload: CalendarPayload): string {
  const failureFingerprint = event.conferenceData?.createRequest?.requestId?.trim() ||
    event.etag?.trim();
  if (!failureFingerprint) {
    throw new ApiError(
      "google_conference_failure_identity_missing",
      "The failed Google Meet request cannot be retried safely.",
      502,
    );
  }
  // The failed provider request identifies one recovery transition. Repeated
  // attempts reuse this revision; a newly failed request produces the next ID.
  return `${payload.conference_revision}:recovery:${failureFingerprint}`;
}

function conferenceStatus(event: GoogleEvent): "pending" | "success" | "failure" | null {
  return event.conferenceData?.createRequest?.status?.statusCode ?? null;
}

function requireReadyConference(event: GoogleEvent, payload: CalendarPayload): string | null {
  const url = meetUrl(event);
  if (payload.format === "in_person") {
    if (url || event.conferenceData) {
      throw new ApiError(
        "google_conference_removal_pending",
        "Google Meet conference removal is not ready yet.",
        503,
      );
    }
    return null;
  }
  const status = conferenceStatus(event);
  if (status === "failure") {
    throw new ApiError(
      "google_conference_failed",
      "Google Meet conference creation failed and requires operator review.",
      502,
    );
  }
  if (!url) {
    throw new ApiError(
      status === "pending" ? "google_conference_pending" : "google_conference_not_ready",
      "Google Meet conference creation is not ready yet.",
      503,
    );
  }
  return url;
}

async function patchCalendarAttendees(
  accessToken: string,
  event: GoogleEvent,
  payload: CalendarPayload,
  attendees: Array<{ email: string; displayName?: string }>,
): Promise<{ google_event_id: string; meet_url: string | null }> {
  let conferenceRevision = payload.conference_revision;
  if (
    payload.format !== "in_person" && !meetUrl(event) && conferenceStatus(event) !== null
  ) {
    if (conferenceStatus(event) === "failure") {
      conferenceRevision = conferenceRecoveryRevision(event, payload);
    } else {
      requireReadyConference(event, payload);
    }
  }
  const body: Record<string, unknown> = {
    summary: `Clearstep — ${payload.course_title}`,
    description: "Clearstep workshop. Manage session and enrollment details from the Clearstep administration area.",
    start: { dateTime: payload.start_at, timeZone: payload.timezone },
    end: { dateTime: payload.end_at, timeZone: payload.timezone },
    attendees,
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    location: payload.venue || undefined,
  };
  if (payload.format === "in_person") {
    // PATCH preserves omitted fields. Sending null with conferenceDataVersion=1
    // explicitly clears a Meet conference after a format change.
    body.conferenceData = null;
  } else if (!meetUrl(event)) {
    body.conferenceData = {
      createRequest: {
        requestId: await conferenceRequestId(
          payload.session_id,
          conferenceRevision,
        ),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}/events/${encodeURIComponent(event.id)}?sendUpdates=all&conferenceDataVersion=1`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const updated = await parseGoogleResponse<GoogleEvent>(response, "calendar attendee update");
  return { google_event_id: updated.id, meet_url: requireReadyConference(updated, payload) };
}

export async function upsertCalendarEnrollment(
  admin: RpcClient,
  payload: CalendarPayload,
): Promise<{ google_event_id: string; meet_url: string | null }> {
  const { accessToken, sender } = await getAccessToken(admin);
  const authorization = { authorization: `Bearer ${accessToken}` };
  let existing: GoogleEvent | null = null;
  const deterministicEventId = `clearstep${payload.session_id.replaceAll("-", "")}`;
  const eventId = payload.google_event_id || deterministicEventId;

  if (eventId) {
    const getResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}/events/${encodeURIComponent(eventId)}`,
      { headers: authorization },
    );
    if (getResponse.ok) {
      existing = await getResponse.json() as GoogleEvent;
    } else if (getResponse.status !== 404 && getResponse.status !== 410) {
      await parseGoogleResponse(getResponse, "calendar event lookup");
    }
  }

  const attendees = new Map<string, { email: string; displayName?: string }>();
  for (const attendee of existing?.attendees ?? []) attendees.set(attendee.email.toLowerCase(), attendee);
  if (payload.attendee_email) {
    attendees.set(payload.attendee_email.toLowerCase(), {
      email: payload.attendee_email,
      ...(payload.attendee_name ? { displayName: payload.attendee_name } : {}),
    });
  }
  attendees.set(sender.toLowerCase(), { email: sender });

  if (existing) {
    return patchCalendarAttendees(accessToken, existing, payload, Array.from(attendees.values()));
  }

  const body: Record<string, unknown> = {
    id: deterministicEventId,
    summary: `Clearstep — ${payload.course_title}`,
    description: "Clearstep workshop enrollment. Manage your booking from your Clearstep account.",
    start: { dateTime: payload.start_at, timeZone: payload.timezone },
    end: { dateTime: payload.end_at, timeZone: payload.timezone },
    attendees: Array.from(attendees.values()),
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    location: payload.venue || undefined,
  };
  if (payload.format !== "in_person") {
    body.conferenceData = {
      createRequest: {
        requestId: await conferenceRequestId(
          payload.session_id,
          payload.conference_revision,
        ),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}/events?sendUpdates=all&conferenceDataVersion=1`,
    {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (response.status === 409) {
    const conflictLookup = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}/events/${encodeURIComponent(deterministicEventId)}`,
      { headers: authorization },
    );
    const conflictedEvent = await parseGoogleResponse<GoogleEvent>(
      conflictLookup,
      "calendar idempotency lookup",
    );
    for (const attendee of conflictedEvent.attendees ?? []) {
      attendees.set(attendee.email.toLowerCase(), attendee);
    }
    return patchCalendarAttendees(
      accessToken,
      conflictedEvent,
      payload,
      Array.from(attendees.values()),
    );
  }
  const created = await parseGoogleResponse<GoogleEvent>(response, "calendar event creation");
  return { google_event_id: created.id, meet_url: requireReadyConference(created, payload) };
}

export async function upsertCalendarSession(
  admin: RpcClient,
  payload: CalendarPayload,
): Promise<{ google_event_id: string; meet_url: string | null }> {
  return upsertCalendarEnrollment(admin, payload);
}

export async function removeCalendarEnrollment(
  admin: RpcClient,
  payload: CalendarEnrollmentRemovalPayload,
): Promise<{
  google_event_id: string;
  meet_url: string | null;
  attendee_removed: boolean;
  event_missing?: boolean;
}> {
  if (!payload.google_event_id || !payload.attendee_email) {
    throw new ApiError(
      "calendar_enrollment_removal_invalid",
      "Calendar enrollment removal is missing required data.",
      500,
    );
  }

  const { accessToken } = await getAccessToken(admin);
  const eventUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}/events/${encodeURIComponent(payload.google_event_id)}`;
  const lookup = await fetch(eventUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (lookup.status === 404 || lookup.status === 410) {
    return {
      google_event_id: payload.google_event_id,
      meet_url: null,
      attendee_removed: false,
      event_missing: true,
    };
  }
  const event = await parseGoogleResponse<GoogleEvent>(lookup, "calendar removal lookup");
  const target = payload.attendee_email.toLowerCase();
  const attendees = (event.attendees ?? []).filter(
    (attendee) => attendee.email.toLowerCase() !== target,
  );
  if (attendees.length === (event.attendees ?? []).length) {
    return {
      google_event_id: event.id,
      meet_url: meetUrl(event),
      attendee_removed: false,
    };
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  if (event.etag) headers["if-match"] = event.etag;
  const response = await fetch(`${eventUrl}?sendUpdates=all`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      attendees,
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
    }),
  });
  const updated = await parseGoogleResponse<GoogleEvent>(response, "calendar attendee removal");
  return {
    google_event_id: updated.id,
    meet_url: meetUrl(updated),
    attendee_removed: true,
  };
}

export function googleFailure(error: unknown): string {
  return errorMessage(error).slice(0, 1_500);
}
