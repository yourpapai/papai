<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-ups · FU5a: Hard Cost Cap + Transparency (design)

> **Context.** Fifth sub-project of the post-migration follow-ups program, and the first of the three
> **un-dropped features** (genuinely new capability, not hardening). Restores kiss's task cost cap: a USD
> budget that actually **stops** a coding run when exceeded, with spend made visible in chat.
>
> **Repos touched.** `magi` (small — expose per-turn usage) + `nerv` (core — accumulate, enforce, surface).
> **papai: no code** — its client surface (`create_coding_task` accepts `costBudgetUsd`; status/list surface
> `usageUsd`) is already built and tested; it only ever receives `0` today.
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-13) in the kiss/magi/nerv/papai repos.

## Premise (what the investigation established)

FU5a is **not greenfield** — it is _plumbing without water_. The cost-cap scaffold exists end-to-end; only the
data is missing:

- **nerv** has `Project.costBudgetUsd` (`db/models/Project.ts:46`), `Task.costBudgetUsd`/`Task.usageUsd`
  (`db/models/Task.ts:56-57`, `usageUsd` default `0`), and a full pricing library `domain/cost.ts`
  (`TokenPricing`/`getPricingForModel`/`calculateCost`/`formatCostMessage`, ported from kiss, unit-tested) — with
  **zero production callers**. `usageUsd` is **never written anywhere**.
- **papai's client surface is fully built and tested**: `create_coding_task` input accepts `costBudgetUsd`
  (`plugins/nerv/schemas.ts:19`), `coding_task_status`/`list_coding_tasks` surface `usageUsd`
  (`plugins/nerv/tools.ts:198-273`), the LLM composes the reply. It receives `0` forever.
- **The single blocker is magi visibility.** ACP reports end-of-turn token `usage` (`PromptResponse.usage`), and
  magi reads it — but only **logs** it (`magi/src/acp/client.ts:112-121`, `resume.ts:76-79`); `runRecordedTurn`
  (`helpers.ts:222-251`) drops it (returns only `{stopReason, answer}`). nerv even documents the gap in code:
  _"magi's Session does not currently expose token usage or cost, so `task.usageUsd` is left untouched here;
  wiring it up is blocked on magi exposing that data (follow-up once available)"_ (`foundationHandlers.ts:31-33`)
  — almost certainly the origin of FU5a.
- **The push path already exists.** magi's `HttpNotifier`/`buildNotifier()` (`magi/src/main.ts:74-80`,
  `notify/notifier.ts:37-65`) already POSTs `{contextId, markdown}` with bearer auth (`MAGI_NOTIFY_TOKEN`) to
  `MAGI_NOTIFY_URL` — nerv's `POST /notify` — on **every turn-completion milestone** (`answer`/`done`/`failed`
  via `SessionManager.emit`, `manager.ts:67-71`). nerv's `/notify` (`http/routes/notify.ts:6-46`) is already
  bearer-gated (`NERV_AUTH_TOKEN`) and already correlates the caller-supplied `contextId` back to a Task
  (`Task.findOne({'contextRef.contextId': ...})`, `notify.ts:36`). So the "push" is a **payload extension**, not
  new transport/auth/route.
- **kiss's cap was turn-granularity** (`kiss/src/agents/GitLabAgent.ts:203-218,1205,1230`): it checked the cap
  before dispatching the next prompt and again right after accumulating a turn's usage — never mid-stream. One
  turn could overshoot. FU5a matches this.

## Decisions of record

