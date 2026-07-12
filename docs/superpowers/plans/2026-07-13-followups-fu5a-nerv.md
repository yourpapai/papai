<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU5a · nerv: Accumulate Priced Usage + Enforce Cost Cap + Transparency + Budget Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the `nerv` repo, turn the existing (currently-unwired) cost-cap scaffold into a working hard cap: price and atomically accumulate per-turn token usage pushed by magi's `/notify`, gate every turn-dispatching call on the accumulated spend, breach into a `failed` task + reaped magi session + chat notification, surface live spend in chat, and fall back to the project's default budget when a task doesn't set one.

**Architecture:** Component B prices an already-per-turn-delta `usage` object (magi's contract — see resolved assumptions below) on the existing `POST /notify` route and `$inc`s it onto `Task.usageUsd` atomically (no session-level delta tracking needed). Component C adds one pure predicate (`isOverBudget`) and one shared breach action (`applyCostCapBreach`) in a new `src/supervisor/costCap.ts`, called immediately before each of the 5 real dispatch call sites (`magi.followUp` × 4, `magi.resumeSession` × 1). Component D extends `PapaiTaskNotifier.notifyStatus` (the single choke point every terminal/in-progress chat notification already flows through) with a spend line and a graceful-degradation warn, and adds a one-line project-default fallback to `TaskService.create`.

**Tech Stack:** nerv is a separate Node/TypeScript repo (not the papai/Bun stack) — Fastify + Zod v3 + Mongoose + Vitest. Commands: `npx vitest run <path>` and `npm run type-check` (bare `tsc -p tsconfig.json --noEmit`), run from `/Users/ki/Projects/yourpapai/nerv`. Baseline: **378 tests, all green, working tree clean.**

---

## Resolved cross-file facts (read directly from nerv source 2026-07-13; do not re-derive)

1. **`domain/cost.ts` API** (`/Users/ki/Projects/yourpapai/nerv/src/domain/cost.ts`):
   - `interface TokenUsage { inputTokens: number; outputTokens: number; cachedInputTokens: number }` — `cachedInputTokens` is a **subset** of `inputTokens`, not additional.
   - `calculateCost(usage: TokenUsage, model?: string | null): number` — returns USD rounded to 4 decimals. This is the exact call Component B makes.
   - `getPricingForModel(model, overrides?)` recognizes **exactly one** literal string, `'deepseek-v4-flash'` → FLASH pricing; every other value (including `null`/`undefined`/unrecognized strings) → PRO pricing. This is kiss's coarse 2-bucket split — confirmed, not refined by this plan (spec explicitly defers that).
   - `formatCostMessage(cost, usage, model?)` — used only by `PapaiTaskNotifier`'s `costHeadline()` helper (Component D already has this, unchanged).

2. **`/notify` route** (`src/http/routes/notify.ts`): zod `notifyBody = z.object({ contextId: z.string().min(1), markdown: z.string().min(1) })` (lines 6-9). Handler does `Task.findOne({'contextRef.contextId': parsed.data.contextId})` (line 36), then unconditionally enqueues a `reconcile` work item. **No auth change needed** — the route is already behind the existing `NERV_AUTH_TOKEN` bearer gate applied at the Fastify instance level (confirmed via the existing "rejects unauthenticated POST /tasks"-style tests all sharing one `authToken` gate; `/notify` itself has no per-route auth check to touch).

   **Magi's `usage` wire shape (pinned by the parallel magi-side FU5a plan, not derived here):** a per-turn positive **delta**, all six fields always present (ACP-optional ones defaulted to `0` by magi):

   ```ts
   {
     ;(totalTokens, inputTokens, outputTokens, thoughtTokens, cachedReadTokens, cachedWriteTokens)
   } // all number
   ```

   This does **not** match `cost.ts`'s `TokenUsage` field-for-field, so Task 2 accepts magi's shape in the zod schema and **maps** it at the `calculateCost` call site: `inputTokens → inputTokens`, `outputTokens → outputTokens`, `cachedReadTokens → cachedInputTokens` (kiss's "cached input" = cache-read hits, the subset of `inputTokens` priced at the cheaper cache rate — the exact field `calculateCost`'s cache branch expects). `totalTokens` is dropped (derived — `calculateCost` sums the priced buckets itself, it doesn't take a total). `cachedWriteTokens` and `thoughtTokens` are accepted (schema-valid) but unpriced: kiss's coarse two-bucket PRO/FLASH pricing table has no cache-write rate or reasoning-token rate — both are lumped into/absorbed by the existing input/output rates rather than tracked separately. A future per-model pricing refinement (the spec's declared out-of-scope item) could price them; this task only wires the two buckets `calculateCost` understands today. **Verified via edit-then-revert** (temporarily reinstating Task 1's `resolvedModel` field alongside this mapping so both compile and run together): a delta of `{totalTokens: 2_000_000, inputTokens: 1_000_000, outputTokens: 1_000_000, thoughtTokens: 500, cachedReadTokens: 200_000, cachedWriteTokens: 300}` against a task with no `resolvedModel` (PRO fallback) produced `usageUsd ≈ 1.218725` (`800_000` regular input @ `$0.435/1M` + `200_000` cached input @ `$0.003625/1M` + `1_000_000` output @ `$0.87/1M`), confirming the mapping and drop rules are correct.

3. **Pricing model source — `task.model` does NOT exist.** The spec's assumption #3 that pricing should read `task.model` is **factually wrong** against real code: `ITask` (`db/models/Task.ts`) has no `model` field. The actual per-task model resolution formula lives transiently in `SupervisorService.startTask` (`const model = project?.model ?? project?.modelProvider?.id ?? defaults.model`, `SupervisorService.ts:64`) and is **only** forwarded to magi's `projectSpec.model` — never persisted. **Verified via edit-then-revert:** naming the new field `model` collides with Mongoose's built-in `Document.model()` method (`tsc` error `TS2322: Type 'string' is not assignable to type '{ <ModelType...>(name: string): ModelType }'`). Resolution (Task 1 below): add `Task.resolvedModel?: string`, snapshotted in `startTask` using the exact same 3-way fallback formula already used for `projectSpec.model` (guaranteeing it never drifts from what magi actually ran), mirroring the existing `task.mcpServers`/`task.modelProvider` snapshot pattern at `SupervisorService.ts:59-60`. `/notify`'s pricing call becomes `calculateCost(usage, task.resolvedModel)` — `calculateCost`/`getPricingForModel` already fall back to PRO pricing for `undefined`, so an unstarted-session task (no `resolvedModel` yet) prices safely.

4. **Per-turn vs. cumulative usage (spec's first open assumption).** Per the task brief's RESOLVED CROSS-REPO CONTRACT, magi's `/notify` `usage` is a **per-turn delta** (magi computes/tracks any session-lineage accounting on its own side, out of scope here). nerv's accumulation is therefore an **unconditional, atomic `$inc`** — no per-`magiSessionId` last-seen tracking, no cumulative-vs-delta branching. This resolves the spec's stated ambiguity in nerv's favor of the simpler design.

5. **Enforcement gate — exactly 5 dispatch call sites** (verified by reading each file):
   - `src/supervisor/reviewHandlers.ts:82` — `makeReviewCommentHandler`, before `magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)`.
   - `src/supervisor/ciHandlers.ts:85` — `makePipelineFailureHandler`, before `magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)`.
   - `src/supervisor/foundationHandlers.ts:192` — `makeChatInstructionHandler`, before `magi.followUp(repo.magiSessionId, promptWithPreamble, credentials, idempotencyKey)`.
   - `src/supervisor/selfReviewHandlers.ts:49` — `makeSelfReviewHandler`, before `magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)`.
   - `src/supervisor/foundationHandlers.ts:82` — `makeReconcileHandler`'s `interrupted`-session resume branch, before `magi.resumeSession(interruptedSessionId, credentials, idempotencyKey)`.
   - `SupervisorService.startTask` is **never** gated (spec decision: `usageUsd` starts at 0, so the first turn can't be over budget).

6. **Breach mechanism.** `HandlerCtx` (`src/supervisor/handlers.ts`) gives every handler direct `magi: MagiClient`, `papai: PapaiNotifier`, `tasks: TaskService` — it does **not** expose `SupervisorService` (whose `cancelTask` needs a `notifier` constructor arg the handler context doesn't carry). So the breach action is built directly from `magi`/`papai`, structurally **mirroring** `SupervisorService.cancelTask`'s existing machinery (`SupervisorService.ts:133-151`) rather than calling it: best-effort `magi.cancelSession(repo.magiSessionId)` per repo (catch-and-`log.warn`, never throw), `task.status = 'failed'`, then `PapaiTaskNotifier.notifyStatus(task, 'failed', {extraMarkdown: costCapMessage})` (which internally does `task.save()`, so no separate save call is needed). **Idempotency** mirrors `cancelTask`'s exact terminal-status guard (`SupervisorService.ts:137`): `if (task.status === 'failed' || 'completed' || 'closed') return` as the first line of the breach helper — verified safe on an idle/`waiting_input` post-turn session because `cancelSession` is already documented+tested as safe to call on an already-dead/unreachable session (best-effort, swallows errors).

7. **Transparency + graceful degradation — single choke point.** `PapaiTaskNotifier.notifyStatus` (`src/services/PapaiTaskNotifier.ts:68-93`) is the **only** place `task.status` is already assigned by the caller and then notified+persisted — used by `foundationHandlers.ts`'s reconcile handler, `periodic/sweeps.ts`'s `pollRepo` (merged/closed MR sweep), `SupervisorService.cancelTask`, and the new `applyCostCapBreach`. Both the in-progress `Spend: $X / $Y cap` line and the graceful-degradation `log.warn` are added **inside `notifyStatus`** (not duplicated per call site) — verified via edit-then-revert that this single-file change covers all terminal/in-progress notification paths without touching `foundationHandlers.ts`, `sweeps.ts`, or `SupervisorService.ts` again.

8. **Project→task fallback.** `TaskService.create` (`src/services/TaskService.ts:44-60`) already has `this.projects?: ProjectService` (constructor-injected, FU2). `ProjectService.getByContextId(contextId): IProject | undefined` (`src/services/ProjectService.ts:42-44`) is the exact lookup already used elsewhere in the same class (`resolvePipelineJobTrackList` uses the reverse `getByForgeProject`). Fix: `costBudgetUsd: input.costBudgetUsd ?? project?.costBudgetUsd ?? null` where `project = this.projects?.getByContextId(input.contextRef.contextId)`. **Scope note:** the spec text only calls out `TaskService.create()` (not `createForgeEvent`) — this plan follows the spec exactly and does not touch `createForgeEvent`.

All 6 of the above code shapes were verified working (type-check clean, targeted tests green, no regressions across the full 378-test baseline) by making the real edit, running it, and reverting before this plan was written — the nerv working tree is clean.

---

## Task 1: Snapshot `Task.resolvedModel` at magi session start

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/db/models/Task.ts`
- Modify: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/SupervisorService.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/foundationHandlers.test.ts`

This is a prerequisite for Task 2's pricing call — without it, `/notify` has no per-task model signal to price against (see resolved fact #3).

- [ ] **Step 1: Write the failing test**

  Add a new test right after the existing `it('resolves repoUrl/baseBranch/forge from the Project registry and snapshots mcpServers/modelProvider onto the task', ...)` block (ends at line 82) in `tests/supervisor/foundationHandlers.test.ts`, inside the `describe('SupervisorService.startTask', ...)` block:

  ```ts
  it('snapshots resolvedModel onto the task using the project.model > project.modelProvider.id > defaults.model precedence', async () => {
    await Project.create({
      contextIds: ['ctx-model-precedence'],
      repositories: [{ projectPath: 'g/r', repoUrl: 'https://forge.example.com/g/r.git' }],
      model: 'project-override-model',
      modelProvider: { id: 'provider-fallback-model' },
    })
    const projects = new ProjectService()
    await projects.loadProjects()

    const magi = { startSession: vi.fn(async () => ({ id: 'sess-model', status: 'queued' })) }
    const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude', model: 'defaults-model' }
    const sup = new SupervisorService(tasks, magi as never, { magiProjectDefaults: defaults }, undefined, projects)
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'ctx-model-precedence' },
      source: 'chat',
      prompt: 'build X',
      repos: [{ projectPath: 'g/r' }],
    })

    await sup.startTask(t._id.toString())

    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.resolvedModel).toBe('project-override-model')
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "snapshots resolvedModel"`
  Expected: FAIL — `expect(reloaded?.resolvedModel).toBe('project-override-model')` fails because `resolvedModel` is `undefined` (property does not exist on `ITask` yet, so this is also a type error until Step 3).

- [ ] **Step 3: Add the field to the Task model**

  In `src/db/models/Task.ts`, in the `ITask` interface, right after `usageUsd: number`:

  ```ts
  export interface ITask {
    _id: Types.ObjectId
    kind: string
    status: TaskStatus
    contextRef: ContextRef
    source: 'chat' | 'forge-event'
    prompt: string
    taskRepositories: TaskRepo[]
    costBudgetUsd: number | null
    usageUsd: number
    /**
     * Snapshot of the model selector string forwarded to magi's `projectSpec.model` at session
     * start (`SupervisorService#startTask`) — the pricing signal `/notify`'s `$inc` uses via
     * `domain/cost.ts#calculateCost`. Undefined until `startTask` runs (or if no model was ever
     * resolved); `calculateCost`/`getPricingForModel` already fall back to PRO pricing for
     * `undefined`. NOT named `model` — that collides with Mongoose's built-in `Document.model()`.
     */
    resolvedModel?: string
    lastActivity: Date
    // ...unchanged fields below
  ```

  And in the `taskSchema` definition, right after `usageUsd: { type: Number, default: 0 },`:

  ```ts
    costBudgetUsd: { type: Number, default: null },
    usageUsd: { type: Number, default: 0 },
    resolvedModel: { type: String, default: undefined },
  ```

- [ ] **Step 4: Snapshot it in `SupervisorService.startTask`**

  In `src/supervisor/SupervisorService.ts`, immediately after the existing line (currently line 64):

  ```ts
  const model = project?.model ?? project?.modelProvider?.id ?? defaults.model
  ```

  add:

  ```ts
  const model = project?.model ?? project?.modelProvider?.id ?? defaults.model
  if (model !== undefined) task.resolvedModel = model
  ```

  (This mirrors the existing `if (project?.mcpServers !== undefined) task.mcpServers = project.mcpServers` pattern two lines above it — same file, lines 59-60 — and runs before the existing `task.save()` at the end of `startTask`, so no extra save is needed.)

- [ ] **Step 5: Run test to verify it passes, then run the full suite**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "snapshots resolvedModel"`
  Expected: PASS

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `tsc` exits 0; `Test Files 39 passed (39)`, `Tests 379 passed (379)` (378 baseline + this new test).

- [ ] **Step 6: Commit**

  ```bash
  git add src/db/models/Task.ts src/supervisor/SupervisorService.ts tests/supervisor/foundationHandlers.test.ts
  git commit -m "feat(nerv): snapshot resolvedModel onto Task at magi session start"
  ```

---

## Task 2: `/notify` — price usage delta + atomic `$inc` (Component B)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/http/routes/notify.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/http/server.test.ts`

**Magi's wire shape (pinned by the parallel magi plan — consume verbatim, do not re-litigate):** magi POSTs a per-turn positive **delta** on `/notify`'s new `usage` field with **all six fields always present** (ACP-optional ones defaulted to `0` on magi's side):

```ts
{
  ;(totalTokens, inputTokens, outputTokens, thoughtTokens, cachedReadTokens, cachedWriteTokens)
} // all number
```

This does **not** match `domain/cost.ts`'s `TokenUsage` shape (`{inputTokens, outputTokens, cachedInputTokens}`) field-for-field — the route must accept magi's schema and then **map** it at the `calculateCost` call site:

| magi field          | → cost.ts field       | Rationale                                                                                                                                                                  |
| ------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputTokens`       | `inputTokens`         | Direct passthrough.                                                                                                                                                        |
| `outputTokens`      | `outputTokens`        | Direct passthrough.                                                                                                                                                        |
| `cachedReadTokens`  | `cachedInputTokens`   | kiss's "cached input" = cache-**read** hits (a subset of `inputTokens`, priced at the cheaper cache rate) — this is the field `calculateCost`'s cache-rate branch expects. |
| `totalTokens`       | _(dropped)_           | Derived (`inputTokens + outputTokens` + extras) — `calculateCost` doesn't take a total, it sums the priced buckets itself.                                                 |
| `cachedWriteTokens` | _(dropped, unpriced)_ | kiss's coarse PRO/FLASH pricing table has no cache-**write** rate — lumped into the base input rate already (no separate bucket to put it in).                             |
| `thoughtTokens`     | _(dropped, unpriced)_ | kiss's pricing table has no reasoning-token rate.                                                                                                                          |

`totalTokens`/`cachedWriteTokens`/`thoughtTokens` are accepted (schema-valid, not stripped) but **not priced** — a future per-model pricing refinement (spec's declared out-of-scope item) could use them; this task only wires the two buckets `calculateCost` actually understands today.

**Verified end-to-end via edit-then-revert** (temporarily reinstated Task 1's `resolvedModel` field on `ITask`/`taskSchema` alongside this task's `/notify` change to compile+run together, then reverted both): a push of `{totalTokens: 2_000_000, inputTokens: 1_000_000, outputTokens: 1_000_000, thoughtTokens: 500, cachedReadTokens: 200_000, cachedWriteTokens: 300}` against a task with no `resolvedModel` (PRO fallback) produced `usageUsd ≈ 0.348 + 0.000725 + 0.87 = 1.218725` — i.e. `regularInput = 1_000_000 - 200_000 = 800_000 @ $0.435/1M`, `cachedInput = 200_000 @ $0.003625/1M`, `output = 1_000_000 @ $0.87/1M` — confirming the mapping is applied correctly and the dropped fields don't affect the price. `tsc` and the full `server.test.ts` suite (17 tests) were clean before reverting.

- [ ] **Step 1: Write the failing tests**

  Add these tests right after the existing `it('maps a magi /notify to a reconcile enqueue', ...)` block in `tests/http/server.test.ts`:

  ```ts
  it('prices a usage push via calculateCost (mapping cachedReadTokens -> cachedInputTokens) and atomically $incs task.usageUsd', async () => {
    const { app } = makeApp()
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth,
      payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
    })
    const id = created.json().taskId

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: auth,
      payload: {
        contextId: 'c1',
        markdown: '[answer] partial',
        usage: {
          totalTokens: 2_000_000,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          thoughtTokens: 500,
          cachedReadTokens: 200_000,
          cachedWriteTokens: 300,
        },
      },
    })
    expect(res.statusCode).toBe(204)

    const after = await tasks.get(id)
    // regularInput = 1_000_000 - 200_000 = 800_000 @ $0.435/1M = 0.348 (PRO, no resolvedModel set yet)
    // cachedInput   = 200_000                      @ $0.003625/1M = 0.000725
    // output        = 1_000_000                    @ $0.87/1M = 0.87
    expect(after?.usageUsd).toBeCloseTo(0.348 + 0.000725 + 0.87, 4)
  })

  it('accumulates usage additively across two pushes (atomic $inc, not overwrite)', async () => {
    const { app } = makeApp()
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth,
      payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
    })
    const id = created.json().taskId

    const usage = {
      totalTokens: 1_000_000,
      inputTokens: 1_000_000,
      outputTokens: 0,
      thoughtTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    }
    await app.inject({
      method: 'POST',
      url: '/notify',
      headers: auth,
      payload: { contextId: 'c1', markdown: '[answer] a', usage },
    })
    await app.inject({
      method: 'POST',
      url: '/notify',
      headers: auth,
      payload: { contextId: 'c1', markdown: '[answer] b', usage },
    })

    const after = await tasks.get(id)
    expect(after?.usageUsd).toBeCloseTo(0.435 * 2, 4)
  })

  it('a push with no usage is a no-op for accumulation (usageUsd stays 0)', async () => {
    const { app } = makeApp()
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth,
      payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
    })
    const id = created.json().taskId

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: auth,
      payload: { contextId: 'c1', markdown: '[done] finished' },
    })
    expect(res.statusCode).toBe(204)

    const after = await tasks.get(id)
    expect(after?.usageUsd).toBe(0)
  })

  it('accepts a usage push with fields omitted (defaulted to 0 — additive wire field, lenient)', async () => {
    const { app } = makeApp()
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth,
      payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
    })
    const id = created.json().taskId

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: auth,
      payload: { contextId: 'c1', markdown: '[answer] x', usage: { inputTokens: 1_000_000 } },
    })
    expect(res.statusCode).toBe(204)

    const after = await tasks.get(id)
    expect(after?.usageUsd).toBeCloseTo(0.435, 4) // outputTokens/cachedReadTokens default to 0
  })

  it('rejects malformed usage (bearer auth still enforced separately)', async () => {
    const { app } = makeApp()
    await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth,
      payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: auth,
      payload: { contextId: 'c1', markdown: '[answer] x', usage: { inputTokens: 'not-a-number' } },
    })
    expect(res.statusCode).toBe(400)

    const unauth = await app.inject({
      method: 'POST',
      url: '/notify',
      payload: { contextId: 'c1', markdown: '[answer] x' },
    })
    expect(unauth.statusCode).toBe(401)
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run tests/http/server.test.ts -t "usage"`
  Expected: FAIL — the schema doesn't accept `usage` yet (zod strips unknown keys by default so the pushes 204 but `usageUsd` stays 0), and the malformed-usage test gets 204 instead of 400.

- [ ] **Step 3: Implement**

  In `src/http/routes/notify.ts`:

  ```ts
  import type { FastifyInstance } from 'fastify'
  import { z } from 'zod'
  import { Task } from '../../db/models/Task.js'
  import { calculateCost } from '../../domain/cost.js'
  import type { ServerDeps } from '../server.js'

  /**
   * Magi's per-turn token-usage delta, pinned by the magi-side FU5a plan. All six fields are
   * always present on the wire (ACP-optional ones defaulted to 0 by magi); defaulted here too so
   * a partial/legacy payload still validates, since this is an additive wire field.
   */
  const usageSchema = z.object({
    totalTokens: z.number().nonnegative().default(0),
    inputTokens: z.number().nonnegative().default(0),
    outputTokens: z.number().nonnegative().default(0),
    thoughtTokens: z.number().nonnegative().default(0),
    cachedReadTokens: z.number().nonnegative().default(0),
    cachedWriteTokens: z.number().nonnegative().default(0),
  })

  const notifyBody = z.object({
    contextId: z.string().min(1),
    markdown: z.string().min(1),
    /** Per-turn token usage delta pushed by magi's HttpNotifier (optional — omitted on milestones with no usage). */
    usage: usageSchema.optional(),
  })
  ```

  And in `registerNotifyRoute`, right before the existing `req.log.info({ taskId: ..., kind }, 'notify -> reconcile')` line:

  ```ts
      const task = await Task.findOne({ 'contextRef.contextId': parsed.data.contextId })
      if (task) {
        if (parsed.data.usage) {
          const { inputTokens, outputTokens, cachedReadTokens } = parsed.data.usage
          // Map magi's wire shape onto cost.ts's TokenUsage: cachedReadTokens (subset of
          // inputTokens read from cache) is the field calculateCost's cache-rate branch expects
          // as cachedInputTokens. totalTokens is derived (dropped); cachedWriteTokens/
          // thoughtTokens are accepted but unpriced under kiss's coarse PRO/FLASH pricing table
          // (no cache-write or reasoning-token rate) — a future per-model pricing refinement
          // (spec's declared out-of-scope item) could use them.
          const deltaUsd = calculateCost(
            { inputTokens, outputTokens, cachedInputTokens: cachedReadTokens },
            task.resolvedModel,
          )
          req.log.info({ taskId: task._id.toString(), deltaUsd }, 'notify -> priced usage delta')
          // Atomic $inc per FU3's ledger lesson — never a whole-document task.save() here, this
          // handler races with the worker loop mutating the same Task document.
          await Task.updateOne({ _id: task._id }, { $inc: { usageUsd: deltaUsd } })
        }
        req.log.info({ taskId: task._id.toString(), kind }, 'notify -> reconcile')
        await deps.queue.enqueueOnce({
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/http/server.test.ts --reporter=verbose`
  Expected: PASS — all pre-existing `server.test.ts` tests plus the 5 new ones (21 total, up from 16).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `tsc` exits 0; `Tests 384 passed (384)` (379 from Task 1 + 5 new).

- [ ] **Step 6: Commit**

  ```bash
  git add src/http/routes/notify.ts tests/http/server.test.ts
  git commit -m "feat(nerv): price /notify usage delta (magi wire shape) and atomically \$inc task.usageUsd"
  ```

---

## Task 3: `isOverBudget` + `applyCostCapBreach` shared helper (Component C foundation)

**Files:**

- Create: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/costCap.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/costCap.test.ts` (new)

This task builds and unit-tests the shared gate + breach logic in isolation, including the idempotency guard, before wiring it into any of the 5 dispatch sites (Tasks 4-8).

- [ ] **Step 1: Write the failing tests**

  Create `tests/supervisor/costCap.test.ts`:

  ```ts
  import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
  import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js'
  import { TaskService } from '../../src/services/TaskService.js'
  import { isOverBudget, applyCostCapBreach } from '../../src/supervisor/costCap.js'

  const tasks = new TaskService()

  const sampleInput = {
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat' as const,
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  }

  describe('isOverBudget', () => {
    it('is false when no budget is set', () => {
      expect(isOverBudget({ costBudgetUsd: null, usageUsd: 100 })).toBe(false)
    })

    it('is false when usage is under budget', () => {
      expect(isOverBudget({ costBudgetUsd: 5, usageUsd: 4.99 })).toBe(false)
    })

    it('is true when usage equals or exceeds budget', () => {
      expect(isOverBudget({ costBudgetUsd: 5, usageUsd: 5 })).toBe(true)
      expect(isOverBudget({ costBudgetUsd: 5, usageUsd: 5.01 })).toBe(true)
    })
  })

  describe('applyCostCapBreach', () => {
    beforeAll(async () => {
      await startTestDb()
    })
    afterAll(async () => {
      await stopTestDb()
    })
    afterEach(async () => {
      await clearDb()
    })

    it('cancels every repo session, fails the task, and notifies with a cost-cap message', async () => {
      const t = await tasks.create({
        ...sampleInput,
        repos: [{ projectPath: 'g/r1' }, { projectPath: 'g/r2' }],
        costBudgetUsd: 1,
      })
      t.taskRepositories[0].magiSessionId = 'sess-a'
      t.taskRepositories[1].magiSessionId = 'sess-b'
      t.status = 'coding'
      t.usageUsd = 1.5
      await t.save()

      const magi = { cancelSession: vi.fn(async () => ({})) }
      const papai = { notify: vi.fn(async () => {}) }

      await applyCostCapBreach(t, magi, papai)

      expect(magi.cancelSession).toHaveBeenCalledWith('sess-a')
      expect(magi.cancelSession).toHaveBeenCalledWith('sess-b')
      expect(t.status).toBe('failed')
      expect(papai.notify).toHaveBeenCalledOnce()
      const [call] = papai.notify.mock.calls[0] as unknown as [{ markdown: string }]
      expect(call.markdown).toContain('⚠️ Cost cap reached: $1.5000 / $1.0000')
      expect(call.markdown).toContain('the coding run was stopped')

      const reloaded = await tasks.get(t._id.toString())
      expect(reloaded?.status).toBe('failed')
    })

    it('a repo whose cancelSession throws does not block the others or the breach outcome', async () => {
      const t = await tasks.create({
        ...sampleInput,
        repos: [{ projectPath: 'g/r1' }, { projectPath: 'g/r2' }],
        costBudgetUsd: 1,
      })
      t.taskRepositories[0].magiSessionId = 'sess-a'
      t.taskRepositories[1].magiSessionId = 'sess-b'
      t.status = 'coding'
      t.usageUsd = 1
      await t.save()

      const magi = {
        cancelSession: vi.fn(async (id: string) => {
          if (id === 'sess-a') throw new Error('gone')
        }),
      }
      const papai = { notify: vi.fn(async () => {}) }

      await expect(applyCostCapBreach(t, magi, papai)).resolves.toBeUndefined()
      expect(magi.cancelSession).toHaveBeenCalledWith('sess-b')
      expect(t.status).toBe('failed')
    })

    it('is idempotent: a task already in a terminal status is left untouched (no double-cancel, no double-notify)', async () => {
      const t = await tasks.create({ ...sampleInput, costBudgetUsd: 1 })
      t.taskRepositories[0].magiSessionId = 'sess-a'
      t.status = 'failed'
      t.usageUsd = 1
      await t.save()

      const magi = { cancelSession: vi.fn(async () => ({})) }
      const papai = { notify: vi.fn(async () => {}) }

      await applyCostCapBreach(t, magi, papai)

      expect(magi.cancelSession).not.toHaveBeenCalled()
      expect(papai.notify).not.toHaveBeenCalled()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run tests/supervisor/costCap.test.ts`
  Expected: FAIL — `src/supervisor/costCap.js` does not exist (import error).

- [ ] **Step 3: Implement**

  Create `src/supervisor/costCap.ts`:

  ```ts
  import type { HydratedDocument } from 'mongoose'
  import type { ITask } from '../db/models/Task.js'
  import type { MagiClient } from '../services/MagiClient.js'
  import type { PapaiNotifier } from '../services/PapaiNotifier.js'
  import { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
  import { createLogger } from '../logger.js'

  const log = createLogger('cost-cap')

  /**
   * True once a budgeted task's accumulated usage has reached (or passed) its cap.
   * Turn-granularity (FU5a decision 1): checked before every dispatch, never mid-turn — one
   * in-flight turn may still overshoot before the next check catches it (kiss's accepted
   * limitation, matched here).
   */
  export function isOverBudget(task: Pick<ITask, 'costBudgetUsd' | 'usageUsd'>): boolean {
    return task.costBudgetUsd != null && task.usageUsd >= task.costBudgetUsd
  }

  /**
   * Breach action (FU5a decision 4): best-effort-cancels every repo's live magi session (freeing
   * the container), transitions the task to `failed`, and notifies papai with a dedicated
   * cost-cap message. Structurally mirrors `SupervisorService.cancelTask`'s existing
   * cancel-then-notify machinery (magi/notifier — not `SupervisorService` itself, which
   * `HandlerCtx` does not expose) including its terminal-status idempotency guard: a task
   * already `failed`/`completed`/`closed` is left untouched — no double-cancel, no
   * double-notify. Safe to call on an idle/`waiting_input` post-turn session:
   * `magi.cancelSession` is already best-effort (catches and logs, never throws to the caller).
   */
  export async function applyCostCapBreach(
    task: HydratedDocument<ITask>,
    magi: Pick<MagiClient, 'cancelSession'>,
    papai: PapaiNotifier,
  ): Promise<void> {
    if (task.status === 'failed' || task.status === 'completed' || task.status === 'closed') return

    for (const repo of task.taskRepositories) {
      if (!repo.magiSessionId) continue
      try {
        await magi.cancelSession(repo.magiSessionId)
      } catch (err) {
        log.warn('failed to cancel magi session on cost-cap breach', {
          taskId: task._id.toString(),
          projectPath: repo.projectPath,
          magiSessionId: repo.magiSessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    task.status = 'failed'
    task.lastActivity = new Date()

    const notifier = new PapaiTaskNotifier(papai)
    await notifier.notifyStatus(task, 'failed', {
      extraMarkdown: `⚠️ Cost cap reached: $${task.usageUsd.toFixed(4)} / $${(task.costBudgetUsd ?? 0).toFixed(4)} — the coding run was stopped.`,
    })
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/costCap.test.ts --reporter=verbose`
  Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `tsc` exits 0; `Test Files 41 passed (41)`, `Tests 390 passed (390)` (384 + 6 new).

- [ ] **Step 6: Commit**

  ```bash
  git add src/supervisor/costCap.ts tests/supervisor/costCap.test.ts
  git commit -m "feat(nerv): add isOverBudget + applyCostCapBreach cost-cap helper"
  ```

---

## Task 4: Gate `makeSelfReviewHandler` (dispatch site 1/5)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/selfReviewHandlers.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/selfReviewHandler.test.ts`

- [ ] **Step 1: Write the failing test**

  Add this test at the end of the `describe('selfReview handler', ...)` block in `tests/supervisor/selfReviewHandler.test.ts` (after the existing idempotencyKey test):

  ```ts
  it('over budget: skips the dispatch, cancels the session, fails the task, and notifies', async () => {
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r' }],
      costBudgetUsd: 1,
    })
    t.taskRepositories[0].magiSessionId = 'sess-1'
    t.usageUsd = 1.5
    await t.save()

    const magi = { followUp: vi.fn(async () => ({})), cancelSession: vi.fn(async () => ({})) }
    const papai = { notify: vi.fn(async () => {}) }
    const payload: SelfReviewPayload = { projectPath: 'g/r', mrIid: 1 }

    const handler = makeSelfReviewHandler()
    await handler({ task: t, item: { _id: new Types.ObjectId(), payload }, magi, papai } as unknown as HandlerCtx)

    expect(magi.followUp).not.toHaveBeenCalled()
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-1')
    expect(t.status).toBe('failed')
    expect(papai.notify).toHaveBeenCalledOnce()
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/selfReviewHandler.test.ts -t "over budget"`
  Expected: FAIL — `magi.followUp` is still called (no gate yet).

- [ ] **Step 3: Implement**

  In `src/supervisor/selfReviewHandlers.ts`, add the import and gate:

  ```ts
  import { generateSelfReviewPrompt } from '../services/prompts.js'
  import { createLogger } from '../logger.js'
  import { resolveWorktreeSubdir } from './reviewHandlers.js'
  import { resolveMagiCredentials } from './magiCredentials.js'
  import { selfReviewIdempotencyKey } from '../domain/idempotencyKeys.js'
  import { isOverBudget, applyCostCapBreach } from './costCap.js'
  import type { Handler } from './handlers.js'
  import type { SelfReviewPayload } from '../domain/workPayloads.js'

  const log = createLogger('self-review-handler')

  export function makeSelfReviewHandler(): Handler {
    return async ({ task, item, magi, papai, projects, magiDefaults }) => {
      const payload = item.payload as SelfReviewPayload
      const repo = task.taskRepositories.find((r) => r.projectPath === payload.projectPath)
      if (!repo || !repo.magiSessionId) {
        log.info(`no repo/session for ${payload.projectPath} on task ${task._id} — skipping`)
        return
      }

      if (isOverBudget(task)) {
        await applyCostCapBreach(task, magi, papai)
        return
      }

      const worktreeSubdir = resolveWorktreeSubdir(projects, task.contextRef.contextId, payload.projectPath)
      // ...rest of the function is unchanged
  ```

  (Only the `papai` destructure addition and the new `if (isOverBudget...)` block change; everything below is untouched.)

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/selfReviewHandler.test.ts --reporter=verbose`
  Expected: PASS (5 tests, up from 4 — the pre-existing "no session" and "happy path" tests must still pass unchanged).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 391 passed (391)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/supervisor/selfReviewHandlers.ts tests/supervisor/selfReviewHandler.test.ts
  git commit -m "feat(nerv): gate self-review follow-up dispatch on the cost cap"
  ```

---

## Task 5: Gate `makeReviewCommentHandler` (dispatch site 2/5)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/reviewHandlers.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/reviewCommentHandler.test.ts`

- [ ] **Step 1: Write the failing test**

  Add to `tests/supervisor/reviewCommentHandler.test.ts` (mirror the existing test's task/repo/forge setup used by the file's other tests — use whatever `makeCtx`/task-building helper the file already defines, following its established pattern; the key new assertions are on `magi.followUp`, `magi.cancelSession`, `task.status`, and `papai.notify`):

  ```ts
  it('over budget: skips the follow-up dispatch, cancels the session, fails the task, and notifies', async () => {
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r' }],
      costBudgetUsd: 1,
    })
    t.taskRepositories[0].magiSessionId = 'sess-1'
    t.usageUsd = 1.5
    await t.save()

    const forge = { getMRView: vi.fn(async () => makeMrView()) }
    const magi = { followUp: vi.fn(async () => ({})), cancelSession: vi.fn(async () => ({})) }
    const papai = { notify: vi.fn(async () => {}) }
    const tasksSvc = { addProcessedNoteIds: vi.fn(async () => {}) }
    const payload: ReviewCommentPayload = {
      projectPath: 'g/r',
      discussionId: 'disc-1',
      noteIds: ['101'],
      mrIid: 1,
    }

    const handler = makeReviewCommentHandler()
    await handler({ task: t, item: { payload }, tasks: tasksSvc, forge, magi, papai } as unknown as HandlerCtx)

    expect(magi.followUp).not.toHaveBeenCalled()
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-1')
    expect(t.status).toBe('failed')
    expect(papai.notify).toHaveBeenCalledOnce()
  })
  ```

  (`makeMrView`, `ReviewCommentPayload` and the `tasks`/`TaskService` import are already present at the top of this test file per its existing tests — reuse them, don't re-declare.)

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/reviewCommentHandler.test.ts -t "over budget"`
  Expected: FAIL — `magi.followUp` is still called.

- [ ] **Step 3: Implement**

  In `src/supervisor/reviewHandlers.ts`:

  ```ts
  import { buildActionableNoteGroups, type ActionableNoteGroup } from '../domain/reviewNotes.js'
  import { formatCodePreview, formatTimestamp } from '../utils/text.js'
  import { generateFixPrompt } from '../services/prompts.js'
  import { createLogger } from '../logger.js'
  import { resolveMagiCredentials } from './magiCredentials.js'
  import { reviewFixIdempotencyKey } from '../domain/idempotencyKeys.js'
  import { isOverBudget, applyCostCapBreach } from './costCap.js'
  import type { Handler } from './handlers.js'
  import type { ForgeClient } from '../services/ForgeClient.js'
  import type { ProjectService } from '../services/ProjectService.js'
  import type { ReviewCommentPayload } from '../domain/workPayloads.js'

  const log = createLogger('review-comment-handler')

  export function makeReviewCommentHandler(gitlabUserName: string = 'nerv-agent'): Handler {
    return async ({ task, item, tasks, forge, magi, papai, projects, magiDefaults }) => {
      const payload = item.payload as ReviewCommentPayload
      const repo = task.taskRepositories.find((r) => r.projectPath === payload.projectPath)
      if (!repo || !repo.magiSessionId) {
        log.info(`no repo/session for ${payload.projectPath} on task ${task._id} — skipping`)
        return
      }

      if (isOverBudget(task)) {
        await applyCostCapBreach(task, magi, papai)
        return
      }

      const processedNoteIds = new Set(repo.processedNoteIds)
      // ...rest of the function is unchanged
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/reviewCommentHandler.test.ts --reporter=verbose`
  Expected: PASS (all pre-existing tests + 1 new).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 392 passed (392)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/supervisor/reviewHandlers.ts tests/supervisor/reviewCommentHandler.test.ts
  git commit -m "feat(nerv): gate review-comment fix dispatch on the cost cap"
  ```

---

## Task 6: Gate `makePipelineFailureHandler` (dispatch site 3/5)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/ciHandlers.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/pipelineFailureHandler.test.ts`

- [ ] **Step 1: Write the failing test**

  Add to `tests/supervisor/pipelineFailureHandler.test.ts`, following the file's existing task/forge/payload setup pattern (a `FailedPipelineJob`-shaped job and `PipelineFailurePayload`):

  ```ts
  it('over budget: skips the fix dispatch, cancels the session, fails the task, and does not post the CI-failure notification', async () => {
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r' }],
      costBudgetUsd: 1,
    })
    t.taskRepositories[0].magiSessionId = 'sess-1'
    t.usageUsd = 1.5
    await t.save()

    const job = { id: 42, name: 'test', stage: 'test', status: 'failed', webUrl: 'https://x', log: '' }
    const forge = { getFailedPipelineJobLogs: vi.fn(async () => ({ jobs: [job] })) }
    const magi = { followUp: vi.fn(async () => ({})), cancelSession: vi.fn(async () => ({})) }
    const papai = { notify: vi.fn(async () => {}) }
    const tasksSvc = { addProcessedJobId: vi.fn(async () => {}) }
    const payload: PipelineFailurePayload = { projectPath: 'g/r', mrIid: 1, jobId: 42 }

    const handler = makePipelineFailureHandler()
    await handler({ task: t, item: { payload }, tasks: tasksSvc, forge, magi, papai } as unknown as HandlerCtx)

    expect(magi.followUp).not.toHaveBeenCalled()
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-1')
    expect(t.status).toBe('failed')
    // The breach notify (cost-cap message) fires; the separate CI-failure "attempting a fix" notify must NOT.
    expect(papai.notify).toHaveBeenCalledOnce()
    const [call] = papai.notify.mock.calls[0] as unknown as [{ markdown: string }]
    expect(call.markdown).toContain('Cost cap reached')
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/pipelineFailureHandler.test.ts -t "over budget"`
  Expected: FAIL — `magi.followUp` is still called.

- [ ] **Step 3: Implement**

  In `src/supervisor/ciHandlers.ts`:

  ```ts
  import { generatePipelineFixPrompt } from '../services/prompts.js'
  import { createLogger } from '../logger.js'
  import { resolveWorktreeSubdir } from './reviewHandlers.js'
  import { resolveMagiCredentials } from './magiCredentials.js'
  import { ciFixIdempotencyKey } from '../domain/idempotencyKeys.js'
  import { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
  import { isOverBudget, applyCostCapBreach } from './costCap.js'
  import type { Handler } from './handlers.js'
  import type { PipelineFailurePayload } from '../domain/workPayloads.js'
  import type { FailedPipelineJob } from '../domain/forge.js'

  // ...formatCiFailureMarkdown unchanged...

  export function makePipelineFailureHandler(gitlabUserName: string = 'nerv-agent'): Handler {
    return async ({ task, item, tasks, forge, magi, papai, projects, magiDefaults }) => {
      const payload = item.payload as PipelineFailurePayload
      const repo = task.taskRepositories.find((r) => r.projectPath === payload.projectPath)
      if (!repo || !repo.magiSessionId) {
        log.info(`no repo/session for ${payload.projectPath} on task ${task._id} — skipping`)
        return
      }

      if (isOverBudget(task)) {
        await applyCostCapBreach(task, magi, papai)
        return
      }

      const processedJobIds = new Set(repo.processedJobIds)
      // ...rest of the function is unchanged
  ```

  Placing the gate before the `processedJobIds` idempotency check is intentional and safe: `applyCostCapBreach` transitions the task terminal regardless of whether this specific job was already processed, and a subsequent retry of the same work item hits `applyCostCapBreach`'s own terminal-status guard (Task 3) as a no-op.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/pipelineFailureHandler.test.ts --reporter=verbose`
  Expected: PASS (all pre-existing tests + 1 new).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 393 passed (393)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/supervisor/ciHandlers.ts tests/supervisor/pipelineFailureHandler.test.ts
  git commit -m "feat(nerv): gate CI pipeline-fix dispatch on the cost cap"
  ```

---

## Task 7: Gate `makeChatInstructionHandler` (dispatch site 4/5)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/foundationHandlers.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/foundationHandlers.test.ts`

- [ ] **Step 1: Write the failing test**

  Add to the `describe('chat_instruction handler', ...)` block in `tests/supervisor/foundationHandlers.test.ts`:

  ```ts
  it('over budget: skips the follow-up dispatch, cancels the session, fails the task, and notifies with the cost-cap message (not the "applying your instruction" ack)', async () => {
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r' }],
      costBudgetUsd: 1,
    })
    t.taskRepositories[0].magiSessionId = 'sess-1'
    t.status = 'coding'
    t.usageUsd = 1.5
    await t.save()

    const magi = { followUp: vi.fn(async () => ({})), cancelSession: vi.fn(async () => ({})) }
    const papai = { notify: vi.fn(async () => {}) }

    const handler = makeChatInstructionHandler()
    await handler({
      task: t,
      item: { _id: new Types.ObjectId(), payload: { prompt: 'do more' } },
      magi,
      papai,
      magiDefaults: {},
    } as unknown as HandlerCtx)

    expect(magi.followUp).not.toHaveBeenCalled()
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-1')
    expect(t.status).toBe('failed')
    expect(papai.notify).toHaveBeenCalledOnce()
    const [call] = papai.notify.mock.calls[0] as unknown as [{ markdown: string }]
    expect(call.markdown).toContain('Cost cap reached')
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "applying your instruction"`
  Expected: FAIL — `magi.followUp` is still called and `papai.notify` gets the "Got it — applying your instruction." ack instead.

- [ ] **Step 3: Implement**

  In `src/supervisor/foundationHandlers.ts`, add the import at the top:

  ```ts
  import { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
  import { resolveMagiCredentials } from './magiCredentials.js'
  import { isOverBudget, applyCostCapBreach } from './costCap.js'
  import { createLogger } from '../logger.js'
  ```

  And in `makeChatInstructionHandler`, right before the existing `if (repo?.magiSessionId && prompt) {` block:

  ```ts
  export function makeChatInstructionHandler(): Handler {
    return async ({ task, item, magi, papai, projects, magiDefaults }) => {
      const { prompt } = item.payload as ChatInstructionPayload
      const repo = task.taskRepositories.find((r) => r.magiSessionId)

      if (repo?.magiSessionId && prompt && isOverBudget(task)) {
        await applyCostCapBreach(task, magi, papai)
        return
      }

      if (repo?.magiSessionId && prompt) {
        const credentials = resolveMagiCredentials(
          projects?.getByContextId(task.contextRef.contextId),
          magiDefaults ?? {},
        )
        const promptWithPreamble = prependOperatingInstructions(task.outputLanguage, prompt)
        const idempotencyKey = chatInstructionIdempotencyKey(task._id.toString(), repo.projectPath, item._id.toString())
        await magi.followUp(repo.magiSessionId, promptWithPreamble, credentials, idempotencyKey)
        await papai.notify({
          contextId: task.contextRef.contextId,
          threadId: task.contextRef.threadId,
          markdown: 'Got it — applying your instruction.',
        })
      } else {
        // ...unchanged "no live session" else-branch
  ```

  (Guarding with the same `repo?.magiSessionId && prompt` condition as the dispatch branch keeps the existing "no repo has a live session" honest-notify else-branch behavior completely untouched when there's nothing to dispatch in the first place.)

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts --reporter=verbose`
  Expected: PASS (all pre-existing tests + 1 new, 34 total in this file).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 394 passed (394)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/supervisor/foundationHandlers.ts tests/supervisor/foundationHandlers.test.ts
  git commit -m "feat(nerv): gate chat-instruction follow-up dispatch on the cost cap"
  ```

---

## Task 8: Gate `makeReconcileHandler`'s resume path (dispatch site 5/5)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/supervisor/foundationHandlers.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/supervisor/foundationHandlers.test.ts`

The `isOverBudget`/`applyCostCapBreach` import was already added in Task 7 — this task only adds the second call site.

- [ ] **Step 1: Write the failing test**

  Add to the `describe('reconcile handler', ...)` block, right after the existing `it('resumes an interrupted session under budget: ...', ...)` test:

  ```ts
  it('over budget: skips resumeSession on an interrupted repo, cancels the session, and fails the task instead', async () => {
    const t = await makeCodingTask()
    t.costBudgetUsd = 1
    t.usageUsd = 1
    await t.save()
    const magi = {
      getSession: vi.fn(async () => ({ id: 'sess-9', status: 'interrupted' })),
      resumeSession: vi.fn(async () => ({ id: 'sess-9-r1', status: 'preparing' })),
      cancelSession: vi.fn(async () => ({})),
    }
    const { papai } = makePapai()

    const handler = makeReconcileHandler(3)
    await handler({ task: t, item: { payload: {} }, magi, papai, magiDefaults: {} } as unknown as HandlerCtx)

    expect(magi.resumeSession).not.toHaveBeenCalled()
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-9')
    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.status).toBe('failed')
    expect(papai.notify).toHaveBeenCalledOnce()
    const [call] = papai.notify.mock.calls[0] as unknown as [{ markdown: string }]
    expect(call.markdown).toContain('Cost cap reached')
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "skips resumeSession on an interrupted"`
  Expected: FAIL — `magi.resumeSession` is still called (no gate on the resume branch yet).

- [ ] **Step 3: Implement**

  In `src/supervisor/foundationHandlers.ts`, inside `makeReconcileHandler`'s repo loop, right where the `interrupted`-status branch currently starts:

  ```ts
        if (session.status === 'interrupted') {
          if (isOverBudget(task)) {
            await applyCostCapBreach(task, magi, papai)
            return
          }
          const attempts = repo.resumeAttempts ?? 0
          // ...rest of the interrupted-branch logic is unchanged
  ```

  The early `return` exits the whole handler for this reconcile tick — deliberate: `applyCostCapBreach` has already authoritatively transitioned the task to `failed` and notified papai, so the remaining per-repo loop iterations, status aggregation (`mappedStatuses`), and the bottom-of-function `notifier.notifyStatus`/`task.save()` calls must not run again against a task that's already terminal (they'd either no-op via `notifyStatus`'s own dedupe or, worse, attempt an illegal transition). This is the same "stop processing, breach action owns the outcome" contract used at all 4 other gate sites.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts --reporter=verbose`
  Expected: PASS (35 tests in this file — all pre-existing reconcile-handler tests, including "resumes an interrupted session under budget" and "transitions the task to failed... once the resume budget is exhausted", must still pass unchanged).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 395 passed (395)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/supervisor/foundationHandlers.ts tests/supervisor/foundationHandlers.test.ts
  git commit -m "feat(nerv): gate reconcile's interrupted-session resume on the cost cap"
  ```

  **All 5 dispatch sites are now gated — Component C is complete.**

---

## Task 9: Transparency spend line + graceful-degradation warn (Component D part 1)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/services/PapaiTaskNotifier.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/services/PapaiTaskNotifier.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add to `tests/services/PapaiTaskNotifier.test.ts`, right after the existing `it('includes a cost line for completed status when usageUsd > 0', ...)` / `it('omits the cost line when usageUsd is 0', ...)` pair:

  ```ts
  it('appends a spend-vs-cap line for in-progress statuses (coding/review) when a budget is set', async () => {
    const { papai, notify } = makePapaiNotifier()
    const notifier = new PapaiTaskNotifier(papai)
    const task = await taskSvc.create({ ...sampleInput, costBudgetUsd: 5 })
    task.usageUsd = 1.2345
    await task.save()

    await notifier.notifyStatus(task, 'coding')

    const body = JSON.parse((notify.mock.calls[0][1] as RequestInit).body as string)
    expect(body.markdown).toContain('Spend: $1.2345 / $5.0000 cap')
  })

  it('omits the spend line for in-progress statuses when no budget is set', async () => {
    const { papai, notify } = makePapaiNotifier()
    const notifier = new PapaiTaskNotifier(papai)
    const task = await taskSvc.create(sampleInput)

    await notifier.notifyStatus(task, 'coding')

    const body = JSON.parse((notify.mock.calls[0][1] as RequestInit).body as string)
    expect(body.markdown).not.toContain('Spend:')
  })

  it('logs a warn when a budgeted task reaches a terminal status with usageUsd still 0 (graceful degradation)', async () => {
    const { papai } = makePapaiNotifier()
    const warnSpy = vi.fn()
    const notifier = new PapaiTaskNotifier(papai, { warn: warnSpy, debug: vi.fn(), info: vi.fn() } as never)
    const task = await taskSvc.create({ ...sampleInput, costBudgetUsd: 5 })

    await notifier.notifyStatus(task, 'failed')

    expect(warnSpy).toHaveBeenCalled()
  })

  it('does not warn when a budgeted task reaches a terminal status with nonzero usageUsd', async () => {
    const { papai } = makePapaiNotifier()
    const warnSpy = vi.fn()
    const notifier = new PapaiTaskNotifier(papai, { warn: warnSpy, debug: vi.fn(), info: vi.fn() } as never)
    const task = await taskSvc.create({ ...sampleInput, costBudgetUsd: 5 })
    task.usageUsd = 2
    await task.save()

    await notifier.notifyStatus(task, 'completed')

    expect(warnSpy).not.toHaveBeenCalled()
  })
  ```

  (`PapaiTaskNotifier`'s constructor already accepts an optional `log: Logger` as its 2nd param — `services/PapaiTaskNotifier.ts:47-50` — so these tests inject a spy logger directly rather than reaching into a private field.)

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run tests/services/PapaiTaskNotifier.test.ts -t "Spend|graceful|warn"`
  Expected: FAIL — no `Spend:` line is appended, and `warnSpy` is never called.

- [ ] **Step 3: Implement**

  In `src/services/PapaiTaskNotifier.ts`, right after the existing `COST_STATUSES` constant:

  ```ts
  /** Task statuses whose notification should include a cost summary when usage was recorded. */
  const COST_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'closed'])

  /** Task statuses whose notification should include a live spend-vs-cap line when a budget is set. */
  const IN_PROGRESS_SPEND_STATUSES: ReadonlySet<TaskStatus> = new Set(['coding', 'review'])

  /** Terminal statuses eligible for the graceful-degradation warn (a budgeted task that never accrued usage). */
  const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'closed', 'failed'])
  ```

  And in `notifyStatus`, extend the existing `parts`-building block:

  ```ts
  const parts = [STATUS_LINES[status]]
  if (opts.extraMarkdown) parts.push(opts.extraMarkdown)
  if (COST_STATUSES.has(status) && task.usageUsd > 0) parts.push(costHeadline(task.usageUsd))
  if (IN_PROGRESS_SPEND_STATUSES.has(status) && task.costBudgetUsd != null) {
    parts.push(`Spend: $${task.usageUsd.toFixed(4)} / $${task.costBudgetUsd.toFixed(4)} cap`)
  }

  // Graceful degradation (FU5a decision 5): a budgeted task reaching a terminal state having
  // never accrued any usage means the cost cap is silently non-functional for it (no backend
  // ever populated ACP usage on its magi turns) — surface that loudly rather than let it read
  // as "the task was just cheap."
  if (TERMINAL_STATUSES.has(status) && task.costBudgetUsd != null && task.usageUsd === 0) {
    this.log.warn(
      'budgeted task reached a terminal status with usageUsd still 0 — cost cap may be non-functional (no usage ever reported)',
      { taskId: task._id.toString(), status, costBudgetUsd: task.costBudgetUsd },
    )
  }
  ```

  (Both checks are placed before the existing `await this.papai.notify(...)` call, alongside the pre-existing `COST_STATUSES` check — no other lines in `notifyStatus` change.)

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/services/PapaiTaskNotifier.test.ts --reporter=verbose`
  Expected: PASS (all pre-existing tests + 4 new).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 399 passed (399)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/services/PapaiTaskNotifier.ts tests/services/PapaiTaskNotifier.test.ts
  git commit -m "feat(nerv): surface in-progress spend line and warn on silent cost-cap degradation"
  ```

---

## Task 10: Project→task budget fallback in `TaskService.create` (Component D part 2)

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/nerv/src/services/TaskService.ts`
- Test: `/Users/ki/Projects/yourpapai/nerv/tests/services/TaskService.test.ts`

- [ ] **Step 1: Write the failing test**

  Add to `tests/services/TaskService.test.ts`, right after the existing `it('creates a task in status new with one repo', ...)` test:

  ```ts
  it('falls back to the project costBudgetUsd when the create input omits it, and honors an explicit input override', async () => {
    await Project.create({
      contextIds: ['chan-1'],
      repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
      costBudgetUsd: 7.5,
    })
    await projects.loadProjects()

    const fallback = await svc.create(sampleInput)
    expect(fallback.costBudgetUsd).toBe(7.5)

    const explicit = await svc.create({ ...sampleInput, costBudgetUsd: 2 })
    expect(explicit.costBudgetUsd).toBe(2)
  })

  it('leaves costBudgetUsd null when neither the input nor the project sets one', async () => {
    const t = await svc.create(sampleInput)
    expect(t.costBudgetUsd).toBeNull()
  })
  ```

  (`Project` is already imported at the top of this test file; `projects`/`svc` are the file's existing shared `ProjectService`/`TaskService` instances — `sampleInput.contextRef.contextId` is `'chan-1'`, matching the `Project.contextIds` above.)

- [ ] **Step 2: Run tests to verify the first one fails**

  Run: `npx vitest run tests/services/TaskService.test.ts -t "falls back to the project costBudgetUsd"`
  Expected: FAIL — `fallback.costBudgetUsd` is `null`, not `7.5` (no project lookup yet).

- [ ] **Step 3: Implement**

  In `src/services/TaskService.ts`, in `create`:

  ```ts
    async create(input: CreateTaskInput): Promise<HydratedDocument<ITask>> {
      const project = this.projects?.getByContextId(input.contextRef.contextId)
      return Task.create({
        kind: input.kind,
        contextRef: input.contextRef,
        source: input.source,
        prompt: input.prompt,
        status: 'new',
        costBudgetUsd: input.costBudgetUsd ?? project?.costBudgetUsd ?? null,
        outputLanguage: input.outputLanguage,
        taskRepositories: input.repos.map((r) => ({
          projectPath: r.projectPath,
          pipelineJobTrackList: this.resolvePipelineJobTrackList(r.projectPath),
          processedNoteIds: [],
          processedJobIds: [],
        })),
      })
    }
  ```

  (`createForgeEvent` at lines 67-86 is intentionally **not** touched — the spec scopes the fallback to `create()` only.)

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/services/TaskService.test.ts --reporter=verbose`
  Expected: PASS (all pre-existing tests + 2 new).

- [ ] **Step 5: Run the full suite + type-check**

  Run: `npm run type-check && npx vitest run --reporter=dot`
  Expected: `Tests 401 passed (401)`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/services/TaskService.ts tests/services/TaskService.test.ts
  git commit -m "feat(nerv): fall back to the project's costBudgetUsd when a task omits one"
  ```

  **Component D is complete — FU5a nerv-side work (Components B, C, D) is fully implemented, tested, and green (401 tests, up from the 378 baseline).**

---

## Self-review notes (already applied above)

- **Spec coverage:** Component B → Tasks 1-2. Component C → Tasks 3-8 (helper + all 5 dispatch sites individually, per the task brief's "may split per-handler if large"). Component D → Tasks 9-10 (transparency/warn + fallback). All 4 "Testing strategy" bullets for nerv in the spec have a corresponding test in this plan.
- **No placeholders:** every step above has complete, real code — no `// TODO`, no "similar to Task N" hand-waving; each handler's gate insertion shows the exact surrounding unchanged lines so an executor can locate the splice point unambiguously.
- **Type/name consistency:** `isOverBudget(task)` and `applyCostCapBreach(task, magi, papai)` signatures are identical across Tasks 3-8; the pricing call is `calculateCost(usage, task.resolvedModel)` everywhere it appears (Task 2); the field is `usageUsd` (never `usage_usd`/`costUsd`) throughout; the new Task field is `resolvedModel` (not `model`, which was caught as a real Mongoose `Document.model()` name collision during verification — see resolved fact #3).
- **Fixed inline during drafting:** the spec's assumption that pricing reads `task.model` was corrected to `task.resolvedModel` after discovering (via real edit + `tsc`) both that no `model` field exists on `ITask` and that `model` is an illegal field name on a Mongoose document.

## Spec ambiguity to flag to the user

- The spec's Component B/assumption text says "price the usage via `domain/cost.ts` `calculateCost(usage, task.model)`" and asks to "confirm the model source is `task.model`." **`task.model` does not exist** — this plan introduces `Task.resolvedModel` (Task 1) as the closest faithful equivalent (snapshotted from the exact same 3-way fallback formula already used to build magi's `projectSpec.model`), but this is a plan-level design decision filling a real gap in the spec's premise, not a verbatim reading of it. Flag for confirmation before/while executing Task 1.
- Component A (magi) is out of scope for this plan (per the task brief) — until magi actually threads `response.usage` up to its `/notify` push (spec's Component A), Tasks 2-8 here are inert-but-correct plumbing: `/notify` pushes without a `usage` field remain a no-op for `usageUsd` accumulation (explicitly tested in Task 2), so the cap simply never trips until magi's side ships. This matches the spec's own "Feasibility risk" section and decision 5 (graceful degradation), not a defect in this plan.
