# Design — sdd-runner-decomposition (part 2 of 3)

## Context

See `proposal.md` for motivation and scope (tasks 2.3, 4.1–4.3, 5.1–5.4). Part 1 landed the full data layer this part consumes — verified in code, not just in the part-1 docs:

- `plan.ts` exports `PlanSchema`/`validatePlan`/`topoSortChildren`/`planDigest`/`materializeChildFiles` (injected fs seam, wholesale rewrite with stale unlink).
- `config.ts` has the `planner` role, `PLAN_REPLAN_PASSES = 1`, `slugify`; the five-key strict config is untouched.
- `event-schemas.ts` carries `GateEvent.mode ∈ {early, final, plan}`, `plan` (childCount + digest), `child_spawned` (child), `child_done` (child + `done|failed`); `replay.ts` folds them, resetting `children` on every `plan` event with ids materializing on first mention.
- `run-state.ts` accepts optional `plan`/`children`; `deriveResumePoint` returns the next not-done child (stage `decompose`, reason `children pending: …`) after the gate-pending check.

Current-state constraints that shape this design:

- `runIntake` (`intake.ts:78`) calls `driver.newChange` **before** spawning the estimator, so the oversize verdict cannot precede scaffolding without reordering; the single branch's scaffold must stay byte-identical in content.
- The gate grammar (`gate-model.ts`) routes checkbox rows by membership against declared ids, but the row regexes are prefix-tabled (`[AF]\d+`, `T\d+`, `B\d+`); `gate-answers.ts` renders exactly what the parser accepts (write-then-parse self-check), and `decisionConsequences` (`gate-render.ts`) is the single source shared by file and TUI front-ends.
- The policy ladder (`auto-policy.ts`) evaluates only early/final; `r4FailsClosed` is the budget guard; `presentGateAt` (`gate-digest.ts:93`) settles/extends only on `final`/`early` plans from the ladder.
- `runGateResume` (`extend-round.ts`) narrows `state.gate.mode` through `narrowGateMode`, which **throws** on `'plan'` — the part-1 guard this part replaces. `resumeGate` (`gate.ts`) emits its `answered` events with a hard-coded `mode: 'final'` (an existing early-gate quirk, pinned by tests — left byte-identical; new plan paths emit the true mode).
- `resumeFromPoint` (`resume-flow.ts:85`) routes any `decompose` decision into the single-run post-convergence tail — a parent's children-pending decision must be intercepted before it. `deriveResumeDecision` calls `driver.status(changeName)`, which a change-folder-less parent must tolerate.
- `orchestrator.ts` is 297 lines and `oxc/no-barrel-file`/`import/no-cycle` are errors; calm-stop is marker-file based (`stop-controller.ts`), and `settleStoppedResult` is the shared stopped-settlement tail.
- Repo rules: DI-first testing, no lint-disable/type-ignore, `.js` import extensions, max-lines as a design signal, and the Write/Edit TDD hook mapping `sdd-runner/src/<x>.ts` → `tests/sdd-runner/<x>.test.ts` (`.hooks/tdd/test-resolver.mjs`).

## Goals / Non-Goals

**Goals:**

- The end-to-end composite path: oversize verdict at intake → planner draft → plan gate → sequential nested child runs → parent completion over a fully-completed subtree, all resumable and fully recorded in the parent's append-only event log.
- Every single-run surface byte-identical where the proposal pins it: intake result, scaffolded change folder, gate files, orchestration output, and every event line a non-plan run emits.
- Hermetic tests: the planner spawn, the child-run execution, and all fs go through injected seams (`runStageAgent` deps, `runChildRun`, `PlanFsDeps`).

**Non-Goals:**

- Tree-aware routing (`continue` descending into a child gate, run-id prefix resolution across the tree), claim-holder exclusivity for externally resumed children, tree-shaped reports and live views — part 3. Part 2 only *surfaces* the active child's run id.
- A TUI plan-gate session: the plan gate is decided through the gate-file protocol and the decision flags, exactly like a non-TTY gate today; the interactive session keeps `early`/`final` views until part 3's tree view.
- Chat-bot surfaces: no chat tool is added, so capability gating and `tool_prefs` are untouched (`sdd-runner/` is an offline workspace, not the bot).
- **Scope model:** no new persisted state is keyed by storage context, config context, platform instance, or user — everything lives under the sdd-runner workdir keyed by run id (`runs/<parent>/children/*.md`, `plan.json` sidecar, `state.plan`/`state.children`, parent `events.ndjson`).
- **DB:** no drizzle migration, no backfill — SQLite is untouched.

## Decisions

### D1 — Oversize verdict: carried by the estimator sidecar, recorded before scaffolding

