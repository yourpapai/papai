## Purpose

Drives the SDD pipeline's tail — decompose, atomicity, the final gate, finals, and the run report — as graph-hosted work, so an afk-runner run can complete end-to-end, resume from any tail crash, and reach a terminal state whose memo matches what sdd-runner persisted.

## ADDED Requirements

### Requirement: Tail stage work with depth-gated atomicity

After a converged review, the drive loop SHALL run decompose as a bracketed stage (decomposer agent writes tasks.md, then a strict `openspec validate` retry up to two attempts) and, for every depth profile except S, atomicity as a second bracketed stage (rewrites tasks.md, split/merge report, same two-attempt retry). For depth S the run SHALL move from decompose directly to the final gate with no atomicity stage events.

#### Scenario: M-depth tail runs both stages

- **WHEN** a depth-M run's review converges
- **THEN** the log records `stage_enter(decompose)` … `stage_exit(decompose)` then `stage_enter(atomicity)` … `stage_exit(atomicity)`, each bracketed around its agent work

#### Scenario: S-depth tail skips atomicity

- **WHEN** a depth-S run's review converges
- **THEN** the log records the decompose bracket followed by the gate stage entry with no atomicity events anywhere in the log

#### Scenario: Validate retries then halts

- **WHEN** the decomposer output fails strict validation twice
- **THEN** the stage halts with the legacy stage-halt error and the run remains resumable

### Requirement: Final-gate presentation as tail work

The final gate SHALL be presented by the tail's last work module (atomicity, or decompose on depth S) as its final act, in this order: render the gate file and hashes sidecar, append `stage_enter(gate)`, append the presented event, run the autonomy ladder (always logging its decision). The module's bracket-closing exit SHALL land after the machine has moved into the gate compound. The presented version SHALL be one greater than the highest version the run has presented.

#### Scenario: Presentation parks the run positionally

- **WHEN** the tail's last stage completes its work
- **THEN** the machine sits in the gate compound's awaiting state with an unanswered gate record, the gate file exists on disk, and the run parks gate-pending

#### Scenario: Version increments across cycles

- **WHEN** a run that already presented gates v1..vN presents its final gate
- **THEN** the presented version is N+1

### Requirement: Outcome-ordered settlement at final gates

The settle seam SHALL order its appends by outcome at a final gate: approve appends the gate stage exit before the answered event (so the completed edge fires on the answer); extend and veto append the answered event first (keeping the gate stage active so the completed edge cannot fire), then the gate stage exit, then the mover event; abort appends the answered event alone. At an early gate the seam SHALL append no gate stage exit.

#### Scenario: Approve completes on the answered event

- **WHEN** a final gate settles approve
- **THEN** the log shows `stage_exit(gate)` then the answered event, and the machine reaches the completed final

#### Scenario: Extend does not complete the run

- **WHEN** a final gate settles extend
- **THEN** the answered event arrives while the gate stage is still active, the completed edge does not fire, and the mover `round_open` moves the machine back to review

#### Scenario: Veto re-enters draft

- **WHEN** a final gate settles veto
- **THEN** the machine moves to draft for the revision round without passing through completed

### Requirement: Tail re-runs are legacy-faithful

When an extended round or veto revision converges after a final gate was already presented, the run SHALL re-run decompose and (except depth S) atomicity as fresh stage brackets and re-present the final gate at the next version, matching sdd-runner's post-convergence tail behavior.

#### Scenario: Extend-at-final full cycle

- **WHEN** a final gate settles extend, the extended round converges, and the re-presented final gate settles approve
- **THEN** the log contains two decompose brackets and two final presentations, and the run completes

### Requirement: Depth-S completion

The completed edge's map guard SHALL fire when the gate stage is done and no stage is active, rather than requiring every stage done — so a depth-S run (whose atomicity entry stays forever pending) can complete. The guard SHALL NOT fire while the gate stage is pending (interstitial early gates) or while any stage is active.

#### Scenario: S run completes

- **WHEN** a depth-S run's final gate settles approve
- **THEN** the machine reaches completed with atomicity still pending in the map

