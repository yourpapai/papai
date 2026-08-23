# Design: sdd-runner-decomposition

See proposal.md for motivation (single-change collapse of oversized tasks) and scope; see
`specs/sdd-runner-decomposition/spec.md` for the normative requirements. This doc covers how the
runner recognizes, plans, gates, and executes a decomposition tree.

## Context

Today one run = one OpenSpec change. The fixed stage spine lives in `sdd-runner/src/events.ts`
(`STAGE_ORDER = intake → draft → review → decompose → atomicity → gate`); `orchestrator.ts`
(`runStart`/`runResume`) drives it through `stage-machine.ts`, persists per-node state to
`runs/<id>/state.json` (`run-state.ts`, Zod schema — plain-object parse, unknown keys strip silently; only the runner config is strict), and appends everything to an
append-only, replay-sufficient `events.ndjson` (discriminated-union event schema). Intake
(`intake.ts`) classifies exactly one axis — the S/M/L depth profile — from a keyword prescreen plus
one estimator spawn. Splitting exists only *within* a change (`decompose.ts` writes `tasks.md`;
atomicity rewrites it); nothing creates additional changes or runs. Gates are versioned
`gate-<n>.md` files with modes `early|final`; the pure decision ladder (`auto-policy.ts`, R1–R5)
reads `PolicySignals.spentUsd` for the single configured `budget`; routing is a single verb
(`continue.ts`) over flat `runs/` directories; calm stop is a marker file per run dir.

Constraints that shape the approach:

- **Runner-only operator tooling.** No chat surfaces, no tool registry changes.
  - *Tool-prefs/capability gating impact:* none — no new tool enters `src/tools` assembly or any
    `tool_prefs` surface; the runner spawns agents via its own `opencode run` driver.
  - *Scope-model impact:* none — all new persisted state is keyed by **runId under the runner
    workDir** (`workDir/runs/<id>/`), not by storage-context, config-context, platform-instance, or
    user ids. Parent/child links are plain runId strings in state files.
  - *DB impact:* none — the runner has no drizzle schema. State evolution is additive Zod fields in
    `state.json` (optional with defaults), so existing rows parse unchanged and **no backfill is
    needed**: absent tree fields mean "legacy single run".
  - *Dependencies:* none added. Zod (schemas), `node:fs` (artifacts), and the existing spawn driver
    cover every need below.
- The five-key config is deliberately closed ("everything else is rejected at load time"); bounds
  should follow the `ROUND_CAPS` / compiled-timeouts precedent rather than grow config keys.
- Stage agents are confined by the diff guard to `openspec/changes/`; sidecar JSON reports flow
  through the established `runStageAgent` + `agentWritePath` seam regardless of destination.

## Goals / Non-Goals

**Goals:**

- Oversize as an independent intake axis recorded before any scaffolding, replay-reconstructible.
- A plan artifact whose semantic claims (coverage, no overlap) are emitted as *evidence* the runner
  can check mechanically — validation is arithmetic, not vibes.
- Plan approval through the existing gate file/TUI/ladder machinery, with per-child veto rounds
  (one revision pass per round, looping until approve/abort), before any child change folder exists.
- Bounded recursion: children are full pipeline runs (own stages, gates, budget view), executed
  sequentially, themselves decomposable up to a depth bound.
- Tree truth everywhere state is read: state.json, events, resume derivation, routing, cost
  aggregation, reports, live views — with zero observable change for non-oversized runs.

**Non-Goals:**

- Parallel child execution (sequential first; plan order keeps the door open).
- Detached/subprocess child processes — children execute in-process (Decision 6).
- Re-planning after the plan gate settles; steering stays veto/extend on the receiving run only.
- Merging child artifacts into a parent change folder — links and roll-ups only.
- New config keys — bounds are compiled constants (Decision 7).

## Decisions

### D1 — Oversize verdict: second axis of the existing estimator spawn

