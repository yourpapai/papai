# Design — Instant notifications for issue activity

## Context

The alert engine already runs on a 5-minute cycle (`ALERT_POLL_MS`, `src/deferred-prompts/poller-lifecycle.ts`); the "2-hour polling" on the issue is the reminder-based watchlist workaround, not the alert path. Three concrete defects keep issue-activity notifications from working on GitHub (motivation in proposal.md — Why):

- **Stringified conditions are rejected before `execute`**: `alertConditionSchema` (`src/deferred-prompts/condition-schema.ts`) is a zod union of four object shapes. The AI SDK validates model tool-call args against the tool `inputSchema` before `execute`, and models commonly emit `condition` as a JSON *string* against `anyOf` positions → `AI_InvalidToolInputError`. The handler layer is already string-agnostic at runtime: `createAlert` (`src/deferred-prompts/tool-handlers.ts`) takes `condition: unknown` and `safeParse`s it, returning the structured `{ error: 'Invalid condition: …' }` guidance shape. Only the tool input schemas in `create-alert.ts` / `update-reminder.ts` reject the string.
- **GitHub comment activity is invisible**: `getTaskHistory` → `githubListTaskEvents` (`plugins/task-provider-github/operations/activities.ts`) fetches only `/repos/{repo}/issues/{n}/events`, which never contains `commented` events — the `case 'commented'` mapping is dead code. Comments already exist as a normalized `Comment` stream via `githubListTaskComments`.
- **Filter alerts replay the backlog**: `collectFieldFirings` (`src/deferred-prompts/poller-alerts-watch.ts`) fires on the match edge versus `alert.matchedTaskIds`, which starts `[]` — so the first evaluation fires for every pre-existing match. `AlertPrompt` already carries `matchedTaskIds` and `lastTriggeredAt` (persisted, no schema change needed); activity alerts baseline via cursor, pure watches via snapshots.

Close semantics are mostly sound (`foldStatus` keeps `closed` vs `closed (not_planned)` distinct; per-task watches see closed issues); that part is verification + docs only. Constraints: Zod v4 + AI SDK v7 (`ai@^7`), strict TS, no new tool surfaces, delivery path untouched.

## Goals / Non-Goals

**Goals:**

- Accept `condition` as a JSON-encoded string at the `create_alert`/`update_reminder` input boundary, with object shapes validating exactly as today and clear rejection of non-JSON / condition-invalid strings.
- Keep the tool `inputSchema` JSON-Schema-representable so AI SDK tool registration and the ask-gate's schema extension keep working.
- Make GitHub task history include comment activity entries through the existing filter/sort/slice pipeline.
- Baseline-on-create for filter alerts so new-issue alerts fire only on tasks that appear after the alert exists.
- Verification tests pinning close semantics (close visible via watch/activity; not-planned close never reported as completed).
- Docs: stringified-condition acceptance, baseline-on-create, and the 5-minute-poll + cooldown delivery contract.

**Non-Goals:**

- No webhooks or event push; no cadence change; no `sendProactiveMessage`/batching changes.
- No per-project comment watching (activity conditions stay per-task).
- No provider changes beyond the GitHub activity merge; no change to whole-list open-only fetch semantics.
- No watchlist migration or reminder cancellation logic in code (ops checklist in tasks.md).
- No condition-edit re-baselining (an alert edited after firing keeps its matched-set edge behavior; pre-existing behavior).

## Decisions

### D1. String acceptance: bare `z.string()` union branch + handler-level coercion (no transforms in the schema)

Widen the tool input schemas with one shared exported union — `alertConditionInputSchema = z.union([alertConditionSchema, z.string().describe('…JSON-encoded condition…')])` — and normalize strings once in the deferred-prompt handlers via a shared `parseConditionInput(condition: unknown)` helper in `condition-schema.ts` that both `createAlert` and `updateAlertFields` call where they currently inline `alertConditionSchema.safeParse`:

