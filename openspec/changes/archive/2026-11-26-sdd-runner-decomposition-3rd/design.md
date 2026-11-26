# Design — sdd-runner-decomposition (part 3 of 3)

## Context

See `proposal.md` for motivation and scope (tasks 6.1–6.2, 7.1, 8.1–8.3, 9.1 of the part-1 folder's decomposition). Sessions 1–2 landed everything this part builds on — verified in code, not just in their docs:

- `children.ts` owns `runPlanBranch` (materialize → `plan` event → `state.plan`/`children` → plan gate) and `runChildren` (sequential topo walk, skip-done, `resumeHandleOf` re-observation, D10 budget guard, gate-pending child surfacing). `child-spawn.ts` derives a child's concrete runId from the parent's `child_spawned` lines (`lastSpawnedHandleOf`/`openFlightHandleOf`) — the persisted `children` records carry only `{ status }`, no runId, deliberately.
- `plan-resume.ts` intercepts plan-parent resumes ahead of `resumeFromPoint` and re-presents an unanswered plan gate fail-closed. Child runs are ordinary top-level dirs under `runs/`, so `resolveRunId`'s exact/prefix/ambiguity logic is already tree-total.
- `cli-routing.ts`/`run-index.ts` route by per-run `state.json` alone; `continue.ts`'s multi-pending listing omits the gate mode; `routeByState` sends a gate-null running parent to a blind `resume`.
- `post-review-tail.ts` is the shared tail: decompose → atomicity (depth ≠ S) → final gate. `runDecompose` (`decompose.ts`) returns `void` and `DecomposeReportSchema` is `{ tasks_file }` only.
- `renderer.ts` `formatEvent` has no branch for `plan`/`child_spawned`/`child_done` (they render as `null` — composite non-TTY output prints nothing for tree events today); `run-view.ts` renders no children; `report.ts` has no children section and unconditionally renders `### Tasks` from a change folder a parent does not own.
- `tui-gate-session.ts` carries a **local** `expectedContent` (line ~126) that omits `children`, while `gate-session.ts`'s identical-looking helper maps them — a TUI plan-gate settle would fail its own write-then-parse self-check today. `GateSessionItem.kind` already includes `'child'`; `gate-session-state.ts` toggles items generically; the `e` (extend) key is already early-only.
- Repo rules that bind: the Write/Edit TDD hook maps `sdd-runner/src/<x>.ts` → `tests/sdd-runner/<x>.test.ts` (`.hooks/tdd/test-resolver.mjs`); DI-first testing; no lint-disable/type-ignore; `.js` import extensions; max-lines as a design signal; the frozen non-TTY byte contract permits exactly the tree event lines on composite runs.

## Goals / Non-Goals

**Goals:**

- Composite runs operable end to end: `continue`/routing descend into a gate-pending descendant with its concrete `sdd <runId>` line; discovery surfaces (gate listing, sole-candidate routing) see plan gates and active child runs; a decompose-stage `needs_split` verdict converts the run into a plan parent before any further stage spend; live views and reports render the tree with repriced subtree costs; the plan gate is decidable from the interactive TUI.
- Single-change runs stay byte-identical everywhere the part-1/2 pins and the frozen non-TTY contract require: renderer/report/gate bytes, `resolveRunId` semantics, `continue`'s non-parent routing.
- Old artifacts parse unchanged: decompose sidecars without `needs_split`, plans without per-child `changeName`, single-run logs folding as today.

**Non-Goals:**

- No revisit of landed scope: intake oversize verdict, plan-gate grammar/prelude/settle, sequential child execution, budget ledger, subtree calm-stop are consumed, not reworked.
- Chat-bot surfaces: no chat tool is added, so capability gating and `tool_prefs` are untouched (`sdd-runner/` is an offline workspace, not the bot).
- **Scope model:** no new persisted state keyed by storage context, config context, platform instance, or user — everything new persists under the sdd-runner workdir keyed by **run id** (parent `state.plan`/`children`, spawn lines in the parent log, child task files, decomposer sidecars).
- **DB:** no drizzle migration, no backfill — SQLite is untouched.

## Decisions

### D1 — Tree discovery lives in `run-index.ts`; descent lives in `resume-flow.ts`; no new module

Checked for coverage first: `run-index.ts` is the only module that scans `runs/` cross-run (listing, lite states, id resolution); `resume-flow.ts` owns resume-point derivation; `child-spawn.ts` derives per-child runIds but from a single parent state, not across the index. A shared `descendantGateOf(workDir, state)` in `run-index.ts` — for each child record reading `running`, resolve its runId through the parent's log (`lastSpawnedHandleOf`), load the child's state, recurse into grandchildren — serves both 6.1 and 6.2 without duplication (the repo runs a duplicates gate). `resume-flow.ts` gains the deeper resolver: starting at the target run, descend while the next action lives in a descendant, returning the **deepest** gate-pending runId or `null` (= plain parent resume). A visited-set guards malformed cyclic state. Alternatives rejected: a new `tree-routing.ts` (nothing else needs it; two files own the concern today); widening the persisted `children` records with a runId field (a second source of truth for what the append-only log already settles — part 2's crash windows made the log authoritative, and `resumeHandleOf` exists precisely because the record alone is not).

### D2 — Descent rule: gate-pending descendant wins over parent resume; skip-forward covers the rest

`continue.ts` resolves the id, then consults the resolver **before** the generic branches: a gate-pending descendant routes to that child's `runGateResume` (the child's decision flow — interactive session on a TTY, hand-edited file otherwise) with the child's concrete `sdd <childRunId>` line; no in-flight descendant falls through to the existing `runResume` → `runChildren` skip-forward at the next not-done child, exactly as landed. `runResume`'s plan-parent interception threads `childRunId` through its `gate-pending` result (the `RunChildrenResult` already carries it; `PlanResumeResult` drops it today — a stated one-field addition) so every caller can route. `resolveRunId` is untouched — child runs are top-level, so exact/prefix/ambiguous behavior is already tree-correct and gets pinned, not changed.

### D3 — Discovery surfaces: mode in every listing line; parents route to their active child

`listPendingGates` already carries `gateMode` (widened in part 1); the remaining gap is the printed lines — `continue.ts`'s multi-pending listing gains the mode beside the version, matching `routeBySoleCandidate`'s existing `gate <mode> v<n>` hint. `routeByState` and the sole-candidate paths consult D1's `descendantGateOf` for gate-null parents: an active gate-pending child routes to `{ kind: 'gate', runId: childRunId }` instead of a blind parent resume. Ambiguous tree-member prefixes keep failing loudly (D2 pin). Alternatives rejected: filtering parents out of the interrupted set (a stopped parent is still the resumable unit when no child is pending — hiding it strands the tree).

### D4 — `needs_split`: optional report field, prompt-scoped tasks.md, report returned

`DecomposeReportSchema` gains `needs_split: z.boolean().optional()` (undefined reads false — old sidecars parse; the additive `oversize` precedent), and the decomposer prompt teaches the contract: when the change cannot land as one atomic-shippable change, set `needs_split: true` and write `tasks.md` scoped to the **first slice only** — that re-scope is "the current change is re-scoped to child #1"; the siblings' scope stays out of the file. `runDecompose` returns the parsed report instead of `void` (the tail needs the verdict). Alternatives rejected: a separate split-proposal sidecar (a second artifact to validate for information the report field carries); letting the planner re-scope tasks.md (it holds the plan, not the change folder).

### D5 — Conversion happens in the tail, through the landed `runPlanner` and `runPlanBranch`

`runPostConvergenceTail` diverts **between decompose and atomicity** — "before any further stage spend" is literal: no atomicity spawn, no final gate, until the plan gate settles. The diversion: (1) `runPlanner` (imported from `intake.js`, unchanged) drafts the family plan; the re-entry input is a composed task text embedding the original task, the existing change name, its drafted-artifact summary, and the re-scoped tasks.md — child #1 is pinned as the existing change, the siblings partition the remainder. Routing this through the existing `PlannerOptions.taskText` keeps the replan bound, `PlanSchema` output contract, and `sidecars/plan.json` promotion intact with zero intake changes. (2) `runPlanBranch` then performs the conversion itself — `state.plan`/`state.children` seeding, `plan` event, plan-gate presentation (R4-only prelude) are the landed function's existing effects. Alternatives rejected: a dedicated split prompt seam in `intake.ts` (more surface for one caller); presenting the plan gate *after* atomicity (spends stage budget the split is about to reassign); a bespoke half-conversion that skips `runPlanBranch` (duplicates its seeding/persisting contract).

### D6 — Child #1 adopts the change folder via a continuation start

The conversion must make "its change folder and drafted artifacts become child #1's" true at execution time. Mechanics: `PlanChildSchema` gains optional `changeName: z.string().min(1)` (additive — old plans parse; `validatePlan` adds no structural rule for it). The `RunChildRun` seam already receives the full `PlanChild`, but today's suppliers discard it (`plan-resume.ts`'s and `gate-resume-entry.ts`'s wrappers forward only `taskFile`/`spendBaselineUsd` — stated pass-through fixes). When a child carries `changeName`, the orchestrator-side starter uses a **continuation start**: a nested run that skips intake/draft/review (the artifacts are already drafted and review-settled — re-drafting would burn the parent's review spend and overwrite reviewed files), inherits the parent's depth, and enters the shared post-convergence tail at atomicity, using an adopted-review **surrogate** for the final-gate digest (the `PLAN_REVIEW_SURROGATE` pattern — the review evidence legitimately lives in the parent's log, and the child's gate digest shows its own task progress and costs). The session-id allocator gives the child run the next free `<slug>-<n>` (the parent holds the bare slug while non-terminal) while `changeName` keeps pointing at the existing folder. Ledger consequence: the draft/review spend stays booked in the parent's own done events, and `child_done.usage` aggregates only the child's log — no double count, nothing lost. Alternatives rejected: an ordinary fresh nested `runStart` over the task file (its intake would `newChange`-collide with the existing folder and its draft/review stages would re-run); the parent executing child #1 in place (breaks per-child event log/ownership and double-books the ledger); renaming the folder to a new child name (session-id collision for no benefit).

