## ADDED Requirements

### Requirement: Depth override warns what it discards

A `start` invoked with `--depth` SHALL emit a warn line on the operator output
naming that scope estimation was skipped — no independent depth reading is
computed — and naming what the forced profile decides for that run: the review
round cap for the forced profile, and, when the forced profile is S, that the
atomicity stage is skipped with decomposition presenting the final gate.

#### Scenario: S override names the cap and the tail

- **WHEN** `start` runs with `--depth S`
- **THEN** an intake warn line names the skipped scope estimation, the S review round cap, and that S skips atomicity with decomposition presenting the final gate

#### Scenario: M override names the cap without a tail claim

- **WHEN** `start` runs with `--depth M`
- **THEN** the warn line names the skipped scope estimation and the M review round cap, and makes no atomicity claim

### Requirement: Divergent depth readings are surfaced

When the estimator's profile and the keyword prescreen's profile disagree by two
levels, intake SHALL emit a warn line naming both readings and stating that the
higher one is taken. The depth event SHALL continue recording the disagreement
flag for replay and analysis.

#### Scenario: Two-level split warns with both readings

- **WHEN** the estimator classifies a task L and the keyword prescreen reads S
- **THEN** a warn line names both readings and the higher one taken, and the recorded depth event still carries the disagreement flag

### Requirement: Command doc flags stay parseable

The front-door command doc (`.claude/commands/sdd-auto.md`) SHALL document only
flag forms the `start` argument parsing accepts. Every flag the doc names SHALL
parse through the same argument parsing the `start` verb uses, so the doc cannot
drift into unknown-flag errors.

#### Scenario: Documented flag inventory parses

- **WHEN** every flag the command doc names is run through the `start` argument parsing with its documented value form
- **THEN** each documented flag is accepted with no unknown-flag or invalid-value error