Extend `DepthClassificationSchema` (`agent-layer.ts`) with an `oversize` object: `{ verdict:
boolean, rationale: string, signals }`, where signals are mechanical markers the estimator justifies
from the task text (spans multiple independently-admissible capabilities, implies more than one
change's worth of tasks, contains parts usable/shippable in isolation). The keyword prescreen gains
a cheap oversize hint; disagreement between prescreen and estimator resolves **toward oversize**.

Why this shape:

- *Same spawn, not a second one* — the estimator already reads the whole task; oversize needs the
  same context. A separate spawn doubles latency/cost for no extra information.
- *Not decided post-draft* — the spec requires the verdict before any scaffolding side effect, and
  the proposal's whole point is that drafting a too-big change produces a bad change.
- *Disagreement toward oversize* — a missed decomposition silently degrades quality (the bug being
  fixed); a spurious one is caught cheaply at the plan gate before anything executes. Fail toward
  the visible failure.
- *`--depth` stays orthogonal* — the depth override shapes review intensity only; it never
  suppresses the oversize verdict (forcing S/M/L onto oversized work would reintroduce the problem).
  Concretely: today an override short-circuits intake before prescreen and estimator
  (`intake.ts` emits `source: 'override'` and returns); under this design the override replaces
  only the S/M/L result — override runs still execute the prescreen hint plus the estimator spawn
  for the oversize axis, accepting one added spawn on that path because a hint alone cannot carry
  the verdict and disagreement resolution needs both signals.

The verdict is emitted as a new L2 event (`oversize { verdict, rationale, source }`, with
`source ∈ {'prescreen', 'estimator'}` recording which signal produced the final verdict after
disagreement resolution — `'prescreen'` only when the hint's oversize wins over a negative
estimator verdict, `'estimator'` otherwise; there is no `'override'` value because the depth
override never suppresses this axis) and persisted
in state before `driver.newChange` is called — satisfying "recorded before any side effect" and
replay reconstruction. Non-oversized runs proceed through today's flow untouched.

Alternatives considered: keywords-only classification (too brittle for a branch this consequential);
an adversarial "is this too big?" reviewer after draft (violates the pre-scaffolding requirement);
always ask a human at intake (defeats autonomy the ladder already provides).

### D2 — Plan artifact drafted by a planner role into the parent run dir; child task files synthesized

New module `sdd-runner/src/plan.ts`. Module-question answer: **no existing module covers this** —
`decompose.ts`/atomicity split *tasks within one change* using openspec instructions and rewrite
`tasks.md` in place; neither creates changes nor reasons across changes. A planner agent (new
`AgentRole` value) spawns via the same `runStageAgent` seam as the estimator/decomposer — identical
validation-retry, diff-guard, transcript, and session-ledger treatment — and writes `plan.json` to
the parent run dir sidecars.

Plan schema (Zod): ordered `children[]` of `{ name, scope, acceptance_signals[], coverage }`, a
planner-emitted top-level `intent_units[]` inventory naming every unit of parent intent the task
decomposes into, plus `declined[]` of `{ units[], reason }` routed out of the plan — each declined
entry naming the inventory units it accounts for, with reason text serving the human gate. Two
non-obvious choices:

- **Coverage is emitted as evidence, not asserted.** Each child carries a `coverage` list naming the
  units of parent intent it owns; the validator (D3) checks that the coverage lists plus the
  `declined[]` entries jointly account for the whole top-level `intent_units` inventory — without
  that explicit universe field, deriving the units from
  the children's own coverage lists would make "nothing dropped" vacuously true, and leaving declined
  scope outside the universe would make "nothing silently routed out" vacuous for the same reason.
  This turns "children cover the intent, nothing
  dropped or duplicated" from an uncheckable claim into arithmetic over the artifact — same trick as
  R3 blast-radius triage turning prose blast radii into recorded-file checks. An LLM cannot be
  trusted to self-report "fully covered"; it can be required to lay out the partition so code can
  check totality and disjointness.
- **Children become real task files.** For each approved child the runner synthesizes
  `<parentRunDir>/children/<order>-<slug>.md`: H1 name, scope, acceptance signals, a short parent
  intent excerpt, and position among siblings. The H1 carries the composed deterministic change
  name `<parent-slug>--<child-slug>` — not the bare plan name — because seeded child runs go through
  ordinary `runStart`, whose only naming seam is `deriveChangeName` reading that heading; pinning
  the composed string into the H1 is what actually keeps siblings and nesting levels collision-free,
  and the validator checks exactly that composed string against `openspec/changes/`. Task-file prose
  is what `deriveChangeName`, the estimator, and drafter prompts already consume, so a child run
  starts with zero prompt-plumbing changes.

Alternatives considered: passing plan JSON inline as the child's prompt (breaks the task-file
contract every downstream stage assumes); letting each child restate its own scope at intake
(scope drift between plan and execution — the plan gate would be approving something different from
what runs).

### D3 — Validation is a pure function; regeneration bounded; halt resumable

