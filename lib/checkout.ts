export type CheckoutResponse = {
  checkoutUrl: string;
  expiresAt: string;
  checkoutRef: string;
};

const CHECKOUT_RESPONSE_FIELDS = new Set(["checkoutUrl", "expiresAt", "checkoutRef"]);

export function parseCheckoutResponse(value: unknown): CheckoutResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !CHECKOUT_RESPONSE_FIELDS.has(key))) return null;
  if (
    typeof result.checkoutUrl !== "string"
    || typeof result.expiresAt !== "string"
    || !Number.isFinite(Date.parse(result.expiresAt))
    || typeof result.checkoutRef !== "string"
    || result.checkoutRef.length < 8
    || result.checkoutRef.length > 200
  ) {
    return null;
  }

  try {
    const checkoutUrl = new URL(result.checkoutUrl);
    if (checkoutUrl.protocol !== "https:") return null;
    return { checkoutUrl: checkoutUrl.href, expiresAt: result.expiresAt, checkoutRef: result.checkoutRef };
  } catch {
    return null;
  }
}
