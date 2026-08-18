import { withSupabase } from "npm:@supabase/server@1.4.1";
import { rpc } from "../_shared/db.ts";
import { operationalEmail } from "../_shared/email.ts";
import { env, handleError, methodNotAllowed, ok } from "../_shared/http.ts";
import {
  googleFailure,
  isKnownUnsentGoogleEmailError,
  prepareGoogleEmail,
  removeCalendarEnrollment,
  sendPreparedGoogleEmail,
  upsertCalendarEnrollment,
  upsertCalendarSession,
} from "../_shared/google.ts";

type Job = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type EmailDeliveryState = {
  state: "none" | "retrying" | "sending" | "sent" | "uncertain" | "failed";
  provider_message_id?: string | null;
  rfc822_message_id?: string | null;
  template?: string;
  recipient?: string;
};

type EmailDeliveryIntent = EmailDeliveryState & {
  should_send: boolean;
};

type CalendarLease = {
  acquired: boolean;
  session_id: string;
  expires_at: string | null;
};

type CalendarEnrollmentState = {
  job_type: "calendar_enrollment" | "calendar_enrollment_remove";
  should_apply: boolean;
  enrollment_status: string;
  enrollment_id: string;
  session_id: string;
  conference_revision: string;
  attendee_email: string;
  attendee_name: string | null;
  google_event_id: string | null;
  course_title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  format: "online" | "in_person" | "hybrid";
  venue: string | null;
};

