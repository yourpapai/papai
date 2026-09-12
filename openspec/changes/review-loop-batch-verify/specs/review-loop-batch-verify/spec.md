## Purpose

Batche and verify review-loop fixes efficiently on CI: reviewer coalesces same-class findings into theme issues, fixer batches them sequentially, and the round pays one build plus one inspector over the aggregated diff with budget-aware deferral of lows.

## ADDED Requirements

### Requirement: Reviewer emits theme issues with spans
The system SHALL allow the reviewer to emit a theme issue that groups same-class findings across files, exposing per-span location and evidence instead of N flat issues, while preserving backward compatibility for single-span issues.

#### Scenario: Same-class leftovers emitted as one theme
- **WHEN** the reviewer finds 5 un-migrated English literals of the same migration class in different files
- **THEN** it emits ONE issue with `spans: [{file, lineStart, lineEnd, evidence}, ...]` (length 5) and the legacy `file/lineStart/lineEnd/evidence` mirrors the first span

#### Scenario: Single-file defect still emits one span
- **WHEN** the reviewer finds a one-file defect (e.g. double-post race in `language-picker.ts:54`)
- **THEN** it emits a single-span issue and the system treats it identically to a legacy flat issue

#### Scenario: Backward compatibility
- **WHEN** a legacy `issues.json` contains only `file/lineStart/lineEnd/evidence` (no `spans`)
- **THEN** the system parses it as a single-span issue and processes it as a batch of one

#### Scenario: Theme issue preserves matching semantics
- **WHEN** a theme issue with spans is matched against the ledger
- **THEN** it creates or reopens exactly one `LedgerIssueRecord` (not N) and `latestSeenRound` reflects the round that emitted the theme

### Requirement: Batch clustering and sequential fixer dispatch
The system SHALL cluster pending ledger issues into theme batches and dispatch one fixer agent per batch sequentially (`poolSize=1`), without per-issue or per-batch build or inspector steps.

#### Scenario: Same-theme lows clustered into one batch
- **WHEN** pending contains 5 `low` cleanup issues sharing a title/evidence n-gram (e.g. “English” + “localized”) or a theme issue with 5 spans
- **THEN** the system creates one batch for those members and dispatches exactly one fixer run for the batch

#### Scenario: Defects and cleanups not mixed in one batch
- **WHEN** pending contains `defect` and `cleanup` issues
- **THEN** the system does not place them in the same batch; `defect` batches are dispatched before `cleanup` batches (respecting existing kind-first order)

#### Scenario: Fixer returns per-issue outcomes for the batch
- **WHEN** a batch fixer completes
- **THEN** its result carries per-issue `{id, verdict, fixed, severity, exposure, targetFiles, reasoning}` for each member and the ledger records each member individually via the existing `recordVerification` / `tally*` paths

#### Scenario: No per-issue build or inspector during batch fixing
- **WHEN** `batchVerify` is enabled and a batch fixer completes
- **THEN** the system does not run `check:full` or the inspector before dispatching the next batch; changes remain uncommitted until the round-level verification step

### Requirement: Single aggregated build per round
The system SHALL run exactly one `check:full` build over the aggregated working-tree diff after all batches have run, and attribute its outcome back to contributing issues/batches.

#### Scenario: Aggregated build passes
- **WHEN** the single round-level build passes
- **THEN** all batches whose fixer claimed `fixed:true` proceed to the aggregated inspector step and then to per-batch commits

#### Scenario: Aggregated build fails with file attribution
- **WHEN** the aggregated build fails and `git diff --name-only` shows only files belonging to one batch’s spans
- **THEN** the system marks that batch’s `fixed:true` members as `needs_human` (with build stderr), leaves other passing batches eligible for inspector/merge, and does not merge the failing batch

#### Scenario: Aggregated build fails with ambiguous attribution
- **WHEN** the aggregated build fails and the failing files cannot be attributed to a single batch
- **THEN** the system marks all `fixed:true` batches in the round as `needs_human` with the build stderr and does not merge any of them; the next round may split them as singles

### Requirement: Single aggregated inspector per round
The system SHALL run exactly one inspector over the aggregated diff after the aggregated build passes, returning a per-issue `addresses` verdict that gates merging per batch member.

#### Scenario: Inspector approves all members
- **WHEN** the aggregated inspector returns `addresses:true` for every `fixed:true` member
- **THEN** the system proceeds to merge each successful batch

#### Scenario: Inspector rejects a subset
- **WHEN** the aggregated inspector returns `addresses:false` for one member and `true` for others
- **THEN** the system marks the rejected member `needs_human` (inspector reasoning recorded), merges the approved members, and does not merge the rejected member’s batch slice

#### Scenario: Inspector unavailable
- **WHEN** the aggregated inspector agent fails or times out
- **THEN** the system treats it as a rejection for all `fixed:true` members in the round (`needs_human`, reasoning “inspector unavailable”), merges nothing from the round, and preserves diffs for split retry next round

### Requirement: Budget-aware deferral of lows
The system SHALL defer remaining `low`/`cleanup` batches when estimated remaining wall-clock is insufficient to complete them, leaving the ledger in a state that makes deferred work visible and resumable.

#### Scenario: Time remains for defects but not for lows
- **WHEN** `runTimeoutMs` is set and remaining time is sufficient for pending `defect`/`medium+` batches but not for remaining `low`/`cleanup` batches
- **THEN** the system defers the `low`/`cleanup` batches (no fixer started), keeps their ledger status `discovered` with `latestSeenRound` bumped, and continues with defects

#### Scenario: Critical/high never deferred
- **WHEN** remaining time is low and pending contains `critical` or `high` defects
- **THEN** the system does not defer them; it starts them even if the run may become `stopped` mid-batch (honored at the next between-batch boundary)

#### Scenario: Deferred work visible in summary
- **WHEN** the round ends with deferred batches
- **THEN** `summary.txt` and `metrics.json` report a `deferred` count distinct from `open`/`needs_human`, and the next round’s reviewer and matcher re-consider deferred issues

### Requirement: Commits and merges per successful batch
The system SHALL commit and merge each batch that passed both aggregated build and aggregated inspector, using one commit per batch and the existing primary-branch mutex, and SHALL NOT merge any failing or deferred batch.

#### Scenario: Successful batches merged sequentially
- **WHEN** two batches passed aggregated verification
- **THEN** the system creates one commit per batch (subject cites the batch theme/ids) and `mergeWorkerIntoPrimary` merges each under the primary lock, publishing each as today (`[review-loop] published fix…`) when `mergeEachFix` is enabled

#### Scenario: Partial success merges only passing batches
- **WHEN** one batch passed and another failed aggregated build
- **THEN** the system merges the passing batch and does not merge the failing batch (its diff is reset)

#### Scenario: Summary reflects batched verification
- **WHEN** a round used batched verification
- **THEN** `metrics.json` counts one `build` and one `inspect` per round (not per issue), and phase timings attribute the single aggregated durations to the round
