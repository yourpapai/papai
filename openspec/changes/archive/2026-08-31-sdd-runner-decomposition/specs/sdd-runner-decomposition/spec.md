## Purpose

Lets an oversized task admitted to the SDD pipeline be recognized at intake and split into independently shippable child changes, each executed as a full nested pipeline run under one gated, bounded, fully traceable run tree — instead of collapsing large requests into a single under-explored change.

## ADDED Requirements

### Requirement: Oversize detection at intake

Intake SHALL classify every admitted task along two independent axes: the depth profile (S/M/L) exactly as today, and an oversize verdict stating whether the task exceeds single-change capacity. The oversize verdict SHALL be derived from the task description alone, recorded in run state and the event log before any scaffolding occurs, and reconstructible by replaying the event log alone. When the verdict is oversize, the runner SHALL NOT scaffold one OpenSpec change covering the whole task; it SHALL enter decomposition planning instead. When the verdict is not oversize, the run SHALL proceed through the existing single-change pipeline with unchanged stages, gates, outputs, and completion criteria.

#### Scenario: Non-oversized task behaves exactly as today

- **WHEN** intake classifies a task that fits single-change capacity
- **THEN** the run scaffolds a single change and proceeds through the current stage flow, gate contract, and completion criteria with no observable difference from today

#### Scenario: Oversized task enters decomposition planning

- **WHEN** intake classifies a task as exceeding single-change capacity
- **THEN** no single change folder is scaffolded for the whole task and the runner proceeds to decomposition planning instead

#### Scenario: Verdict is recorded before any side effect

- **WHEN** any run passes intake
- **THEN** the oversize verdict exists in run state and the event log before any change scaffolding or child planning output is written, and replaying the event log alone reconstructs the verdict

### Requirement: Decomposition plan content

When intake returns an oversize verdict, the runner SHALL draft a decomposition plan: an ordered set of child change definitions, each carrying a name, a scope statement bounding what that child covers, and acceptance signals describing how its completion can be verified. Every child definition SHALL be independently admissible under the repository's proposal admission rules — a child that cannot justify its own existence SHALL NOT appear in the plan. Scope of the parent intent that fails admission SHALL be recorded as declined and stay visibly routed out of the plan, never silently absorbed into another child. The plan SHALL be persisted as an artifact in the parent run directory before approval is sought.

#### Scenario: Plan lists complete child definitions

- **WHEN** a decomposition plan is drafted for an oversized task
- **THEN** every listed child carries a name, a scope statement, and acceptance signals, persisted in the parent run directory

#### Scenario: Inadmissible scope stays visible

- **WHEN** some part of the parent intent cannot form an independently admissible child change
- **THEN** the plan records that scope as declined rather than embedding it in a sibling child or dropping it silently

### Requirement: Plan validation before approval

A drafted plan SHALL be validated before it can be approved or executed. Validation SHALL reject a plan unless all of the following mechanically checkable conditions hold: the children's coverage lists together with the plan's declined entries account for every unit of the declared parent intent — each unit covered by exactly one child or explicitly declined, none both and none neither; no unit of intent appears in more than one child; every child carries a non-empty scope statement and acceptance signals; every child name is unique, slug-valid, and collides with no existing `openspec/changes/` entry; the number of children does not exceed the enforced maximum; and intent the planner could not admit is present as declined entries naming the units they account for rather than omitted or absorbed. Independent admissibility beyond these mechanical checks — whether a child justifies its own existence under the repository's proposal admission rules — is semantic and lives where judgment lives: the planner SHALL admit only such children when drafting, and the human plan gate remains the semantic backstop before any spend starts. A rejected plan SHALL be regenerated, and if no valid plan can be produced within the regeneration allowance, the run SHALL halt loudly and resumably naming why — it SHALL NOT proceed with a known-invalid plan and SHALL NOT silently shrink the plan to pass validation.

#### Scenario: Coverage gap rejects the plan

- **WHEN** a drafted plan leaves some aspect of the parent intent both uncovered by any child and absent from the declined entries
- **THEN** the plan is rejected and regenerated, and no child execution starts from it

