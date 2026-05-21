<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reusable Prompt: Research / Design / Plan a New Provider

Use this prompt to brief an AI agent (Claude, GPT, etc.) on producing a
high-quality design document and implementation plan for adding either a new
**chat platform adapter** (`ChatProvider`) or a new **task tracker adapter**
(`TaskProvider`) to papai.

The prompt assumes the agent starts with **zero context** about papai. It
encodes everything the agent needs to research, the artefacts it must produce,
and the quality bar — modelled on the existing YouTrack docs:

- `docs/youtrack-full-api-design.md` — original design
- `docs/plans/2026-04-08-youtrack-full-api-enhanced-design.md` — enhanced design
- `docs/plans/2026-04-08-youtrack-api-implementation.md` — TDD implementation plan

---

## How to use

1. Copy the **prompt body** below into a fresh agent session.
2. Fill in the `<<…>>` placeholders in the **Inputs** block (provider name,
   API docs URL, scope, deadlines, etc.). Leave the rest verbatim.
3. Run the agent in **research/design mode first** — do not let it write code
   until both design + implementation plan are reviewed and approved.
4. Approve the design doc, then re-run the agent in **execute mode** against
   the implementation plan it produced (or a separate executor agent).

---

## Prompt body (copy from here)

````markdown
# Task: Design and Plan a New `<<chat | task>>` Provider for papai — `<<provider-name>>`

You are a senior software architect joining the **papai** project for the
first time. Your job is to produce a **design document** and a **TDD-ordered
implementation plan** for adding a new provider. You will not write any
production code in this turn — only research, design, and planning.

Operate under **radical skepticism**: verify every claim against the actual
codebase, the provider's official API docs, and authoritative sources. Do not
trust prior knowledge; APIs and project conventions drift.

---

## Inputs (fill these in before sending)

- **Provider type:** `<<chat | task>>` — chat platform adapter (`ChatProvider`)
  or task tracker adapter (`TaskProvider`).
- **Provider name:** `<<e.g. linear, jira, slack, discord, asana, github-issues>>`
- **Official API docs URL(s):** `<<https://…>>`
- **Auth model the user expects:** `<<API token | OAuth | bot token | basic | …>>`
- **Hosting model:** `<<SaaS only | self-hostable | both>>`
- **Existing SDK to consider (if any):** `<<npm package name or "none — raw HTTP">>`
- **Initial scope (optional):** `<<MVP capabilities the user wants in phase 1, e.g. "tasks CRUD + comments only">>`
- **Hard non-goals (optional):** `<<things to explicitly exclude>>`
- **Deadline / milestone (optional):** `<<absolute date>>`

If any input above is missing or ambiguous, **stop and ask the user** before
researching. Do not invent values.

---

## What papai is (one paragraph)

papai is a Bun + TypeScript chat bot that lets users manage tasks via natural
language. A user sends a message through a configurable **chat platform**
(currently Telegram or Mattermost). The bot calls a configurable
OpenAI-compatible LLM via the Vercel AI SDK, which autonomously selects and
calls **task tracker tools**. Tools delegate to a **task provider** (currently
Kaneo or YouTrack) that talks to the tracker's REST API. Both layers — chat and
task — are pluggable behind interfaces and registries. Capabilities are
declared per provider; tools are gated so only supported operations are exposed
to the LLM.

---

## Mandatory research steps (in order, do not skip)

### Step 1 — Read project context

Read these files before forming any opinion. Cite them by `path:line` in your
final output when you reference a convention or pattern.

- `CLAUDE.md` — top-level project rules (Bun, Zod v4, oxlint, TDD hooks, logging).
- `src/providers/CLAUDE.md` — provider conventions (only if designing a task provider).
- `src/tools/CLAUDE.md` — tool conventions, capability gating, destructive actions.
- `src/chat/CLAUDE.md` — chat adapter conventions (only if designing a chat provider).
- `src/commands/CLAUDE.md` — command handler pattern, `ReplyFn`.
- `tests/CLAUDE.md` — test helpers, mock pollution rules, TDD hook pipeline.
- The relevant interface file:
  - Task provider → `src/providers/types.ts` (`TaskProvider`, `Capability`,
    `ProviderConfigRequirement`) and `src/providers/domain-types.ts`.
  - Chat provider → `src/chat/types.ts` (`ChatProvider`, `IncomingMessage`,
    `ReplyFn`, `ChatUser`, `ChatFile`, `ReplyContext`).
