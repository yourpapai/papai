# Tasks — Instant notifications for issue activity

Design open questions: none (design.md resolves the only earlier unknown). Work follows the four MRs in design.md — Migration Plan, TDD each (failing test → fix → green).

## 1. Stringified alert-condition acceptance (MR 1)

- [x] 1.1 Write failing schema-level tests beside the existing condition-schema tests: object shapes validate unchanged; JSON-string forms of `{"field":"task.status","op":"eq","value":"open"}` and `{"kind":"activity","taskId":"417"}` coerce to the canonical object; non-JSON string and condition-invalid string (unknown operator; activity leaf without taskId) are rejected with clear `Invalid condition: …` errors; `z.toJSONSchema` over the assembled tool input union does not throw and its `condition` anyOf contains object variants plus a string variant (design D2). Verify: `bun run test tests/deferred-prompts` (red)
- [x] 1.2 Implement `alertConditionInputSchema` (object union ∪ `z.string()`, no transforms) and the `parseConditionInput` coercion helper in `src/deferred-prompts/condition-schema.ts`. Verify: `bun run test tests/deferred-prompts` (green)
- [x] 1.3 Write failing tool-bridge tests through `getToolExecutor()` on `makeCreateAlertTool` (`tests/tools/create-alert.test.ts`) and `makeUpdateReminderTool` (`tests/deferred-prompts/tools.test.ts`): condition passed as a JSON string for both repro shapes (activity leg with the capability flag and a configured task instance) creates/updates the alert with the canonical object condition stored; invalid strings return the structured invalid-condition error and store nothing. Verify: `bun run test tests/tools/create-alert.test.ts tests/deferred-prompts/tools.test.ts` (red)
- [x] 1.4 Wire `alertConditionInputSchema` into `makeCreateAlertTool` and `makeUpdateReminderTool` input schemas; route `createAlert` and `updateAlertFields` in `src/deferred-prompts/tool-handlers.ts` through `parseConditionInput`; widen `CreateInput`/`UpdateInput` `condition` to `AlertCondition | string`. Verify: `bun run test tests/tools/create-alert.test.ts tests/deferred-prompts/tools.test.ts` (green)
- [x] 1.5 Add string-form gating cases: stringified activity condition refused without `activities.read` and with a null task instance; `ask`/`deny` tool_prefs resolution unchanged for string conditions (confirmation requested, permission-denied result, deny removes the tool); guest read-only toolset unchanged. Verify: `bun run test tests/deferred-prompts tests/tools`
- [x] 1.6 MR gate: `bun run test tests/deferred-prompts tests/tools` then `bun run test:affected`.

## 2. GitHub comment activity in task history (MR 2)

- [x] 2.1 Create failing `tests/plugins/task-provider-github/activities.test.ts` (setMockFetch pattern): a comment surfaces as `{category:'comment', id, timestamp, author}`; categories excluding `'comment'` skip the comments fetch and emit no comment entries; events + comments merge into one ascending-timestamp sequence; existing event→category mappings unchanged; a comments-fetch failure fails the whole lookup with the classified error. Verify: `bun run test tests/plugins/task-provider-github` (red)
- [x] 2.2 Implement the merge in `plugins/task-provider-github/operations/activities.ts`: reuse `githubListTaskComments`, map comments to comment activity entries, skip the fetch when categories exclude `'comment'`, run both sources through one shared post-merge filter/sort/slice (slice once, after the merge). Verify: `bun run test tests/plugins/task-provider-github` (green)
- [x] 2.3 MR gate: `bun run test tests/plugins/task-provider-github` then `bun run test:affected`.

## 3. Baseline-on-create for filter alerts + close verification (MR 3)

- [x] 3.1 Write failing poller tests in `tests/deferred-prompts/poller-alerts*.test.ts`: a filter alert with empty `matchedTaskIds` and null `lastTriggeredAt` records its matched set on the first cycle and fires nothing despite a pre-existing backlog; a task newly matching a later cycle fires; pre-existing matches never fire; an alert that has fired is not re-baselined; pure-watch (snapshot baseline) and activity (cursor baseline) behavior unchanged. Verify: `bun run test tests/deferred-prompts` (red)
- [x] 3.2 Implement the guard in the filter branch of `collectFieldFirings` (`src/deferred-prompts/poller-alerts-watch.ts`): empty matched set AND never fired → record via `updateAlertMatchedTaskIds`, fire nothing; otherwise existing edge semantics. Verify: `bun run test tests/deferred-prompts` (green)
- [x] 3.3 Add verification-only close tests: a per-task watch observes a GitHub close via targeted fetch; a close surfaces as `status` activity for activity alerts; `closed (not_planned)` is never reported as completed (folded-status distinctness at fire time); a `task.status changed_to "closed"` filter alert on the whole-list path does not fire for GitHub closes (open-only listing). Verify: `bun run test tests/deferred-prompts tests/plugins/task-provider-github`
- [x] 3.4 MR gate: `bun run test tests/deferred-prompts tests/plugins/task-provider-github` then `bun run test:affected`.

## 4. Documentation (MR 4)

- [x] 4.1 Update `docs/architecture/tools.md`: `create_alert`/`update_reminder` accept `condition` as a JSON-encoded string or object with identical validation and rejection reasons; capability gating, tool_prefs (`allow`/`ask`/`deny`), and the guest toolset unchanged. Verify: review diff against specs; `bun run lint`
- [x] 4.2 Update `docs/architecture/behaviors.md`: filter alerts baseline on their first evaluation cycle (no backlog replay); alert delivery is the 5-minute poll cycle with `cooldown_minutes` burst collapse (one merged message per firing cycle; fire-time LLM composes the digest with `get_task`/`get_comments`); GitHub close coverage comes from per-task watches/activity (whole-list path lists open tasks only). Verify: review diff against specs; `bun run lint`

## 5. Post-deploy ops checklist (no code; after rollout)

- [x] 5.1 Create per-issue comment alerts for #417/#401/#397/#400 and a `task.project eq yourpapai/papai` new-issues alert in the target chat; cancel each per-issue alert when its issue closes (per-issue watches also report closes). Verify: alerts listed via `list_reminders`
- [x] 5.2 Verify one real comment on a watched issue delivers within one poll cycle (≤5 minutes, no reminder workaround), then cancel the polling reminder. Verify: live delivery observed and reminder cancelled via `cancel_reminder`

## 6. Full verification

- [x] 6.1 Run the full suite and checks — `bun run test`, `bun run typecheck`, `bun run lint` (or `bun run check:full`) — and confirm the `docs/architecture/tools.md`/`behaviors.md` updates from 4.x are in place; fix anything red and re-run to green.
