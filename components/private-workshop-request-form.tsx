"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";
import { COMPANY_DETAILS } from "@/shared/company-details";

type RequestResult = {
  request_id?: unknown;
  status?: unknown;
};

type SubmitState = "idle" | "submitting" | "success" | "error" | "unconfigured";

const fieldClassName = "min-h-13 w-full rounded-2xl border border-[var(--border)] bg-[var(--cream)] px-4 py-3 text-[var(--navy)] outline-none placeholder:text-[color:rgba(16,42,67,.48)] focus:border-[var(--action)] focus:ring-3 focus:ring-[var(--mint)]";
const labelClassName = "mb-2 block font-bold";

export function PrivateWorkshopRequestForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const client = getSupabaseBrowserClient();

    if (!client) {
      setState("unconfigured");
      setMessage("The online request form is still being connected. You can email us directly and we’ll help plan your session.");
      return;
    }

    const formData = new FormData(form);
    const attendeeCount = Number.parseInt(String(formData.get("attendeeCount") ?? ""), 10);
    const payload = {
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      organization: String(formData.get("organization") ?? "").trim(),
      attendeeCount: Number.isInteger(attendeeCount) ? attendeeCount : null,
      preferredFormat: String(formData.get("preferredFormat") ?? ""),
      preferredTiming: String(formData.get("preferredTiming") ?? "").trim(),
      goals: String(formData.get("goals") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      consentToContact: formData.get("consentToContact") === "on",
      website: String(formData.get("website") ?? ""),
      startedAt: startedAt.current ?? Date.now(),
    };

    setState("submitting");
    setMessage("Sending your workshop request…");

    try {
      const { data, error } = await client.functions.invoke("private-workshop-request", {
        body: payload,
      });

      if (error) {
        setState("error");
        setMessage(await functionErrorMessage(error, "We couldn’t send your request. Please try again or email us for help."));
        return;
      }

      const result = unwrapFunctionData<RequestResult>(data);
      if (!result || typeof result.request_id !== "string") {
        setState("error");
      setMessage("We couldn’t confirm that your request was received. Please try again or email us for help.");
        return;
      }

      form.reset();
      setState("success");
      setMessage("Thanks — your request is in. We’ll review what you shared and reply with a clear recommendation for the session.");
    } catch (error) {
      setState("error");
    setMessage(await functionErrorMessage(error, "We couldn’t send your request. Please try again or email us for help."));
    }
  }

  const isSubmitting = state === "submitting";

  if (state === "success") {
    return (
      <div className="rounded-[28px] border border-[color:rgba(8,117,71,.2)] bg-white p-7 text-left shadow-[var(--shadow)] md:p-10" role="status" aria-live="polite" aria-atomic="true">
        <p className="eyebrow">Request received</p>
        <h3 className="text-3xl">We’ll take it from here.</h3>
        <p className="mb-0 mt-4">{message}</p>
      </div>
    );
  }

  return (
    <form
      className="rounded-[28px] border border-[var(--border)] bg-white p-6 text-left shadow-[var(--shadow)] md:p-10"
      onSubmit={submitRequest}
      aria-busy={isSubmitting}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label className={labelClassName} htmlFor="private-contact-name">Your name</label>
          <input className={fieldClassName} id="private-contact-name" name="contactName" type="text" autoComplete="name" minLength={2} maxLength={120} required />
        </div>
        <div>
          <label className={labelClassName} htmlFor="private-email">Work email</label>
          <input className={fieldClassName} id="private-email" name="email" type="email" autoComplete="email" maxLength={254} required />
        </div>
        <div>
          <label className={labelClassName} htmlFor="private-phone">Phone <span className="font-normal text-[color:rgba(16,42,67,.62)]">(optional)</span></label>
          <input className={fieldClassName} id="private-phone" name="phone" type="tel" autoComplete="tel" maxLength={50} />
        </div>
        <div>
          <label className={labelClassName} htmlFor="private-organization">Company or organization</label>
          <input className={fieldClassName} id="private-organization" name="organization" type="text" autoComplete="organization" minLength={2} maxLength={200} required />
        </div>
        <div>
          <label className={labelClassName} htmlFor="private-attendee-count">Expected group size</label>
          <input className={fieldClassName} id="private-attendee-count" name="attendeeCount" type="number" inputMode="numeric" min={1} max={10000} required />
        </div>
        <div>
          <label className={labelClassName} htmlFor="private-format">Preferred format</label>
          <select className={fieldClassName} id="private-format" name="preferredFormat" defaultValue="" required>
            <option value="" disabled>Choose a format</option>
            <option value="in_person">In person</option>
            <option value="online">Live online</option>
            <option value="hybrid">Hybrid</option>
            <option value="unsure">Not sure yet</option>
          </select>
        </div>
      </div>

      <div className="mt-6">
        <label className={labelClassName} htmlFor="private-timing">Preferred dates or timing</label>
        <textarea
          className={fieldClassName}
          id="private-timing"
          name="preferredTiming"
          rows={3}
          maxLength={500}
          placeholder="For example: late October, Tuesday mornings, or before the team planning day"
          required
        />
      </div>

      <div className="mt-6">
        <label className={labelClassName} htmlFor="private-goals">What should your team be able to do afterwards?</label>
        <p className="mb-3 text-sm text-[color:rgba(16,42,67,.68)]">Please do not include special-category personal data, passwords, confidential client information, or other secrets.</p>
        <textarea
          className={fieldClassName}
          id="private-goals"
          name="goals"
          rows={5}
          minLength={10}
          maxLength={2000}
          placeholder="Tell us about the recurring work, questions, or confidence gaps you want the session to address."
          required
        />
      </div>

      <div className="mt-6">
        <label className={labelClassName} htmlFor="private-notes">Anything else we should know? <span className="font-normal text-[color:rgba(16,42,67,.62)]">(optional)</span></label>
        <textarea className={fieldClassName} id="private-notes" name="notes" rows={4} maxLength={1000} />
      </div>

      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="private-website">Website</label>
        <input id="private-website" name="website" type="text" autoComplete="off" tabIndex={-1} />
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl bg-[var(--cream)] p-4" htmlFor="private-consent">
        <input className="mt-1 h-5 w-5 shrink-0 accent-[var(--action)]" id="private-consent" name="consentToContact" type="checkbox" required />
        <span className="text-sm">I agree that Clearstep may use these details to respond to this request and plan the workshop. See the <a className="font-bold text-[var(--action)] underline underline-offset-3" href="/privacy">privacy policy</a>.</span>
      </label>

      <button className="button button-primary mt-7 w-full cursor-pointer border-0 disabled:cursor-wait disabled:opacity-65" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending your request…" : "Request a private workshop"}
      </button>

      {message ? (
        <p
          className={`mb-0 mt-5 rounded-2xl p-4 text-sm ${state === "error" || state === "unconfigured" ? "bg-[#fff0ec] text-[#8f2f1f]" : "bg-[var(--mint)] text-[var(--navy)]"}`}
          role={state === "error" || state === "unconfigured" ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          {message}
        </p>
      ) : null}

      <p className="mb-0 mt-5 text-center text-sm text-[color:rgba(16,42,67,.68)]">
        If the form is unavailable, <a className="font-bold text-[var(--action)] underline underline-offset-3" href={`mailto:${COMPANY_DETAILS.email}?subject=Private%20Clearstep%20workshop`}>email us directly</a>.
      </p>
    </form>
  );
}
