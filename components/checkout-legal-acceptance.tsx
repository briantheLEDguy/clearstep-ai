"use client";

type CheckoutLegalAcceptanceProps = {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  tone?: "dark" | "light";
};

/** A single, explicit acknowledgement shared by every paid checkout entry point. */
export function CheckoutLegalAcceptance({
  checked,
  disabled = false,
  onChange,
  tone = "light",
}: CheckoutLegalAcceptanceProps) {
  const colors = tone === "dark"
    ? "border-white/20 bg-white/8 text-white/85"
    : "border-[var(--border)] bg-[var(--cream)] text-[var(--navy)]";

  return (
    <label className={`mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left text-sm ${colors}`} htmlFor="checkout-legal-acceptance">
      <input
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--action)]"
        checked={checked}
        disabled={disabled}
        id="checkout-legal-acceptance"
        name="legalAccepted"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        I have read and accept the <a className="font-bold underline underline-offset-3" href="/terms" target="_blank" rel="noreferrer">Terms of service</a> and <a className="font-bold underline underline-offset-3" href="/cancellation" target="_blank" rel="noreferrer">Cancellation policy</a>.
      </span>
    </label>
  );
}
