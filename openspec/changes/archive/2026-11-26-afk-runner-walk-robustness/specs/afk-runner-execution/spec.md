# afk-runner-execution Specification — Delta

## ADDED Requirements

### Requirement: Implement halts on structural preconditions

When the implement state cannot read the change folder's `tasks.md`, it SHALL
declare a precondition stage-halt through the C6 failure taxonomy — kind
`precondition`, with a resume hint naming the restoration — instead of an
untyped crash. The drive bracket SHALL record `stage_failed` with that kind,
and the existing immediate-escalation semantics for preconditions SHALL
govern, exactly as the atomicity stage already does for the same structural
gap.

#### Scenario: Missing tasks.md escalates, not crashes

- **WHEN** an execution-armed run enters implement and the change folder's tasks.md is absent
- **THEN** the log records `stage_failed{implement, precondition}` naming the unreadable path, no refusal alarm fires, and the run parks at the escalation gate rather than dying

#### Scenario: Recovery is resume after restore

- **WHEN** the operator restores the change folder and resumes the escalated run
- **THEN** implement re-enters and re-picks the first item the fold still owes

### Requirement: Execution checks are wall-capped

The production command seam that runs the per-task affected check and the
verify boundary's gate set SHALL enforce a compiled wall cap on every check
process. A check that exceeds the cap SHALL report a non-zero exit whose
output names the cap, so red routing, fix context, and task-failure details
attribute the failure to the timeout and not to a phantom regression. The cap
SHALL be sized above any legitimate gate-set run of the repository.

#### Scenario: A hung check is capped and reported

- **WHEN** a check process spawned by the seam does not exit within the compiled cap
- **THEN** the seam returns a non-zero result carrying a marker line naming the wall cap, and the walk's existing red routing handles it without hanging

#### Scenario: Legitimate checks never trip the cap

- **WHEN** the repository's full gate set runs to completion under the cap
- **THEN** the check result is the process's own exit code and output, unchanged from today
