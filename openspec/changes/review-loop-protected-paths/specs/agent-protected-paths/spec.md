# agent-protected-paths Specification

## Purpose

Defines how the autonomous coding agent and its review loop treat repository paths a push from
the pipeline's token cannot carry (files under `.github/workflows/`): the single rule every
code-writing instruction surface states, the manual-application behavior that replaces the
forbidden edit, and the push-guard invariants that contain a protected edit without ever
re-applying one.

## ADDED Requirements

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
