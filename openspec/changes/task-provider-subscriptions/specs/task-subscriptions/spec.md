## Purpose

Edge-triggered tracker watches delivered through the alert tool: per-task watches on individual task ids, activity watches on a task's history, both pinned to the task instance they were created against, cancelled when that instance is switched away or deleted, and governed by shared cooldown/no-refire discipline and per-context tool permission gating on alert creation.

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
- On firing, the alert's trigger bookkeeping SHALL behave as for other alerts: the last-trigger timestamp is set, the recorded matched task ids become the watched ids present in the fetched set, and stored snapshots are updated from the fetched tasks.

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

### Requirement: Composed conditions keep matched-set firing semantics

Conditions that mix `task.id` leaves with any other condition field SHALL keep the general alert firing semantics unchanged: `task.id` only narrows which tasks can satisfy the condition, firing still happens only when tasks newly match versus the alert's recorded matched task ids, and the existing whole-context "no task changes" early exit still applies to those alerts.

#### Scenario: task.id narrows a field condition

- **WHEN** an alert's condition is `and(task.id eq 42, task.status changed_to "Done")` and task `42` moves to `Done`
- **THEN** the alert fires under the same matched-set edge semantics as before this capability, and other tasks moving to `Done` do not fire it

#### Scenario: Unchanged context still short-circuits

- **WHEN** an instance poll serves only composed (non-pure-watch) alerts and no change-tracked field changed for the conversation context
- **THEN** alert evaluation is skipped for that context exactly as before, with no firing and no snapshot changes

### Requirement: Targeted polling for pure-watch instances

When every alert eligible in a task-instance poll — across every conversation context group routable for that instance — is a pure per-task watch, the poller SHALL fetch only the union of the watched task ids through the task provider's single-task retrieval, with bounded concurrency, and SHALL NOT enumerate the task instance (no project listing, task listing, or task search). A failure of a single-task fetch SHALL abort that instance's cycle: no alerts fire and no snapshots or alert state are updated for that instance in that cycle, and the failure is logged.

When at least one non-watch alert is eligible for the instance, the poller SHALL keep the existing whole-list fetch path (including task enrichment when required), and pure watches in that instance SHALL evaluate their watch semantics against their watched tasks as drawn from the full task list; when another alert in the same instance poll causes richer task details to be fetched, changes to the richer change-tracked fields of a watched task also count.

