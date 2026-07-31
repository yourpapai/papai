<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0307: F5 Scheduling Story Family — Behavioral Coverage for Recurring Tasks, Deferred Scheduled Prompts, and Condition-Driven Alerts

## Status

Implemented (with divergence)

## Date

2026-07-21

## Context

The coverage-expansion roadmap sequences family **F5** (`reminder-*` + `deferred-*`) after F1–F4. Unlike the F4 HTTP family (ADR-0306, which made zero production changes), F5 is the first family whose fire scenarios must drive **production proactive delivery** end to end: a due recurring task creates a real task in the world provider and pushes a "Recurring task created" notification; a due scheduled prompt and a condition-matched alert each run a real `dispatchExecution` proactive LLM turn whose outbound `generateText` call is intercepted by a declared `world.http.expect` chat route. The catalog audit (`needs-seam` for all eight records) traced the blockers to two shared and one fire-specific gap:

1. **No capability ids.** `CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts`) covered `tasks.*`/`memos.*`/`memory.*`/`instructions.*`/`history.*` but neither the seven recurring tools nor the five deferred-prompt tools — so the scripted model's `callCapability(id, input)` could not address them. Shared with F1/F2/F3 (`capability-ids`).
2. **No recurring-notification injection.** `tick(deps)` fired due recurrences through the injectable `SchedulerDeps.resolve`, but delivered its notification through a **module-level `chatProviderRef` set only by `startScheduler`** (`src/scheduler.ts`). The harness disables the background scheduler (`tests/stories/harness/world.test.ts:183-191`), so a directly-driven `tick()` left the ref `null` and the notification was silently skipped.
3. **No past-due seed + single-pass drive.** The three fire scenarios needed to seed a row safely in the past and drive the already-exported single-pass functions (`tick`/`pollScheduledOnce`/`pollAlertsOnce`), with no clock seam.

The roadmap flagged a discovery task — "F5 seed-due-rows could hit a production wall-clock read that bypasses seeding." Research resolved it favorably: every fire path reads "now" internally and compares `<=` a stored due-column (`getDueRecurringTasks` `lte(nextRun, now)`, `getScheduledPromptsDue` `lte(fireAt, now)`, alerts condition+cooldown with no `fireAt`), so a row seeded in the past is picked up by the next single pass with **zero clock-seam production change**. The design (`docs/superpowers/specs/2026-07-21-f5-scheduling-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-21-f5-scheduling-story-family.md`) chose two production seams (12 capability ids; an injectable `SchedulerDeps.chat`), one harness seam (`scheduler-due-seed`, realizing the reserved id, plus the new `scheduler-chat-di` seam id), two story files grouped under `tests/stories/scheduling/`, and a ledger update moving the catalog from 87 to 95 executable scenarios.

## Decision Drivers

- **Two production seams, each reviewed independently (roadmap rule 2).** The 12 `CORE_TOOL_CAPABILITIES` entries land first so the scripted model can address the recurring/deferred tools; the `SchedulerDeps.chat` DI field lands next so a directly-driven `tick()` can deliver its notification. Each carries its own contract test before any story consumes it.
- **No clock seam.** Every fire path seeds a past-due row and drives a single pass against the real wall clock; virtual-time injection stays deferred to a later tiering phase. Alert `overdue` evaluation reads a per-call `new Date()`, mitigated by seeding the matched task's due-date well in the past.
- **Single-pass drive primitives, no timers.** `when.recurringTick()`/`scheduledPoll()`/`alertPoll()` call the already-exported `tick`/`pollScheduledOnce`/`pollAlertsOnce` with world-provided deps — `startScheduler`/`startPollers`/`startProductionBackground` are bypassed (the harness already disables the background scheduler).
- **No assertion-only stories (rule 3).** Every scenario qualifies through a real tool result (token fingerprint on the genuine list output, not scripted reply text), a durable change observed on a following turn (a token appearing/disappearing), or a captured proactive delivery (`then.replyTo`/`then.replyIn`).
- **Create-vs-fire split (deliberate).** `create_deferred_prompt` validates future fire dates in the handler, so create scenarios drive the tool with far-future times and verify listing; fire scenarios seed past-due rows directly, bypassing validation.
- **Fire scenarios are story-mode-only.** The proactive `generateText` fetch is intercepted only under `bun test:stories`' global-fetch patch, not `--contracts` — the same footnote F3 (ADR-0305) recorded for `memory-capture-sweep` and F4 (ADR-0306) for `transcript-viewer`.
- **Reclassifications record their rationale (rule 6).** `SCN-deferred-fire-alert`'s mechanism is corrected (alert prompts have no `fireAt` — they are condition + cooldown driven); the scenario stays executable under the same two seams. Ledger updates ride in the same PR (rule 5).