#### Scenario: Duplicated work rejects the plan

- **WHEN** two children claim the same work item
- **THEN** the plan is rejected and regenerated until the children partition the intent without overlap

#### Scenario: Unproducible valid plan halts resumably

- **WHEN** repeated regeneration cannot produce a plan that passes validation
- **THEN** the run halts with an error naming the failing validation rule, remains resumable, and has started no child runs

### Requirement: Decomposition bounds and recursion limit

The runner SHALL enforce two fixed operational bounds — a maximum number of children per decomposition and a maximum decomposition nesting depth — held as compiled constants alongside the existing operational caps, deliberately outside user configuration so the closed five-key config stays inviolate. A child whose own intake returns an oversize verdict MAY itself be decomposed only while the resulting nesting depth stays within the enforced maximum. At the depth limit, a child that still exceeds single-change capacity SHALL halt that branch with a loud, resumable failure naming the exhausted bound — it SHALL NOT recurse further nor force the remaining work into a single shallow change without the operator seeing why.

#### Scenario: Nested decomposition allowed under the limit

- **WHEN** an approved child's own intake returns an oversize verdict while the enforced nesting depth allows one more level
- **THEN** the child enters decomposition planning itself and its descendants execute as further nested runs

#### Scenario: Depth limit halts instead of over-recursing

- **WHEN** a nested child receives an oversize verdict at the enforced maximum nesting depth
- **THEN** the branch halts loudly naming the depth bound, starts no deeper decomposition, and stays resumable

### Requirement: Plan approval gate precedes any child execution

The validated plan SHALL be presented at a human gate before the first child starts, rendered through the existing gate-file protocol: each child as a checkbox row with its scope and acceptance signals. Checking every box approves the plan; leaving a child's box unchecked vetoes that child, optionally carrying a redirect line; each veto round triggers exactly one plan revision incorporating that round's redirects before the gate is re-presented at the next version, and the veto loop repeats round by round until every box is checked or ABORT is written — vetoes are bounded per round, never lifetime-capped, matching today's veto seam. Writing ABORT aborts the parent before any child runs. The autonomy ladder MAY settle this gate under its existing never-cut invariants: any auto-approved plan SHALL still write and settle through the versioned gate file with decided-by attribution, and budget exceedance SHALL always fall back to a human decision. No child change folder SHALL be created and no child run SHALL start until the gate is settled in favor of the plan.

#### Scenario: Approval releases the children

- **WHEN** the plan approval gate is approved with every child checked
- **THEN** the runner begins executing the approved children in plan order and no child was created before settlement

#### Scenario: Unchecked child vetoes just that child

- **WHEN** an operator leaves one child's box unchecked with a redirect while approving the rest
- **THEN** the plan is revised to incorporate the redirect for that child and the gate is re-presented at the next gate version before any child executes

#### Scenario: Auto-settled plan approval is audited

- **WHEN** the autonomy ladder settles a validated plan approval without a human
- **THEN** the decision writes the versioned gate file with decided-by attribution and an audit record citing the deciding rule and evidence digest

#### Scenario: Budget exceedance forces a human plan decision

- **WHEN** the ladder would settle a plan approval but projected spend exceeds the configured budget
- **THEN** the plan gate is presented to a human instead of being auto-settled

### Requirement: Nested per-child pipeline execution

Each approved child SHALL execute as a full nested pipeline run with its own change folder, run directory, event log, depth-profile classification, review loop, gates, and completion criteria — indistinguishable in kind from a top-level run. Children SHALL execute sequentially: at most one descendant run SHALL be in flight at any moment. Each child's identity and outcome SHALL be recorded back into the parent's event log as it starts and finishes, keeping every node's event log append-only and replay-sufficient.

#### Scenario: Child run is a full pipeline run

- **WHEN** an approved child begins execution
- **THEN** it passes through the same stages, gates, and completion criteria as a top-level run and owns its own change folder and event log

#### Scenario: Children run sequentially

- **WHEN** a parent has multiple pending children
- **THEN** exactly one descendant run executes at a time, in plan order

#### Scenario: Parent event log records child outcomes

