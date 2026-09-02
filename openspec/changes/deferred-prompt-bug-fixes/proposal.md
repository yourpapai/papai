# deferred-prompt-bug-fixes (issue #401, change 2 of #397)

## Goal

Fix five verified deferred-prompt bugs, one small MR per bug, TDD (red reproducing test → fix → green → live proof-check run). Prerequisite: `deferred-prompt-proof-checks` (change 1) — already implemented in-tree (`src/deferred-prompts/proof-checks.ts` + prompts/observe/store, tools `proof-check-run.ts`/`proof-checks-read.ts`, poller record line in `poller.ts:22-38`); its five checks are the in-prod verification harness. No refactors outside these bugs. All five bug claims below were re-verified against current code.

## Bugs (each = one MR)

### Bug 1 — execution without delivery
- **Where:** `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts:134-146`). `hadToolFailure` makes any result "risky", so non-empty good text is discarded and the verifier/neutral-fallback stub (`completion.doneFallback`) is delivered instead.
- **Behaviour change:** good text + `finishReason: 'stop'` + injected tool failure must deliver the text verbatim with the verifier not called. Additionally, when the stub *is* delivered, it must state what the bot attempted (include the failure context) instead of a bare neutral line.
- **Repro:** unit test on `finalizeAndLog` — good text + `finishReason: 'stop'` + injected tool failure must deliver the text verbatim, verifier not called.
- **Proof:** `bug1_delivery_matches_execution` (both variants) records pass from a live run.

### Bug 2 — stale time in proactive context
- **Where:** `buildProactiveTrigger` userLines (`src/deferred-prompts/proactive-trigger.ts:73`) carries no fresh `<current_time>` tag; per the system-prompt TIME rule (`en-system-prompt.ts:14`, "the most recent message's `<current_time>` is now"), replayed history's stale tags anchor the model's "now". Tag shape lives in `src/utils/current-time-format.ts`.
- **Behaviour change:** the proactive trigger user message begins with a fresh `<current_time>` line computed at real fire time in the user's timezone.
- **Repro:** trigger-contract test — fresh tag present in `userContent` and matching real fire time (inject clock/`Date`).
- **Proof:** `bug2_context_time` records pass from a live run.

### Bug 3 — fires on creation
- **Two candidate mechanisms (decide lane from bug-3 proof-check live observations before fixing):**
  - (a) **Stale-clock fire_at stored at creation:** `validateFutureFireAt` (`src/deferred-prompts/schedule-update-helpers.ts:21-27`) accepts still-future-but-too-soon times; `createScheduled` (`src/deferred-prompts/tool-handlers.ts:108-117`) stores it, and the first poll immediately fires. Fix lane: enforce a minimum future lead at creation (and mirror in `buildScheduleUpdates` for updates).
  - (b) **Alert-path first-poll firing for pre-matching tasks:** `collectFieldFirings` (`src/deferred-prompts/poller-alerts-watch.ts:65-76`) — a filter alert with empty `matchedTaskIds` fires on the first poll when tasks already match (pure watches are safe: `watchTaskChanged` treats a no-snapshot task as baseline sighting). **If the live evidence lands here, do NOT change semantics — surface the baseline-on-create decision to the maintainer instead** (record observations in the change folder and stop that sub-lane for maintainer input).
- **Repro:** red test for the chosen lane's mechanism.
- **Proof:** `bug3_fires_on_creation` (scheduled + alert variants) records pass from a live run.

### Bug 4 — create response missing execution.mode
- **Where:** `CreateResult` (`src/deferred-prompts/types.ts:211-214`), returned via `createScheduled` (`tool-handlers.ts:124-130`) and `createAlert` (`tool-handlers.ts:164`).
- **Behaviour change:** add `execution.mode` (`'scheduled' | 'on_event'`) to both created variants. Proven by inspection alone — no further forensics; red test asserts the field on both variants.
- **Proof:** `bug4_create_response_mode` records pass from a live run.

### Bug 5 — update wipes prompt text
- **Where:** `updateScheduledFields` (`src/deferred-prompts/tool-handlers.ts:226`): `if (input.prompt !== undefined) updates.prompt = input.prompt` copies `prompt: ""` through (zod `.optional()` accepts it). **Assumption:** the identical pattern in `updateAlertFields` (`tool-handlers.ts:251`) is the same bug served by the same `update_reminder` tool and gets the same guard — kept in-scope as one bug class, not a refactor.
- **Behaviour change:** `update_reminder` with `prompt: ""` + another field keeps the stored text (treat empty string as no-op or reject it explicitly — pick one and test it).
- **Repro first:** red test asserting stored prompt survives an empty-string update alongside another field.
- **Proof:** `bug5_update_preserves_prompt` records pass from a live run.

## Final MR — cleanup

Once all five checks have recorded pass in prod, remove the disposable proof-check infrastructure: `src/deferred-prompts/proof-checks.ts`, `proof-checks-prompts.ts`, `proof-checks-observe.ts`, `proof-store.ts`, tool registrations `src/tools/proof-check-run.ts` + `src/tools/proof-checks-read.ts` (wired in `src/tools/diagnostics.ts`, metadata in `src/tools/tool-metadata.ts`), and the poller record line (`src/deferred-prompts/poller.ts:22-38`, including its design-D9 comment).

## Files touched

`src/deferred-prompts/proactive-llm-helpers.ts`, `src/deferred-prompts/proactive-trigger.ts`, `src/deferred-prompts/schedule-update-helpers.ts` and/or `src/deferred-prompts/poller-alerts-watch.ts` (bug-3 lane), `src/deferred-prompts/tool-handlers.ts`, `src/deferred-prompts/types.ts`, plus i18n locale files for the enriched done-fallback stub; corresponding tests under `tests/`; cleanup MR removes the proof-check files listed above.

## Verification

1. Per bug: red reproducing test → minimal fix → green → full `bun run test` + `bun check:full` before MR.
2. Per MR: the matching proof check records **pass from a live admin run in prod** (`run_proof_check` / `read_proof_results`); MR is not done until the record exists.
3. Bug 3's lane decision must cite the bug-3 proof-check observations; mechanism-(b) evidence routes to a maintainer decision, not a semantic change.
4. Final cleanup MR: all five records pass, then infra removed with suite green.

## Non-goals

- No refactors beyond the five bugs and their immediate guards.
- No change to pure-watch baseline-on-create semantics (maintainer decision if evidence lands there).

## Capabilities

None — skip_specs proposed because all five items are fixes restoring intended behaviour of an existing, specified deferred-prompt surface (plus removal of disposable diagnostics); no downstream-visible contract deltas are intended.
