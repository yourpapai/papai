# agent-protected-paths Specification

## ADDED Requirements

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
