## Purpose

Lets an oversized task admitted to the SDD pipeline be recognized at intake and split into independently shippable child changes, each executed as a full nested pipeline run under one gated, bounded, fully traceable run tree — instead of collapsing large requests into a single under-explored change.

## ADDED Requirements

### Requirement: Oversize detection at intake

Intake SHALL classify every admitted task along two independent axes: the depth profile (S/M/L) exactly as today, and an oversize verdict stating whether the task exceeds single-change capacity. The oversize verdict SHALL be derived from the task description alone, recorded in run state and the event log before any scaffolding occurs, and reconstructible by replaying the event log alone. When the verdict is oversize, the runner SHALL NOT scaffold one OpenSpec change covering the whole task; it SHALL enter decomposition planning instead. When the verdict is not oversize, the run SHALL proceed through the existing single-change pipeline with unchanged stages, gates, outputs, and completion criteria. An explicit operator depth override SHALL suppress decomposition planning entirely and keep the run on the single-change path.

#### Scenario: Non-oversized task behaves exactly as today

- **WHEN** intake classifies a task that fits single-change capacity
- **THEN** the run scaffolds a single change and proceeds through the current stage flow, gate contract, and completion criteria with no observable difference from today

#### Scenario: Oversized task enters decomposition planning

- **WHEN** intake classifies a task as exceeding single-change capacity
- **THEN** no single change folder is scaffolded for the whole task and the runner proceeds to decomposition planning instead

#### Scenario: Verdict is recorded before any side effect

- **WHEN** any run passes intake
- **THEN** the oversize verdict exists in run state and the event log before any change scaffolding or child planning output is written, and replaying the event log alone reconstructs the verdict

#### Scenario: Depth override stays on the single-change path

- **WHEN** the operator supplies an explicit depth override for a task whose description would otherwise earn an oversize verdict
- **THEN** the run skips decomposition planning entirely and follows the single-change pipeline with unchanged stages, gates, outputs, and completion criteria

### Requirement: Plan approval gate precedes any child execution

The validated plan SHALL be presented at a human gate before the first child starts, rendered through the existing gate-file protocol: each child as a checkbox row with its scope and acceptance signals. Checking every box approves the plan; leaving a child's box unchecked vetoes that child, optionally carrying a redirect line; each veto round triggers exactly one plan revision incorporating that round's redirects before the gate is re-presented at the next version, and the veto loop repeats round by round until every box is checked or ABORT is written — vetoes are bounded per round, never lifetime-capped, matching today's veto seam. Writing ABORT aborts the parent before any child runs. The autonomy ladder MAY settle this gate under its existing never-cut invariants: any auto-approved plan SHALL still write and settle through the versioned gate file with decided-by attribution, and budget exceedance SHALL always fall back to a human decision. For plan gates the auto-policy prelude SHALL reduce to the budget guard alone: no other prelude rule SHALL settle or influence a plan gate. No child change folder SHALL be created and no child run SHALL start until the gate is settled in favor of the plan.

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

Each approved child SHALL execute as a full nested pipeline run with its own change folder, run directory, event log, depth-profile classification, review loop, gates, and completion criteria — indistinguishable in kind from a top-level run. Children SHALL execute sequentially: at most one descendant run SHALL be in flight at any moment, and execution SHALL follow the plan's topological spawn order — a child SHALL NOT start before the children it depends on have finished, with declaration order breaking ties. Each child's identity and outcome SHALL be recorded back into the parent's event log as it starts and finishes, carrying the child's usage figures so aggregate cost is computable from the parent log alone, keeping every node's event log append-only and replay-sufficient.

#### Scenario: Child run is a full pipeline run

- **WHEN** an approved child begins execution
- **THEN** it passes through the same stages, gates, and completion criteria as a top-level run and owns its own change folder and event log

#### Scenario: Children run sequentially

- **WHEN** a parent has multiple pending children
- **THEN** exactly one descendant run executes at a time, in the plan's topological spawn order

#### Scenario: Dependencies gate spawn order

- **WHEN** one child declares a dependency on another
- **THEN** the dependent child does not start until the child it depends on has finished, while independent children start in declared order