### D7 — Renderer: three tree-event lines, composite-only by construction

`formatEvent` gains branches: `plan` → a `plan: <n> children (<digest>)` line, `child_spawned` → `child <id> spawned (run <runId>)`, `child_done` → `child <id> <outcome>`. These are the only permitted non-TTY additions on composite runs per the frozen byte contract; single-change runs never emit the events, so their byte stream is unchanged by construction — and pinned anyway (the pins, not the construction, are the contract). Alternatives rejected: rendering child rows into the pipeline map (`renderPipelineMap` shape is stage-keyed; `StageIdSchema` is pinned unchanged).

### D8 — Run-view children section from the replay fold

`run-view.ts` renders a `## Children` block from `ReplayState.children` (landed fold) — one `<child-id> <status>` line per entry, the first non-`pending`/non-`done` child marking the active node — omitted entirely when the fold is empty, so single-run screens are unchanged. The TUI is the dynamic surface, so this addition needs no byte-contract carve-out. Alternatives rejected: deriving rows from slots (slots are per-agent, per-flight, and lose the plan order).

### D9 — Report children section through the existing reprice path

`report.ts` gains a children section for parents (`state.plan` present): one row per child — child id, latest spawn's runId (the flight that produced the current status), status (live child `state.json`, falling back to the parent's `children` record when unloadable), and cost via `childUsageOf` (already subtree-shaped per the D10 ledger doc); a subtree total row from `treeSpend` over the parent's repriced events. Unknown cost renders the established `unknown` marker — fail-closed display, never `$0.00`. The parent reports **no** `### Tasks` section: it owns no change folder or task list to count (the MODIFIED early-gate requirement's "no parent-owned change directory or task list"); depth/review/gains/commits sections stay as today (children commit on the same branch). Alternatives rejected: reading child costs from the parent's `child_done.usage` alone (unsettled flights and pre-adoption flips would read as absent instead of unknown).