`validatePlan(plan, bounds)` in `plan.ts` — pure, table-testable — rejects unless:

1. Totality and disjointness over the plan's top-level `intent_units`: every emitted intent unit is
   either owned by exactly one child's `coverage` list or named by a `declined[]` entry — never
   both, never neither — every coverage entry names an emitted unit, and every declined entry names
   units from that same inventory. Declined units stay *inside* the checked universe: that is what
   keeps "nothing dropped" mechanically checkable rather than vacuous, because a unit deliberately
   routed out and a unit forgotten are distinguishable.
2. Every child passes the admission checklist mechanically checkable from the artifact: non-empty
   scope and acceptance signals; name unique, slug-valid, not colliding with an existing
   `openspec/changes/` entry; count within `MAX_CHILDREN_PER_PLAN`.
3. Declined completeness for whatever the planner could not admit: coverage alone may fall short of
   totality only where declined entries name the uncovered units with reasons — an empty `declined`
   alongside an incomplete partition is itself a rejection reason, forcing the planner to surface
   declined scope instead of hiding it.

On rejection the planner respawns with the failing rules appended (the existing retry-with-error
pattern, ≤2 attempts like decompose/atomicity); exhaustion throws `StageHaltError` — loud, names the
rule, resumable, zero children started. Why not an adversarial second agent as validator: it would
re-introduce probabilistic sign-off where the design goal is mechanical checks, and it costs another
spawn per attempt. The human plan gate remains the semantic backstop; validation only guarantees no
*known-invalid* plan reaches it. The spec's "independently admissible" clause is discharged where
judgment lives — the planner prompt carries the repo's proposal-admission rules at drafting time and
the human plan gate judges them at approval time — leaving `validatePlan` the mechanical subset
enumerated above.

### D4 — Plan approval rides the existing gate machinery as a new mode `'plan'`

Add `'plan'` to the gate-mode enums (`state.gate.mode`, the L2 `gate` event, renderer
mode-conditionals). Children render as checkbox rows (scope + acceptance signals) built from the
plan sidecar, materialized through the assumptions path so the TUI gate screen, `--confirm-all`,
hand-edited file protocol, write-then-parse self-check, and versioned `gate-<n>.md` audit trail all
work unchanged. Leaving a child's box unchecked with a redirect triggers one revision pass per veto
round: the veto-updater seam (`updateAssumptionsFromVetoes` + a resolver-role spawn) regenerates the
affected child definitions and the gate re-presents at `gate-<n+1>` — the same veto loop operators
already know. Rounds are not lifetime-capped: each re-presentation accepts fresh vetoes, and approve
(all boxes checked) or `ABORT` are the only terminals — mirroring `settleVeto`'s per-presentation
loop in `gate-resume-tail.ts`. `ABORT` aborts the parent pre-children via the normal path.

Ladder: a conservative plan rung (**R6**) — auto-approve only when validation passed, there are
**zero declined entries** (routed-out scope always gets human eyes), and the R4 projection against
tree-wide spend is clear. R4 fail-closed (unknown cost / projected exceedance) always forces the
human gate, per the never-cut invariants. R3 low-blast prechecking is **disabled for plan mode** —
child rows sit inside the run dir by construction and would otherwise be auto-prechecked, which is
exactly wrong for a decision committing a whole subtree of spend. Every auto-settled plan still
writes and settles through the versioned gate file with `decided-by` attribution and an
`auto_decision` audit line, as today.

Why not a bespoke interactive prompt: it would fork the gate contract (two decision protocols,
two audit paths) precisely where consequences are largest.

### D5 — Stage machine grows `plan` and `execute`; run kind branches the spine

`StageIdSchema`/`STAGE_ORDER` gain `'plan'` and `'execute'`. Run kind derives from the oversize
verdict: **composite** runs follow `intake → plan → execute`; **single** runs keep today's six-stage
flow and never enter the new ids. `remainingStages(from, kind)` filters analogously to the existing
`atomicity-at-S` skip. Composite parents skip `draft/review/decompose/atomicity/gate`: their quality
control is the plan gate plus each child's full pipeline, and a rubber-stamp parent gate after every
child already gated individually would add friction without a decision.

This buys the established machinery for free: `stage_enter/exit` events, calm-stop boundaries,
idempotent re-entry, and resume derivation. Old event logs contain no new ids and old state files
parse unchanged (enum growth is additive). Renderers show skipped stages dimmed, as atomicity-at-S
already renders.

