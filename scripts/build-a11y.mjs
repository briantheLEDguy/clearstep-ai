import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Browser tests must never contact the production project. Keep canonical
// metadata stable while directing the public Supabase endpoint to the local
// static server, whose API path Playwright intercepts.
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const result = spawnSync(process.execPath, [nextCli, "build"], {
  env: {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: "https://www.clearstep-ai.nl",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "a11y-test-publishable-key",
    CLEARSTEP_A11Y_CATALOG_FIXTURE: "true",
  },
  stdio: "inherit",
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
