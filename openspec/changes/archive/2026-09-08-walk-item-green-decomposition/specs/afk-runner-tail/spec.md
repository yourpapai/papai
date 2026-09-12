# afk-runner-tail Specification — Delta

## ADDED Requirements

### Requirement: Walk-safe task granularity

The decomposer and atomicity prompts SHALL state the executor's granularity
contract: every task is one complete red→green cycle — the failing test and
its implementation land in the same task — and no task may leave the working
tree red when the executor's per-task affected check runs. Neither prompt SHALL
license test-only tasks; atomicity's verification wording SHALL read as "every
task must be independently green", not as "tasks may consist of a test alone".
The per-task affected check itself SHALL remain green-per-item with no
tolerance for declared-red tasks.

Rationale anchor: C9 finding F-P2 and the U13 audit decision (Option A) —
red-first test/impl splits structurally fail the walk's check and poison later
items; the measured correct granularity is the pair-merge.

#### Scenario: Decomposer prompt carries the granularity contract

- **WHEN** the decomposer prompt is built
- **THEN** it states that a failing test and its implementation land in the same task, that a test is never split into its own task, and that every task must leave the tree green for the executor's per-task affected check

#### Scenario: Atomicity prompt cannot license test-only tasks

- **WHEN** the atomicity prompt is built
- **THEN** its verification wording requires every task to be independently green, pairs a test with the implementation it verifies rather than splitting them, and contains no sentence readable as "a task may end at its own red test"

#### Scenario: Red-first pairs are not tolerated at the check

- **WHEN** an execution-armed walk runs an item whose work leaves the working tree red
- **THEN** the per-task affected check records the failure exactly as today — the check's green-per-item semantics are unchanged by the guidance