`deriveResumePoint` gains a composite arm: plan settled but children incomplete → resume at
`execute` targeting the first non-completed child; never re-runs completed children.

Alternatives considered: modeling planning as a sub-phase of intake (loses stage semantics, stop
boundaries, and replayable transitions); overloading `decompose` (conflates intra-change task
splitting with cross-change planning — different artifacts, different gates, different failure
modes).

### D6 — Children execute in-process, sequentially, as ordinary `runStart` runs

The parent orchestrator loops over approved children in plan order and calls the same fresh-run
entry used today, seeded with the synthesized child task file, a child `RunState` stamped
`kind/parentId/childRunIds`, and the shared `OrchestratorDeps`. At most one descendant runs at a
time; completion is observed synchronously and recorded into the parent log.

Why in-process over spawning `sdd` subprocesses:

- **One live view owner.** Renderer choice is exclusive per process (`render-mode.ts`); a subprocess
  child would fight the parent for stdio/TUI or lose live rendering entirely. In-process children
  share the mounted screen and event bus, so the tree renders in one place naturally.
- **Shared seams.** Stop markers, budget reads, config, and the spawn driver are already DI'd;
  subprocesses would re-load config and reduce outcomes to exit codes.
- **Resumability is file-based anyway.** Every node's truth lives in its own `state.json` +
  `events.ndjson`, so a crashed process loses nothing: resume walks the tree from files (D8). The
  coupling risk of shared process death is bounded by the same durability model that already makes
  single runs crash-safe.

Abort propagation uses the existing per-run-dir marker seam, fanned out at **abort-observation
time** — the moment the stop request lands, not at the parent's next loop boundary: the aborting
path writes calm-stop markers directly into the run dirs of every incomplete descendant *of the
aborted node* (its subtree only; siblings outside that subtree are untouched). Because node truth is
file-first, this needs no cooperation from a running parent loop: a descendant mid-stage honors its
own dir's marker at its next stage or round boundary, so stopping does not wait for the parent's
`execute` iteration to advance. Completed nodes are never touched. Veto/extend steering directives
keep landing on the receiving run only — the approved plan is frozen (spec requirement), so steering
never mutates `childRunIds`.

### D7 — Tree state and events are additive; roll-ups walk `childRunIds`

`PersistedRunStateSchema` gains optional defaulted fields: `kind ('single')`, `parentId?`,
`childRunIds: string[]`, `planPath?`, `oversize? { verdict, rationale }`. Legacy files parse as-is;
absence of tree fields *is* the legacy encoding — no migration step.

New L2 events, appended only (existing entries untouched):
`oversize {verdict, rationale, source}`, `plan_rejected {rule, attempt}`,
`child_started {runId, name}`, `child_finished {runId, outcome}` (outcome ∈ `completed | aborted |
failed | stopped` — the status enum minus `running`, which cannot describe a finish).
`replay.ts` folds them into `ReplayState` (tree section), preserving replay-sufficiency.

Cost/token/duration aggregation extends `usage-aggregate.ts`/`report.ts`: subtree figures are
computed by walking `childRunIds` recursively and summing each node's own event-derived usage —
per-node numbers stay exact, ancestor totals equal the sum of descendants (report shows both).
Tree-wide budget enforcement threads the *subtree* spend into `PolicySignals.spentUsd` wherever the
ladder evaluates inside any node, so R2/R4/R6 projections see committed + projected tree spend
against the single configured `budget`; exceedance anywhere degrades auto-decisions to human gates.

Live views (`live-view.ts`, TUI running screen) get the tree from the fold layer — they already
hold no state of their own, so a `child_started/finished` fold renders parent/child structure and
highlights the active node without new view state.

### D8 — Routing and discovery stay flat; composite-awareness goes into resume/continue

Children are real dirs under `runs/`, so `resolveRunId` prefix resolution (with loud ambiguity
failure) and `listPendingGates` discovery already work across tree members unchanged. The only
routing change needed: `continue`/`resume` on a **composite** node consults its children — a
gate-pending active child routes to that child's gate flow (printing the child's concrete command),
an interrupted child resumes, otherwise the next pending child starts. Bare `continue` keeps picking
the sole gate-pending run wherever it sits in the tree. This keeps the one-verb UX while making
"continue the parent" mean "advance the subtree".