## Considered Options

### Option 1 — Two production seams (`capability-ids` + `scheduler-chat-di`) + `scheduler-due-seed` harness seam + single-pass drives, no clock seam (chosen)

Append 12 `CORE_TOOL_CAPABILITIES` entries; add an optional `chat?: ChatProvider | null` to `SchedulerDeps` read as `deps.chat ?? chatProviderRef`, so `tick({ resolve, chat })` delivers the notification to an injected provider while production `startScheduler` is byte-for-byte unchanged. Seed past-due `recurring_tasks`/`scheduled_prompts`/`alert_prompts` rows through `given.*` fixtures and drive the exported single-pass functions through `when.*` primitives. Group three recurring + five deferred scenarios under `tests/stories/scheduling/`.

- **Pros:** the DI field introduces zero cross-scenario state (deliberately unlike F4's notify-token module cache, which needed a dual reset); the recurring notification path becomes symmetric with the deferred pollers, which already take `chat` as a parameter; the agent/fire contract stays a single-pass function call trivially drivable from the harness; no virtual-time machinery is built speculatively.
- **Cons:** two production `src/` files change (re-baselines the compat proof for `src/` shape, not just harness bytes); the recurring-notification route is permissive on a null chat ref, so the seam's contract test must assert the delivered notification specifically, not task creation alone; the alert fire depends on the `MemoryTaskProvider` list-item `dueDate` surface (a provider-surface dependency).

### Option 2 — A clock/virtual-time seam instead of past-due seeding (rejected)

Inject a fake "now" into `tick`/`pollScheduledOnce`/`pollAlertsOnce` so fire scenarios seed future rows and advance the clock.

- **Pros:** fire scenarios would not depend on the real wall clock at all.
- **Cons:** research proved no clock seam is needed (every due comparison is a simple `<=` against a stored column, and firing advances rather than loops); a clock seam is a larger, speculative production change touching three modules, deferred by the roadmap to a later tiering phase. Strictly more invasive than Option 1.

### Option 3 — A module-ref setter for the recurring chat provider instead of a `SchedulerDeps.chat` DI field (rejected)

Expose a `setRecurringChatProviderForTesting()`-style module setter the harness calls and resets.

- **Pros:** no `SchedulerDeps` shape change.
- **Cons:** introduces process-lifetime module state that outlives the per-scenario DB — the same determinism hazard F4's notify-token cache posed, which needed a dual reset; breaks the "DI over module mocking" convention; the DI field is a one-line read (`deps.chat ?? chatProviderRef`) that preserves production behavior exactly with no teardown burden.

## Decision

The chosen Option 1 shipped across two production seams, the `scheduler-due-seed` harness seam (recurring + deferred), two story files (eight scenarios), the catalog ledger update, the `scheduler-chat-di` seam id, and a spec reconciliation. What shipped:

1. **`capability-ids` production seam — 12 entries.** `CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts:85-96`) gains `recurring.{create,list,update,pause,resume,skip,delete}` → the seven recurring wire names and `deferred.{create,list,get,update,cancel}` → the five deferred wire names. `registerOfferedCoreToolCapabilities` (`src/tools/core-capabilities.ts:100-104`) registers each pair only when the wire name is in the offered set, so conditional gating (recurring offered when the chat user id is defined; deferred only in `mode === 'normal'`) is honored for free.
2. **`scheduler-chat-di` production seam.** `SchedulerDeps` (`src/scheduler.ts:23-26`) gains `chat?: ChatProvider | null`; `executeRecurringTask` (`src/scheduler.ts:43`) resolves `const chat = deps.chat ?? chatProviderRef` and passes that single value to both the route guard and `finalizeCreatedRecurringTask` (`src/scheduler.ts:57`). `defaultSchedulerDeps` sets no `chat`, and `startScheduler`/`stopScheduler` still own `chatProviderRef`, so production behavior is byte-for-byte unchanged.
3. **`scheduler-due-seed` harness seam — recurring.** `seedTestRecurringTask` (`tests/utils/test-helpers.ts:265`) inserts a `recurring_tasks` row; `ScenarioFixtures.seedRecurringTask` (`tests/stories/harness/fixtures.ts:262,360`) wraps it; `given.recurringTask(context, input)` (`tests/stories/harness/scenario.ts:734-752`) scopes the id and keys `userId` to the world's scoped context id; `when.recurringTick()` (`scenario.ts:867-871`) drives `tick({ resolve: () => world.fixtures.taskProvider, chat: world.chat })`.
4. **`scheduler-due-seed` harness seam — deferred.** `seedTestScheduledPrompt` (`tests/utils/test-helpers.ts:310`) and `seedTestAlertPrompt` (`tests/utils/test-helpers.ts:346`) insert past-due/eligible rows; `seedScheduledPrompt`/`seedAlertPrompt` (`fixtures.ts:264-265,366,369`) wrap them; `given.scheduledPrompt`/`given.alertPrompt` (`scenario.ts:753-779`) scope ids to the world's scoped storage context id; `when.scheduledPoll()`/`when.alertPoll()` (`scenario.ts:872-881`) drive `pollScheduledOnce`/`pollAlertsOnce` with `world.chat` and `() => world.fixtures.taskProvider`.
5. **Three recurring scenarios** (`tests/stories/scheduling/recurring.story.test.ts:11-81`): `SCN-reminder-recurring-create` (create + list, with a pre-seeded recurrence proving the list enumerates real persisted state), `SCN-reminder-recurring-manage` (rename via `recurring.update`, asserting the new title token present and the old absent), `SCN-reminder-recurring-fire` (past-due seed → `when.recurringTick()` → real task in the world provider + captured notification).
6. **Five deferred scenarios** (`tests/stories/scheduling/deferred.story.test.ts:13-148`): `SCN-deferred-schedule-create`, `SCN-deferred-alert-create`, `SCN-deferred-manage` (cancel observed via the status field, not the prompt text), `SCN-deferred-fire-scheduled` (past-due seed → `when.scheduledPoll()` → real proactive LLM turn → captured delivery), `SCN-deferred-fire-alert` (overdue task + alert seed → `when.alertPoll()` → captured alert).
7. **Catalog ledger + seam id.** Eight F5 records moved to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-21'` (`tests/stories/catalog/coverage.ts:819-866`); `scheduler-chat-di` added to `STORY_SEAM_IDS` beside the realized `scheduler-due-seed` (`coverage.ts:50-51`); the eight keys removed from `AUDIT_RECORDS`.