1. **Turn-granularity enforcement.** nerv gates the _next_ dispatch once `usageUsd >= costBudgetUsd`; a single
   in-flight turn may overshoot before the check catches it (kiss's accepted limitation). No mid-turn kill.
2. **Push via the existing notifier.** Extend the milestone/`/notify` payload with token `usage`; reuse magi's
   `HttpNotifier` → nerv `/notify`. No new endpoint, auth, or push direction.
3. **magi sends tokens; nerv prices.** ACP `Usage` is token counts. magi stays model-agnostic; nerv prices via
   its existing `domain/cost.ts` using the task's configured `model`. USD end to end.
4. **Breach → `failed` + reap + notify.** On the gate tripping, nerv transitions the task to `failed`, reaps the
   (idle, post-turn) magi session to free the container, and posts a dedicated cost-cap chat message. (Reuses the
   P0 reap-and-close machinery.)
5. **Graceful degradation.** If a backend never emits usage, `usageUsd` stays `0` and the cap is inert; nerv logs
   a `warn` when a _budgeted_ task reaches a terminal state with `usageUsd == 0`, so a silently-non-functioning
   cap is visible rather than false comfort. A planning spike confirms a real backend populates ACP `usage`.
6. **papai unchanged.** Client surface already built; it just needs a non-zero `usageUsd`, which nerv now writes.

## Feasibility risk (call out explicitly)

ACP's `Usage`/`PromptResponse.usage` is marked `@experimental` in the SDK, and there is **no in-repo evidence**
which coding-agent backends (claude/codex/opencode) actually populate it. The entire feature is inert if the
chosen backend reports nothing. Mitigations: (decision 5) fail-open + a loud warn so it is never silently broken;
(planning) an empirical spike against a real agent binary **before** building the nerv enforcement, so we know the
signal is real. This risk does not change the design — only validates its foundation.

---

## Component A — magi: report per-turn usage (magi)

Thread `response.usage` from `runRecordedTurn` (`magi/src/session/helpers.ts:222-251`, currently returns only
`{stopReason, answer}`) up through `runSessionTurn` (`lifecycle.ts:257-282`) to the milestone `emit` path
(`manager.ts:67-71`). Extend:

- `Milestone` (`notify/notifier.ts:20-24`): add optional `usage?: TokenUsage` (the ACP token counts —
  `inputTokens`/`outputTokens`/`totalTokens` and cached-token fields as available).
- `HttpNotifier.notify` (`notifier.ts:37-65`): include `usage` in the POST body when present.
- The per-turn `emit('answer'|'done'|'failed', ...)` calls (`auto-finish.ts`, `finish.ts`) carry the turn's
  `usage`.

magi does **not** price or cap — it only reports tokens. Non-throwing, exactly as the notifier is today (transport
errors logged, never thrown). Milestones that have no usage (`needs_permission`/`waiting_input`/`cancelled`) simply
omit the field.

## Component B — nerv: accumulate priced usage (nerv)

`POST /notify` (`nerv/src/http/routes/notify.ts`):

- Extend the zod body schema (`notify.ts:6-9`) with an optional `usage` (token counts).
- On receipt: resolve the Task by `contextId` (existing `Task.findOne({'contextRef.contextId': ...})`), price the
  usage via `domain/cost.ts` `calculateCost(usage, task.model)`, and **atomically accumulate** into `task.usageUsd`
  via `$inc` (`Task.updateOne({_id}, {$inc: {usageUsd: deltaUsd}})`) — per FU3's atomic-ledger lesson, never a
  whole-document save.
- Preserve the existing behavior (parse `[kind]` markdown → enqueue `reconcile`); usage accumulation is additive.

## Component C — nerv: enforcement gate (nerv)

A shared helper `isOverBudget(task)` = `task.costBudgetUsd != null && task.usageUsd >= task.costBudgetUsd`,
evaluated **before every turn-dispatching call**:

- `makeReviewCommentHandler` / `makePipelineFailureHandler` / `makeChatInstructionHandler` /
  `makeSelfReviewHandler` — before `magi.followUp`.
- `makeReconcileHandler`'s resume path — before `magi.resumeSession`.

On breach: **skip the dispatch**, transition the task → `failed`, **reap the magi session** (existing
cancel/reap-and-close machinery, freeing the container), and enqueue a dedicated cost-cap notification
(`⚠️ Cost cap reached: $<usageUsd> / $<costBudgetUsd> — the coding run was stopped.`). Idempotent: a task already
`failed` is not re-processed (mirrors the resume-attempt-exhausted path in `foundationHandlers.ts:70-96`).

The initial `startTask` turn is never gated (`usageUsd` starts `0`); only subsequent turns are — matching kiss.

## Component D — nerv: transparency + config coherence (nerv)

- **In-progress spend line.** Extend `PapaiTaskNotifier` (`services/PapaiTaskNotifier.ts`) so the
  `formatCostMessage`-based headline (today gated to `COST_STATUSES = {completed, closed}` and `usageUsd > 0`,
  `:19,80`) also appends a `Spend: $X / $Y cap` line on in-progress statuses (`coding`/`review`) when a budget is
  set — the same `parts.join('\n\n')` splice point (`:78-85`).
- **Project→task budget fallback.** `TaskService.create()` (`services/TaskService.ts:44-60`) currently does
  `input.costBudgetUsd ?? null`, ignoring the project default despite the documented "fall back to defaults"
  (`docs/DEPLOYMENT.md:143`). Implement `input.costBudgetUsd ?? project.costBudgetUsd ?? null` (the Project is
  already resolvable — FU2 added the `ProjectService` dependency to `TaskService` for the pipeline-list seeding).

---

## Cross-repo contract summary

| #   | Interface               | Producer → Consumer | Change                                                                       |
| --- | ----------------------- | ------------------- | ---------------------------------------------------------------------------- |
| 1   | milestone `usage`       | magi → nerv         | extend `Milestone`/`HttpNotifier`/`/notify` body with optional token `usage` |
| 2   | `usageUsd`              | nerv (internal)     | price tokens via `domain/cost.ts` + atomic `$inc` on the Task                |
| 3   | budget gate             | nerv (internal)     | `isOverBudget` before every dispatch → `failed` + reap + notify              |
| 4   | transparency + fallback | nerv (internal)     | in-progress `Spend: $X / $Y` line; project→task `costBudgetUsd` fallback     |

The only cross-repo wire change is #1 (an additive optional field on an existing authenticated push). Everything
else is nerv-internal; papai consumes the now-non-zero `usageUsd` through its existing client surface.

## Testing strategy

The end-to-end cost cap has **zero** coverage in any repo today. FU5a adds:

- **magi:** a completed turn's `usage` threads into the milestone/`HttpNotifier` payload; a turn with no usage
  omits the field (payload still valid); the notifier still never throws on transport error.
- **nerv `/notify`:** a usage push prices via `domain/cost.ts` and atomically `$inc`s `task.usageUsd` on the right
  task; a push with no usage is a no-op for accumulation; malformed usage is rejected by the schema (bearer auth
  still enforced).
- **nerv gate:** at/over budget → the next `followUp`/`resumeSession` is NOT dispatched, task → `failed`, session
  reaped, cost-cap notification enqueued; under budget → dispatch proceeds; an already-`failed` task is not
  re-processed.
- **nerv transparency/fallback:** in-progress `Spend: $X / $Y` line renders for a budgeted task; `TaskService.create`
  falls back to the project budget; a budgeted task ending at `usageUsd == 0` emits the graceful-degradation warn.

## Out of scope / deferred

- **True mid-turn kill** via the experimental `usage_update` streaming signal (turn-granularity chosen; a later FU
  once a backend is verified to emit it).
- **Any papai code** — client surface already built and tested.
- **A per-model pricing overhaul** — reuse `domain/cost.ts` as-is (it inherits kiss's coarse flash/pro split;
  refining pricing for newer models is a separate concern).
- **magi-side pricing/enforcement** — magi only reports tokens; all pricing and capping is nerv's.

## Open assumptions (resolve during planning)

- **Is ACP `PromptResponse.usage` per-turn or session-cumulative?** This decides nerv's accumulation: `$inc` the
  raw value (per-turn) vs. track a per-`magiSessionId` last-seen and `$inc` only the positive delta (cumulative).
  The plan MUST verify (read the ACP SDK semantics / an empirical turn) and implement the correct one — getting
  this wrong double-counts or under-counts spend. If cumulative, note that magi mints a new child session per
  follow-up/resume, so each child's usage restarts at 0 and nerv sums across the lineage.
- **Empirical backend spike (blocking-ish):** confirm at least one real agent backend populates ACP `usage`
  before building nerv enforcement; if none do, FU5a ships the plumbing + the graceful-degradation warn and the
  cap stays inert until a backend emits usage — decide with the user if that materializes.
- **Model source for pricing** — default to `task.model`; confirm no path leaves it unset/mismatched vs. the model
  magi actually ran (if magi can fall back to a different model, consider including the model in the push).
- The exact reap mechanism to call on breach (the existing `cancelTask`/`SupervisorService` reap-and-close path)
  and that it is safe to call on a task whose session is idle/`waiting_input` post-turn.