type CalendarSessionState = {
  should_apply: boolean;
  session_status: string;
  session_id: string;
  conference_revision: string;
  course_title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  format: "online" | "in_person" | "hybrid";
  venue: string | null;
  google_event_id: string | null;
};

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const workerId = `automation-${crypto.randomUUID()}`;
      const maintenance = await rpc(ctx.supabaseAdmin, "run_booking_maintenance");
      const jobs = await rpc<Job[]>(ctx.supabaseAdmin, "claim_automation_jobs", {
        p_worker_id: workerId,
        p_limit: 20,
      });
      let completed = 0;
      let deferred = 0;

      for (const job of jobs) {
        let diagnosticOutput: Record<string, unknown> | null = null;
        let emailIntentMayExist = false;
        let calendarLeaseMayExist = false;
        try {
          let output: Record<string, unknown> | null;
          if (job.job_type === "email") {
            const delivery = await rpc<EmailDeliveryState>(
              ctx.supabaseAdmin,
              "inspect_email_delivery",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            if (delivery.state === "sent") {
              emailIntentMayExist = true;
              diagnosticOutput = {
                template: delivery.template ?? String(job.payload.template ?? ""),
                recipient: delivery.recipient ?? String(job.payload.to ?? ""),
              };
              output = {
                ...diagnosticOutput,
                message_id: delivery.provider_message_id,
                rfc822_message_id: delivery.rfc822_message_id,
              };
            } else if (!["none", "retrying"].includes(delivery.state)) {
              emailIntentMayExist = true;
              await rpc(ctx.supabaseAdmin, "fail_uncertain_email_job", {
                p_job_id: job.id,
                p_worker_id: workerId,
                p_error: `email_delivery_${delivery.state}_requires_reconciliation`,
              });
              deferred += 1;
              continue;
            } else {
              const message = operationalEmail(
                job.payload,
                env("PUBLIC_SITE_URL"),
                env("ADMIN_NOTIFICATION_EMAIL"),
              );
              diagnosticOutput = {
                template: String(job.payload.template ?? ""),
                recipient: message.to,
              };
              const prepared = await prepareGoogleEmail(ctx.supabaseAdmin, message, job.id);
              // Gmail has no request idempotency key. From this point onward,
              // an ambiguous failure must never fall back to an automatic retry.
              emailIntentMayExist = true;
              const intent = await rpc<EmailDeliveryIntent>(
                ctx.supabaseAdmin,
                "begin_email_delivery",
                {
                  p_job_id: job.id,
                  p_worker_id: workerId,
                  p_template: diagnosticOutput.template,
                  p_recipient: message.to,
                  p_rfc822_message_id: prepared.rfc822MessageId,
                },
              );
              if (intent.state === "sent") {
                output = {
                  ...diagnosticOutput,
                  message_id: intent.provider_message_id,
                  rfc822_message_id: intent.rfc822_message_id,
                };
              } else if (!intent.should_send) {
                await rpc(ctx.supabaseAdmin, "fail_uncertain_email_job", {
                  p_job_id: job.id,
                  p_worker_id: workerId,
                  p_error: "email_delivery_intent_uncertain",
                });
                deferred += 1;
                continue;
              } else {
                const sent = await sendPreparedGoogleEmail(ctx.supabaseAdmin, prepared);
                await rpc(ctx.supabaseAdmin, "mark_email_delivery_sent", {
                  p_job_id: job.id,
                  p_worker_id: workerId,
                  p_provider_message_id: sent.message_id,
                });
                output = {
                  ...diagnosticOutput,
                  ...sent,
                  rfc822_message_id: prepared.rfc822MessageId,
                };
              }
            }
          } else if (job.job_type === "calendar_enrollment") {
            calendarLeaseMayExist = true;
            const lease = await rpc<CalendarLease>(
              ctx.supabaseAdmin,
              "acquire_calendar_session_lease",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            if (!lease.acquired) throw new Error("calendar_session_busy");
            const enrollment = await rpc<CalendarEnrollmentState>(
              ctx.supabaseAdmin,
              "resolve_calendar_enrollment_job",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            if (enrollment.should_apply) {
              output = await upsertCalendarEnrollment(ctx.supabaseAdmin, {
                session_id: enrollment.session_id,
                conference_revision: enrollment.conference_revision,
                attendee_email: enrollment.attendee_email,
                attendee_name: enrollment.attendee_name,
                google_event_id: enrollment.google_event_id,
                course_title: enrollment.course_title,
                start_at: enrollment.start_at,
                end_at: enrollment.end_at,
                timezone: enrollment.timezone,
                format: enrollment.format,
                venue: enrollment.venue,
              });
              await rpc(ctx.supabaseAdmin, "apply_calendar_integration_state", {
                p_job_id: job.id,
                p_worker_id: workerId,
                p_google_event_id: output.google_event_id,
                p_meet_url: output.meet_url,
                p_format: enrollment.format,
              });
            } else {
              output = null;
            }
          } else if (job.job_type === "calendar_enrollment_remove") {
            calendarLeaseMayExist = true;
            const lease = await rpc<CalendarLease>(
              ctx.supabaseAdmin,
              "acquire_calendar_session_lease",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            if (!lease.acquired) throw new Error("calendar_session_busy");
            const enrollment = await rpc<CalendarEnrollmentState>(
              ctx.supabaseAdmin,
              "resolve_calendar_enrollment_job",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            output = !enrollment.should_apply
              ? {
                attendee_removed: false,
                skipped: true,
                enrollment_status: enrollment.enrollment_status,
              }
              : enrollment.google_event_id
              ? await removeCalendarEnrollment(ctx.supabaseAdmin, {
                session_id: enrollment.session_id,
                attendee_email: enrollment.attendee_email,
                google_event_id: enrollment.google_event_id,
              })
              : {
                attendee_removed: false,
                event_missing: true,
                google_event_id: null,
              };
          } else if (job.job_type === "calendar_session") {
            calendarLeaseMayExist = true;
            const lease = await rpc<CalendarLease>(
              ctx.supabaseAdmin,
              "acquire_calendar_session_lease",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            if (!lease.acquired) throw new Error("calendar_session_busy");
            const session = await rpc<CalendarSessionState>(
              ctx.supabaseAdmin,
              "resolve_calendar_session_job",
              { p_job_id: job.id, p_worker_id: workerId },
            );
            if (session.should_apply) {
              output = await upsertCalendarSession(
                ctx.supabaseAdmin,
                session,
              );
              await rpc(ctx.supabaseAdmin, "apply_calendar_integration_state", {
                p_job_id: job.id,
                p_worker_id: workerId,
                p_google_event_id: output.google_event_id,
                p_meet_url: output.meet_url,
                p_format: session.format,
              });
            } else {
              output = null;
            }
          } else {
            throw new Error(`unsupported_job_type:${job.job_type}`);
          }

          await rpc(ctx.supabaseAdmin, "complete_automation_job", {
            p_job_id: job.id,
            p_worker_id: workerId,
            p_success: true,
            p_output: output,
            p_error: null,
          });
          completed += 1;
        } catch (jobError) {
          if (job.job_type === "email" && emailIntentMayExist) {
            try {
              if (isKnownUnsentGoogleEmailError(jobError)) {
                await rpc(ctx.supabaseAdmin, "retry_unsent_email_job", {
                  p_job_id: job.id,
                  p_worker_id: workerId,
                  p_error: googleFailure(jobError),
                  p_retryable: jobError.retryable,
                  p_retry_after_seconds: jobError.retryAfterSeconds,
                });
                deferred += 1;
                continue;
              }
              const delivery = await rpc<EmailDeliveryState>(
                ctx.supabaseAdmin,
                "inspect_email_delivery",
                { p_job_id: job.id, p_worker_id: workerId },
              );
              if (delivery.state === "sent") {
                await rpc(ctx.supabaseAdmin, "complete_automation_job", {
                  p_job_id: job.id,
                  p_worker_id: workerId,
                  p_success: true,
                  p_output: {
                    ...diagnosticOutput,
                    message_id: delivery.provider_message_id,
                    rfc822_message_id: delivery.rfc822_message_id,
                  },
                  p_error: null,
                });
                completed += 1;
                continue;
              }
              await rpc(ctx.supabaseAdmin, "fail_uncertain_email_job", {
                p_job_id: job.id,
                p_worker_id: workerId,
                p_error: googleFailure(jobError),
              });
            } catch (reconciliationError) {
              console.error("Unable to reconcile uncertain Gmail delivery", reconciliationError);
            }
          } else {
            try {
              await rpc(ctx.supabaseAdmin, "complete_automation_job", {
                p_job_id: job.id,
                p_worker_id: workerId,
                p_success: false,
                p_output: diagnosticOutput,
                p_error: googleFailure(jobError),
              });
            } catch (completionError) {
              console.error("Unable to defer automation job", completionError);
            }
          }
          deferred += 1;
        } finally {
          if (calendarLeaseMayExist) {
            try {
              await rpc(ctx.supabaseAdmin, "release_calendar_session_lease", {
                p_job_id: job.id,
                p_worker_id: workerId,
              });
            } catch (releaseError) {
              console.error("Unable to release Calendar session lease", releaseError);
            }
          }
        }
      }

      await rpc(ctx.supabaseAdmin, "record_integration_health", {
        p_integration: "automation_worker",
        p_success: true,
        p_error: null,
        p_metadata: { claimed: jobs.length, completed, deferred },
      });
      return ok({ claimed: jobs.length, completed, deferred, maintenance });
    } catch (error) {
      try {
        await rpc(ctx.supabaseAdmin, "record_integration_health", {
          p_integration: "automation_worker",
          p_success: false,
          p_error: googleFailure(error),
          p_metadata: {},
        });
      } catch (healthError) {
        console.error("Unable to record automation worker health", healthError);
      }
      return handleError(error);
    }
  }),
};