- **WHEN** a nested child run starts, completes, aborts, or halts
- **THEN** the parent's event log gains a corresponding record linking the child's run id and outcome, replayable without mutating earlier entries

### Requirement: Parent completion requires every child completed

A decomposing run SHALL reach completed status only when every descendant run has reached completed status. If any descendant ends non-completed — aborted, or halted (`failed` or `stopped`: throughout this specification *halted* denotes a descendant that terminated before completion through a loud resumable failure and surfaces as persisted status `failed` or `stopped`; there is no separate `halted` status) — the parent SHALL persist status `stopped` (halted but resumable, so tree-aware routing still treats it as active), and reports SHALL identify which descendant blocks completion by its persisted status. The parent SHALL never report success over an incomplete subtree.

#### Scenario: Parent completes after the last child

- **WHEN** the final descendant run reaches completed
- **THEN** the parent run reaches completed and its report reflects the finished subtree

#### Scenario: Aborted child keeps the parent incomplete

- **WHEN** a descendant run ends aborted while siblings remain
- **THEN** the parent stays halted-and-resumable, its report names the aborted child, and it SHALL NOT be marked completed

### Requirement: Abort propagates downward

Requesting a stop or abort of any node in the run tree SHALL propagate to every incomplete descendant: each affected descendant SHALL honor the request at its next stage or round boundary using calm-stop semantics, leaving every affected node individually resumable. Completed descendants SHALL remain completed and SHALL NOT be re-executed because a sibling or ancestor was aborted.

#### Scenario: Parent abort stops the running child at a boundary

- **WHEN** an operator aborts a parent while a descendant run is mid-stage
- **THEN** the descendant records a calm stop at its next stage or round boundary and both nodes are individually resumable afterwards

#### Scenario: Completed child unaffected by sibling abort

- **WHEN** one child completes and a later sibling is aborted
- **THEN** the completed child's status and artifacts remain untouched and resume does not re-run it

### Requirement: Per-node resume and tree-aware routing

Every node in the run tree SHALL be individually resumable by its own run id through the existing single routing verb. Routing SHALL become tree-aware: continuing or resuming a parent whose next action lives inside a descendant routes to that descendant's pending point — for example a gate-pending child's decision flow — and resuming a partially executed tree continues at the next incomplete child without re-executing completed ones. Run-id prefixes SHALL resolve across tree members, and an ambiguous prefix SHALL fail loudly listing every candidate id. A run directory SHALL admit at most one driver at a time: a driver claims the run dir via an exclusive-create claim file before acting, and any concurrent drive attempt on a claimed node — including external resume of a child currently executing inside its parent's run — SHALL fail loudly naming the current holder instead of starting a second driver.

#### Scenario: Continue on the parent routes into a pending child gate

- **WHEN** `continue` is invoked for a parent whose active child is gate-pending
- **THEN** the operator is routed to that child's gate decision flow with the child's concrete command and run id

#### Scenario: Resume skips completed children

- **WHEN** a halted tree with some completed children is resumed
- **THEN** execution resumes at the next incomplete child and completed children are not re-run

#### Scenario: Ambiguous prefix across the tree fails loudly

- **WHEN** a run-id prefix matches both a parent and one of its children
- **THEN** the command fails listing every matching id instead of guessing

#### Scenario: External resume of an actively driven node fails loudly

- **WHEN** `resume` targets a run whose directory is claimed by an active driver, such as a child currently executing inside its parent's run
- **THEN** the command fails naming the current holder and starts no second driver on that run dir

### Requirement: Tree-wide cost accounting and tree visibility

Reports, cost aggregation, and live views SHALL present the run tree: per-node status for every node, and subtree-aggregated cost, token, and duration figures on ancestor views alongside their per-node figures. The configured budget SHALL be enforced tree-wide: any auto-decision or auto-extension within any node SHALL account for the committed and projected spend of the entire tree against the single configured budget, and exceedance SHALL force a human gate wherever the ladder would otherwise have auto-decided.

#### Scenario: Report aggregates subtree cost

- **WHEN** a report is generated for a decomposing parent
- **THEN** it shows the tree with each node's status and cost, plus subtree totals on the parent that equal the sum of its descendants' costs

