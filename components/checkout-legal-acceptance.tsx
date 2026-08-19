"use client";

type CheckoutLegalAcceptanceProps = {
  checked: boolean;
  disabled?: boolean;
  id?: string;
  onChange: (checked: boolean) => void;
  tone?: "dark" | "light";
};

/** A single, explicit acknowledgement shared by every paid checkout entry point. */
export function CheckoutLegalAcceptance({
  checked,
  disabled = false,
  id = "checkout-legal-acceptance",
  onChange,
  tone = "light",
}: CheckoutLegalAcceptanceProps) {
  const colors = tone === "dark"
    ? "border-white/20 bg-white/8 text-white/85"
    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]";

  return (
    <label className={`mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left text-sm ${colors}`} htmlFor={id}>
      <input
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-action)]"
        checked={checked}
        disabled={disabled}
        id={id}
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
