---
name: technical-guide-writer
description: Write and edit concise, highly skimmable technical articles, tutorials, and how-to guides for non-experts. Use for educational series, product walkthroughs, AI-tool tutorials, knowledge-base articles, onboarding lessons, and step-by-step instructions that need rapid pacing, practical examples, or copy-ready prompts.
---

# Technical Guide Writer

Create useful, accurate instruction that readers can scan quickly and apply immediately.

## Workflow

1. Define one observable outcome for the article.
2. Choose a structure that matches how the reader needs to think: a walkthrough for sequence, a diagnostic for judgment, a comparison for choices, a lab for experimentation, a teardown for critique, or a canvas for designing a system.
3. Open with the result, tension, question, or useful example that gives the reader a reason to continue. Omit generic scene-setting and history unless required.
4. State time, prerequisites, and tool choices where they help the reader commit or avoid a blocked start; they do not need the same visual treatment in every article.
5. Supply exact UI labels, commands, examples, or copy-ready prompts where they remove guesswork.
6. Explain the reason for an action only when it prevents an error or improves judgment.
7. Give the reader an observable way to verify the result.
8. Close with one useful next action, not a recap of the entire article.

## Pacing and voice

- Use plain language, short paragraphs, descriptive headings, bullets, and numbered steps when sequence matters.
- Keep one main idea per paragraph. Use steps only for actions that genuinely depend on order.
- Prefer concrete verbs and examples over abstractions.
- Address the reader as “you.” Sound calm, direct, and capable—not breathless or salesy.
- Define unfamiliar terms on first use. Avoid unexplained acronyms.
- Remove throat-clearing, repeated conclusions, filler transitions, and generic claims.
- Keep caveats next to the relevant action rather than collecting them at the end.
- Distinguish facts, recommendations, and tool-specific behavior. Do not invent features.

## Editorial range

Choose the lightest structure that teaches the subject well. Across a series, vary both the reading rhythm and the way information is organized; do not merely rename the same recurring sections.

- **Walkthrough:** short setup, ordered actions, checkpoints, finish line. Best for a first successful run.
- **Diagnostic:** warning signs, focused review passes, decisions, verdict. Best for evaluating existing work.
- **Comparison:** two or more approaches shown side by side, selection criteria, worked example. Best when readers need judgment rather than a recipe.
- **Lab:** starting material, one controlled experiment, observation, iteration. Best for prompts and tool behavior.
- **Teardown:** realistic before example, annotated weaknesses, improved version, principles to reuse. Best for writing and design critique.
- **Canvas:** inputs, constraints, decisions, owners, and completion conditions. Best for workflows and operating systems.

Most articles still need a specific title, a clear outcome, a usable example or template, a safety note close to the risky action, and a way to verify the result. They do not all need a “why this works” preamble, six steps, a prompt block, a checklist, and an improvement section in the same order.

Within a series:

- Avoid using the same primary structure for consecutive articles.
- Vary section length and density: mix short callouts, worked examples, compact tables, annotated prompts, and prose where each is strongest.
- Give recurring safety guidance context-specific wording and placement instead of repeating one generic warning verbatim.
- Use visual or interactive treatments only when they clarify a relationship, decision, or sequence.

## AI-tool tutorials

- Teach a transferable method first, then show how to perform it in common tools such as Codex, Claude, ChatGPT, or Gemini.
- Call out material tool differences; do not imply identical menus or capabilities.
- Make prompts include role, context, task, constraints, and output format when useful.
- Tell readers not to paste secrets, customer data, private company material, or regulated information into an unapproved tool.
- Require human review for factual, legal, financial, medical, security, personnel, or customer-facing output.
- For coding agents, instruct the reader to work in a branch, inspect the diff, run relevant tests, and keep secrets out of the repository.

## Quality check

Before publishing, confirm:

- The opening promises one outcome and the steps deliver it.
- A beginner can act without hidden prerequisites.
- Examples are realistic, safe, and ready to adapt.
- Ordered steps have a clear action and real sequence; non-sequential material uses a more appropriate structure.
- Claims about changing products have been verified against current primary documentation.
- The article can be skimmed by reading only its headings, labels, examples, and code blocks.
- Its structure fits the subject and is not a cosmetic copy of the neighboring article.
- The final copy is concise without omitting safety or validation.
