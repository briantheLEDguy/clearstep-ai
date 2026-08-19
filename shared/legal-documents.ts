/**
 * The identifiers below are the server-authoritative versions recorded with a
 * checkout acknowledgement. Issue a new version here whenever the matching
 * public document changes, then deploy the static site and checkout Function together.
 */
export const LEGAL_DOCUMENTS = {
  terms: {
    key: "terms",
    title: "Terms of service",
    version: "2026-08-19.1",
    effectiveDate: "19 August 2026",
  },
  privacy: {
    key: "privacy",
    title: "Privacy policy",
    version: "2026-08-19.1",
    effectiveDate: "19 August 2026",
  },
  cancellation: {
    key: "cancellation",
    title: "Cancellation policy",
    version: "2026-08-19.1",
    effectiveDate: "19 August 2026",
  },
} as const;

export type LegalDocumentKey = keyof typeof LEGAL_DOCUMENTS;

export const CHECKOUT_LEGAL_DOCUMENT_KEYS = ["terms", "cancellation"] as const satisfies readonly LegalDocumentKey[];