### D10 — Plan-gate TUI: fix the self-check gap, reuse assumption checkbox semantics

The child rows already flow as `GateSessionItem { kind: 'child' }` through `gate-session.ts`'s expected content, the generic toggle/redirect machinery, and `gateAnswersFromToggles`' anyDeclined → veto mapping. Two changes close the gap: (1) `tui-gate-session.ts`'s **local** `expectedContent` duplicate is deleted in favor of the children-aware one it mirrors in `gate-session.ts` (duplicates gate + the actual self-check bug); (2) behavior pins land in `tui-gate.test.ts`/`tui-gate-session.test.ts`: toggle = checked; unchecked child + `a` settles a **veto** with the collected inline redirect (the proposal's "approve unavailable until every child is checked" is the outcome-level statement — approve is the settled decision only when every C-row is checked, exactly the assumption semantics, since hard-blocking `a` would orphan the veto decision in the TUI and diverge from the file protocol); `e` already refuses at plan mode; the write-then-parse self-check guards the settle. No other plan-specific TUI affordances. Alternatives rejected: a plan-specific keymap or a per-child veto key (new affordance for existing mechanics).

### D11 — No new module, no new dependency

Every task lands in an existing file; the only files beyond the proposal's list are the stated additions above (`plan.ts` optional `changeName`, `plan-resume.ts`/`gate-resume-entry.ts` child pass-through + one result field, `orchestrator.ts` continuation start). Zod covers the schema growth; the tree math reuses `usage-aggregate.ts`; discovery reuses `run-index.ts` + `child-spawn.ts`. Nothing in the installed or chat-side stack (AI SDK, Grammy, discord.js, drizzle — none imported here) is implicated.

