"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckoutLegalAcceptance } from "@/components/checkout-legal-acceptance";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";
import { COMPANY_DETAILS } from "@/shared/company-details";

type WorkshopSession = {
  id: string;
  start_at: string;
  venue: string | null;
  courses: { slug: string; title: string } | { slug: string; title: string }[] | null;
};

type OfferState = "checking" | "ready" | "signed-out" | "loading" | "error" | "invalid";

function firstRelated<T>(relation: T | T[] | null): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function initialState(sessionRef?: string, offerToken?: string): OfferState {
  if (!sessionRef || !offerToken) return "invalid";
  if (!isSupabaseConfigured()) return "error";
  return "checking";
}

function initialMessage(sessionRef?: string, offerToken?: string) {
  if (!sessionRef || !offerToken) return "This waitlist offer link is invalid or incomplete.";
  if (!isSupabaseConfigured()) {
    return "Online booking is being connected. Please contact us for help with this offer.";
  }
  return "Checking your offer…";
}

export function WaitlistOffer({
  sessionRef,
  offerToken,
  returnPath,
}: {
  sessionRef?: string;
  offerToken?: string;
  returnPath: string;
}) {
  const [state, setState] = useState<OfferState>(() => initialState(sessionRef, offerToken));
  const [message, setMessage] = useState(() => initialMessage(sessionRef, offerToken));
  const [session, setSession] = useState<WorkshopSession | null>(null);
  const [legalAccepted, setLegalAccepted] = useState(false);

  useEffect(() => {
    if (!sessionRef || !offerToken) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const supabase = client;
    let active = true;

    async function loadOffer() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!active) return;

      if (userError || !userData.user) {
        setState("signed-out");
        setMessage("Sign in with the email address that received the waitlist offer.");
        return;
      }

      const { data, error } = await supabase
        .from("workshop_sessions")
        .select("id,start_at,venue,courses!inner(slug,title)")
        .eq("id", sessionRef)
        .maybeSingle();

      if (!active) return;
      if (error || !data) {
        setState("invalid");
        setMessage("This workshop session is no longer available. The offer may have expired.");
        return;
      }

      setSession(data as unknown as WorkshopSession);
      setState("ready");
      setMessage("A place is being held for you for a limited time. Continue to checkout to claim it.");
    }

    void loadOffer();
    return () => {
      active = false;
    };
  }, [offerToken, sessionRef]);

  async function acceptOffer() {
    if (!session || !offerToken) return;
    if (!legalAccepted) {
      setState("error");
      setMessage("Please read and accept the Terms and Cancellation policy before opening checkout.");
      return;
    }
    const course = firstRelated(session.courses);
    if (!course) {
      setState("invalid");
      setMessage("We couldn’t match this offer to a workshop. Please contact Brian for help.");
      return;
    }

    const client = getSupabaseBrowserClient();
    if (!client) return;

    setState("loading");
    setMessage("Opening secure checkout…");

    const { data, error } = await client.functions.invoke("create-checkout", {
      body: {
        workshopSlug: course.slug,
        sessionRef: session.id,
        offerToken,
        legalAccepted: true,
      },
    });

    if (error) {
      setState("error");
      setMessage(await functionErrorMessage(error, "We couldn’t start checkout. The offer may have expired."));
      return;
    }

    const result = unwrapFunctionData<{ checkoutUrl?: unknown }>(data);
    if (!result || typeof result.checkoutUrl !== "string") {
      setState("error");
      setMessage("Checkout did not return a payment link. Please contact Brian before trying again.");
      return;
    }

    window.location.assign(result.checkoutUrl);
  }

  const course = session ? firstRelated(session.courses) : null;
  const signInHref = `/sign-in?next=${encodeURIComponent(returnPath)}`;

  return (
    <div className="mx-auto max-w-2xl rounded-[30px] border border-[var(--border)] bg-white p-7 shadow-[var(--shadow)] md:p-10">
      {course ? (
        <div className="mb-6 rounded-2xl bg-[var(--mint)] p-5">
          <p className="m-0 font-[var(--font-manrope)] text-2xl font-bold">{course.title}</p>
          <p className="mb-0 mt-2 text-sm">
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "long",
              timeStyle: "short",
              timeZone: "Europe/Amsterdam",
            }).format(new Date(session!.start_at))}
            {session?.venue ? ` · ${session.venue}` : ""}
          </p>
        </div>
      ) : null}

      <p
        className={`m-0 rounded-2xl p-4 ${state === "error" || state === "invalid" ? "bg-[#fff0ec] text-[#8f2f1f]" : "bg-[var(--cream)]"}`}
        role={state === "error" || state === "invalid" ? "alert" : "status"}
        aria-live="polite"
      >
        {message}
      </p>

      {state === "signed-out" ? (
        <Link className="button button-primary mt-6 w-full text-center" href={signInHref}>Sign in to continue</Link>
      ) : null}
      {state === "ready" || state === "loading" ? (
        <>
          <CheckoutLegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} />
          <button
            className="button button-primary mt-6 w-full cursor-pointer border-0 disabled:cursor-wait disabled:opacity-65"
            type="button"
            disabled={state === "loading" || !legalAccepted}
            onClick={acceptOffer}
          >
            {state === "loading" ? "Opening checkout…" : "Book my place"}
          </button>
        </>
      ) : null}
      <p className="mb-0 mt-5 text-sm text-[color:rgba(16,42,67,.68)]">
        This link is personal to your waitlist entry. If it does not work, email <a className="font-bold underline" href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>.
      </p>
    </div>
  );
}
