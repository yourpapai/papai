## Purpose

Lets a user watch individual tasks through the alert tool ("notify me when issue #42 changes", firing on any visible change to that task), and stops the alert poller from downloading the task instance's entire task list when only per-task watches are active.

## ADDED Requirements

### Requirement: Per-task watch condition is expressible

The alert-creation tool SHALL accept `task.id` as a condition field supporting only the `eq` operator, with a required value (string or number). `task.id` conditions SHALL compose under `and`/`or` with any other conditions, at any nesting depth. Validation SHALL reject any operator other than `eq` for `task.id`, and a `task.id eq` leaf without a value, using the same validation error messages as the other condition fields.

#### Scenario: Single-task watch is created

- **WHEN** the LLM creates an alert whose condition is `{ "field": "task.id", "op": "eq", "value": "42" }`
- **THEN** the alert is created and stored as active with that condition, and the result reports its cooldown

#### Scenario: Unsupported operator is rejected

- **WHEN** the LLM submits a condition leaf `{ "field": "task.id", "op": "neq", "value": "42" }` (or any operator other than `eq`)
- **THEN** validation fails with a message naming the field, the invalid operator, and `eq` as the only valid operator

#### Scenario: Missing value is rejected

- **WHEN** the LLM submits `{ "field": "task.id", "op": "eq" }` with no value
- **THEN** validation fails with a message stating that `eq` requires a value

#### Scenario: Composes inside boolean conditions

- **WHEN** the LLM creates an alert with condition `{ "or": [{ "field": "task.id", "op": "eq", "value": "42" }, { "field": "task.id", "op": "eq", "value": "43" }] }`
- **THEN** the alert is created, and a top-level condition `and`-ing or `or`-ing `task.id` leaves with other condition fields is likewise accepted

### Requirement: Task id predicate matching

A `task.id eq X` condition leaf SHALL match exactly the task whose id equals `X` and SHALL NOT match any other task, whatever the other field values of that task.

#### Scenario: Matches only the identified task

- **WHEN** a condition `task.id eq 42` is evaluated against a set of tasks containing task `42` and other tasks
- **THEN** exactly task `42` satisfies the leaf, regardless of the other tasks' fields

### Requirement: Pure per-task watch firing

An alert whose condition tree consists only of `task.id eq` leaves (in any `and`/`or` shape) SHALL be treated as a per-task watch. A per-task watch SHALL fire when a watched task's change-tracked fields (status, priority, assignee, due date, project, labels) differ from the snapshot stored for that task in the watch owner's conversation context at the previous evaluated cycle.

- The first evaluated cycle after creation for which no stored snapshot exists for a watched task SHALL establish the baseline without firing.
- A cycle in which no watched task changed relative to the stored snapshots SHALL NOT fire.
- The alert's cooldown (in minutes since its last trigger, default 60) SHALL continue to gate eligibility: changes observed while the watch is within its cooldown do not fire it.
- A watched task the task provider does not return SHALL be skipped for that cycle without failing the evaluation of the other watched tasks or of other alerts.
- On firing, the alert's trigger bookkeeping SHALL behave as for existing alerts: the last-trigger timestamp is set, the recorded matched task ids become the watched ids present in the fetched set, and stored snapshots are updated from the fetched tasks.

#### Scenario: Fires on a visible change to the watched task

- **WHEN** a per-task watch on task `42` has a stored baseline snapshot and a later poll cycle observes task `42` with a different status, priority, assignee, due date, project, or labels
- **THEN** the alert fires and its delivery is sent to the alert's delivery target

#### Scenario: Baseline cycle does not fire

- **WHEN** a per-task watch is evaluated for the first time after creation and no snapshot was previously stored for its watched task
- **THEN** the cycle stores the baseline snapshot and does not fire

#### Scenario: Unchanged cycle does not fire

- **WHEN** a poll cycle observes every watched task identical to its stored snapshot
- **THEN** the alert does not fire

#### Scenario: Cooldown suppresses an immediate re-fire

