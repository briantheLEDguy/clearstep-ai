import { ApiError, env } from "./http.ts";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(cents: unknown): string {
  const amount = typeof cents === "number" ? cents : Number(cents ?? 0);
  return new Intl.NumberFormat("en-NL", { style: "currency", currency: "EUR" }).format(amount / 100);
}

function formatDate(value: unknown): string {
  const date = new Date(String(value));
  return new Intl.DateTimeFormat("en-NL", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function frame(title: string, body: string, activeService = "Clearstep AI"): string {
  const serviceLabel = activeService === "BNC Consulting"
    ? "BNC Consulting"
    : `${escapeHtml(activeService)} · a BNC Consulting service`;
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;color:#252525;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border-radius:16px;padding:32px"><div style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#555">BNC Consulting</div><h1 style="font-size:28px;line-height:1.2">${escapeHtml(title)}</h1>${body}<p style="margin-top:28px;color:#666">${serviceLabel}</p></div></div></body></html>`;
}

function linkButton(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#183029;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">${escapeHtml(label)}</a></p>`;
}

export function operationalEmail(
  payload: Record<string, unknown>,
  siteUrl: string,
  adminEmail: string,
): EmailMessage {
  const template = String(payload.template ?? "");
  const target = payload.to_role === "workspace_admin" ? adminEmail : String(payload.to ?? "");
  if (!target) throw new ApiError("email_job_invalid", "Email job has no recipient.", 500);

  switch (template) {
    case "enrollment_confirmation": {
      const subject = `Your Clearstep workshop is confirmed: ${payload.course_title}`;
      const date = formatDate(payload.start_at);
      const text = `Your seat for ${payload.course_title} is confirmed for ${date}. You will receive calendar details shortly.`;
      return {
        to: target,
        subject,
        text,
        html: frame(subject, `<p>Your seat is confirmed.</p><p><strong>${escapeHtml(payload.course_title)}</strong><br>${escapeHtml(date)}<br>${escapeHtml(payload.format)}${payload.venue ? `<br>${escapeHtml(payload.venue)}` : ""}</p><p>Calendar details will follow automatically.</p>`),
      };
    }
    case "booking_admin_alert": {
      const subject = `New Clearstep booking: ${payload.course_title}`;
      const text = `${payload.attendee_name ?? "A student"} (${payload.attendee_email}) booked ${payload.course_title} for ${formatMoney(payload.amount_cents)}.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "waitlist_joined": {
      const subject = `You are on the waitlist for ${payload.course_title}`;
      const text = `You are on the waitlist for ${payload.course_title}. Current position: ${payload.position}.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "waitlist_offer": {
      const offerUrl = `${siteUrl.replace(/\/$/u, "")}/account/waitlist?session=${encodeURIComponent(String(payload.session_id))}&offer=${encodeURIComponent(String(payload.offer_token))}`;
      const subject = `A seat is available for ${payload.course_title}`;
      const text = `A seat is reserved for you until ${formatDate(payload.offer_expires_at)}. Complete your booking: ${offerUrl}`;
      return { to: target, subject, text, html: frame(subject, `<p>A seat is reserved for you until <strong>${escapeHtml(formatDate(payload.offer_expires_at))}</strong>.</p>${linkButton(offerUrl, "Book my seat")}`) };
    }
    case "payment_failed": {
      const subject = `Payment was not completed for ${payload.course_title}`;
      const text = `Your payment was not completed and the seat has been released. Visit ${siteUrl} to view current availability.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "payment_pending_timeout_admin": {
      const subject = `Review timed-out Clearstep payment: ${payload.course_title}`;
      const text = `An asynchronous ${formatMoney(payload.amount_cents)} payment for ${payload.customer_email} did not settle before ${formatDate(payload.grace_expires_at)}. The provisional enrollment and seat were released. Check Stripe payment ${payload.stripe_payment_intent_id ?? "not yet assigned"} before taking manual action; a later paid webhook will run the normal capacity and refund-remediation checks. Checkout: ${payload.checkout_id}. Payment record: ${payload.payment_id ?? "not created"}.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "late_payment_refund_required": {
      const subject = `Action underway for your Clearstep payment: ${payload.course_title}`;
      const reason = String(payload.remediation_reason ?? "");
      const timing = reason === "post_start_payment_settlement"
        ? "after the workshop had started"
        : "after the workshop had reached capacity";
      const text = `Stripe completed your ${formatMoney(payload.amount_cents)} payment ${timing}. We could not confirm a seat. Our team has been alerted and will arrange the required refund; you do not need to pay again. We will email you when the refund is processed.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "late_payment_refund_admin": {
      const subject = `Urgent: refund required for late Clearstep payment`;
      const reason = String(payload.remediation_reason ?? "unknown_conflict");
      const conflict = reason === "post_start_payment_settlement"
        ? "the workshop had already started"
        : "the workshop had reached capacity";
      const text = `A late ${formatMoney(payload.amount_cents)} payment could not be allocated because ${conflict}. Refund and follow-up are required for ${payload.customer_email}. Payment: ${payload.stripe_payment_intent_id}. Checkout: ${payload.checkout_id}. Reason: ${reason}.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "refund_processed": {
      const subject = `Your Clearstep refund has been processed${payload.course_title ? `: ${payload.course_title}` : ""}`;
      const text = `${formatMoney(payload.amount_refunded_cents)} has been refunded. Your bank may take several business days to show the credit.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "refund_admin_alert": {
      const subject = `Clearstep refund recorded${payload.course_title ? `: ${payload.course_title}` : ""}`;
      const text = `${formatMoney(payload.amount_refunded_cents)} was refunded${payload.customer_email ? ` to ${payload.customer_email}` : ""}. Status: ${payload.refund_status}. Payment: ${payload.stripe_payment_intent_id}.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "payment_mismatch_admin": {
      const subject = `Action required: Clearstep payment mismatch for ${payload.course_title}`;
      const text = `Checkout expected ${formatMoney(payload.expected_amount_cents)} ${payload.expected_currency}, but Stripe reported ${formatMoney(payload.received_amount_cents)} ${payload.received_currency}. The enrollment was not confirmed. Customer: ${payload.customer_email}. Payment: ${payload.stripe_payment_intent_id ?? "not available"}.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "private_request_received": {
      const subject = "We received your Clearstep workshop request";
      const text = `Thanks, ${payload.contact_name}. We received the request for ${payload.organization} and will follow up shortly.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "private_request_admin_alert": {
      const subject = `New private workshop request: ${payload.organization}`;
      const text = `${payload.contact_name} (${payload.email}) requested a private workshop for ${payload.attendee_count ?? "an unspecified number of"} attendees. Request reference: ${payload.request_id}. Review the authorised request record in the staff workspace; this alert intentionally excludes free-text goals and notes.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`) };
    }
    case "private_quote": {
      const subject = `Clearstep proposal for ${payload.organization}`;
      const paymentUrl = String(payload.payment_url ?? "");
      const text = `${payload.description}\n\nTotal: ${formatMoney(payload.amount_cents)} including VAT. Valid until ${payload.valid_until}.${paymentUrl ? `\n\nAccept and pay: ${paymentUrl}` : ""}`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(payload.description)}</p><p><strong>${escapeHtml(formatMoney(payload.amount_cents))}</strong> including VAT<br>Valid until ${escapeHtml(payload.valid_until)}</p>${paymentUrl ? linkButton(paymentUrl, "Accept and pay") : ""}`) };
    }
    case "service_order_confirmation": {
      const subject = `Your Plate & Post payment is confirmed: ${payload.service_title}`;
      const accountUrl = `${siteUrl.replace(/\/$/u, "")}/account`;
      const text = `We received your ${formatMoney(payload.amount_cents)} payment for ${payload.service_title}. Our team will contact you to agree scheduling. Payment does not reserve a particular date. View your order: ${accountUrl}`;
      return {
        to: target,
        subject,
        text,
        html: frame(subject, `<p>We received your payment for <strong>${escapeHtml(payload.service_title)}</strong>.</p><p>Our team will contact you to agree scheduling. Payment does not reserve a particular date.</p>${linkButton(accountUrl, "View service order")}`, "Plate & Post"),
      };
    }
    case "service_order_admin_alert": {
      const subject = `New Plate & Post order: ${payload.service_title}`;
      const text = `${payload.customer_email} paid ${formatMoney(payload.amount_cents)} for ${payload.service_title}. Order reference: ${payload.service_order_id}. Contact the customer to arrange scheduling.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`, "Plate & Post") };
    }
    case "service_order_refund": {
      const subject = `Your Plate & Post refund has been recorded: ${payload.service_title}`;
      const text = `${formatMoney(payload.amount_refunded_cents)} has been refunded. Your bank may take several business days to show the credit.`;
      return { to: target, subject, text, html: frame(subject, `<p>${escapeHtml(text)}</p>`, "Plate & Post") };
    }
    case "staff_invite": {
      const subject = "You have been invited to BNC Consulting";
      const text = `You have been invited to the BNC Consulting staff workspace as ${payload.role}. Accept the invitation: ${payload.invite_url}`;
      return { to: target, subject, text, html: frame(subject, `<p>You have been invited to the BNC Consulting team as <strong>${escapeHtml(payload.role)}</strong>.</p>${linkButton(String(payload.invite_url), "Accept invitation")}`, "BNC Consulting") };
    }
    default:
      throw new ApiError("email_template_unknown", `Unknown email template: ${template}.`, 500);
  }
}

export type AuthHookPayload = {
  user: { email?: string; new_email?: string };
  email_data: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    email_action_type: string;
    site_url: string;
  };
};

function authActionLink(data: AuthHookPayload["email_data"], tokenHash: string, type: string): string {
  const appBase = new URL(env("PUBLIC_SITE_URL"));
  const callback = new URL("/auth/callback", appBase);
  if (data.redirect_to) {
    try {
      const requested = new URL(data.redirect_to);
      if (requested.origin === appBase.origin && requested.pathname === "/auth/callback") {
        callback.search = requested.search;
      }
    } catch {
      // Ignore malformed or cross-origin redirect targets and use the safe callback.
    }
  }

  const url = new URL("/auth/v1/verify", env("SUPABASE_URL"));
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("redirect_to", callback.toString());
  return url.toString();
}

export function authEmails(payload: AuthHookPayload): EmailMessage[] {
  const { user, email_data: data } = payload;
  const action = data.email_action_type;
  const accountFrame = (title: string, body: string) => frame(title, body, "BNC Consulting");
  const labels: Record<string, [string, string]> = {
    signup: ["Confirm your BNC Consulting account", "Confirm account"],
    recovery: ["Reset your BNC Consulting password", "Reset password"],
    magiclink: ["Your BNC Consulting sign-in link", "Sign in"],
    invite: ["You have been invited to BNC Consulting", "Accept invitation"],
    reauthentication: ["Confirm your BNC Consulting identity", "Confirm identity"],
  };

  if (action === "reauthentication") {
    if (!user.email || !data.token) {
      throw new ApiError("auth_email_invalid", "Reauthentication email has no recipient or code.", 400);
    }
    return [{
      to: user.email,
      subject: "Your BNC Consulting verification code",
      text: `Your verification code is ${data.token}. It expires shortly.`,
      html: accountFrame(
        "Your verification code",
        `<p>Use this code to confirm your identity:</p><p style="font-size:28px;font-weight:700;letter-spacing:.15em">${escapeHtml(data.token)}</p><p>It expires shortly.</p>`,
      ),
    }];
  }

  if (action === "email_change") {
    const messages: EmailMessage[] = [];
    if (user.email && data.token_hash_new) {
      const link = authActionLink(data, data.token_hash_new, "email_change");
      messages.push({
        to: user.email,
        subject: "Confirm your BNC Consulting email change",
        text: `Confirm the email change: ${link}`,
        html: accountFrame("Confirm your email change", linkButton(link, "Confirm email change")),
      });
    }
    if (user.new_email && data.token_hash) {
      const link = authActionLink(data, data.token_hash, "email_change");
      messages.push({
        to: user.new_email,
        subject: "Confirm your new BNC Consulting email",
        text: `Confirm your new email address: ${link}`,
        html: accountFrame("Confirm your new email", linkButton(link, "Confirm new email")),
      });
    }
    if (messages.length) return messages;
  }

  const recipient = action === "email_change" ? user.new_email : user.email;
  const tokenHash = data.token_hash || data.token_hash_new;
  if (!recipient || !tokenHash) {
    throw new ApiError("auth_email_invalid", "Auth hook payload has no recipient or token.", 400);
  }
  const [subject, label] = labels[action] ?? ["Your BNC Consulting account link", "Continue"];
  const link = authActionLink(data, tokenHash, action);
  return [{
    to: recipient,
    subject,
    text: `${subject}: ${link}`,
    html: accountFrame(subject, linkButton(link, label)),
  }];
}
