import { runNextBuild } from "./run-next-build.mjs";

// Rendered-output contracts describe the production BNC origin and must not
// inherit a developer's loopback or retired Clearstep value from .env.local.
runNextBuild({ NEXT_PUBLIC_SITE_URL: "https://www.bncconsulting.nl" });
