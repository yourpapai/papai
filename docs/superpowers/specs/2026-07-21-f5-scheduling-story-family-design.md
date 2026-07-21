<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F5 reminders and deferred-work story family

**Status:** approved

**Date:** 2026-07-21

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F5 (`reminder-*` + `deferred-*`) after F1–F4. `plugin-core-separation`
rewires builtin tool registration and runtime composition; F5's scenarios observe what that
can break in **scheduling and proactive delivery**: recurring-task tool registration
(`src/tools/provider-independent-tools-builder.ts:62-71`), deferred-prompt tool registration
(`src/tools/deferred-tools-builder.ts:39-45`), the single-pass tick/poller entrypoints
(`src/scheduler.ts:110`, `src/deferred-prompts/poller.ts:99,230`), and the
`ChatProvider.sendMessage` proactive-delivery path
(`src/deferred-prompts/proactive-delivery.ts:29-38`, `src/scheduler-recurring.ts:79-106`).

The catalog audit (`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) classified
the 8 F5 records `needs-seam`: all eight share `capability-ids`, and the three fire
scenarios add `scheduler-due-seed`. This spec lands **8 executable scenarios** — a clean
family, with no scenario reclassified out (contrast F3/F4, which each moved one). It moves
the ledger from **87 to 95 executable** and puts behavioral tripwires on recurring-task
scheduling, deferred scheduled prompts, and condition-driven alerts.

The roadmap flagged a discovery task here — "F5 seed-due-rows could hit a production
wall-clock read that bypasses seeding." **Research resolved it favorably** (no clock seam
needed); see "Clock-seam resolution" below.

Research basis: recurring tools (`src/tools/create-recurring-task.ts` and siblings), storage
and tick (`src/recurring.ts:266-295`, `src/scheduler.ts:110-147`,
`src/scheduler-recurring.ts:79-128`, `src/recurring-utils.ts:45-48`), `recurring_tasks`
schema (`src/db/schema.ts:113-144`); deferred-prompt tools
(`src/deferred-prompts/tools.ts`), pollers (`src/deferred-prompts/poller.ts:99,230`),
scheduled storage (`src/deferred-prompts/scheduled.ts:206-237`), alerts
(`src/deferred-prompts/alerts.ts:184-204`), proactive LLM dispatch
(`src/deferred-prompts/proactive-llm.ts:284`,
`src/deferred-prompts/proactive-llm-helpers.ts:72,251-256`), deferred schema
(`src/db/deferred-schema.ts:9-63`); production background wiring
(`src/runtime/production-background.ts:74-101`, `src/scheduler.ts:149-174`,
`src/deferred-prompts/poller.ts:253-273`); capability registration
(`src/tools/core-capabilities.ts:10-75`); and harness mechanics (F3's `2026-07-20-f3-*`
spec, `tests/stories/harness/fixtures.ts`, `world.ts`, `scenario.ts`, `strict-http.ts`).

## Clock-seam resolution (the roadmap's discovery task)

For all three fire paths, "now" is an internal, non-injectable `new Date()` / `Date.now()`
read at query time, compared against a stored due-column with a simple `<=` (`lte`):

- **Recurring:** `getDueRecurringTasks()` reads `const now = new Date().toISOString()` and
  selects `lte(recurringTasks.nextRun, now)` gated by `enabled = '1'` (`src/recurring.ts:268,273`).
  `tick()` takes no clock parameter.
- **Scheduled prompts:** `getScheduledPromptsDue()` reads `new Date().toISOString()` and
  selects `lte(scheduledPrompts.fireAt, now)` gated by `status = 'active'`
  (`src/deferred-prompts/scheduled.ts:210,215`). `pollScheduledOnce()` takes no clock parameter.
- **Alerts:** condition + cooldown driven, **no `fireAt`**. `getEligibleAlertPrompts()`
  checks `Date.now() - triggeredMs >= cooldownMs` (`src/deferred-prompts/alerts.ts:187,195`);
  a fresh alert with `lastTriggeredAt: null` is always eligible. The `overdue` condition op
  evaluates `new Date(fieldValue) < now` against a per-call `new Date()` captured inside
  `pollAlertsOnce` (`src/deferred-prompts/condition-eval.ts:47`, `poller.ts:235`).

No path re-normalizes or re-schedules a row **before** the due comparison, so a row seeded
safely in the past is picked up by the next single-pass call regardless of the exact wall
clock. Firing advances rather than loops (`markExecuted` /`finalizeRecurring` use the firing
time as the anchor). **Conclusion:** seeding past-due rows + calling the exported single-pass
functions works with **zero clock-seam production change**; the phase-5 virtual-time fallback
is not needed. The only wall-clock caveat is the alert `overdue` evaluation — mitigated by
seeding the matched task's due-date well in the past (Deliberate exclusions).

## Production seams (two — each lands first and is reviewed independently, rule 2)

F5 has two production changes. Per rule 2 each lands as its own commit and is reviewed alone
before any harness seam or story consumes it.

### 1. `capability-ids` — capability registration for scheduling tools

None of the recurring or deferred-prompt tools carry a capability id today —
`CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts:10-69`) covers only `tasks.*`,
`meta.expand-result`, and the F1–F3 additions. The scripted model addresses tools with the
existing `callCapability(id, input)` decision, so F5 adds 12 entries, exactly as F1/F2/F3 do:

| Capability id      | Wire name                |
| ------------------ | ------------------------ |
| `recurring.create` | `create_recurring_task`  |
| `recurring.list`   | `list_recurring_tasks`   |
| `recurring.update` | `update_recurring_task`  |
| `recurring.pause`  | `pause_recurring_task`   |
| `recurring.resume` | `resume_recurring_task`  |
| `recurring.skip`   | `skip_recurring_task`    |
| `recurring.delete` | `delete_recurring_task`  |
| `deferred.create`  | `create_deferred_prompt` |
| `deferred.list`    | `list_deferred_prompts`  |
| `deferred.get`     | `get_deferred_prompt`    |
| `deferred.update`  | `update_deferred_prompt` |
| `deferred.cancel`  | `cancel_deferred_prompt` |

Registration is unchanged: `registerOfferedCoreToolCapabilities`
(`src/tools/core-capabilities.ts:71-75`) iterates the map and registers each wire name **only
when present in the offered set**, so conditional gating is honored for free — recurring tools
offer when the chat user id (`storageOwnerId`) is defined
(`provider-independent-tools-builder.ts:62-63`); deferred-prompt tools offer only in
`mode === 'normal'`. This is the roadmap's `capability-ids` seam.

### 2. `scheduler-chat-di` — inject the recurring notification chat provider (new seam)

`tick()` fires due recurring tasks by creating them through the injectable
`SchedulerDeps.resolve` (`src/scheduler.ts:23-29`) — so the created task is already
observable — but delivers its "Recurring task created" notification through a **module-level
`chatProviderRef` set only by `startScheduler`** (`src/scheduler.ts:172`,
`src/scheduler-recurring.ts:128` → `notifyUser(chatProviderRef, …)`). Driving `tick()`
directly (the only timer-free option; the harness disables background schedulers,
`world.test.ts:183`) leaves that ref `null`, so the notification is silently skipped.

The seam adds an optional `chat` to `SchedulerDeps` (`{ resolve, chat? }`) and prefers it in
the notification path, so `tick({ resolve, chat })` delivers to an injected provider. This
makes recurring symmetric with the deferred pollers, which already take `chat` as a parameter
(`pollScheduledOnce(chat, …)`). It introduces **no module state and no cross-scenario leak**
(deliberately unlike F4's notify-token module cache, which needed a dual reset). Production
`startScheduler` is unaffected (it may pass `chat` through deps or keep setting the module ref
for backward compatibility — a plan-discovery pick that does not change behavior).

This is a **new named seam**: it is added to `STORY_SEAM_IDS` and recorded in "New seam"
below, per rule 2's requirement that a new seam be named in the family spec.

## Harness seam: `scheduler-due-seed` (realizes the reserved seam id)

`scheduler-due-seed` is already reserved in `STORY_SEAM_IDS` but never realized — F5 is the
first family to use it. All additions are harness-only under `tests/stories/harness/`, each
with its own contract test, and land before any story consumes them (rule 2).

**Seeding fixtures:**

- `given.dueRecurringTask(...)` — seed a `recurring_tasks` row with `nextRun` in the past and
  `enabled = '1'` (the exact shape `getDueRecurringTasks` selects), keyed to the world's
  scoped context id.
- `given.dueScheduledPrompt(...)` — seed a `scheduled_prompts` row with `fireAt` in the past
  and `status = 'active'`.
- `given.alertPrompt(...)` — seed an `alert_prompts` row with `lastTriggeredAt: null`
  (always eligible) and a condition (e.g. `overdue`) that a seeded task satisfies.

**Single-pass drive primitives** (call the already-exported production functions with
world-provided dependencies — no timers):

- `when.recurringTick()` → `tick({ resolve: () => worldProvider, chat: worldChat })`.
- `when.scheduledPoll()` → `pollScheduledOnce(worldChat, buildProviderFn)`.
- `when.alertPoll()` → `pollAlertsOnce(worldChat, buildProviderFn)`.

`buildProviderFn` returns the world's task provider for a context (F2 built out the
`MemoryTaskProvider` surface); alerts use it to fetch and condition-match tasks.

**Create-vs-fire split (deliberate).** `create_deferred_prompt` validates future fire dates,
so the _create_ scenarios drive the tool with valid future times and verify listing; the
_fire_ scenarios **seed past-due rows directly** through the fixtures above, bypassing
validation. Recurring creation has no such validation, but the fire scenario still seeds
directly for determinism.

## Story files

Grouped under a new `tests/stories/scheduling/`. Every scenario qualifies through observable
behavior — a real tool result, a durable change observed on a following turn, or a captured
proactive delivery (rule 3 — never a scripted reply string alone; F3's observation model).

### `tests/stories/scheduling/recurring.story.test.ts` (3)

| Scenario                        | Shape                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-reminder-recurring-create` | `callCapability('recurring.create', …)`; a follow-up `list_recurring_tasks` turn surfaces the created recurrence (token fingerprint on the real tool result, not scripted reply text)                                 |
| `SCN-reminder-recurring-manage` | Seed a recurrence → `pause`/`skip`/`update` → a follow-up `list_recurring_tasks` turn reflects the changed state (token appears/disappears or status field)                                                           |
| `SCN-reminder-recurring-fire`   | `given.dueRecurringTask` → `when.recurringTick()` → a real task is created in the world provider (`then.task().exists()`) **and** the proactive notification is delivered (captured via the `scheduler-chat-di` seam) |

### `tests/stories/scheduling/deferred.story.test.ts` (5)

| Scenario                       | Shape                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SCN-deferred-schedule-create` | `callCapability('deferred.create', …)` (scheduled kind, future `fireAt`) → a follow-up `list_deferred_prompts` turn surfaces it                                                                                          |
| `SCN-deferred-alert-create`    | `callCapability('deferred.create', …)` (alert/condition kind) → a follow-up list turn surfaces it                                                                                                                        |
| `SCN-deferred-manage`          | Seed/create → `update`/`cancel` → a follow-up list turn reflects the change                                                                                                                                              |
| `SCN-deferred-fire-scheduled`  | `given.dueScheduledPrompt` → `when.scheduledPoll()` → a real `dispatchExecution` proactive turn → the proactive message is captured (`kind:'proactive'`); the prompt status advances (recurring) or completes (one-shot) |
| `SCN-deferred-fire-alert`      | `given.alertPrompt` + a seeded overdue task → `when.alertPoll()` → the matched-task alert is delivered proactively and `lastTriggeredAt` is updated                                                                      |

**Fire scenarios run a real proactive LLM turn.** `dispatchExecution`
(`src/deferred-prompts/proactive-llm.ts:284`) builds its own model from the seeded LLM config
(`llm_apikey`/`llm_baseurl`/`main_model`, already seeded by `given.seedSystemLlmConfig`) and
calls `generateText` — in story mode a real `POST https://llm.invalid/v1/chat/completions`
that the strict dispatcher intercepts via a **declared `world.http.expect` chat route**. This
is the exact F3 `history-lookup` / F4 transcript-viewer precedent (a production-internal model
call declared as an HTTP expectation, not scripted through `world.model`). The simplest
deterministic execution mode (`lightweight`) is used unless plan-discovery finds a scenario
needs `context`/`full`. Consequently the three fire scenarios are **story-mode-only** (the
fetch patch that intercepts the outbound call is active under `bun test:stories`, not under
`--contracts`) — the same footnote F3 recorded for `memory-capture-sweep` and F4 for
`transcript-viewer`.

## Reclassification (roadmap rule 6)

`SCN-deferred-fire-alert` was audited `needs:[capability-ids, scheduler-due-seed]` with the
rationale "Seed `fireAt` in the past and drive `pollAlertsOnce` against the memory task
provider." Research corrected the mechanism: **alert prompts have no `fireAt`**
(`src/db/deferred-schema.ts:38-63`) — they are condition + cooldown driven. The corrected
rationale: seed an `alert_prompts` row with `lastTriggeredAt: null` plus a task the condition
matches (e.g. an `overdue` task), then drive `pollAlertsOnce` against the memory task
provider. The scenario **stays executable** with the same two seams — this is a rationale fix
(rule 6), not a family move. The other two fire rationales are accurate and are carried
forward on the executable mappings.

## New seam

- **`scheduler-chat-di`** — added to `STORY_SEAM_IDS`. Injects the recurring notification chat
  provider through `SchedulerDeps` so `reminder-recurring-fire` can observe the proactive
  notification without the timer-driven `startScheduler`. Backs the executable
  `SCN-reminder-recurring-fire` story. (`scheduler-due-seed` was already reserved and is
  realized by F5; no other new seam ids.)

## Deliberate exclusions

- **No clock seam.** All fire paths seed past-due rows and drive single passes against the
  real wall clock; virtual-time injection stays deferred to tiering phase 5.
- **Alert `overdue` uses real wall-clock.** The `overdue` op compares against a per-call
  `new Date()` inside `pollAlertsOnce`; the story seeds the matched task's due-date well in the
  past so the comparison is deterministic without a fake timer.
- **Fire scenarios are story-mode-only** (proactive LLM HTTP interception; see Story files).
- **No hand-authored proactive prompt-injection.** The proactive generation routes through the
  production `dispatchExecution` path and its declared chat route, not a bespoke harness turn.
- **`startScheduler`/`startPollers`/`startProductionBackground` are bypassed** — the harness
  calls the exported single-pass functions directly; no timers are spun up.

## Ledger updates (same PR, roadmap rule 5)

Eight `AUDIT_RECORDS` entries move from pending to `EXECUTABLE_STORY_MAPPINGS` with
`verifiedAt: '2026-07-21'` (the corrected `SCN-deferred-fire-alert` rationale is recorded on
its executable mapping). `scheduler-chat-di` is added to `STORY_SEAM_IDS`. Contract-test
totals update to **128 ids / 95 executable / 33 pending**; the pending readiness split becomes
**1 executable-as-is / 10 needs-seam / 22 blocked** (needs-seam drops by 8). The runner
manifest totals line follows.

## Success criteria

- 8 new scenarios pass sandboxed (`bun test:stories`).
- Ledger: 95 executable / 33 pending; runner prints the updated totals line.
- Both production changes (the 12 capability-id entries; the `SchedulerDeps.chat` injection)
  land first, are reviewed independently, and are each covered by the stories that consume them.
- The `scheduler-due-seed` harness fixtures/primitives land before any story and carry their
  own contract tests.
- `bun test:stories:contracts` (including the new fixture/seam contract tests), typecheck,
  lint, and `format:check` stay green.
- `bun test:stories:stress` once before merge — no flakes.
- The compat baseline is re-recorded only for the intended frozen-harness byte changes; the
  existing scenario set is otherwise untouched.

## Risks

1. **Proactive LLM HTTP route** — the fire scenarios depend on the strict dispatcher
   intercepting `dispatchExecution`'s outbound `generateText` call; mitigated by declaring the
   `world.http.expect` chat route (F3/F4 precedent) and asserting the captured proactive
   delivery. Story-mode-only, as noted.
2. **Execution mode selection** — a plan-discovery step confirms the simplest deterministic
   mode (`lightweight`) for the fire scenarios; `context`/`full` modes pull in `buildProviderFn`
   tool-calling and are avoided unless a scenario specifically needs them.
3. **Alert condition matching against the memory provider** — `deferred-fire-alert` needs the
   seeded overdue task to be fetched and matched by `evaluateCondition`; a plan-discovery step
   confirms the F2 `MemoryTaskProvider` surface exposes what the alert fetch path reads.
4. **`scheduler-chat-di` shape** — the injection must not change production behavior when `chat`
   is absent (default remains the module ref / no-op); its contract test asserts an injected
   `chat` receives the recurring notification while the unset case stays silent.
5. **Create-tool future-date validation** — the create scenarios must use valid future times so
   the tool accepts them; the fire scenarios seed past-due rows directly, keeping the two paths
   independent.