The targeted fetch SHALL run against the same task instance the alerts resolve to (a per-alert pinned instance or the context's currently configured instance), and instance pinning behavior SHALL be unchanged. An instance whose task provider cannot be resolved — including when no task instance is configured — SHALL be skipped for the cycle exactly as for other alerts, without firing.

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
- **THEN** the targeted fetch and evaluation run against the pinned instance, with pinning and unpinning behavior unchanged from other alerts

#### Scenario: Unconfigured task instance is skipped

- **WHEN** a pure-watch instance poll cannot resolve a task provider because no task instance is configured for the context
- **THEN** the cycle is skipped without firing, exactly as for other alerts

### Requirement: Activity alert condition kind

The alert-creation tool SHALL accept an activity condition kind consisting of a required task id and an optional list of activity categories. An activity condition missing the task id SHALL be rejected as invalid input. Activity conditions SHALL be combinable under the existing `and`/`or` condition combinators together with other activity conditions. The system SHALL render a human-readable description of an activity condition (identifying the watched task and, when present, the categories) wherever alert conditions are described to the user.

#### Scenario: Activity condition accepted without categories

- **WHEN** the user creates an alert whose condition is `{ kind: 'activity', taskId: 'TASK-1' }` through the alert-creation tool on a capable tracker
- **THEN** the alert is created and stored with that condition

#### Scenario: Activity condition accepted with categories

- **WHEN** the user creates an alert whose condition is `{ kind: 'activity', taskId: 'TASK-1', categories: ['comment'] }` on a capable tracker
- **THEN** the alert is created and stored with the category filter attached to the condition

#### Scenario: Missing task id rejected

- **WHEN** an activity condition without `taskId` is submitted to the alert-creation tool
- **THEN** the condition is rejected as invalid input and no alert is created

#### Scenario: Activity conditions nest under and/or combinators

- **WHEN** an alert condition combines two activity leaves with `and` or `or`
- **THEN** the combined condition is accepted and treated as a pure-activity tree

#### Scenario: Readable description of an activity condition

- **WHEN** the system describes an alert whose condition is an activity leaf
- **THEN** the description names the activity kind, the watched task id, and the categories when categories are set

### Requirement: Activity watch creation gated on activity reading and task instance

The alert-creation tool SHALL accept an activity condition only when the delivery context has a configured (non-null) task instance whose task provider exposes activity reading — the `activities.read` capability and a task-history lookup. Otherwise the tool SHALL refuse the activity condition with a guidance error, in the same error-result shape used by other tool errors, telling the user the tracker does not expose task history. Field-value alert conditions SHALL remain acceptable regardless of this gate.

#### Scenario: Refused when tracker lacks activity support

- **WHEN** the context's task provider does not expose `activities.read` or a task-history lookup and the user submits an activity condition
- **THEN** the alert-creation tool returns a guidance error stating the tracker does not expose task history and no alert is created

#### Scenario: Refused when no task instance is configured

- **WHEN** the delivery context has no task instance configured (null) and the user submits an activity condition
- **THEN** the alert-creation tool returns a guidance error and no alert is created

#### Scenario: Accepted when capable and configured

- **WHEN** the context's task provider exposes `activities.read` and a task-history lookup and a task instance is configured
- **THEN** the alert-creation tool accepts the activity condition and creates the alert

### Requirement: Condition trees are pure-activity or pure-field

The alert-creation tool SHALL reject, with a guidance error, a condition tree that mixes activity leaves with field-value leaves; only pure-activity trees and pure-field trees SHALL be accepted. The rejection SHALL name the mixing as the reason so the user can split the alert.

#### Scenario: Mixed tree refused at creation

- **WHEN** an alert condition combines an activity leaf with a field-value leaf under `and` or `or`
- **THEN** the alert-creation tool returns a guidance error explaining activity and field conditions cannot be mixed in one alert and no alert is created

#### Scenario: Pure-activity tree accepted

- **WHEN** an alert condition tree contains only activity leaves
- **THEN** the tree is accepted and evaluated by activity polling

### Requirement: Baseline-then-edge-triggered activity polling

Activity alerts SHALL be evaluated by polling the task provider's history for the watched task. The first poll after creation SHALL establish a baseline: the system stores the newest activity timestamp as the alert's activity cursor and fires nothing. Subsequent polls SHALL fire the alert when history entries newer than the cursor appear, passing the condition's categories (when present) to the history lookup. After a successful delivery the cursor SHALL advance to the newest entry seen. Entries at or below the cursor SHALL never (re)fire the alert. An alert watching multiple tasks (a multi-leaf tree) SHALL watch the union of its task ids with a single per-alert cursor equal to the newest timestamp seen across them.

#### Scenario: First poll baselines without firing

- **WHEN** a newly created activity alert is polled for the first time and the task already has history entries
- **THEN** the system stores the newest entry's timestamp as the alert's activity cursor and delivers nothing

#### Scenario: New activity fires the alert

- **WHEN** a later poll finds history entries newer than the alert's cursor
- **THEN** the alert fires and its summary is delivered through the alert's configured delivery context

#### Scenario: Already-seen entries never refire

- **WHEN** a poll finds only entries at or older than the alert's cursor
- **THEN** the alert does not fire and its cursor is unchanged

#### Scenario: Cursor advances only after successful delivery

- **WHEN** an activity alert fires and delivery succeeds
- **THEN** the alert's activity cursor advances to the newest entry seen in that poll and its last-triggered timestamp is recorded

#### Scenario: Categories passed to the history lookup

- **WHEN** an activity alert with categories set is polled
- **THEN** the history lookup for the watched task is requested with those categories

#### Scenario: Cooldown suppresses immediate refire

- **WHEN** an activity alert fired within its cooldown window and new activity appears before the cooldown elapses
- **THEN** the alert is not delivered again until the cooldown elapses, under the same cooldown eligibility the other alert kinds use

#### Scenario: Multi-task tree watches the union

- **WHEN** an alert's pure-activity tree watches tasks A and B and new activity appears on either task
- **THEN** the alert fires, and afterwards the single per-alert cursor equals the newest timestamp seen across both tasks so older entries on the other task do not refire it

### Requirement: Graceful degradation on capability loss at poll time

If, at poll time, the provider backing an activity alert no longer exposes activity reading (the capability is gone or the history lookup is missing), the system SHALL skip that alert for the cycle with a warning, leave its cursor unchanged, and continue processing the remaining alerts without the poll cycle failing.

#### Scenario: Capability lost between creation and poll

- **WHEN** an activity alert is polled and its provider no longer exposes a history lookup or the `activities.read` capability
- **THEN** the alert is skipped with a warning, its cursor is unchanged, and no alert delivery occurs for it that cycle

#### Scenario: Other alerts still processed

- **WHEN** one provider loses activity support while other routable alerts exist in the same cycle
- **THEN** the cycle completes and the other alerts are evaluated normally

### Requirement: Activity-only contexts skip whole-list fetches

When every routable alert for a context is a pure-activity alert or a pure-watch task-equality alert, the poll cycle for that context SHALL NOT fetch the task list (no project listing, task listing, or task search). When a context mixes activity alerts with field-value alerts, the cycle SHALL still perform the task-list fetch for the field-value alerts while the activity alerts are evaluated through history lookups.

#### Scenario: Activity-only context performs no list fetch

- **WHEN** a context's routable alerts are all activity alerts (or all pure-watch task-equality alerts)
- **THEN** the poll cycle issues no project-list, task-list, or task-search request to the provider

#### Scenario: Mixed context still lists tasks for field alerts

- **WHEN** a context has both activity alerts and field-value alerts
- **THEN** the poll cycle fetches the task list for the field-value alert evaluation and evaluates the activity alerts via history lookups

### Requirement: Firing summaries treat activity content as untrusted

An activity alert's firing summary SHALL apply the same untrusted-content framing used for other external-data summaries: the summary is prefaced with external-data framing and activity-derived fields (author, category, field names, added and removed text) are wrapped as untrusted content so they cannot be mistaken for system or bot output.

#### Scenario: Summary wraps activity-derived content

- **WHEN** an activity alert fires and its history entries contain attacker-controlled text in author, category, field, added, or removed values
- **THEN** the delivered summary frames those values as untrusted external data rather than plain trusted text

### Requirement: Alerts record their creating task instance

The system SHALL capture the task instance configured for the alert's delivery config context at alert creation time and store it on the alert as its pin. Alerts created in a config context with no task instance configured SHALL store a NULL pin. Alerts that predate pinning SHALL keep a NULL pin, with no backfill.

#### Scenario: Alert created with a configured task instance

- **WHEN** a user creates an alert while the alert's delivery config context has task instance A configured
- **THEN** the stored alert is pinned to A

#### Scenario: Alert created with no task instance configured

- **WHEN** a user creates an alert in a config context whose task instance is not configured (null)
- **THEN** the stored alert has a NULL pin

#### Scenario: Legacy alerts keep a NULL pin

- **WHEN** an alert created before pinning existed is loaded after the capability ships
- **THEN** its pin is NULL and its behavior is unchanged from before pinning existed

### Requirement: Pinned alerts evaluate against the pinned instance

The system SHALL resolve the task provider for an alert with a non-NULL pin from the pinned task instance, regardless of which task instance the delivery config context currently has configured. Context-scoped fields of the provider configuration other than the instance (for example a per-context token) SHALL still come from the alert's delivery context. The system SHALL NOT evaluate a pinned alert against a task instance other than its pin. An alert with a NULL pin SHALL resolve its task provider from the delivery config context's currently configured task instance, exactly as before pinning existed.

#### Scenario: Context switches tracker after alert creation

- **WHEN** an alert pinned to instance A is due for evaluation and its delivery config context is now configured with instance B
- **THEN** the alert is evaluated through instance A's task provider and never through B's

#### Scenario: Per-context credentials still come from the delivery context

- **WHEN** a pinned alert is evaluated and its provider configuration includes a context-scoped credential
- **THEN** that credential is taken from the alert's delivery context, not from whichever context owns the pinned instance

#### Scenario: NULL-pinned alert follows its context

- **WHEN** a NULL-pinned alert is due for evaluation
- **THEN** it is evaluated through the task provider resolved from its delivery config context's current task instance, matching pre-pinning behavior

### Requirement: Unresolvable pin auto-cancels the alert

The system SHALL set the status of any active alert to `cancelled` when its non-NULL pin refers to a task instance that no longer resolves (deleted or otherwise unresolvable), SHALL log the cancellation at info level, and SHALL NOT evaluate such an alert against any other task instance. This SHALL hold both when detected during alert polling and when detected via an explicit task-instance switch or delete path.

#### Scenario: Polling detects a deleted pinned instance

- **WHEN** an active alert pinned to instance A comes due for evaluation and instance A no longer resolves
- **THEN** the alert's status becomes `cancelled`, the cancellation is logged at info level, and no evaluation is performed for it

#### Scenario: Cancelled alert is never re-pointed

- **WHEN** an alert pinned to a no-longer-resolvable instance A is handled and its delivery context has instance B configured
- **THEN** the alert is cancelled rather than evaluated against B

### Requirement: Switching a context's task instance cancels old-pinned alerts

The system SHALL, when a config context's task instance assignment changes away from an old instance, cancel every active alert pinned to that old instance whose delivery target resolves into that config context, logging each cancellation at info level. Active alerts with a NULL pin or a pin on an unaffected instance that deliver into the same config context SHALL remain active.

#### Scenario: Switch cancels alerts pinned to the old instance

- **WHEN** a config context's task instance changes from A to B and active alerts pinned to A deliver into that config context
- **THEN** those alerts are cancelled with an info log and are not silently re-pointed to B

#### Scenario: NULL-pinned alerts survive a switch

- **WHEN** a config context's task instance changes and NULL-pinned alerts deliver into that config context
- **THEN** those alerts remain active and at their next evaluation resolve via the context's newly configured task instance

#### Scenario: Alerts pinned to other instances survive a switch

- **WHEN** a config context's task instance changes from A to B and an active alert pinned to instance C (distinct from A) delivers into that config context
- **THEN** that alert remains active and continues to be evaluated against C

### Requirement: Deleting a task instance cancels its pinned alerts first

The system SHALL cancel every active alert pinned to a task instance, regardless of delivery config context, before that task instance is deleted, logging each cancellation at info level. Data-level referential integrity on deletion SHALL remain only as a backstop, not as the primary cancellation mechanism.

#### Scenario: Delete cancels all pinned alerts across contexts

- **WHEN** a task instance A holding active pinned alerts is deleted
- **THEN** each of those alerts is cancelled with an info log before the task instance is removed, including alerts delivering into config contexts other than the one that owned A

### Requirement: Cooldown and no-refire across alert kinds

Every alert kind — field-condition alerts, per-task watches, and activity watches — SHALL share one cooldown eligibility rule: an alert SHALL NOT fire again within its cooldown window (minutes since its last trigger, default 60), however many further changes or history entries appear. Field-condition alerts SHALL fire only when tasks newly match versus the alert's recorded matched task ids, and activity alerts SHALL never refire history entries at or below their cursor, so no alert kind refires on already-reported state.

#### Scenario: Cooldown gates every alert kind equally

- **WHEN** an alert of any kind fires and its watched state changes again before its cooldown window (default 60 minutes) elapses
- **THEN** the alert is not delivered again until the cooldown has elapsed and a further change or new activity is observed

#### Scenario: Already-reported state never refires

- **WHEN** a poll observes only matches an alert has already reported — tasks already in a field-condition alert's recorded matched set, watched tasks identical to their stored snapshots, or history entries at or below an activity alert's cursor
- **THEN** the alert does not fire

### Requirement: Alert creation tool permission gating

The alert-creation tool SHALL be subject to the per-context tool permission preferences, resolved most-specific-wins: a per-tool override (including one recorded under the tool's previous name) over a per-domain default over a per-risk default over the implicit default `allow`. A resolved `deny` SHALL remove the tool from the resolved tool set so it cannot be invoked. A resolved `ask` SHALL expose the tool with a required user-facing permission-reason input, so each call MUST be approved by the user before execution; a refused or unavailable approval SHALL return a structured permission-denied result and create no alert. A resolved `allow` SHALL expose the tool callable without additional permission confirmation.

#### Scenario: Default permission is allow

- **WHEN** no permission preference entry touches the alert-creation tool
- **THEN** the tool is offered and executable without a permission prompt

#### Scenario: Deny removes the tool from the set

- **WHEN** the resolved permission for the alert-creation tool is `deny`
- **THEN** the tool is absent from the tool set offered to the model and no alert can be created through it

#### Scenario: Ask requires per-call approval

- **WHEN** the resolved permission for the alert-creation tool is `ask`, the model calls it with a permission reason, and the user approves the prompt
- **THEN** the call executes and the alert is created following the other requirements of this capability

#### Scenario: Ask refusal creates no alert

- **WHEN** the resolved permission for the alert-creation tool is `ask` and the user refuses the permission prompt, or no interactive permission surface is available
- **THEN** the call returns a structured permission-denied result and no alert is created