## Consequences

### Positive

- The recurring-task, deferred-scheduled, and condition-driven-alert scheduling paths are now covered by real behavioral scenarios: a refactor that breaks RRULE recurrence storage (ADR-0098), the single-pass tick/poller entrypoints, the proactive-delivery `ChatProvider.sendMessage` path, or the deferred-prompt firing pipeline fails a story, not a unit assertion.
- The `SchedulerDeps.chat` DI field makes recurring-notification delivery symmetric with the deferred pollers (which already take `chat` as a parameter) and introduces zero cross-scenario state — no module setter, no dual reset, production `startScheduler` byte-for-byte unchanged.
- The clock-seam discovery resolved favorably: every fire scenario seeds a past-due row and drives one single-pass function against the real wall clock, so no virtual-time machinery was built speculatively.
- The `SCN-deferred-fire-alert` rationale correction (alert prompts are condition + cooldown driven, with no `fireAt`) is recorded on its executable mapping, replacing the audit's inaccurate "seed `fireAt` in the past" rationale while keeping the scenario executable under the same two seams.
- The `scheduler-due-seed` harness seam is now realized and reusable by any future fire-style scenario; `scheduler-chat-di` is named in `STORY_SEAM_IDS` so downstream audits can reference it.

### Negative

- **Two production `src/` files changed** (`src/tools/core-capabilities.ts`, `src/scheduler.ts`), so the compat baseline must re-record for the intended `src/` shape delta alongside the harness byte changes — expected for this family, not a regression.
- **The fire scenarios are story-mode-only.** The proactive `generateText` fetch is intercepted only under `bun test:stories`' global-fetch patch; under `--contracts` the patch is absent, so the fire scenarios' contract proof bridges `globalThis.fetch` via the sanctioned `setMockFetch`/`restoreFetch` in a `try/finally` scoped to that single test (never baked into the reusable `when.scheduledPoll`/`when.alertPoll` DSL).
- **The alert fire carries a provider-surface dependency.** `MemoryTaskProvider` drops `dueDate` on the `fetchViaSearch` fallback path; the `overdue` op reads `task.dueDate` off the list item, so the scenario must seed a real project plus the `projects.list` capability to force the `dueDate`-preserving `fetchViaProjects` path.