`DepthClassificationSchema` gains `oversize: z.boolean().optional()` (undefined reads false — old sidecars parse unchanged), the estimator prompt teaches the field, and the `depth` event gains a matching optional `oversize` field (the additive `done.model` precedent). The verdict is thereby derived from the task description alone (the estimator is read-only over the task text), recorded in state and log before any scaffolding: `driver.newChange` **moves into the single branch, after the estimator** — folder contents byte-identical, only creation timing shifts. In run state, `state.plan` presence is the durable `true`; a single run's `false` reconstructs from the `depth` line plus the absence of a `plan` event. Proposal-phrase mapping: "`{ kind: 'plan' }` when the planner sidecar says oversize" is realized as *the intake-stage sidecar carries the verdict; the planner sidecar then drafts* — the planner spawn keeps `PlanSchema` as `outputSchema` exactly as the proposal pins, which a bare plan sidecar could not do if it also had to encode "not oversize". Alternatives rejected: a dedicated planner-verdict spawn before drafting (one extra agent spawn on **every** run, including single ones, to produce a boolean the estimator can carry for free); a deterministic keyword prescreen (no insight into declared scope, and a misroute has no recourse).

### D2 — `runIntake` returns a union; the single branch is today's path verbatim

```ts
type IntakeOutcome =
  | { kind: 'single'; changeName; depth; disagreement }   // byte-identical fields
  | { kind: 'plan'; children: PlanChild[] }               // topo-ordered, validated
```

