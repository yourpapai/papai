---
name: designing-new-provider
description: Use when the user asks to add, integrate, support, evaluate, or research a new chat platform (Telegram/Mattermost-like) or task tracker (Kaneo/YouTrack-like) provider in papai — covers anything from "could papai talk to Linear?" through to a finished, approved OpenSpec change ready for implementation
---

# Designing a New papai Provider

Take a user request like "let's add Linear support" or "could we integrate Slack?" through research, exploration, and design into an OpenSpec change (proposal + design + TDD-ordered tasks) that **another session** will implement via `/opsx:apply`.

<HARD-GATE>
This skill is RESEARCH AND DESIGN ONLY.

You MUST NOT, under any circumstance during this skill:

- Write, edit, or create any `.ts`, `.tsx`, `.js`, `.jsx` file under `src/`, `client/`, or `tests/`
- Run `bun add`, `npm install`, or modify `package.json`, `bunfig.toml`, `tsconfig.json`
- Create directories like `src/providers/<new>/` or `src/chat/<new>/`
- Register the new provider in `src/providers/registry.ts` or `src/chat/registry.ts`
- Add a capability string to `src/providers/types.ts`
- Touch env-var validation in `src/index.ts`
- "Just sketch out" the schema or class in a real source file — code blocks inside markdown documents are fine; `.ts` files are not

Only these outputs are allowed:

- OpenSpec change artifacts under `openspec/changes/<change-name>/` (`proposal.md`, `design.md`, `tasks.md`)
- Reading any file in the repo
- Calling research tools (`context7`, `synthetic` web search, `WebFetch`)
- Asking the user clarifying questions

Implementation happens in a SEPARATE session, executed by a different agent against the change you produce. You do not get to start it. Hand off and stop.
</HARD-GATE>

## When to Use

- User says "let's add `<X>`", "integrate `<X>`", "support `<X>`", "research how to add `<X>`", "what would it take to plug in `<X>`" — where X is a chat platform or task tracker
- User points at an API and asks "could papai talk to this?"
- Mention of any provider name not already in `src/providers/` or `src/chat/`: Linear, Jira, Asana, GitHub Issues, GitLab Issues, Trello, ClickUp, Notion, Plane, Tuleap, Slack, Discord, Microsoft Teams, WhatsApp, Signal, Matrix, etc.

**Do NOT use when:**