#### Scenario: Parent event log records child outcomes

- **WHEN** a nested child run starts, completes, aborts, or halts
- **THEN** the parent's event log gains a corresponding record linking the child's run id, outcome, and usage, replayable without mutating earlier entries

### Requirement: Parent completion requires every child completed

A decomposing run SHALL reach completed status only when every descendant run has reached completed status. If any descendant ends non-completed — aborted, or halted (`failed` or `stopped`: throughout this specification *halted* denotes a descendant that terminated before completion through a loud resumable failure and surfaces as persisted status `failed` or `stopped`; there is no separate `halted` status) — the parent SHALL persist status `stopped` (halted but resumable, so tree-aware routing still treats it as active), and reports SHALL identify which descendant blocks completion by its persisted status. The parent SHALL never report success over an incomplete subtree, and the parent run itself SHALL own no change folder of its own at any status.

#### Scenario: Parent completes after the last child

- **WHEN** the final descendant run reaches completed
- **THEN** the parent run reaches completed and its report reflects the finished subtree

#### Scenario: Aborted child keeps the parent incomplete

- **WHEN** a descendant run ends aborted while siblings remain
- **THEN** the parent stays halted-and-resumable, its report names the aborted child, and it SHALL NOT be marked completed

#### Scenario: Parent owns no change folder

- **WHEN** a composite parent run reaches any status
- **THEN** no OpenSpec change folder exists for the parent itself; every change folder in the tree belongs to a child run

### Requirement: Abort propagates downward

Requesting a stop or abort of any node in the run tree SHALL propagate to every incomplete descendant: each affected descendant SHALL honor the request at its next stage or round boundary using calm-stop semantics, leaving every affected node individually resumable. A parent calm-stop SHALL write a subtree-scoped stop marker for the currently active child, honored at that child's next boundary. Completed descendants SHALL remain completed and SHALL NOT be re-executed because a sibling or ancestor was aborted.

#### Scenario: Parent abort stops the running child at a boundary

- **WHEN** an operator aborts a parent while a descendant run is mid-stage
- **THEN** the descendant records a calm stop at its next stage or round boundary and both nodes are individually resumable afterwards

#### Scenario: Completed child unaffected by sibling abort

- **WHEN** one child completes and a later sibling is aborted
- **THEN** the completed child's status and artifacts remain untouched and resume does not re-run it

#### Scenario: Parent calm-stop marks the active child

- **WHEN** a calm stop is requested on a parent while a child is executing
- **THEN** the active child's subtree receives a stop marker that the child honors at its next stage or round boundary, and both nodes stay individually resumable

### Requirement: Tree-wide cost accounting and tree visibility

Reports, cost aggregation, and live views SHALL present the run tree: per-node status for every node, and subtree-aggregated cost, token, and duration figures on ancestor views alongside their per-node figures. The configured budget SHALL be enforced tree-wide as an aggregate ledger over parent and child spend: any auto-decision or auto-extension within any node SHALL account for the committed and projected spend of the entire tree against the single configured budget, and exceedance SHALL force a human gate wherever the ladder would otherwise have auto-decided. The aggregate ledger SHALL fail closed: wherever a node's contribution to tree spend cannot be determined, that uncertainty SHALL count against the budget rather than as free headroom.

#### Scenario: Report aggregates subtree cost

- **WHEN** a report is generated for a decomposing parent
- **THEN** it shows the tree with each node's status and cost, plus subtree totals on the parent that equal the sum of its descendants' costs

#### Scenario: Live view renders the tree position

- **WHEN** a live view attaches during a nested child's execution
- **THEN** the view shows the parent/child structure and highlights which node is currently active

#### Scenario: Budget guard spans the whole tree

- **WHEN** a rule inside a child would auto-decide but the tree's aggregate spend crosses the configured budget
- **THEN** the decision is declined in favor of a human gate

#### Scenario: Aggregate ledger fails closed

- **WHEN** a node's contribution to tree spend cannot be determined at a point where a rule would auto-decide
- **THEN** the undetermined spend counts against the budget rather than as headroom, so the decision falls back to a human gate
