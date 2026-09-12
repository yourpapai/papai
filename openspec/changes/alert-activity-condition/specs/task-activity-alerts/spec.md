## Purpose

Lets users create alerts that fire when new activity (comments, description edits) appears on a specific task in their configured tracker, evaluated by edge-triggered polling of task history. Complements the existing field-value watch alerts without changing their behavior.

## ADDED Requirements

### Requirement: Activity alert condition kind
The `create_alert` tool SHALL accept an activity condition kind consisting of a required task id and an optional list of activity categories. An activity condition missing the task id SHALL be rejected as invalid input. Activity conditions SHALL be combinable under the existing `and`/`or` condition combinators together with other activity conditions. The system SHALL render a human-readable description of an activity condition (identifying the watched task and, when present, the categories) wherever alert conditions are described to the user.

#### Scenario: Activity condition accepted without categories
- **WHEN** the user creates an alert whose condition is `{ kind: 'activity', taskId: 'TASK-1' }` through `create_alert` on a capable tracker
- **THEN** the alert is created and stored with that condition

#### Scenario: Activity condition accepted with categories
- **WHEN** the user creates an alert whose condition is `{ kind: 'activity', taskId: 'TASK-1', categories: ['comment'] }` on a capable tracker
- **THEN** the alert is created and stored with the category filter attached to the condition

#### Scenario: Missing task id rejected
- **WHEN** an activity condition without `taskId` is submitted to `create_alert`
- **THEN** the condition is rejected as invalid input and no alert is created

#### Scenario: Activity conditions nest under and/or combinators
- **WHEN** an alert condition combines two activity leaves with `and` or `or`
- **THEN** the combined condition is accepted and treated as a pure-activity tree

#### Scenario: Readable description of an activity condition
- **WHEN** the system describes an alert whose condition is an activity leaf
- **THEN** the description names the activity kind, the watched task id, and the categories when categories are set

### Requirement: Creation gated on tracker activity support and task instance
`create_alert` SHALL accept an activity condition only when the delivery context has a configured (non-null) task instance whose task provider exposes activity reading — the `activities.read` capability and a task-history lookup. Otherwise the tool SHALL refuse the activity condition with a guidance error, in the same error-result shape used by other tool errors, telling the user the tracker does not expose task history. Field-value alert conditions SHALL remain acceptable regardless of this gate.

#### Scenario: Refused when tracker lacks activity support
- **WHEN** the context's task provider does not expose `activities.read` or a task-history lookup and the user submits an activity condition
- **THEN** `create_alert` returns a guidance error stating the tracker does not expose task history and no alert is created

#### Scenario: Refused when no task instance is configured
- **WHEN** the delivery context has no task instance configured (null) and the user submits an activity condition
- **THEN** `create_alert` returns a guidance error and no alert is created

#### Scenario: Accepted when capable and configured
- **WHEN** the context's task provider exposes `activities.read` and a task-history lookup and a task instance is configured
- **THEN** `create_alert` accepts the activity condition and creates the alert

### Requirement: Condition trees are pure-activity or pure-field
`create_alert` SHALL reject, with a guidance error, a condition tree that mixes activity leaves with field-value leaves; only pure-activity trees and pure-field trees SHALL be accepted. The rejection SHALL name the mixing as the reason so the user can split the alert.

#### Scenario: Mixed tree refused at creation
- **WHEN** an alert condition combines an activity leaf with a field-value leaf under `and` or `or`
- **THEN** `create_alert` returns a guidance error explaining activity and field conditions cannot be mixed in one alert and no alert is created

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

#### Scenario: Cursor advances after delivery
- **WHEN** an activity alert fires and delivery succeeds
- **THEN** the alert's activity cursor advances to the newest entry seen in that poll and its last-triggered timestamp is recorded

#### Scenario: Categories passed to the history lookup
- **WHEN** an activity alert with categories set is polled
- **THEN** the history lookup for the watched task is requested with those categories

#### Scenario: Cooldown suppresses immediate refire
- **WHEN** an activity alert fired within its cooldown window and new activity appears before the cooldown elapses
- **THEN** the alert is not delivered again until the cooldown elapses, under the same cooldown eligibility the existing alert kinds use

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

### Requirement: Existing alert behavior is preserved
Adding the activity condition kind SHALL NOT change the behavior of existing alert kinds: pure-watch task-equality alerts continue to be evaluated by targeted single-task fetches, and alerts pinned to a specific task instance continue to be evaluated against that instance.

#### Scenario: Pure-watch alert still evaluated by targeted fetch
- **WHEN** an alert whose condition is a task-equality watch on a task id is polled
- **THEN** it is evaluated by fetching that task directly, unchanged from its pre-activity behavior

#### Scenario: Task-instance pinning still applies
- **WHEN** an alert recorded against a pinned task instance is evaluated
- **THEN** it is evaluated against that pinned task instance's provider, unchanged from its pre-activity behavior