- User wants to extend an existing provider (read that provider's directory and `src/providers/CLAUDE.md` instead)
- User wants to add a new LLM tool against existing providers (use `src/tools/CLAUDE.md`)
- User wants to fix a bug in an existing provider

## The Canonical Brief

The full research / design / plan brief lives at **`docs/prompts/add-new-provider.md`**. Read it end-to-end before doing anything else. It defines:

- The `<<…>>` inputs the user must supply (provider name, API URL, auth model, hosting, scope, non-goals)
- The mandatory research order (project context → API docs via `context7` → capability mapping → risks)
- The required design sections and the per-task TDD structure (red → green → commit)
- The quality bar self-review checklist
- The exhaustive "what NOT to do" list

The brief predates OpenSpec: where it tells the agent to write `docs/<name>-provider-design.md` and `docs/plans/YYYY-MM-DD-<name>-implementation.md`, those deliverables now land in the change's artifacts — the goal/scope/non-goals become `proposal.md`, the design content becomes `design.md`, and the implementation tasks become `tasks.md`. Everything else in the brief (research order, section content, quality bar) still applies.

This skill is the **discipline wrapper** around that brief. The brief tells you _what_ to produce. This skill enforces _that you stop after producing it_.

## Required Workflow

Create one `TodoWrite` task per step and complete them **in order**. Do not parallelise. Do not start step N+1 until step N is approved by the user.

1. **Read the brief.** Open `docs/prompts/add-new-provider.md` and read it in full.
2. **Collect inputs.** Ask the user for every `<<…>>` placeholder, **one question at a time**. Do not invent values, do not batch.
3. **Explore.** **REQUIRED SUB-SKILL:** Use `/opsx:explore` (openspec-explore) to refine intent, surface assumptions, and weigh 2–3 design directions. Return here once a direction is settled.
4. **Research.** Execute the "Mandatory research steps" from the brief, in order:
   - Read every `CLAUDE.md` listed in the brief (`CLAUDE.md`, `src/providers/CLAUDE.md`, `src/chat/CLAUDE.md`, `src/tools/CLAUDE.md`, `tests/CLAUDE.md`).
   - Read the relevant interface in full (`src/providers/types.ts` for task, `src/chat/types.ts` for chat).
   - Read at least one full reference implementation: YouTrack (`src/providers/youtrack/`) for task, Telegram (`src/chat/telegram/`) for chat.
   - **Fetch the target API documentation via `context7`** — do not rely on training data. APIs drift. If `context7` lacks the docs, fall back to web search and cite the official URL.
   - Build the capability matrix and domain-type mapping defined in the brief.
5. **Propose the change.** **REQUIRED SUB-SKILL:** Use `/opsx:propose` (openspec-propose) to create the change, carrying the brief's deliverables into its artifacts:
   - `proposal.md` — goal, scope, non-goals, capability summary
   - `design.md` — the brief's 14 design sections, modelled on `docs/youtrack-full-api-design.md`
   - `tasks.md` — the TDD-ordered implementation tasks (red → green → commit per task), modelled on `docs/plans/2026-04-08-youtrack-api-implementation.md`

   Get explicit user approval of the artifacts.

6. **Hand off.** Produce a single short paragraph the user can paste into a fresh executor session. Then **stop**. Do not begin task 1. Do not "just check that it compiles". End your turn.

## Hard Constraints from papai (Bake into Design, Do Not Implement)

These come from the project's `CLAUDE.md` files. The change's tasks must encode them; this skill must not act on them.

- **Runtime:** Bun (not Node). **Validation:** Zod v4. **LLM:** Vercel AI SDK. **Lint/format:** oxlint / oxfmt. **Logging:** pino structured JSON.
- **TDD hook pipeline is enforced at runtime.** See `CLAUDE.md` → "TDD Enforcement (Hooks)". Tasks that try to write impl before tests will be blocked. Design every task as red → green → commit.
- **`.js` extension** in every relative import path (Bun ESM resolution).
- **No `lint-disable`, `@ts-ignore`, `@ts-nocheck`** — ever. Fix the underlying issue.
- **Capability gating in the same task** that adds the operation. Tools never see a half-wired capability.
- **Mandatory logging** in every operation: `log.debug` on entry with all params, `log.info` on success with result identifiers, `log.error` on caught exceptions with `error instanceof Error ? error.message : String(error)`. Use `param !== undefined` (not `!!param`). Never log tokens, API keys, or PII.
- **Domain-type extensions** only when at least one _other_ provider could plausibly support the field. Otherwise hide behind `extra: Record<string, unknown>` or a capability flag. Do not pollute `Task` / `Project` / `Comment` for one-provider concepts.
- **Pagination must be bounded** — every list operation needs a `MAX_PAGES` cap to bound LLM context.
- **`getPromptAddendum()`** is required on every `TaskProvider`. Design what it returns.

## Closing the Implementation Loophole

Agents under pressure rationalise their way into "just a tiny bit" of code. **All of these are violations of this skill:**

| Rationalization                                                       | Reality                                                                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| "I'll scaffold an empty `index.ts` so the design feels concrete"      | Empty files are still files. The hook pipeline will catch them and waste the turn.                         |
| "The design is done, task 1 is small, I'll just start"                | You don't get to decide. Hand off and stop.                                                                |
| "I need to write the test file to know if the API surface is right"   | Test cases live in the change's `tasks.md` as fenced code blocks, not as `.test.ts` files on disk.         |
| "The user said 'go ahead' so they meant implement"                    | "Go ahead" after a design = "approve and finish the artifacts". Confirm before touching code.              |
| "Editing the registry is just one line, not really implementation"    | Registry edits are implementation. They alter runtime behaviour and trigger the hook pipeline.             |
| "I'll add the capability string to `types.ts` so the design is valid" | The design is valid as markdown. Type changes are implementation.                                          |
| "Writing the schema file is just data, not logic"                     | `.ts` files under `src/` are implementation regardless of content.                                         |
| "I'll spike a scratch script to verify the API works"                 | If the script lives outside the repo and you delete it after, fine. If it touches `src/`, it is forbidden. |
| "I already designed it in my head, the markdown is busywork"          | The artifacts are the deliverable. Without them, the executor session has nothing to act on.               |
| "Following the spirit, not the letter"                                | **Violating the letter of the rules is violating the spirit of the rules.**                                |

## Red Flags — STOP and Re-read the HARD-GATE

- About to run `Write` or `Edit` on any path under `src/`, `client/`, or `tests/`
- About to run `Bash` with `bun add`, `npm install`, `mkdir src/...`, or touch `package.json`
- About to register the provider in `src/providers/registry.ts` or `src/chat/registry.ts`
- About to add a capability string to `src/providers/types.ts`
- About to modify `src/index.ts` env validation
- About to "demonstrate" the provider class in a real `.ts` file rather than a markdown code block
- Thinking "the design and a tiny implementation are basically the same artefact"
- Thinking "the user clearly wants this shipped, not just designed"

**All of these mean: stop, finish the change artifacts, hand off, end the turn.**

## Quick Reference

| Step              | Output                                               | Sub-skill              |
| ----------------- | ---------------------------------------------------- | ---------------------- |
| 1. Read brief     | (mental model)                                       | —                      |
| 2. Collect inputs | answers to `<<…>>` placeholders                      | —                      |
| 3. Explore        | settled design direction                             | `/opsx:explore`        |
| 4. Research       | capability matrix + risk list (notes)                | `context7`, file reads |
| 5. Propose change | `openspec/changes/<name>/` proposal + design + tasks | `/opsx:propose`        |
| 6. Hand off       | one-paragraph paste-prompt for executor session      | —                      |

## Common Mistakes (Bake Into the Change)

- **Skipping `context7`.** Training data lies. Always fetch the target API fresh.
- **Designing horizontally** (all reads, then all writes, then all collaboration). The first phase must be a thin **vertical** slice: auth → list → create → read end-to-end.
- **Copying YouTrack-only concepts** (state bundles, work items, sprints) into providers that don't have them. Map honestly, use `extra` for one-provider data.
- **Over-extending shared types.** A new field on `Task` requires at least one _other_ provider that could fill it.
- **Unbounded pagination.** Every list operation needs `MAX_PAGES`.
- **Calendar estimates.** Estimate **scope** (file count, capability count), never time.
- **Forgetting `getPromptAddendum()`.** Every `TaskProvider` exposes it; the design must specify the return value.
- **Forgetting error classification.** Each provider needs `classify-error.ts` mapping HTTP status + provider error codes → `AppError` from `src/errors.ts`.

## When the User Says "Just Implement It"

Respond, verbatim or close to it:

> The `designing-new-provider` skill makes this session research and design only. The change I'm about to propose is meant to be implemented in a **fresh** session via `/opsx:apply` — that keeps the executor's context clean and lets the TDD hook pipeline enforce red → green per task. Want me to (a) finish the change artifacts and hand them off to a new session, or (b) explicitly override the skill and start implementing here (your call, but it bypasses the discipline this skill enforces)?

Wait for an **explicit** override. Do not assume one. "Sure" is not explicit. "Yes, override the skill and implement now" is.

## Hand-Off Template

When the change is approved, end your turn with something like:

> Change proposed and approved:
>
> - `openspec/changes/<change-name>/proposal.md`
> - `openspec/changes/<change-name>/design.md`
> - `openspec/changes/<change-name>/tasks.md`
>
> To execute, open a fresh session and paste:
>
> > Use `/opsx:apply <change-name>`. Start with task 1. Follow the TDD pipeline strictly — the project's hook system will block any deviation.
>
> I'm stopping here per the `designing-new-provider` skill.

Then stop.
