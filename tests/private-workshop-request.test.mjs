import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("../components/private-workshop-request-form.tsx", import.meta.url);
const pageUrl = new URL("../app/private-workshops/page.tsx", import.meta.url);

test("collects the complete private workshop brief with accessible form states", async () => {
  const source = await readFile(componentUrl, "utf8");

  for (const field of [
    "contactName",
    "email",
    "phone",
    "organization",
    "attendeeCount",
    "preferredFormat",
    "preferredTiming",
    "goals",
    "notes",
    "consentToContact",
  ]) {
    assert.match(source, new RegExp(`name=["']${field}["']`), field);
  }

  assert.match(source, /aria-busy=\{isSubmitting\}/);
  assert.match(source, /role=\{state === "error" \|\| state === "unconfigured" \? "alert" : "status"\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /type="checkbox" required/);
});

test("submits bot signals and request details through the private workshop Edge Function", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /functions\.invoke\("private-workshop-request"/);
  assert.match(source, /body:\s*payload/);
  assert.match(source, /website:\s*String\(formData\.get\("website"\)/);
  assert.match(source, /startedAt:\s*startedAt\.current \?\? Date\.now\(\)/);
  assert.match(source, /unwrapFunctionData<RequestResult>\(data\)/);
  assert.match(source, /typeof result\.request_id !== "string"/);
  assert.match(source, /getSupabaseBrowserClient\(\)/);
  assert.match(source, /mailto:brian@bncconsulting\.co/);
});

test("routes the page’s primary call to action to the request form", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /href="#private-workshop-request"/);
  assert.match(page, /id="private-workshop-request"/);
  assert.match(page, /<PrivateWorkshopRequestForm \/>/);
});