#### Scenario: Early approve stays blocked

- **WHEN** an early (interstitial) gate settles approve
- **THEN** the completed edge does not fire and the approve-early mover proceeds to decompose

### Requirement: Mid-stage crash resume in the tail

A run interrupted during a work-carrying stage SHALL resume by re-entering that stage through its own self-loop edge, for decompose, atomicity, and intake (the pre-existing gap), in addition to the already-covered draft and review.

#### Scenario: Crash during decompose work

- **WHEN** a process dies between `stage_enter(decompose)` and its exit and the run is resumed
- **THEN** resume re-enters decompose and re-runs its work rather than throwing an append refusal

#### Scenario: Crash during intake work

- **WHEN** a process dies during intake work and the run is resumed
- **THEN** resume re-enters intake and the run proceeds

### Requirement: Tail crash-window recovery

Resume SHALL detect a gate-stage entry whose presentation never landed (gate record null or stale-answered while the gate stage is active in the map) and heal by appending the owed presented event at the version of the latest gate file on disk, then re-running the ladder. Owed-mover detection SHALL be gated on map signals so a mover that already landed is never re-appended.

#### Scenario: Crash between gate entry and presentation

- **WHEN** a process dies after `stage_enter(gate)` but before the presented event and the run is resumed
- **THEN** resume appends the owed presentation (the gate file already exists) and the run parks gate-pending — no infinite waiter loop

#### Scenario: No phantom extended round

- **WHEN** a crash of the same shape happens in a run whose last gate record is an already-answered early gate
- **THEN** resume appends the owed final presentation, not a second `round_open` for the landed extend mover

### Requirement: Finals end the run cleanly

When the machine reaches a final state, the drive loop SHALL report it as a terminal park (distinct from awaiting-tail), the run memo SHALL record status completed or aborted, the session id SHALL become reusable, and resuming a terminal run SHALL print a report pointer without driving.

#### Scenario: Approve reaches completed

- **WHEN** a final gate settles approve and the re-drive folds to the completed final
- **THEN** the run exits with a terminal park, the memo says completed, and the same session id can be allocated by a new run

#### Scenario: Resume of a completed run

- **WHEN** an operator resumes a run whose log folds to a final
- **THEN** the command prints the report pointer and appends nothing

#### Scenario: Abort reaches aborted

- **WHEN** a final gate settles abort
- **THEN** the machine reaches the aborted final and the memo records aborted

### Requirement: Run report

A passive report command SHALL build the run summary (depth, review verdict and rounds, gate versions, skeptic lens, task completion, autonomy gains with median-dwell math, commits on the branch, run paths) purely from the event log, the change directory, and git, and SHALL print it without writing run state.

#### Scenario: Report of a completed run

- **WHEN** the report command runs against a completed run
- **THEN** it prints the summary including per-rule interventions avoided and the run/transcript paths

### Requirement: Memo parity with sdd-runner

The derived run memo SHALL carry every field sdd-runner persisted (plan and children included) as a pure projection of the log, with terminal rules matching legacy: gate null at terminal status, stage holding the last entered stage rather than the final position. A conformance test SHALL derive the memo from each surviving original run's event log and match the fold-derivable fields of its persisted state.json.

#### Scenario: Derived memo matches a real completed run

- **WHEN** the memo is derived from an original completed run's events
- **THEN** depth, round, round cap, gate-null, status, last stage, and auto-extends-used match the persisted state.json (timestamps within the finalize-clock tolerance)

### Requirement: Corpus and synthetic conformance

The kernel SHALL fold every historical fixture and every tail scenario fixture identically to the legacy fold across all replay-state fields, including logs using the new choreography (exit-after-presented brackets, outcome-ordered settles, tail re-entries, crash-recovery appends).

#### Scenario: Synthetic tail fixtures fold identically

- **WHEN** the parity harness folds the extend-at-final, veto-at-final, abort-at-final, S-tail, and tail-crash-resume fixtures
- **THEN** kernel and legacy folds agree on every replay-state field at every event