- The relevant registry: `src/providers/registry.ts` or `src/chat/registry.ts`.
- **At least one existing implementation in full**, as a reference:
  - Task → `src/providers/youtrack/` (preferred — most complete) and skim
    `src/providers/kaneo/` for contrast.
  - Chat → `src/chat/telegram/` (preferred — most features) and skim
    `src/chat/mattermost/`.
- The existing tests for that implementation under `tests/providers/<name>/`
  or `tests/chat/<name>/` to understand the test style and fixture layout.
- The two YouTrack design docs and the implementation plan listed in the
  header of this file — these are the **structural template** for what you
  must produce.

### Step 2 — Read the provider's official API docs via `context7`

Use `context7` (MCP server) to fetch up-to-date documentation for the target
provider. Do **not** rely on training data — APIs change. Capture:

- Auth flow and required scopes.
- Endpoint inventory mapped to the `Capability` union (for task providers) or
  to the `ChatProvider` methods (for chat providers).
- Pagination model (`$top`/`$skip`, cursor, page tokens, link headers).
- Rate-limit headers and retry guidance.
- Webhook / WebSocket / long-poll model (chat only) and event payload shape.
- File upload model (multipart, signed URLs, chunked) — relevant for both
  chat (`ChatFile`, `IncomingFile`) and task (`attachments.*`).
- Error envelope shape (status codes, error codes, machine-readable fields).
- Anything **non-obvious or surprising** — locale handling, soft deletes,
  shared resources across projects, eventual consistency, idempotency keys.

If `context7` does not have the docs, fall back to `synthetic` web search,
then cite the official URL.

### Step 3 — Map the provider to the papai abstraction

Produce two mappings:

1. **Capability matrix.** For each `Capability` in
   `src/providers/types.ts` (task) or each `ChatProvider` method (chat),
   answer: _supported / partially supported / not supported / not applicable_,
   with one-line justification and a link to the relevant API endpoint.
2. **Domain-type fit.** For each normalized type the abstraction exposes
   (`Task`, `Project`, `Comment`, `Label`, `Status`, `Attachment`, `WorkItem`,
   `Sprint`, `Activity`, `UserRef`, … or for chat: `IncomingMessage`,
   `ReplyContext`, `IncomingFile`, etc.), call out fields that are:
   - **Free** — direct 1:1 mapping.
   - **Derived** — computed from multiple API fields; explain the formula.
   - **Lossy** — provider has it but the abstraction doesn't model it; decide
     whether it goes in `extra: Record<string, unknown>` or is dropped.
   - **Missing** — abstraction expects it but provider doesn't expose it;
     propose a fallback.

### Step 4 — Identify risks and open questions before designing

List things that could derail the implementation: rate-limit asymmetries,
soft-delete semantics, locale-dependent field names, custom-field bundles
shared across projects (see YouTrack §4.3), webhook delivery guarantees,
permission scoping (admin vs. member tokens), pagination caps that bound
LLM context windows, any provider quirk that has bitten people in public
forums. Each risk gets a short mitigation.