One driver per run dir: before driving any node, a process claims its run dir via an
exclusive-create claim file — the same mutual-exclusion pattern as the autonomy deadline waiter —
and releases it when its drive ends. An external `continue`/`resume` targeting a claimed node fails
loudly naming the current holder (for a tree member, the driving ancestor's run id) instead of
putting a second driver on that dir; this is what upholds "at most one descendant in flight"
against the documented routing verbs while a composite parent executes its children in-process.

### D9 — Recursion bounds are compiled constants

`MAX_CHILDREN_PER_PLAN` and `MAX_NESTING_DEPTH` live next to `ROUND_CAPS` (`review-model.ts`) as
exported constants. The timeout-removal precedent set the rule: operational constants stay out of
the five-key config, whose strictness ("everything else rejected naming the replacement") is a
loaded-time safety feature worth keeping inviolate. Depth is threaded down as a plain integer on
child creation; a child whose own intake returns oversize at the depth limit halts that branch with
`StageHaltError` naming the exhausted bound — resumable once an operator raises the constant.

## Risks / Trade-offs

- [Planner emits a well-formed but semantically hollow coverage matrix] → Validation mechanizes
  completeness/disjointness arithmetic, not truth; the plan gate remains the human semantic check,
  declined-scope visibility forces honest routing-out, and the veto→revision loop lets the operator
  reshape any child before spend starts.
- [A decomposition multiplies total spend beyond a budget sized for one change] → Budget is
  enforced tree-wide (subtree spend in every ladder evaluation); R6 requires a clear R4 projection;
  the plan gate renders projected subtree spend beside each child; exceedance always falls to a
  human.
- [In-process recursion ties tree progress to one process lifetime] → All node truth is file-first
  and append-only; stages idempotent; resume continues at the next incomplete child — a crash costs
  tokens, never state, matching today's single-run durability contract.
- [Sequential children make large trees slow end-to-end] → Accepted (proposal non-goal); plan order
  plus frozen child definitions mean a future parallel executor swaps the loop body without touching
  plan/gate/resume semantics.
- [Oversize false positives fragment genuinely small work] → Disagreement resolves toward oversize
  precisely because the failure is caught early and cheaply (gate veto/abort before any folder or
  child exists); the estimator rationale is recorded for operator audit.
- [New stage ids/event types break older readers of newer logs] → Forward-only compatibility:
  downgrade while trees are in flight is unsupported; finish or abort trees before reverting.
  Reading old data with new code is safe (additive enums/fields).
- [Change-folder namespace collisions across nested levels] → Deterministic `<parent>--<child>`
  naming plus a validator scan of `openspec/changes/` reject collisions before the plan gate.

## Migration Plan

1. Land bottom-up, test-first (see order below); every step keeps the full suite green, and
   non-oversized behavior bit-identical — the feature is reachable only through the new oversize
   verdict, which defaults negative until the estimator schema extension ships.
2. Additive evolution only: extended Zod schemas (events, state), two new stage ids, new gate mode,
   new module `sdd-runner/src/plan.ts`, ladder rung R6, constants in `review-model.ts`. No config
   keys, no DB, no backfill, no external artifact format changes.
3. Rollout order: (1) event/state schema extensions → (2) `plan.ts` schema + pure validator →
   (3) intake oversize axis → (4) R6 + tree-wide spend threading → (5) composite stage spine +
   resume arm → (6) plan gate wiring → (7) child execution loop + abort fan-out → (8) continue/
   routing → (9) report/replay/live tree rendering. Steps 2–4 are pure functions unit-tested in
   isolation; 5–8 integrate against fake drivers/spawns per the existing `tests/sdd-runner/` style.
4. Rollback: revert the commit range. Caveat: do not downgrade with an in-flight tree — complete or
   abort it first (older code cannot parse the new event types).

Hook/TDD interactions: new files `sdd-runner/src/plan.ts` and `tests/sdd-runner/plan.test.ts` enter
the normal Write/Edit hook pipeline (staged lint/typecheck/format, license-header check on new
files — headers required from the first commit; no lint/type ignores permitted). Planner/decomposer
agents keep writing only through the `runStageAgent` sidecar seam, so the existing diff guard
confines them exactly as it does the estimator today. Test-first order follows the rollout order
above; the pure-function quartet (schemas, validator, verdict mapping, R6) lands before any
orchestration wiring, per TDD.

## Open Questions

None — remaining unknowns (compact-tree rendering below narrow terminals) are implementation
details deferred to tasks without affecting specs, approach, or breakdown.