### Risks

- **The `scheduler-chat-di` seam's load-bearing proof is the delivered notification, not task creation.** `canRouteRecurringNotification` returns `true` on a null chat ref (`src/scheduler-recurring.ts:38-39`), so a directly-driven `tick()` creates the fired task even without the seam — only `notifyUser` is skipped. The contract test therefore asserts an injected `chat` receives the recurring-notification `sendMessage` with the task title; a seam regression that silently dropped the notification (but kept creating tasks) would still fail it.
- **Alert `overdue` uses the real wall clock.** The `overdue` op compares against a per-call `new Date()` inside `pollAlertsOnce`; the scenario seeds the matched task's due-date well in the past (`2020-01-01`) so the comparison is deterministic without a fake timer, but it is a real-clock read.
- **Each fire declares exactly one non-risky canned completion.** `invokeLightweight` runs a second verification call only if the result `isRisky` (empty text / `finish_reason:'tool-calls'` / tool failure); the canned completions use non-empty `content`, `finish_reason:'stop'`, and no tool calls so exactly one outbound `/chat/completions` is demanded. A completion mis-shaped to look risky would demand a second call and fail the strict dispatcher.

## Related Decisions

- [ADR-0306](0306-f4-http-story-family.md) — F4 HTTP-Surfaces Story Family: the immediately preceding story-family batch whose `transcript-viewer` scenario established the "production-internal model call declared as a `world.http.expect` HTTP route" precedent F5's two deferred fire scenarios reuse, and the same story-mode-only interception footnote.
- [ADR-0305](0305-f3-memory-story-family.md) — F3 Memory Story Family: established the strict-http dispatcher and the `world.http.expect` FIFO matching F5's fire scenarios declare against, and the token-fingerprint-on-real-tool-result observation model F5's create/list scenarios extend.
- [ADR-0304](0304-story-catalog-audit.md) — Story Catalog Audit: established the structured `needs(...)`/`blocked(...)` pending-record shape and the `EXECUTABLE_STORY_MAPPINGS` table F5's eight new records (and the `SCN-deferred-fire-alert` rationale correction) land in.
- [ADR-0297](0297-f1-command-meta-story-family.md) / [ADR-0298](0298-f2a-task-lifecycle-story-family.md) / [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) / [ADR-0300](0300-f2b2-task-integration-surface-story-family.md) / [ADR-0293](0293-settings-story-family.md) — the sibling story-family batch (same 2026-07-19/20/21 cycle) that established the `capability-ids` seam F5 extends with its 12 entries, the `MemoryTaskProvider` surface F5's alert fire reads `dueDate` from, and the family-by-family landing discipline; their later landing is why the shipped catalog totals (140/165) far exceed F5's 87→95 era target.
- [ADR-0098](README.md) — Adopt RFC 5545 RRULE for Recurrence Storage and Runtime: the RRULE storage and `computeNextRun`/`markExecuted` machinery F5's recurring fire seeds (`rrule: 'FREQ=DAILY'`) and round-trips before the notification is delivered. (Source file pruned with the 0001-0100 batch; referenced via the index.)
- [ADR-0019](README.md) — Recurring Task Automation: the original recurring-task tick/notification architecture into which F5's `SchedulerDeps.chat` DI field inserts. (Source file pruned; referenced via the index.)
- [ADR-0036](README.md) — Centralized Scheduler Utility: the centralized scheduler instance whose default tasks the harness disables (`world.test.ts`) so F5 can drive the single-pass functions directly. (Source file pruned; referenced via the index.)
- [ADR-0116](0116-deferred-prompt-delivery-redesign.md) — Deferred Prompt Delivery Redesign: the same-context delivery and personal-vs-shared audience model F5's scheduled/alert fires deliver through.
- [ADR-0216](0216-reminder-mention-resolution.md) — Reminder Mention Resolution: the recurring-notification routing (`getRecurringNotificationRoute`, `parseScopedContextId` → `dmTarget`) F5's `scheduler-chat-di` seam drives the notification through.
- [ADR-0302](0302-remove-deferred-prompt-modes.md) — Remove Deferred-Prompt Execution Modes: the unified proactive firing path (`dispatchExecution` on the main model, modes removed) F5's deferred fire scenarios exercise — every fire now runs the same unified full-generation path, so F5 specifies only `lightweight`-shaped `executionMetadata` and declares one non-risky canned completion.
- [ADR-0166](0166-storybook-harness-pr1.md) / [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0284](0284-scenario-catalog-hermetic-stories.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness (origin vertical slice + master baseline + OS sandbox + catalog ledger + Docker-all-hosts) these scenarios execute under.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:85-96` | 12 scheduling capability ids — `recurring.{create,list,update,pause,resume,skip,delete}` + `deferred.{create,list,get,update,cancel}` → their wire names. | `read` confirms. |
| `src/tools/core-capabilities.ts:100-104` | `registerOfferedCoreToolCapabilities` registers a pair only when `tools[wireName] !== undefined` (conditional gating honored for free). | `read` confirms. |
| `src/scheduler.ts:23-26` | `SchedulerDeps` gains `chat?: ChatProvider \| null`. | `read` confirms. |
| `src/scheduler.ts:43` | `const chat = deps.chat ?? chatProviderRef` — injected-or-fallback value. | `read` confirms. |
| `src/scheduler.ts:57` | `finalizeCreatedRecurringTask(task, provider, created, chat)` — the resolved `chat` reaches the notification path. | `read` confirms. |
| `src/scheduler.ts:28-30,151-176` | `defaultSchedulerDeps` sets no `chat`; `startScheduler` still owns `chatProviderRef` — production path unchanged. | `read` confirms. |
| `src/scheduler-recurring.ts:38-39` | `canRouteRecurringNotification` returns `true` when `chatProviderRef === null` (see divergence). | `read` confirms. |
| `tests/utils/test-helpers.ts:265` | `seedTestRecurringTask(input)` — raw `recurring_tasks` insert. | `read` confirms. |
| `tests/utils/test-helpers.ts:310` | `seedTestScheduledPrompt(input)` — raw `scheduled_prompts` insert (past-due `fireAt`, `status:'active'`). | `read` confirms. |
| `tests/utils/test-helpers.ts:346` | `seedTestAlertPrompt(input)` — raw `alert_prompts` insert (`lastTriggeredAt:null` always eligible). | `read` confirms. |
| `tests/stories/harness/fixtures.ts:262,360` | `ScenarioFixtures.seedRecurringTask` wraps `seedTestRecurringTask`. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:264-265,366,369` | `seedScheduledPrompt`/`seedAlertPrompt` wrap the deferred seed helpers. | `read` confirms. |
| `tests/stories/harness/scenario.ts:46,26` | imports `tick` and `pollScheduledOnce`/`pollAlertsOnce`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:734-752` | `given.recurringTask` — scopes id, keys `userId` via `toScopedContextId`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:753-766` | `given.scheduledPrompt` — scopes `deliveryContextId` to scoped storage context id. | `read` confirms. |
| `tests/stories/harness/scenario.ts:767-779` | `given.alertPrompt` — JSON-stringifies the condition. | `read` confirms. |
| `tests/stories/harness/scenario.ts:867-871` | `when.recurringTick` — `tick({ resolve: () => world.fixtures.taskProvider, chat: world.chat })`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:872-881` | `when.scheduledPoll`/`when.alertPoll` — drive the deferred single-pass pollers with `world.chat`. | `read` confirms. |
| `tests/stories/scheduling/recurring.story.test.ts:11-81` | Three recurring scenarios (create/manage/fire). | `read` confirms. |
| `tests/stories/scheduling/deferred.story.test.ts:13-148` | Five deferred scenarios (schedule-create/alert-create/manage/fire-scheduled/fire-alert). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:50-51` | `scheduler-due-seed` (realized) + `scheduler-chat-di` (new) in `STORY_SEAM_IDS`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:819-866` | Eight F5 `EXECUTABLE_STORY_MAPPINGS`, `verifiedAt: '2026-07-21'`; the eight ids absent from `AUDIT_RECORDS`. | `read` confirms. |
| `tests/tools/core-capabilities-scheduling.test.ts` | Capability-id contract test (resolves from id when offered; unoffered not registered). | `glob` confirms. |
| `tests/scheduler-chat-di.test.ts:55-58` | `tick({ resolve, chat })` DI contract — asserts the injected `chat` receives the notification `sendMessage` with the task title. | `read` confirms. |
| `tests/stories/harness/scenario.test.ts:592-644` | `scheduler-due-seed` seam contract tests (recurring fire + scheduled fire). | `read` confirms. |
| `tests/stories/harness/world.test.ts:183-191` | Background scheduler disabled — `DEFAULT_SCHEDULER_TASK_NAMES` never registered. | `read` confirms. |

Plan-vs-implementation notes:

- **The `scheduler-chat-di` seam proves the notification specifically, not task creation.** `canRouteRecurringNotification` returns `true` on a null chat ref (`src/scheduler-recurring.ts:38-39`), so with the module `chatProviderRef` null `executeRecurringTask` still creates the fired task (the route guard short-circuits permissive) and only `notifyUser` is skipped. The plan/spec's Risk 4 phrasing ("the unset case stays silent") is accurate, but the load-bearing proof is the delivered notification: the contract test (`tests/scheduler-chat-di.test.ts:55-58`) asserts an injected `chat` receives the `sendMessage` with the task title — the created task alone would pass even without the seam. Recorded in the spec's post-implementation deviations.
- **`SchedulerDeps.chat?: ChatProvider | null` chosen over a module-ref setter.** A DI field read as `const chat = deps.chat ?? chatProviderRef` (one value used by both the route guard and the finalize call) keeps zero cross-scenario state and preserves production behavior byte-for-byte: `defaultSchedulerDeps` sets no `chat`, `startScheduler`/`stopScheduler` still own `chatProviderRef`. No module-level setter/teardown was introduced — deliberately unlike F4's notify-token module cache (ADR-0306), which needed a dual reset.
- **The recurring-manage scenario renames via `recurring.update`, not `recurring.pause`.** `list_recurring_tasks` filters only by `userId` and never by `enabled`, so a paused recurrence still lists by its title — a bare pause leaves the title token unchanged and proves nothing. Shipped (`recurring.story.test.ts:50-61`) performs a `recurring.update` rename ('Weekly report' → 'Monthly report') and asserts the new token present + the old absent. The scenario title still reads "pausing a recurrence…" byte-for-byte so the ledger storyId matches; an inline comment records the substitution. The tool's id field is `recurringTaskId`, not `id`.
- **The deferred-manage scenario observes the status field, not the prompt text.** The unfiltered `list_deferred_prompts` still returns cancelled rows' prompt text, so the planned `not.toContain('Submit')` was unfalsifiable. Shipped (`deferred.story.test.ts:69-83`) pairs `toContain('cancelled')` with `not.toContain('active')`: the scenario lists only after cancelling, so a no-op cancel would leave the row `active` and fail the pair.
- **The alert fire seeds a real project to preserve `dueDate` on the fetch path.** `MemoryTaskProvider`'s `fetchViaSearch` fallback omits `dueDate`, but the `overdue` op reads `task.dueDate` off the list item. Shipped (`deferred.story.test.ts:117-127`) seeds `given.taskCapabilities(['projects.list'])` + `world.tasks.createProject(...)` before `createTask`, forcing the `dueDate`-preserving `fetchViaProjects` path. This is the provider-surface dependency flagged in the spec's Risk 3; the memory provider needed no code change, only capability + project seeding.
- **`given.seedSystemLlmConfig()` is not a DSL member — LLM config is seeded by default.** `world.ts` calls `fixtures.seedSystemLlmConfig()` unconditionally during world setup (base URL `https://llm.invalid/v1`), so the deferred fire scenarios call no `given.seedSystemLlmConfig` and simply declare `world.http.expect` against that URL (`deferred.story.test.ts:91,128`). The harness contract test (which runs under `--contracts`, where the fetch patch is absent) bridges `globalThis.fetch` via `setMockFetch`/`restoreFetch` in a `try/finally` scoped to that single test — never baked into the reusable `when.scheduledPoll`/`when.alertPoll` DSL.
- **The recurring-create scenario was strengthened beyond the plan.** The plan's create scenario asserted only the created token (`'Standup'`). Shipped (`recurring.story.test.ts:17-36`) also pre-seeds a `given.recurringTask(dm, { title: 'Quarterly audit reminder', … })` and asserts both `promptTextFingerprint('Standup')` (the created recurrence) **and** `promptTextFingerprint('Quarterly')` — a token that exists in no create result and can only come from `list_recurring_tasks` genuinely enumerating persisted state, closing the "scripted reply echoes the create input" loophole.
- **The recurring fire notification is a pure string template, no LLM call.** `notifyUser` builds the notification from the created task's title, so `SCN-reminder-recurring-fire` declares no `world.http.expect` chat route — only the two deferred fire scenarios do. Each fire declares exactly one non-risky canned completion (non-empty `content`, `finish_reason:'stop'`, no tool calls), so `invokeLightweight` makes exactly one outbound call.
- **The shipped catalog totals far exceed F5's era target.** The plan's ledger target was **87→95 executable / 41→33 pending (128 ids)**. Shipped, the catalog now carries **140 executable / 25 pending (165 ids)** (`tests/stories/harness/catalog-coverage.test.ts:216,305`; `tests/scripts/story-coverage-totals.test.ts:13-27`): the sibling story-family batch (ADR-0293, 0297-0300, 0305, 0306) and the tier-expansion roadmap (parity @1, smoke @2, platform @3 lanes) landed after F5 and filled `EXECUTABLE_STORY_MAPPINGS` far beyond F5's eight records. F5's own deliverables — the eight `SCN-*` mappings at `verifiedAt: '2026-07-21'` and the `scheduler-chat-di` seam id — are all present; the larger totals are the cumulative state, not an F5 divergence.
- **Both production seams landed first and are each covered by their consumer stories.** The 12 capability ids are exercised by every create/manage scenario's `callCapability('recurring.*'|'deferred.*', …)`; the `SchedulerDeps.chat` field is exercised by `SCN-reminder-recurring-fire`'s captured notification. The `scheduler-due-seed` fixtures/primitives land before any story and carry their own contract tests (`scenario.test.ts:592-644`).

The source plan `docs/superpowers/plans/2026-07-21-f5-scheduling-story-family.md` and design `docs/superpowers/specs/2026-07-21-f5-scheduling-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
