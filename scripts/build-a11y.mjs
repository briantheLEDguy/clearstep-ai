import { runNextBuild } from "./run-next-build.mjs";

// Browser tests must never contact the production project. Keep canonical
// metadata stable while directing the public Supabase endpoint to the local
// static server, whose API path Playwright intercepts.
runNextBuild({
  NEXT_PUBLIC_SITE_URL: "https://www.bncconsulting.nl",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "a11y-test-publishable-key",
  CLEARSTEP_A11Y_CATALOG_FIXTURE: "true",
});
