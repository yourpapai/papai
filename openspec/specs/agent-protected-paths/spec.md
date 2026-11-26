# agent-protected-paths Specification

## Purpose

Defines which repository paths a coding agent must never modify, and how a protected-path fix reaches the maintainer: the review push guard refuses re-applied protected content, and the reverted diff plus the needs-human finding carry the exact change instead of dying with the run.

## Requirements

### Requirement: Needs-human findings carry their manual-change content

When the review loop finishes with issues in the needs-human group, the run summary SHALL render
under each such issue's reference line the content a maintainer needs to apply it by hand: the
finding's suggested fix and, where the fixer produced one, the not-auto-fixable reasoning
describing the exact change — each truncated at a bounded length with the truncation visible.
When neither kind of content exists (a needs-human verdict forced by an infrastructure
fallback rather than a protected-path judgement), the summary SHALL say so and name the run's
ledger as the remaining record, instead of rendering an empty block.

#### Scenario: The suggested fix names the exact change

- **WHEN** a needs-human finding carries a suggested fix describing the change to apply
- **THEN** the run summary shows that text under the finding's line
- **AND** the pull-request report that folds the summary carries it too

#### Scenario: The fixer described the change in its reasoning

- **WHEN** a needs-human record holds the fixer's not-auto-fixable reasoning describing the exact change
- **THEN** the run summary renders that reasoning alongside the suggested fix

#### Scenario: The content is longer than the bound

- **WHEN** rendered manual-change content exceeds the summary's size bound
- **THEN** it is cut at the bound with an explicit truncation marker
- **AND** the summary still names where the full text lives (the run's ledger)

#### Scenario: An infrastructure fallback forced the needs-human verdict

- **WHEN** a needs-human record has neither a suggested fix nor fixer reasoning naming a change
- **THEN** the summary points at the run's ledger instead of rendering an empty manual-change block

### Requirement: The push guard's reverted diff reaches the pull-request report

When the review push guard reverts protected-path changes before a push, the review phase SHALL
capture the diff it took back out and render it in the review report on the pull request as an
apply-by-hand patch, bounded in size, so the maintainer can apply the fix the pipeline wrote and
verified without recovering it from git history. A capture that fails SHALL degrade to naming
the reverted paths (the prior behavior) and SHALL NOT fail the push or the report. A path
reverted across several pushes in one run SHALL be reported once, with the diff of its last
revert.

#### Scenario: The guard reverts a workflow edit the loop merged

- **WHEN** the review push guard reverts a protected-path change and pushes the rest
- **THEN** the review report on the pull request carries the reverted diff as a patch
- **AND** it says a maintainer must apply it by hand

#### Scenario: The diff cannot be captured

- **WHEN** reading the reverted diff fails before the revert completes
- **THEN** the report names the reverted path without a patch, as before this requirement
- **AND** the push and the report still succeed

#### Scenario: The same path is reverted on more than one push

- **WHEN** a run's push guard reverts the same protected path during several pushes
- **THEN** the report carries that path once, with the diff of the most recent revert

### Requirement: The protected-paths rule has one definition

The repository SHALL hold the protected-paths rule's text in one named constant per workspace
that needs it, duplicated rather than imported across workspace boundaries, and a test SHALL
fail when the copies diverge or when a carrier paraphrases, shortens, or weakens the rule.

#### Scenario: A carrier softens the rule

- **WHEN** an instruction surface that must carry the rule is edited to restate it in other words
- **THEN** the test asserting that carrier against the constant fails
- **AND** the divergence is reported as a failure of that carrier, naming it

#### Scenario: The rule names the manual alternative

- **WHEN** the constant's text is read
- **THEN** it forbids creating or editing files under `.github/workflows/`
- **AND** it states what to do instead: describe the change a maintainer should apply by hand

### Requirement: Every code-writing instruction surface receives the rule

Every instruction surface that asks an agent to write or change repository files SHALL carry the
protected-paths rule. This covers the autonomous pipeline's implementation, CI-fix and
plan-drafting prompts, and the review loop's fix and retry prompts.

#### Scenario: A review-loop fixer is dispatched

- **WHEN** the review loop dispatches an issue to a fixer, or re-dispatches it on a retry
- **THEN** the instruction the fixer receives carries the protected-paths rule

### Requirement: Protected-path fixes are reported, not applied

When a finding's genuine fix requires creating or editing a file under `.github/workflows/`, the
review loop SHALL report the finding for manual application instead of applying it: the reviewer
describes the exact change in its suggested fix, and the fixer returns a not-auto-fixable
verdict whose reasoning describes the exact change, editing nothing.

#### Scenario: The reviewer finds a defect whose fix is a workflow edit

- **WHEN** a reviewer finding's resolution requires editing a workflow file
- **THEN** the finding's suggested fix describes the change for a maintainer to apply by hand

#### Scenario: The fixer determines the fix requires a workflow edit

- **WHEN** a fixer verifies a finding whose only resolution is a protected-path edit
- **THEN** it returns the not-auto-fixable verdict with the exact change described in its reasoning
- **AND** it leaves the protected path unmodified

### Requirement: The review push guard never re-applies protected content

The review phase SHALL revert protected-path changes before pushing, and the push point it
records after a push SHALL name the head the remote accepted — including any revert the guard
itself committed — so a later guard pass can never treat the guard's own revert as a protected
change and restore the protected content it removed.

#### Scenario: A second push follows a guarded first push

- **WHEN** the guard reverted a protected path and pushed, and a later push in the same run runs
  the guard again
- **THEN** the revert commit the guard made is not seen as a protected-path change to restore
- **AND** the push that follows is not refused for the protected path the guard had removed

### Requirement: Reverted protected paths are reported to the maintainer

Protected paths the guard reverted before a push SHALL be named in the review report on the pull
request, with the instruction to apply them by hand if the finding is wanted.

#### Scenario: The guard reverted a workflow edit the loop merged

- **WHEN** the review phase reverts a protected path and pushes the rest
- **THEN** the report on the pull request names the reverted path
- **AND** it says a maintainer must apply the change by hand