- object → `alertConditionSchema.safeParse` (byte-for-byte today's behavior);
- string → `JSON.parse` (SyntaxError → `Invalid condition: value is not valid JSON: <detail>`), then `alertConditionSchema.safeParse` on the parsed value (failure → the existing `Invalid condition: <zod message>`);
- other types → object-parse failure, as today.

Both call sites already return the structured `{ error }` tool result, so string-condition failures surface as guidance the model can read and retry within the turn — no exception path, no involvement of `repairToolCall` (which deliberately returns `null` for `InvalidToolInputError`).

**Why not transforms inside the schema** (`z.preprocess` / `z.string().transform(…)`, i.e. schema-level coercion): the AI SDK derives the wire schema with `z.toJSONSchema`, and JSON-Schema conversion of transform pipes is io-mode-fragile (a transform's output side is unrepresentable; `z.lazy` cycles already stress this path — see the existing `cyclicAlertSchema.toJSONSchema()` guards in `tests/llm-orchestrator-events.test.ts`). Thrown errors inside transforms also have uncertain zod-v4 issue semantics, which is exactly the "clear error" requirement. A bare string branch converts to `{ type: 'string' }` under every io mode.

**Why not widen the canonical `alertConditionSchema` itself**: it is also the storage/DB-load and update-validation schema (`alerts.ts` parses `alert_prompts.condition` and validates updates). Conditions must stay object-shaped in storage — `evaluateCondition` assumes objects (`'kind' in condition` throws on a primitive). One exported input-level union in the same file keeps a single fix point for both tools without widening every consumer.

**Why not prompt-only mitigation**: non-deterministic and already observed failing in prod.

Type note: `CreateInput.condition` / `UpdateInput.condition` widen to `AlertCondition | string`; after `parseConditionInput` normalization, everything downstream (mixed-tree check, activity gating, storage) sees the canonical `AlertCondition`.

### D2. JSON-Schema representability asserted, not assumed

A schema-level test (beside the existing condition-schema tests) asserts that converting the assembled tool input schema — e.g. `z.toJSONSchema` over `z.object({ condition: alertConditionInputSchema })` — does not throw and the `condition` property is an `anyOf` containing both object variants and a string variant. This guards the exact derivation the AI SDK performs at tool registration and that `extendSchemaForAsk` merges `_permission_reason` into (a top-level property merge — unaffected by widening one property's union).

### D3. Comment merge inside `githubListTaskEvents`, one pipeline

Merge in `plugins/task-provider-github/operations/activities.ts` (the function keeps its name; its contract is "issue activity history"): fetch comments via the existing `githubListTaskComments`, map each comment to the normalized `Activity` shape as `{ id: String(comment.id), timestamp: <created_at>, author: <user login>, category: 'comment' }`, and run both sources through the existing client-side filter (author/categories/start/end), ascending timestamp sort, optional reverse, and the limit/offset slice — **sliced once after the merge**, never per source (per-source slicing would corrupt cross-source ordering). The comments fetch is skipped when `params.categories` excludes `'comment'` (an alert filtering to `['status']` pays zero extra calls). The dead `case 'commented'` event mapping stays (harmless; `/events` never emits it) — existing event mappings are untouched per the spec. `provider.ts`'s `getTaskHistory` remains the seam; no other provider changes.

**Alternative rejected — merging in `provider.ts.getTaskHistory` by composing the two operations**: would duplicate the filter/sort/slice pipeline at the call site and split one behavior across two files.

**Failure semantics — fail closed**: a comments-fetch failure fails the whole lookup (classified error, as today for events). Returning events-only data would let the activity cursor advance past undelivered comments, silently dropping them; the poller's existing degradation (skip alert for the cycle, cursor unchanged, warning logged) is the correct recovery.

### D4. Baseline-on-create guarded by "empty matched set AND never fired"

In the filter branch of `collectFieldFirings` (non-pure-watch, non-activity alerts): when `alert.matchedTaskIds` is empty **and** `alert.lastTriggeredAt === null`, record `matchedNow` via the existing `updateAlertMatchedTaskIds` and fire nothing; otherwise keep the existing match-edge semantics unchanged. The double guard prevents re-baselining an alert that legitimately drifted to an empty matched set after firing, and keeps fired alerts on edge semantics. Zero-match first cycles behave identically to today (record `[]`, no firing). Pure-watch and activity paths are separate branches in the same function and are not touched. No persistence changes: `matchedTaskIds`/`lastTriggeredAt` already exist on `alert_prompts`.

**Alternative rejected — a stored `baselined` flag / new column**: redundant with the existing state; the two-field guard is exactly the creation state and needs no migration.

### D5. Verification-only close tests + docs

No code change for close semantics: add tests asserting (a) a per-task watch observes a GitHub close via targeted fetch, (b) close events map to `status` activity for activity alerts, (c) `closed (not_planned)` is never reported as completed (folded-status distinctness at fire time), and (d) a `task.status changed_to "closed"` filter alert on the whole-list path does not fire for GitHub closes (GitHub lists open tasks there — documented limitation; close coverage comes from watches/activity). Docs updates in `docs/architecture/tools.md` and `docs/architecture/behaviors.md` cover the stringified-condition acceptance, baseline-on-create, and the delivery contract (5-minute poll cycle, `cooldown_minutes` burst collapse, fire-time LLM composes the digest with `get_task`/`get_comments`).

### Gating / tool-prefs and scope-model impact

- **No new tool surface**: the two existing tools keep their names, descriptions, and parameters; only `condition`'s schema widens. Capability gating (activity conditions still require `activities.read` + a configured, non-null task instance), `tool_prefs` resolution (`allow`/`ask`/`deny`), the ask confirmation wrapper (its schema extension is a top-level `_permission_reason` merge), and the guest read-only filter (both tools are write-risk, still excluded for guests) are all unaffected by construction — asserted by the existing gating tests plus new string-form gating cases.
- **Scope model — no new persisted state**: conditions are stored as canonical JSON objects in the existing `alert_prompts.condition` column (keyed by alert id + `createdByUserId`, resolved to the config-context's `taskInstanceId` at creation, pinned on the row). The string form exists only in transit and normalizes before storage. No platform-instance-scoped or user-scoped new state.
- **No DB changes**: no drizzle migration, no backfill — existing rows already hold object-shaped conditions and existing `matchedTaskIds`/`lastTriggeredAt` values; the baseline guard treats every existing alert that has ever fired (or has a recorded set) as already past baseline, which is exactly today's behavior for them.
- **No new dependencies and no new modules**: zod v4 unions + `JSON.parse` cover coercion; all edits land in existing modules (`src/deferred-prompts/`, `src/tools/`, `plugins/task-provider-github/operations/`).
- **Hook/TDD interactions**: the Write/Edit TDD hook pipeline gates the touched product files under `src/` (`condition-schema.ts`, `tool-handlers.ts`, `create-alert.ts`, `update-reminder.ts`, `poller-alerts-watch.ts`) and `plugins/` (`operations/activities.ts`); work item 2 adds one new test file, `tests/plugins/task-provider-github/activities.test.ts`. Test-first order per work item: failing tool-invocation/schema test → schema fix → green; the per-file mutation ratchet applies at merge on the changed product files (existing suites provide the kills).

## Risks / Trade-offs

- [Model sends a malformed condition string] → `Invalid condition: …` tool-result guidance names the problem (non-JSON vs schema-invalid); the model retries within the turn. Object-shape violations keep the existing `AI_InvalidToolInputError` path unchanged.
- [Widened union breaks AI-SDK schema derivation or ask-wrapper extension] → D2 test asserts conversion succeeds and describes both forms; the ask wrapper merges at the top level, orthogonal to the property's union.
- [Comments fetch doubles per-poll provider calls for comment-watching alerts] → fetch skipped when categories exclude `'comment'`; `githubPaginate` bounds pages; cooldown collapse limits delivery frequency; accepted cost — it is the only way comments can fire alerts before webhooks (explicit non-goal).
- [Comments-fetch failure mid-poll] → fail closed (D3): whole lookup fails, cursor unchanged, alert skipped with a warning — never advance past undelivered comments.
- [Baseline suppresses a real first-cycle match] → intentional and one cycle wide (≤5 min); a task newly matching later still fires; regression tests pin "first cycle baselines", "new task fires", "fired alert not re-baselined".
- [Baseline accidentally applied to watch/activity alerts] → guard sits in the filter branch only; dedicated regression tests for pure-watch snapshot baseline and activity-cursor baseline.
- [String-acceptance weakens input validation] → revalidation runs the parsed value through the *same* union with the same superRefine rules; rejection reasons are identical to objects (spec requirement), covered by schema-level tests.

## Migration Plan

Four small MRs, TDD each (failing test → fix → green), order-independent but recommended as listed:

1. String-condition acceptance (`condition-schema.ts`, `tool-handlers.ts`, `create-alert.ts`, `update-reminder.ts`) — unblocks alert creation; gate: `bun run test tests/deferred-prompts tests/tools`.
2. GitHub comment activities (`plugins/task-provider-github/operations/activities.ts`, new `tests/plugins/task-provider-github/activities.test.ts`) — gate: `bun run test tests/plugins/task-provider-github`.
3. Baseline-on-create + close-verification tests (`poller-alerts-watch.ts`, `tests/deferred-prompts/poller-alerts*.test.ts`).
4. Docs (`docs/architecture/tools.md`, `docs/architecture/behaviors.md`).

Then `bun run test:affected`, one full `bun run test` + `bun check:full` before finishing. Deploy is a plain rollout — no migrations, no backfill, no feature flags; each MR reverts cleanly with `git revert` (all persisted data stays canonical/object-shaped, so rollback needs no data scrub). Post-deploy ops checklist (no code, tracked in tasks.md): create the per-issue comment alerts (#417/#401/#397/#400) and the `task.project eq yourpapai/papai` new-issues alert, verify one real comment delivers within a poll cycle, then cancel the polling reminder.

## Open Questions

None. The one earlier unknown — whether `/events` could double-count comments once comments are merged — is resolved by evidence (the endpoint never emits `commented`; the mapping is dead code) and the merge keys entries by distinct source ids.
