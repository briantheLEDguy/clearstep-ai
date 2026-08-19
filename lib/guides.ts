export type GuideSeries = "AI basics" | "Everyday productivity" | "Work efficiency systems";

export type GuideFormat =
  | "field-guide"
  | "prompt-lab"
  | "four-pass-audit"
  | "planning-sprint"
  | "evidence-board"
  | "message-clinic"
  | "workflow-canvas"
  | "codex-runbook"
  | "improvement-loop";

export type GuideStep = {
  title: string;
  body: string;
  tip?: string;
};

export type Guide = {
  slug: string;
  series: GuideSeries;
  order: number;
  title: string;
  summary: string;
  minutes: number;
  difficulty: "Beginner";
  outcome: string;
  prerequisites: string[];
  tools: string[];
  whyItWorks: string;
  steps: GuideStep[];
  prompt: string;
  checks: string[];
  improveIt: string;
  nextGuide: string | null;
};

export const guides: Guide[] = [
  {
    slug: "ai-is-a-draft-partner",
    series: "AI basics",
    order: 1,
    title: "Use AI as a draft partner, not an answer machine",
    summary: "Learn what generative AI does, where it fails, and how to get a useful first result safely.",
    minutes: 7,
    difficulty: "Beginner",
    outcome: "You will turn a rough idea into a short, reviewable draft.",
    prerequisites: ["A low-risk writing task", "Access to ChatGPT, Claude, or Gemini"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "Generative AI predicts a plausible response from your instructions and context. Treating that response as a draft keeps you responsible for truth, judgment, and the final wording.",
    steps: [
      { title: "Choose a low-risk task", body: "Start with a note, outline, or internal announcement. Do not begin with medical, legal, financial, security, personnel, or customer-facing advice." },
      { title: "Remove private material", body: "Replace names and identifying details with labels such as [CUSTOMER] or [PROJECT]. Never paste passwords, access keys, personal data, regulated data, or confidential company material into an unapproved tool." },
      { title: "Describe the result", body: "Tell the tool who the reader is, what they should learn, the facts it may use, the tone, and the format. Ask it to flag missing facts instead of guessing." },
      { title: "Generate one draft", body: "Paste the prompt below into ChatGPT, Claude, or Gemini. Their interfaces differ, but the same instruction pattern works in each." },
      { title: "Review every claim", body: "Compare names, dates, numbers, links, and quoted text with a trusted source. Rewrite anything that sounds generic or unlike you." },
      { title: "Approve the final version", body: "Read it once from the audience's viewpoint. A human must approve factual, legal, financial, medical, security, personnel, and customer-facing output before use." },
    ],
    prompt: `You are a careful writing assistant.

Context: I need a [TYPE OF DOCUMENT] for [AUDIENCE].
Task: Draft a concise version that helps the reader [DESIRED ACTION].
Facts you may use:
- [FACT 1]
- [FACT 2]
Constraints: Use plain language, short paragraphs, and no invented facts. Mark missing information as [NEEDS INPUT].
Output: A title followed by the finished draft.`,
    checks: ["The draft addresses the named audience and action.", "Every factual claim matches your source.", "No private or confidential information appears in the chat or draft."],
    improveIt: "Ask the tool to cut the draft by 25% without removing facts or actions.",
    nextGuide: "write-prompts-that-produce-usable-work",
  },
  {
    slug: "write-prompts-that-produce-usable-work",
    series: "AI basics",
    order: 2,
    title: "Write prompts that produce usable work",
    summary: "Build a repeatable prompt from five parts: role, context, task, constraints, and output.",
    minutes: 8,
    difficulty: "Beginner",
    outcome: "You will create a reusable prompt that produces a specific, structured answer.",
    prerequisites: ["A task with a clear audience", "Access to ChatGPT, Claude, or Gemini"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "Specific inputs narrow the range of plausible answers. A defined output format also makes weak or missing content easy to spot.",
    steps: [
      { title: "Assign a useful role", body: "Name the perspective the task needs, such as editor, tutor, or project coordinator. A role guides the response; it does not make the model a qualified professional." },
      { title: "Add only safe context", body: "Explain the audience and situation without secrets or personal data. Use placeholders when a real detail is unnecessary." },
      { title: "State one task", body: "Use a concrete verb: compare, outline, rewrite, classify, or explain. Split unrelated jobs into separate prompts." },
      { title: "Set constraints", body: "Define length, tone, allowed facts, exclusions, and what to do when information is missing." },
      { title: "Specify the output", body: "Request headings, bullets, a table, or another form you can inspect quickly. Paste the prompt into your chosen tool." },
      { title: "Test with one example", body: "Check whether the response obeys every constraint. If not, revise the instruction rather than repeatedly asking for a vague improvement." },
    ],
    prompt: `Role: Act as a plain-language editor.
Context: This is for [AUDIENCE], who already know [WHAT THEY KNOW]. Use only the facts below.
Task: Rewrite the material so the reader can [OUTCOME].
Constraints: Maximum [NUMBER] words. Short sentences. Do not add facts. Label uncertainty as [VERIFY].
Output: 1) a descriptive heading, 2) the rewrite, 3) a list of facts I should verify.

Material:
[PASTE NON-SENSITIVE MATERIAL]`,
    checks: ["The result follows the requested structure and length.", "Unknown information is flagged rather than invented.", "A colleague could reuse the prompt by changing the bracketed fields."],
    improveIt: "Add one short example of the tone or format you want; remove any example details you do not want copied.",
    nextGuide: "verify-ai-output-before-you-use-it",
  },
  {
    slug: "verify-ai-output-before-you-use-it",
    series: "AI basics",
    order: 3,
    title: "Verify AI output before you use it",
    summary: "Run a fast accuracy, relevance, safety, and ownership check on any AI-assisted draft.",
    minutes: 9,
    difficulty: "Beginner",
    outcome: "You will review an AI response with a repeatable four-pass checklist.",
    prerequisites: ["An AI-generated draft", "The original brief and trusted source material"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "A fluent response can still be wrong, incomplete, biased, or unsuitable. Separate review passes reduce the chance that polished wording hides a serious error.",
    steps: [
      { title: "Check accuracy", body: "Verify every name, date, number, quote, citation, link, and technical claim against an authoritative source. Do not treat links produced by a model as evidence until you open them." },
      { title: "Check relevance", body: "Compare the draft with the original request. Remove detours and confirm the audience can take the intended action." },
      { title: "Check safety", body: "Look for exposed private data, harmful instructions, unfair assumptions, and claims that require professional review." },
      { title: "Check ownership", body: "Rewrite in your voice and confirm you have permission to use source material. Do not ask for imitation of a living writer or paste copyrighted material you cannot share." },
      { title: "Invite criticism", body: "Use the prompt below to locate possible issues, not to certify the work. Independently verify its findings." },
      { title: "Record human approval", body: "For consequential or public work, note who checked it and which sources were used. Escalate legal, financial, medical, security, personnel, or customer-facing material to the responsible reviewer." },
    ],
    prompt: `Review the draft below as a skeptical editor. Do not rewrite it yet.
Return a table with: passage, possible issue, why it matters, and how I can verify it.
Check for unsupported facts, missing context, ambiguity, privacy risks, unfair assumptions, and failure to follow the brief.
Say "none found" rather than inventing an issue. Your review is not proof; I will verify each item independently.

Brief: [PASTE BRIEF]
Draft: [PASTE SAFE DRAFT]`,
    checks: ["Each factual claim has a trusted source or has been removed.", "The response contains no information you were not allowed to share.", "The appropriate person has approved consequential or public output."],
    improveIt: "Keep a source column beside the draft while editing so later reviewers can retrace important claims.",
    nextGuide: "turn-notes-into-a-daily-plan",
  },
  {
    slug: "turn-notes-into-a-daily-plan",
    series: "Everyday productivity",
    order: 1,
    title: "Turn a messy task list into a daily plan",
    summary: "Convert safe, unstructured notes into a realistic plan with priorities and time blocks.",
    minutes: 8,
    difficulty: "Beginner",
    outcome: "You will leave with a three-priority plan you can actually complete today.",
    prerequisites: ["A list of tasks", "Your available time and fixed commitments"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "The model handles sorting and formatting while you retain control of priority and effort estimates. Explicit capacity prevents an impressive but impossible schedule.",
    steps: [
      { title: "Sanitize your list", body: "Remove customer names, private appointments, sensitive health details, credentials, and confidential project information. Use neutral labels." },
      { title: "Add constraints", body: "State your available work blocks, deadlines, energy pattern, and rough task durations. Mark estimates you are unsure about." },
      { title: "Request a first plan", body: "Paste the prompt into ChatGPT, Claude, or Gemini. Ask for no more than three priorities and include buffer time." },
      { title: "Correct the estimates", body: "You know the work better than the tool. Adjust durations, dependencies, and priority before accepting the plan." },
      { title: "Put blocks on your calendar", body: "Copy only the approved blocks. Do not give an AI tool calendar access unless your organization has approved the integration and its data handling." },
      { title: "Review at day's end", body: "Mark completed, moved, and dropped tasks. Use the result—not guilt—to improve tomorrow's estimates." },
    ],
    prompt: `Act as a practical planning assistant.
Available time: [TIME BLOCKS]
Fixed commitments: [SAFE, NON-SENSITIVE DETAILS]
Tasks with rough durations: [LIST]
Task: Propose a realistic plan with at most three priorities.
Constraints: Keep 20% of my time unallocated. Do not schedule overlapping work. Flag missing durations or dependencies.
Output: A time-block table, then a short "defer" list and one sentence explaining the tradeoff.`,
    checks: ["The plan fits inside your actual available hours.", "The top three items reflect your judgment, not only the model's ranking.", "At least 20% of the day remains flexible."],
    improveIt: "After three days, add your actual completion times so the next plan uses better estimates.",
    nextGuide: "summarize-notes-into-actions",
  },
  {
    slug: "summarize-notes-into-actions",
    series: "Everyday productivity",
    order: 2,
    title: "Turn meeting notes into decisions and actions",
    summary: "Extract decisions, owners, dates, and open questions without letting AI invent commitments.",
    minutes: 10,
    difficulty: "Beginner",
    outcome: "You will produce a review-ready action log from permitted notes.",
    prerequisites: ["Notes you are authorized to process", "A list of known participant labels"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "A fixed schema exposes gaps instead of hiding them in a smooth summary. Requiring direct evidence prevents a likely suggestion from becoming a false commitment.",
    steps: [
      { title: "Confirm permission", body: "Follow your meeting, recording, and AI policies. Do not upload a transcript containing customer, personnel, regulated, or confidential information to an unapproved tool." },
      { title: "Redact the notes", body: "Replace people and organizations with stable labels. Keep exact wording around decisions when it is safe and necessary." },
      { title: "Extract without guessing", body: "Use the prompt below. Require [NOT STATED] for missing owners or dates, and ask for evidence from the supplied notes." },
      { title: "Compare with the source", body: "Check every decision and action against the notes. The model can misread suggestions as commitments." },
      { title: "Ask participants to confirm", body: "Send the concise log to attendees or the meeting owner. Clearly label it as a draft until they approve it." },
      { title: "Store the approved log", body: "Move the human-reviewed result to the authorized project system; apply the same access controls as the source meeting." },
    ],
    prompt: `Extract a draft action log from the notes below. Use only explicit statements.
Output three sections:
1. Decisions: decision | evidence from notes
2. Actions: action | owner | due date | evidence from notes
3. Open questions
Use [NOT STATED] when an owner or date is missing. Do not infer a commitment. Keep evidence excerpts brief.

Notes:
[PASTE REDACTED, APPROVED NOTES]`,
    checks: ["Every listed item is supported by the original notes.", "Missing owners and dates remain visibly unresolved.", "A participant or meeting owner has confirmed the log."],
    improveIt: "Use consistent participant labels and action verbs across meetings to make logs easier to scan.",
    nextGuide: "draft-clear-everyday-messages",
  },
  {
    slug: "draft-clear-everyday-messages",
    series: "Everyday productivity",
    order: 3,
    title: "Draft clear messages in five minutes",
    summary: "Create a concise email or chat message with a clear ask, context, and deadline.",
    minutes: 5,
    difficulty: "Beginner",
    outcome: "You will produce a brief message the recipient can act on immediately.",
    prerequisites: ["The recipient's role", "The facts, desired action, and real deadline"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "Separating facts from the requested action keeps the message short and reduces ambiguity. A human tone pass prevents generic or overly forceful wording.",
    steps: [
      { title: "Write the ask first", body: "In one sentence, state what the recipient should do and by when. If there is no action, state the purpose instead." },
      { title: "List necessary facts", body: "Include only information the recipient needs. Remove private, customer, employee, or company-confidential data before using an unapproved tool." },
      { title: "Generate two options", body: "Ask for a direct version and a warmer version. ChatGPT, Claude, and Gemini may phrase them differently; judge both against your relationship with the recipient." },
      { title: "Restore your voice", body: "Choose one and replace stock phrases with words you normally use. Confirm that the tone does not hide or soften the actual ask." },
      { title: "Verify before sending", body: "Check names, attachments, dates, links, promises, and recipients yourself. Human review is required for customer-facing or sensitive messages." },
    ],
    prompt: `Draft two versions of a concise [EMAIL/CHAT MESSAGE]: one direct and one warm.
Recipient: [ROLE OR RELATIONSHIP]
Purpose: [PURPOSE]
Required action: [ACTION]
Real deadline: [DATE/TIME OR NONE]
Facts you may use: [SAFE FACTS]
Constraints: 120 words maximum, plain language, no invented context or promises.
Output: A subject line if email, then the two labeled versions.`,
    checks: ["The action and deadline are visible on a quick scan.", "Every name, date, link, and promise is accurate.", "The final message sounds like you and is appropriate for the recipient."],
    improveIt: "Save the prompt with placeholders, not real names or sensitive details, for recurring messages.",
    nextGuide: "build-a-repeatable-workflow-checklist",
  },
  {
    slug: "build-a-repeatable-workflow-checklist",
    series: "Work efficiency systems",
    order: 1,
    title: "Build a repeatable workflow checklist",
    summary: "Turn a task you repeat into a short checklist with inputs, decisions, and a clear finish line.",
    minutes: 15,
    difficulty: "Beginner",
    outcome: "You will create and test a one-page standard operating checklist.",
    prerequisites: ["A low-risk task you perform regularly", "One recent, sanitized example"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "Writing the workflow exposes hidden decisions and handoffs. AI can organize your description, but the person who performs or owns the process must validate it.",
    steps: [
      { title: "Choose one finish line", body: "Define the event that means the task is complete, such as “approved file stored in the project folder.” Avoid broad processes with several unrelated outcomes." },
      { title: "Describe a real run", body: "List what triggered it, the safe inputs, actions, decisions, handoffs, and final check. Remove credentials, personal data, client data, and confidential rules." },
      { title: "Generate the checklist", body: "Use the prompt below in an approved AI tool. Require the tool to mark missing information rather than fill gaps." },
      { title: "Test it yourself", body: "Perform the task using only the checklist. Mark unclear actions, missing permissions, and steps that cannot be verified." },
      { title: "Ask the process owner to approve", body: "Confirm responsibilities, controls, and escalation paths. Never let an AI draft override policy or professional judgment." },
      { title: "Version and store it", body: "Add an owner, approval date, and review date. Store the checklist where the people doing the work can find the current version." },
    ],
    prompt: `Act as a process editor. Turn my sanitized notes into a beginner-friendly checklist.
Outcome: [ONE FINISH LINE]
Audience: [ROLE]
Notes: [SAFE DESCRIPTION OF A REAL RUN]
Constraints: Start each step with a verb. Preserve required reviews and approvals. Do not invent tools, permissions, policy, or missing steps; mark gaps [CONFIRM].
Output: prerequisites, numbered steps, decision points, completion checks, owner, and review date.`,
    checks: ["A beginner can identify the trigger, inputs, and finish line.", "Every decision has an owner or a [CONFIRM] marker.", "The process owner has tested and approved the checklist."],
    improveIt: "After the next three runs, remove steps that add no control and clarify the steps that caused questions.",
    nextGuide: "automate-a-small-task-with-codex",
  },
  {
    slug: "automate-a-small-task-with-codex",
    series: "Work efficiency systems",
    order: 2,
    title: "Automate one small task safely with Codex",
    summary: "Use a coding agent to make a narrow, testable change while you control scope and approval.",
    minutes: 25,
    difficulty: "Beginner",
    outcome: "You will create a reviewed code change on a branch without exposing secrets.",
    prerequisites: ["A version-controlled project", "A documented test command", "Codex configured for the project"],
    tools: ["Codex"],
    whyItWorks: "A narrow task, acceptance checks, and an isolated branch make agent work easier to inspect and reverse. Tests reduce risk but do not replace reading the change.",
    steps: [
      { title: "Select a bounded change", body: "Choose one low-risk improvement, such as validating a filename or formatting a report. Do not start with production access, authentication, payments, or sensitive data flows." },
      { title: "Protect secrets", body: "Confirm credentials are outside the repository and ignored by version control. Use placeholder data. Never put keys, tokens, customer data, or private company material in the prompt, code, fixture, or commit." },
      { title: "Create a branch", body: "Run `git switch -c automate/report-filenames` and confirm `git status` is clean before the agent edits files." },
      { title: "Give Codex a testable brief", body: "Provide the goal, allowed files, constraints, acceptance checks, and test command. Ask it to inspect project instructions before editing." },
      { title: "Inspect the diff", body: "Run `git diff --check` and `git diff`. Read every changed line. Reject unrelated changes, embedded secrets, unexplained dependencies, or weakened safeguards." },
      { title: "Run relevant tests", body: "Run the repository's documented test, lint, and type-check commands. Test one normal input and one invalid input yourself." },
      { title: "Commit only approved work", body: "Stage named files, review the staged diff, and commit with a specific message. Use your normal peer review and deployment process; do not grant production access just to finish faster." },
    ],
    prompt: `First read the repository instructions and inspect the relevant code. Do not edit yet if requirements conflict.

Goal: [ONE SMALL AUTOMATION]
Allowed files: [PATHS]
Must not change: [BOUNDARIES]
Acceptance checks:
- [OBSERVABLE RESULT]
- [ERROR OR EDGE CASE]
Validation commands: [PROJECT TEST/LINT/TYPE-CHECK COMMANDS]

Keep secrets and personal data out of the repository. Make the smallest maintainable change, add or update focused tests, run the validation commands, and summarize the diff and any remaining risks.`,
    checks: ["Only expected files appear in the staged diff.", "Relevant tests pass, including an invalid or edge-case input.", "A human reviewer understands and approves every changed line before merge."],
    improveIt: "Add the successful acceptance checks to a regression test so later changes cannot silently remove the behavior.",
    nextGuide: "create-a-weekly-improvement-loop",
  },
  {
    slug: "create-a-weekly-improvement-loop",
    series: "Work efficiency systems",
    order: 3,
    title: "Create a weekly improvement loop",
    summary: "Use a lightweight review to find friction, choose one experiment, and measure whether it helps.",
    minutes: 15,
    difficulty: "Beginner",
    outcome: "You will define one safe, measurable workflow experiment for next week.",
    prerequisites: ["Five days of rough task notes", "Authority to change the selected workflow"],
    tools: ["ChatGPT", "Claude", "Gemini"],
    whyItWorks: "Small experiments reveal whether a change saves time in your real context. AI can group sanitized observations and suggest options; you choose the change and decide whether evidence supports it.",
    steps: [
      { title: "Capture friction", body: "For one week, note repeated work, waiting, errors, rework, and unclear handoffs. Record rough minutes without names, private content, or confidential operational details." },
      { title: "Sanitize and group", body: "Replace projects and people with labels. Use the prompt below to group patterns, while telling the tool not to infer performance or blame." },
      { title: "Choose one controllable problem", body: "Prefer a frequent, low-risk annoyance that your team owns. Do not automate a control, approval, or consequential decision merely because it takes time." },
      { title: "Define the experiment", body: "State one change, one owner, a seven-day window, and a measure such as minutes, error count, or handoff count. Record the baseline first." },
      { title: "Run with safeguards", body: "Tell affected people what is changing. Preserve required review, privacy, security, accessibility, and quality checks." },
      { title: "Compare and decide", body: "At week's end, compare the measure with the baseline. Keep, revise, or stop the change. Ask the process owner and affected users about quality—not only speed." },
    ],
    prompt: `Act as a neutral operations coach.
Below are sanitized workflow observations. Group repeated friction without judging people or inventing causes.
For the top three patterns, return: evidence from my notes, one small experiment, likely risk, safeguard, and a simple seven-day measure.
Do not recommend removing approvals, privacy controls, security checks, accessibility work, or human review.

Observations:
[PASTE SANITIZED NOTES]`,
    checks: ["The experiment changes one variable and has a named owner.", "A baseline and seven-day measure are recorded.", "Speed did not come at the cost of accuracy, safety, accessibility, or required review."],
    improveIt: "Keep a short experiment log so you do not repeat failed ideas and can share proven improvements.",
    nextGuide: null,
  },
];

const seriesNames: GuideSeries[] = ["AI basics", "Everyday productivity", "Work efficiency systems"];

const guideFormats: Record<string, { format: GuideFormat; formatLabel: string }> = {
  "ai-is-a-draft-partner": { format: "field-guide", formatLabel: "Field guide" },
  "write-prompts-that-produce-usable-work": { format: "prompt-lab", formatLabel: "Prompt lab" },
  "verify-ai-output-before-you-use-it": { format: "four-pass-audit", formatLabel: "Four-pass audit" },
  "turn-notes-into-a-daily-plan": { format: "planning-sprint", formatLabel: "10-minute sprint" },
  "summarize-notes-into-actions": { format: "evidence-board", formatLabel: "Evidence board" },
  "draft-clear-everyday-messages": { format: "message-clinic", formatLabel: "Message clinic" },
  "build-a-repeatable-workflow-checklist": { format: "workflow-canvas", formatLabel: "Workflow canvas" },
  "automate-a-small-task-with-codex": { format: "codex-runbook", formatLabel: "Codex runbook" },
  "create-a-weekly-improvement-loop": { format: "improvement-loop", formatLabel: "7-day loop" },
};

export const guideSeries = seriesNames.map((title) => ({
  slug: title.toLowerCase().replaceAll(" ", "-"),
  title,
  articles: getGuidesBySeries(title).map((guide) => ({
    ...guide,
    ...guideFormats[guide.slug],
    time: `${guide.minutes} min`,
    level: guide.difficulty,
    why: guide.whyItWorks,
    safety: "Use only tools approved for the information involved. Do not paste secrets, personal data, regulated information, customer data, or confidential company material. A qualified human must review consequential or external output.",
  })),
}));

export function getGuidesBySeries(series: GuideSeries) {
  return guides.filter((guide) => guide.series === series).sort((left, right) => left.order - right.order);
}
