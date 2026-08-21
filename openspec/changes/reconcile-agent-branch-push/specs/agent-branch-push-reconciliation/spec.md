## Purpose

Defines how the GitHub Actions agent's pushes to `agent/issue-<n>` reconcile with a remote branch that advanced mid-run, so a maintainer pushing to the branch during a multi-hour phase neither fails the run nor silently strands the agent's commits.

## ADDED Requirements

### Requirement: Pushes reconcile a remote branch that advanced mid-run

Before every push of an `agent/issue-<n>` branch, the system SHALL fetch the branch from the remote and, when the remote tip contains commits local HEAD does not, integrate them with a non-interactive merge before pushing the merged result. The system SHALL NOT force-push on this path.

#### Scenario: Human pushed while the review loop ran

- **WHEN** a review-loop fix is published and pushed, a maintainer then pushes their own commits (including a merge that already contains the agent's pushed fix) to the same branch, and the loop publishes its next fix
- **THEN** the push fetches the branch, merges the remote tip into the local branch without discarding either line, and the push succeeds, keeping the maintainer's commits and the new fix on the remote

#### Scenario: Remote unchanged skips integration

- **WHEN** the remote branch tip is already an ancestor of local HEAD at push time
- **THEN** the system SHALL push without creating a merge commit

#### Scenario: Branch not yet on the remote

- **WHEN** the branch being pushed does not exist on the remote (first push after branch capture)
- **THEN** the system SHALL push without attempting integration and without treating the missing remote ref as an error

### Requirement: Reconciliation conflicts are diagnosed, not hinted

When the reconciliation merge conflicts, the system SHALL abort the merge, leave the working tree clean, and fail the push with an error that names the conflicted paths, rather than surfacing git's generic non-fast-forward rejection text.

#### Scenario: Human rewrote the same files a fix touched

- **WHEN** the remote tip's changes conflict with the local branch's unpushed commits during the reconciliation merge
- **THEN** the merge is aborted and the reported failure names each conflicted path so a maintainer can resolve by hand

### Requirement: Per-call-site failure semantics are preserved

Reconciliation SHALL NOT change which push failures are fatal: a mid-loop review-fix push that still fails after reconciliation logs a warning and the run continues, while a phase's final push failure fails the run with its resume point intact.

#### Scenario: Mid-loop push failure does not kill the loop

- **WHEN** a reconciliation or push attempted while the review loop is running fails (for example a transient lock contention with the loop's own merge into the checkout)
- **THEN** the failure is logged as a warning and the loop is not interrupted; the phase's final push carries the fixes

#### Scenario: Final push failure still parks for retry

- **WHEN** the phase's final push fails after a conflicted reconciliation
- **THEN** the run is reported failed with the phase as its resume point and the conflicted paths in the report

### Requirement: Agent credentials and subprocess boundaries are unchanged

Reconciliation SHALL run git in the pipeline process with the existing per-invocation credential environment; no credential SHALL become visible to review-loop subprocesses or their model-controlled children, and no new credential surface SHALL be introduced.

#### Scenario: Loop subprocesses never see the push credential

- **WHEN** the reconciling fetch and push run while the review loop's subprocesses are alive
- **THEN** the credential is present only in the pipeline-side git child environment, as before

### Requirement: No papai runtime or scope-model effects

The capability SHALL be confined to the `opencode-agent` CI pipeline's git layer; it SHALL NOT touch papai platform instances, task instances, config or storage context ids, or `tool_prefs`.

#### Scenario: Papai scope unchanged

- **WHEN** any reconciling push runs
- **THEN** no papai persisted state is created or modified