- **WHEN** a per-task watch fires and the watched task changes again before its cooldown window (default 60 minutes) has elapsed
- **THEN** the alert does not fire again until the cooldown has elapsed and a further change is observed

#### Scenario: Missing watched task is skipped

- **WHEN** a poll cycle cannot retrieve one of a watch's watched tasks but retrieves the others
- **THEN** the missing task is skipped for that cycle, and the watch still evaluates (and may fire) on changes to the retrieved watched tasks

### Requirement: Composed conditions keep existing firing semantics

Conditions that mix `task.id` leaves with any other condition field SHALL keep the existing alert firing semantics unchanged: `task.id` only narrows which tasks can satisfy the condition, firing still happens only when tasks newly match versus the alert's recorded matched task ids, and the existing whole-context "no task changes" early exit still applies to those alerts.

#### Scenario: task.id narrows a field condition

- **WHEN** an alert's condition is `and(task.id eq 42, task.status changed_to "Done")` and task `42` moves to `Done`
- **THEN** the alert fires under the same matched-set edge semantics as before this capability, and other tasks moving to `Done` do not fire it

#### Scenario: Unchanged context still short-circuits

- **WHEN** an instance poll serves only composed (non-pure-watch) alerts and no change-tracked field changed for the conversation context
- **THEN** alert evaluation is skipped for that context exactly as before, with no firing and no snapshot changes

### Requirement: Targeted polling for pure-watch instances

When every alert eligible in a task-instance poll — across every conversation context group routable for that instance — is a pure per-task watch, the poller SHALL fetch only the union of the watched task ids through the task provider's single-task retrieval, with bounded concurrency, and SHALL NOT enumerate the task instance (no project listing, task listing, or task search). A failure of a single-task fetch SHALL abort that instance's cycle: no alerts fire and no snapshots or alert state are updated for that instance in that cycle, and the failure is logged.

When at least one non-watch alert is eligible for the instance, the poller SHALL keep the existing whole-list fetch path (including task enrichment when required), and pure watches in that instance SHALL evaluate their watch semantics against their watched tasks as drawn from the full task list; when another alert in the same instance poll causes richer task details to be fetched, changes to the richer change-tracked fields of a watched task also count.

The targeted fetch SHALL run against the same task instance the alerts resolve to (a per-alert pinned instance or the context's currently configured instance), and instance pinning behavior SHALL be unchanged. An instance whose task provider cannot be resolved — including when no task instance is configured — SHALL be skipped for the cycle exactly as for existing alerts, without firing.

#### Scenario: Pure-watch instance skips whole-list enumeration

- **WHEN** all eligible alerts for a task instance are pure per-task watches
- **THEN** the poll fetches each watched task individually and issues no project-listing, task-listing, or task-search request to the task provider

#### Scenario: Watched ids are deduplicated across context groups

- **WHEN** multiple context groups in the same instance poll watch the same task id (or one watch lists the same id in several `task.id` leaves)
- **THEN** the task is fetched once per cycle for the instance, not once per alert or per context group

#### Scenario: Mixed instance keeps the whole-list path

- **WHEN** an instance poll has at least one eligible alert that is not a pure per-task watch
- **THEN** the poll fetches the instance's full task list (with enrichment as today), and pure watches in that instance still fire on changes to their watched tasks

#### Scenario: Single-task fetch failure aborts the instance cycle

- **WHEN** a targeted fetch for a pure-watch instance fails for one of the watched tasks
- **THEN** no alert fires and no alert or snapshot state is updated for that instance in that cycle, and the failure is logged with its error message

#### Scenario: Pinned task instance is honored

- **WHEN** a per-task watch was created pinned to a specific task instance and that instance differs from the context's currently configured one
- **THEN** the targeted fetch and evaluation run against the pinned instance, with pinning and unpinning behavior unchanged from existing alerts

#### Scenario: Unconfigured task instance is skipped

- **WHEN** a pure-watch instance poll cannot resolve a task provider because no task instance is configured for the context
- **THEN** the cycle is skipped without firing, exactly as for existing alerts