## Hook / TDD interaction

Every implementation file is hook-gated to `tests/sdd-runner/<x>.test.ts`. Red-first order, one task per green step (matching the proposal's Verify commands):

1. `continue.test.ts` + `resume-flow.test.ts` red (descent into a gate-pending child with its concrete line; no-descendant skip-forward unchanged; non-parent routing byte-identical; `resolveRunId` semantics pinned) → D1–D2 green (task 6.1).
2. `run-index.test.ts` + `cli-routing.test.ts` red (`descendantGateOf` discovery from persisted records + spawn lines; mode-bearing listing lines; parent → child gate routing; ambiguous tree prefixes fail loudly) → D3 green (task 6.2).
3. `decompose.test.ts` + `post-review-tail.test.ts` red (old sidecars parse; `needs_split` prompt contract; report returned; diversion before atomicity; planner re-entry; `runPlanBranch` conversion; continuation start for the `changeName`-carrying child; single-run tail byte-identical) → D4–D6 green (task 7.1).
4. `renderer.test.ts` + `run-view.test.ts` red (three tree lines; single-run bytes pinned; children block from the fold) → D7–D8 green (task 8.1).
5. `report.test.ts` red (children rows, subtree total, unknown marker, no Tasks section for parents; single-run report byte-identical) → D9 green (task 8.2).
6. `tui-gate.test.ts` + `tui-gate-session.test.ts` red (child-row toggles, redirect input, all-checked → approve, unchecked → veto, `e` refused, self-check through the shared expected content) → D10 green (task 8.3).
7. `docs/architecture/sdd-pipeline.md` update (task 9.1) — not hook-gated; lands with the final gate.

Edit loop: `bun run test:affected` plus direct runs of touched files. This session owns the final gate: one full `bun run test` (≥20 min timeout, never two concurrent), `bun run typecheck`, `bun run lint`, then the commit `sdd-runner-decomposition(3/3)` for the Stryker ratchet to judge.

## Risks / Trade-offs

- [Descent reads the child's `state.json` written by another process] → read-only, tolerant parsing: an unloadable child state counts as no pending gate and the parent falls back to plain resume (fail-open here is safe — the parent resume re-surfaces the child line itself).
- [D6 continuation start skips the child's own review — a re-scoped change lands with the parent's review evidence only] → the artifacts were re-scoped by the decomposer before the split and the human signs off at both the plan gate (the split) and child #1's final gate (the task list); the surrogate digest names the adoption rather than fabricating review rounds.
- [D6's stated additions touch four files beyond the proposal's list] → all additive and mechanically forced by the seam's current child-discarding wrappers; named here and in the commit body.
- [`needs_split` misfires on a change that was actually fine] → the plan gate is the backstop: the operator sees child #1 (the existing change) plus siblings and can ABORT before any spend; a veto round re-plans, exactly like an intake split.
- [Renderer additions could leak into single-run output] → the events cannot occur on single runs, and the single-run byte pins fail loudly if the branches ever misfire.
- [Report cost rows for unfinished children read partial] → by design — the section reports per-node status honestly; unknown/unpriced renders the fail-closed marker, never zero.
- [Part 3 changes TUI/report surfaces the part-2 mutation floor already covers] → the ratchet judges the combined branch diff; per-file exhaustive pure-function tests (the fold, the resolver, the rows) keep the measurable surface cheap.

## Migration Plan

No database, no deploy step; the change rides branch `agent/issue-331` as commit `sdd-runner-decomposition(3/3)` on top of session 2. Old decompose sidecars and plans parse unchanged (pinned); single-run bytes, gate files, and routing semantics are pinned identical; no existing run directory changes shape until a composite run or a `needs_split` conversion actually executes. Rollback is reverting the commit: pre-part-3 runs resume identically, and a run converted by part-3 code left behind resumes under old code as a plain plan parent (its `plan`/`children` fields are optional and already understood by part-2 code — only the `changeName`-carrying child's continuation nuance degrades to a normal child spawn over the same task file, which the operator re-routes by hand).