If any risk requires a product decision (e.g. "should we ship without
attachments?"), **stop and ask the user**.

---

## Deliverables

Produce **two markdown files** in the repository, in this order. Do not start
file 2 until file 1 is complete.

### Deliverable 1 — Design document

**Path:** `docs/<<provider-name>>-provider-design.md` (task) or
`docs/<<provider-name>>-chat-design.md` (chat).

**Required sections** (mirror `docs/youtrack-full-api-design.md`):

1. **Goal** — one paragraph: what the provider unlocks for users.
2. **Current state** — what already exists (likely nothing; note any partial
   work or scaffolding).
3. **API surface to cover** — grouped by resource family, with **bold** for
   anything not in scope of the MVP, and citations to the official endpoint.
4. **Domain-type mapping** — the matrix from research step 3, plus any
   proposed extensions to `Task` / `Project` / `Comment` / etc. Justify each
   extension by showing at least one **other** provider that could plausibly
   support the same field — otherwise put it in `extra` (do not pollute
   shared types with provider-only data).
5. **New & changed tools** — table of tool name → capability → notes.
   Include description-text changes for existing tools when the new provider
   forces a richer LLM-facing schema.
6. **Custom-field / bundle handling** (task only) — if the provider has a
   notion of project-scoped or workspace-scoped enums/states, design the
   resolution + caching strategy explicitly. Cite the YouTrack bundle-cache
   pattern in `src/providers/youtrack/bundle-cache.ts` as prior art.
7. **Pagination strategy** — endpoint conventions, helper signature, default
   page size, max-pages cap (must bound LLM context).
8. **Error classification** — table mapping HTTP status / provider error code
   → `AppError` discriminant, with the user-facing message. Reference
   `src/errors.ts` for the union.
9. **Auth & config** — `ProviderConfigRequirement[]` (task) or env-var list
   (chat). Show the keys exactly as they will appear in `/config` and
   `/set <key> <value>`.
10. **Capability matrix additions** — exhaustive list of `Capability` strings
    the provider will declare.
11. **Phased rollout** — at least 2 phases, each independently shippable
    behind capability gating. Phase 1 must be a thin vertical slice that
    proves the integration end-to-end (auth → list → create → read).
12. **Testing strategy** — unit fixtures (`tests/providers/<name>/fixtures/*.json`),
    mutation testing notes (Stryker), and an opt-in E2E plan (Docker image
    if available, otherwise mocked HTTP).
13. **Risks & open questions** — from research step 4.
14. **Non-goals** — explicitly out of scope.

### Deliverable 2 — Implementation plan

**Path:** `docs/plans/YYYY-MM-DD-<<provider-name>>-implementation.md` (use
today's absolute date — ask the user if you don't know it).

**Format:** mirror `docs/plans/2026-04-08-youtrack-api-implementation.md`
exactly. Each task is a numbered subsection inside its phase, and each task
follows the **TDD red→green→commit** pipeline:

```
### Task <phase>.<n>: <imperative title>

**Files:**
- Create / Modify / Test: <list>

**Step 1: Write the failing test**
<full test code, ready to paste>

**Step 2: Run test to verify it fails**
Run: `bun test tests/<...> --reporter=dot`
Expected: FAIL — <specific failure reason>

**Step 3: Write minimal implementation**
<full impl code, ready to paste>

**Step 4: Run test to verify it passes**
Run: `bun test tests/<...> --reporter=dot`
Expected: PASS

**Step 5: Wire into provider / registry / tool layer**
<exact edits to types.ts, registry.ts, tools/*.ts as needed>

**Step 6: Run all tests**
Run: `bun test`
Expected: all green

**Step 7: Commit**
git commit -m "feat(<scope>): <message>"
```

Constraints on the plan:

- **TDD-first**, always. The test file must be written and must fail before
  the impl is touched. The TDD hook pipeline (`CLAUDE.md` → "TDD Enforcement
  (Hooks)") will block any deviation; design tasks so the hooks stay green.
- **One concept per task.** Bundle-resolution, capability gating, error
  classification, prompt addendum, registry registration, tool wiring,
  configuration UI — each gets its own task.
- **Capability gating in the same task** that adds the operation, so the
  tool layer never sees a half-wired capability.
- **Logging mandatory** in every operation: `log.debug` on entry with all
  params, `log.info` on success with result identifiers, `log.error` on
  caught exceptions with `error instanceof Error ? error.message : String(error)`.
  Use `param !== undefined` (not `!!param`) for boolean checks. Never log
  tokens, API keys, or PII.
- **No `lint-disable` / `@ts-ignore` / `@ts-nocheck`** — fix the underlying
  type or lint issue. The pre-commit hook will reject otherwise.
- **`.js` extension** in every relative import path (Bun ESM resolution).
- **Zod v4** for every request/response shape; place schemas in
  `schemas/` subdirectory.
- **Error classification** in `classify-error.ts`, not inline.
- **Mutation testing**: design tasks so Stryker keeps coverage; flag any
  task where mutation testing is impractical and justify.
- **Rollback**: each phase must be revertible by removing the capability
  declaration without leaving dangling tools.

Each task ends with the exact `git commit -m` line to use.

---

## Quality bar (the agent's self-review checklist)

Before returning the deliverables, verify:

- [ ] Every claim about the target API cites an official doc URL.
- [ ] Every claim about papai cites a `path:line` in the repo.
- [ ] The capability matrix is exhaustive (no `Capability` left unaddressed).
- [ ] No domain-type extension lives in `Task`/`Project`/`Comment` unless at
      least one **other** provider could plausibly support it.
- [ ] Phase 1 is a thin end-to-end slice (auth + one read + one write),
      not a horizontal layer.
- [ ] Every implementation task in deliverable 2 is independently runnable
      and ends with a green `bun test` and a single commit.
- [ ] Error classification covers 401/403/404/409/422/429/5xx **and** the
      provider's own error codes.
- [ ] Pagination is bounded; no unbounded list pulls into LLM context.
- [ ] Logging follows `src/providers/CLAUDE.md` / `src/chat/CLAUDE.md`.
- [ ] No mention of writing files outside `src/`, `client/`, `tests/`,
      `docs/`, `docs/plans/`.
- [ ] All dates are absolute (`YYYY-MM-DD`), never relative ("next week").
- [ ] `context7` was actually called for the target API docs and the
      response was used (cite it).
- [ ] You stopped and asked the user for any decision marked with `<<…>>`
      or any open question that gates the design.

---

## What NOT to do

- Do **not** write production code in this turn. Only docs.
- Do **not** invent capabilities, fields, or endpoints that the official
  API does not document. If unsure, mark as `OPEN QUESTION` and ask.
- Do **not** copy YouTrack-specific concepts (state bundles, work items,
  sprints) into the new provider unless the new provider has the same
  concept under a different name. Map honestly.
- Do **not** propose cross-provider abstractions for things only this
  provider has. Use `extra: Record<string, unknown>` or hide behind a
  capability flag.
- Do **not** propose webhook handling for chat providers without first
  confirming the deployment model supports inbound HTTP (papai today
  uses long-polling for Telegram and WebSocket for Mattermost — see
  `src/chat/telegram/index.ts` and `src/chat/mattermost/index.ts`).
- Do **not** skip the TDD hook pipeline. Tasks that try to write impl
  before tests will be blocked at runtime.
- Do **not** use emojis in any deliverable.
- Do **not** estimate calendar time. Estimate **scope** (file count,
  capability count) instead.

---

## Output format for this session

1. First, a short **research log** (≤ 300 words): which files you read,
   which API docs you fetched, which open questions you raised with the
   user.
2. Then the **two deliverables**, written to disk at the paths specified
   above. Confirm the paths in your reply.
3. Finally, a **next-step prompt** the user can paste into a separate
   executor session to begin Phase 1 of the implementation plan.
````

---

## Notes for the human running this prompt

- The agent will likely ask 3–6 clarifying questions before producing the
  design. That is the correct behaviour; do not pre-answer them in the
  initial prompt.
- After the design is approved, run the implementation plan through a
  separate fresh agent session (e.g. via the `executing-plans` skill) so
  the design context does not pollute the implementer's window.
- The TDD hook pipeline (see top-level `CLAUDE.md`) will enforce the
  red→green ordering at runtime. If the implementer tries to skip a step,
  the hook will block it and surface a clear error.
- For chat providers specifically, also confirm: message-edit semantics,
  reply/quote/thread model, file upload limits, formatting dialect (HTML,
  Markdown, MarkdownV2, mrkdwn, blocks), and rate limits per chat vs. per
  bot. These map to `ReplyFn.formatted`, `ReplyContext`, and `ChatFile`.
- For task providers, confirm: workspace vs. project scoping, custom-field
  bundle sharing, soft-delete vs. hard-delete, and whether the API exposes
  a "current user" endpoint (needed for `getCurrentUser()`).