`--depth` override returns the single shape before the oracle is ever consulted (today's early return, unchanged). Non-oversize: scaffold (newChange, moved per D1) and return single. Oversize: draft via D3 and return the plan — no change folder is created for the parent, ever.

### D3 — Planner spawn and the structural replan loop

`runPlanner(deps, { taskText, redirects?, runDir, sidecarDir })` (in `intake.ts`, reused by the veto loop): `runStageAgent` with role `planner`, `outputPath: 'plan.json'`, `outputSchema: PlanSchema`. JSON-shape failures are already retried inside `runStageAgent` (`MAX_VALIDATION_ATTEMPTS`); structural failures from `validatePlan`/`topoSortChildren` run **after** the spawn, so the replan loop wraps them: append the validation-error text to the prompt and respawn, bounded by `PLAN_REPLAN_PASSES`, then fail loudly naming the structural errors. The current plan always lives at `sidecars/plan.json` — the single source the plan gate re-reads on resume and re-presentation.

### D4 — Plan-gate grammar: synthetic `C<n>` rows, membership-routed

One checkbox per child, id `C<n>` with n = the 1-based topo index (stable across re-presents of the same plan, matching the `<n>-<slug>.md` numbering), row text `<child-id> — <instruction first line>` plus deps/capabilities. `ExpectedGateContent` gains optional `children: readonly { id; text }[]`; the row regexes gain `C\d+` and route through the same declared-id membership set as assumptions/findings — never by prefix alone (the existing doctrine comment). Approve = every C-box checked; an unchecked C-box is a veto for that child, optional `→ <redirect>` beneath; `ABORT` aborts the parent; `→ RUN 1 MORE` is rejected at plan mode (the parser already rejects it outside `'early'` — message generalized to name cap-hit-only). `gate-answers.ts` gains item kind `'child'` and renders the identical grammar, preserving the write-then-parse self-check (`renderAutoApproveAnswers` analog for plan rows). `decisionConsequences` widens to `'plan'`: approve — "executes the children sequentially as nested runs in plan order"; veto — "revises the plan once with the redirects, then re-gates"; extend — `null`; abort — "aborts the parent before any child runs".

### D5 — Plan-gate prelude: R4 only, never settle, never extend

`presentGateAt` widens its mode parameter to `'early' | 'final' | 'plan'`. For `'plan'` it runs a new `evaluatePlanGate(signals)` in `auto-policy.ts`: `r4FailsClosed(signals) ?? gateDecision('none', …)` — the budget guard stays, every other rung is skipped, and no rule can approve or extend in part 2 (the spec's "ladder MAY settle" stays permissive for part 3). Projection for the guard: `spent + childCount × DEFAULT_ROUND_COST_USD` (the established conservative-constant precedent). A fired R4 still writes the preview block, `auto-policy.jsonl` line, and `auto_decision` event via the existing `writePresentedRecord` path — decided-by attribution for free. The auto paths in `gate-settle.ts` are pinned to refuse plan mode.

### D6 — Plan-gate veto loop mirrors `settleVeto`, one re-plan per round, unbounded rounds

Veto round: `settlePlanVeto` (in `gate-resume-tail.ts`, beside `settleVeto`) re-runs `runPlanner` with the round's redirects appended, re-validates (D3 loop), re-materializes wholesale (landed stale-unlink semantics), emits a fresh `plan` event — which is exactly why part 1's replay fold resets `children` on `plan` — sets `state.plan` to the new childIds/digest, and re-presents at `gate-<n+1>.md` with `skipPolicy: true` (the settled round never re-runs the ladder), mirroring `settleVeto`. Rounds are unbounded; approve and `ABORT` are the only terminals; `ABORT` → `finalizeGate(deps, state, 'aborted', version)` before any child exists.

### D7 — New module `children.ts` with an injected `runChildRun` seam

Checked for coverage first: `plan.ts` is the data layer, `orchestrator.ts` the single-run control flow, `gate-resume-tail.ts`/`extend-round.ts` gate settles — nothing owns a sequential nested-run loop, and `orchestrator.ts` at 297 lines cannot absorb it (max-lines doctrine). New `sdd-runner/src/children.ts` exports `runPlanBranch` (materialize → `plan` event → `state.plan` → present plan gate) and `runChildren` (the execution loop), both taking `runChildRun` injected — default `(child) => runStart(deps, { taskFile })` supplied by the orchestrator side, so the dependency arrow is one-way (`orchestrator` → `children`) and `import/no-cycle` holds without a dynamic import. The TDD hook therefore adds `tests/sdd-runner/children.test.ts` to the proposal's test list — a stated addition, not a scope change.

### D8 — Sequential topo execution and event bookkeeping

`runChildren` walks `state.plan.childIds` (already topo-ordered). Per child: skip when `state.children[id].status === 'done'` (resume never re-runs a completed child); check the parent's calm-stop seam (D11); check the aggregate ledger (D10); emit `child_spawned { child, runId }` and await `runChildRun`. The nested `runStart` always halts at the child's own gate, so the loop's terminal observation reads the child's persisted `state.json`: completed → `child_done { child, outcome: 'done', usage }` with usage aggregated from the child's log; gate-pending → the parent records the child as `running`, prints the child's concrete `sdd <childRunId>` line, and returns with the parent `running` (the operator settles the child's gate, then resumes the parent, which skips forward); aborted/failed/stopped → `child_done { child, outcome: 'failed' }` and D9 applies. Two additive optional event fields are required and land with pins in `events.test.ts`: `child_spawned.runId` and `child_done.usage` (`AgentUsageSchema`, optional — old lines parse; absent usage makes the ledger fail closed per D10). This touches `event-schemas.ts` and `agent-layer.ts` (D1) beyond the proposal's file list — both additive-only, stated here.

### D9 — Failure and completion semantics

A child ending non-completed stops the loop immediately (sequential order preserved): the parent persists status `stopped` (halted but resumable, matching the spec's "Parent completion requires every child completed" verbatim) with an operator line naming the blocking child and its persisted status; resume continues at the next not-done child via the landed `deriveResumePoint` branch. Parent `completed` is set exactly when every `state.plan.childIds` entry reads `done`. The parent never calls `driver.newChange`, so it owns no change folder at any status. `runResume` intercepts parent states (a `plan` with pending children) **before** `resumeFromPoint` (which would misroute the `decompose` decision into the single-run tail) and drives `runChildren` instead; `deriveResumeDecision`'s `driver.status` call tolerates the parent's absent change folder.

### D10 — Aggregate budget ledger fails closed

`treeSpend(parentLog, resolve)` = `aggregateUsage(done events)` + Σ `child_done.usage`, with `costKnown = false` if any `child_done` lacks usage (fail closed: unknown counts against the budget, never as headroom). The ledger guards two places: (1) the plan gate's R4 (D5) before any child spend; (2) the loop before each `child_spawned` — if `treeSpend` is unknown or crosses `config.budget`, the loop halts for a human decision (parent `stopped`, loud line naming the guard; the operator raises `budget` and resumes, or aborts). Tree-wide reach into child decisions: the parent passes its committed spend as a `spendBaselineUsd` into the nested run (additive optional on the child-run input, default 0 for top-level runs), and the child's own R4 guard adds the baseline before comparing — so an auto-decide inside a child sees parent + prior children against the single budget, exactly the spec's scenario.

### D11 — Parent calm-stop is subtree-scoped

The parent's stop seam watches its own marker file while a child is in flight; on request it writes the **child's** stop marker (`requestCalmStop(childRunDir)`), the child honors it at its next stage/round boundary (its own in-process seam), the parent then consumes its own marker and settles through the existing `settleStoppedResult` tail — both nodes individually resumable, no completed child touched.

### D12 — Plan-gate resume wiring replaces the `narrowGateMode` throw

`runGateResume` for `mode: 'plan'`: expected content built from `sidecars/plan.json` + `state.plan`; decision surfaces are the hand-edited file and the decision flags (`--abort`, `--confirm-all`, `--vetoes`), desugared through the D4 render-then-parse functions — the interactive TUI session keeps early/final views (part 3 widens it). Approve → `settleApprovedGate`'s plan branch → `runChildren`; veto → D6; abort → `finalizeGate('aborted')`; extend → unreachable (parser rejects first). New `answered` events carry `mode: 'plan'`; the existing hard-coded `'final'` quirk on early-gate answers is left byte-identical (pinned).

### D13 — No new dependencies

Zod covers the schema growth; `node:fs`/`node:crypto` the rest; nothing in the installed or chat-side stack is implicated.

## Hook / TDD interaction

Every implementation file is hook-gated to `tests/sdd-runner/<x>.test.ts`. Red-first order, one task per green step (matching tasks 2.3, 4.1–4.3, 5.1–5.4):

1. `agent-layer.test.ts` + `events.test.ts` red (optional `oversize`, `child_spawned.runId`, `child_done.usage`; old shapes parse) → schemas green.
2. `intake.test.ts` red (union return; single branch byte-identical incl. scaffold-after-verdict ordering; override skips the oracle; planner spawn + replan bound + loud failure; no scaffold on plan) → `intake.ts` green (D1–D3).
3. `gate-model.test.ts` / `gate-answers.test.ts` / `gate-render.test.ts` red (C-rows membership routing, redirect capture, RUN rejection at plan, render-then-parse self-check, `decisionConsequences('plan')`, single-run gate bytes pinned) → green (D4).
4. `gate-prelude.test.ts` / `gate-settle.test.ts` / `gate-digest.test.ts` red (`evaluatePlanGate` R4-only projection; auto paths refuse plan; `presentGateAt` plan mode presents, never settles/extends) → green (D5).
5. `children.test.ts` red (topo order, skip-done, sequential single-flight, gate-pending child surfaces and returns, failure → parent `stopped`, all-children-done → `completed`, budget halt, calm-stop propagation — all through fake `runChildRun`/fs) → `children.ts` green (D7–D11).
6. `orchestrator.test.ts` red (plan branch after intake; parent resume interception; gate-resume plan outcomes via `gate-resume-tail`/`extend-round`) → green (D6, D9, D12).

Edit loop `bun run test:affected` plus direct runs of touched files; one full `bun run test`, `typecheck`, `lint` before finishing.

## Risks / Trade-offs

- [D1 deviates from the proposal's "planner sidecar says oversize" phrasing] → the mapping is stated (verdict on the intake sidecar, `PlanSchema`-as-outputSchema preserved verbatim); if a maintainer prefers a dedicated verdict spawn, it swaps the oracle behind the same `IntakeOutcome` union — a local change.
- [Moving `newChange` after the estimator changes failure-mode ordering — a failed estimator no longer leaves a scaffolded empty folder] → closer to the spec's verdict-before-scaffolding scenario; folder contents identical on success; pinned by tests.
- [Additive event/schema fields (`oversize`, `runId`, `usage`) grow the surface beyond the proposal's file list] → all optional, old lines/files parse (pinned); writers and readers ship in the same repo.
- [Parent observes child `state.json` written by another process] → read-only, tolerant parsing: an unloadable child state counts as not-done (fail closed, never silently completed).
- [Sequential nesting multiplies operator gate round-trips — every child gate pauses the tree] → part 2 always prints the active child's concrete `sdd <childRunId>` line; part 3's tree-aware routing is the declared fix.
- [No child-count cap (maintainer revision 1) means large plans pause often and spend long] → the D10 ledger halts before each spawn at the budget; the plan gate shows every child up front and ABORT is always available.
- [Projection constant in the plan-gate R4 may mis-estimate] → conservative-direction default (`DEFAULT_ROUND_COST_USD` precedent); exceedance falls back to a human, the safe side.
- [The proposal's tick targets (2.3, 4.1–4.3, 5.1–5.4 in the part-1 folder's `tasks.md`) don't exist under that numbering today] → this change's own `tasks.md` carries the authoritative list; the part-1 folder's checkboxes are ticked by cross-reference as each task lands, or renumbered in the same commit — an artifact bookkeeping step, not a design unknown.

## Migration Plan

No database, no deploy step; the change rides branch `agent/issue-331` as commit `sdd-runner-decomposition(2/3)`. Single-run output, gate files, and event lines are byte-identical (pinned), `PersistedRunStateSchema` is untouched (part 1 already carries `plan`/`children`), so pre-part-2 runs and state files resume identically. New on-disk shapes appear only when a composite run actually executes (`sidecars/plan.json`, `children/*.md`, plan gates, plan/child events). Rollback is reverting the commit: a half-executed parent left behind resumes under the old code as a plain non-plan run (its `plan`/`children` fields are optional and ignored), and child runs are ordinary top-level runs.