#### Scenario: Live view renders the tree position

- **WHEN** a live view attaches during a nested child's execution
- **THEN** the view shows the parent/child structure and highlights which node is currently active

#### Scenario: Budget guard spans the whole tree

- **WHEN** a rule inside a child would auto-decide but the tree's aggregate spend crosses the configured budget
- **THEN** the decision is declined in favor of a human gate

### Requirement: Approved plan is stable during execution

Once the plan gate settles in favor of the plan, the set of children SHALL be fixed for the parent's lifetime: the runner SHALL NOT regenerate, extend, or redefine children mid-execution. Queued steering directives remain veto/extend only and SHALL affect only the receiving run's rounds and findings, never the shape of the plan. Re-planning SHALL be reachable only through the plan-gate veto loop before the first child starts.

#### Scenario: Steering cannot mutate the plan

- **WHEN** an extend or veto steer directive lands while child runs are executing
- **THEN** the directive affects the receiving run exactly as today and the parent's set of children is unchanged

## MODIFIED Requirements

### Requirement: Early-gate approval continues the pipeline

When a human approves an early (cap-hit) gate, the pipeline SHALL continue into
task decomposition, atomicity checking, and a final gate instead of finalizing
the run. Approval SHALL mean "the remaining findings are accepted as resolved —
proceed," and no approval path SHALL produce a completed run that lacks a task
list. This requirement governs single-change runs; a composite run (one whose
intake returned an oversize verdict) never enters this approval path and follows
the decomposition capability's own completion criterion instead — reaching
`completed` only when every descendant run has reached `completed`, owning no
change directory or `tasks.md` itself.

#### Scenario: Approval at an early gate proceeds to decomposition

- **WHEN** a human approves an early gate (all boxes checked, blockers answered)
- **THEN** the pipeline runs task decomposition and atomicity checking and then
  presents a final gate, instead of marking the run completed

#### Scenario: No completion path skips the task list

- **WHEN** any single-change run reaches `completed` status
- **THEN** the change directory contains a `tasks.md` produced by the pipeline's
  decomposition stage (or the run was aborted, which is the only non-completing
  exit); a composite parent instead completes only under the decomposition
  capability's "Parent completion requires every child completed", with no
  parent-owned change directory or task list

#### Scenario: Final gate after early approval carries the next version

- **WHEN** the final gate is presented following an early-gate approval at
  version `n`
- **THEN** it is written as `gate-<n+1>.md` with the full task-progress digest,
  preserving the versioned audit trail

### Requirement: Frozen non-TTY byte contract

Non-TTY (CI/log-file) pipeline output SHALL remain byte-identical to its pre-change form for single-change runs, with exactly one permitted addition: the model id on agent `done` lines. A composite run (one whose intake returned an oversize verdict) additionally emits the decomposition stage lines (`plan`, `execute`) and the tree event lines specified by the sdd-runner-decomposition capability; these are the only further permitted additions, and they appear on composite runs only. All other Tier 0 output details SHALL land only in the dynamic (interactive-TTY) renderer and in gate files.

#### Scenario: CI output gains only the done-line model id

- **WHEN** a single-change pipeline run writes to a non-TTY sink (pipe, file,
  CI log)
- **THEN** the byte stream SHALL equal the pre-change byte stream except that
  `done` lines include the model id

#### Scenario: Composite runs add only decomposition lines

- **WHEN** a composite run writes to a non-TTY sink
- **THEN** the byte stream equals the single-change contract plus only the
  decomposition stage lines and tree event lines specified by the
  sdd-runner-decomposition capability

#### Scenario: Done line without a model id is unchanged

- **WHEN** a `done` event carries no model id (historical or unmetered run)
- **THEN** the done line SHALL be rendered exactly as before the change, with no model segment and no placeholder

#### Scenario: Interactive details never leak into non-TTY output

- **WHEN** any Tier 0 detail other than the done-line model id (stage timings, ETA, sparklines, retry badges, terminal title) is rendered
- **THEN** it SHALL appear only on interactive TTY output or in gate files, never in the non-TTY byte stream
