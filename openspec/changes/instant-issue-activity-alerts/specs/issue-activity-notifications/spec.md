## Purpose

Makes GitHub issue-activity notifications creatable and instant: alert conditions may arrive as JSON-encoded strings at the tool surface, comment activity becomes visible in GitHub task history, and filter alerts baseline on their first evaluation cycle so new-issue, comment, and close notifications deliver within the existing alert poll cycle without replaying the pre-existing backlog.

## ADDED Requirements

### Requirement: Alert conditions may be submitted as a JSON-encoded string

The `create_alert` and `update_reminder` tools SHALL accept the `condition` parameter in either of two forms: the existing structured object form, or a JSON-encoded string whose parsed value is a valid condition. A string condition SHALL be parsed and validated against exactly the same condition rules as the object form — the same accepted shapes, combinators, operators, and rejection reasons — so the two forms are interchangeable once accepted. A string that is not valid JSON, or whose parsed value fails condition validation, SHALL be rejected as invalid input with a clear error naming the problem, and no alert or reminder SHALL be created or updated in either rejection case. Accepting the string form SHALL NOT remove the object form, change any other tool parameter, or prevent either tool from being assembled and exposed to the model.

#### Scenario: Object conditions keep working unchanged
- **WHEN** the assistant calls `create_alert` with `condition` as a structured object (for example `{"field":"task.status","op":"eq","value":"open"}`)
- **THEN** the condition validates exactly as before the change and the alert is created

#### Scenario: Stringified field condition accepted
- **WHEN** the assistant calls `create_alert` with `condition` sent as the JSON string `'{"field":"task.status","op":"eq","value":"open"}'`
- **THEN** the string is parsed and accepted and the alert is created with the equivalent object condition

#### Scenario: Stringified activity condition accepted
- **WHEN** the assistant calls `create_alert` on a capable, configured tracker with `condition` sent as the JSON string `'{"kind":"activity","taskId":"417"}'`
- **THEN** the string is parsed and accepted and a per-task activity alert is created

#### Scenario: Stringified condition accepted by update_reminder
- **WHEN** the assistant calls `update_reminder` to set a condition on an existing alert, sending `condition` as a JSON string
- **THEN** the string is parsed and validated like an object and the alert's condition is updated

#### Scenario: Non-JSON string rejected
- **WHEN** `condition` is sent as a string that is not valid JSON (for example `'watch issue 417'`)
- **THEN** the tool returns an invalid-input error naming the problem and no alert or reminder is created or updated

#### Scenario: Condition-invalid JSON string rejected
- **WHEN** `condition` is sent as a JSON string whose parsed value fails condition validation (for example an unknown operator, or an activity condition missing its task id)
- **THEN** the tool returns the same invalid-input error the equivalent object would produce and nothing is created or updated

#### Scenario: Tools remain exposed after the change
- **WHEN** the assistant's tool surface is assembled for a normal turn
- **THEN** `create_alert` and `update_reminder` are exposed and invocable with their `condition` parameter described, with both forms acceptable

### Requirement: Gating and permissions are identical for both condition forms

Accepting a stringified condition SHALL NOT change any gating or permission behavior of the alert tools. Activity conditions — in either form — SHALL still be accepted only when the delivery context has a configured (non-null) task instance whose provider exposes activity reading, and refused with the existing guidance error otherwise. Per-context tool permissions (`allow`/`ask`/`deny`) SHALL resolve identically for both forms: an `ask`-gated call with a stringified condition SHALL require user confirmation before execution, and a permission denial SHALL return the structured permission-denied result with nothing created. The guest read-only toolset SHALL be unchanged: alert creation and update tools remain unavailable to guests. Alerts pinned to a task instance continue to evaluate against the pinned instance.

#### Scenario: Stringified activity condition refused without tracker activity support
- **WHEN** the context's task provider does not expose activity reading and `create_alert` receives an activity condition as a JSON string
- **THEN** the tool returns the guidance error stating the tracker does not expose task history and no alert is created

#### Scenario: Stringified activity condition refused with unconfigured task instance
- **WHEN** the delivery context has no task instance configured (null) and `create_alert` receives an activity condition as a JSON string
- **THEN** the tool returns the guidance error and no alert is created

#### Scenario: ask-gated stringified condition requires confirmation
- **WHEN** the context's tool preferences set `create_alert` to `ask` and the assistant calls it with a stringified condition
- **THEN** user confirmation is requested before execution, and a denied confirmation yields the structured permission-denied result with no alert created

#### Scenario: deny removes the tool for both forms
- **WHEN** the context's tool preferences set `create_alert` to `deny`
- **THEN** the tool is not exposed to the assistant at all, regardless of which condition form would be used

#### Scenario: Guests never gain alert creation
- **WHEN** an unrecognized user posts in a group with guest mode enabled
- **THEN** the guest's read-only toolset does not include `create_alert` or `update_reminder`, unchanged by the new input form

### Requirement: GitHub task history exposes comment activity

The GitHub task provider's task-history lookup SHALL include one comment activity entry per issue comment, each carrying the comment's timestamp, its author, and the `comment` category, merged with the existing event-derived entries. Comment and event entries SHALL be combined into a single timestamp-ordered result through the existing filter, sort, and limit pipeline. When the lookup is requested with a category filter that excludes comments, comment entries SHALL be omitted. Existing event-derived entries and their category mappings SHALL be unchanged. Activity entries SHALL never include credential material: provider access tokens remain in the encrypted task-instance configuration and never appear in activity entries. This SHALL hold uniformly for every conversation context and platform instance backed by the GitHub provider.

#### Scenario: Comment surfaces as comment activity
- **WHEN** a user comments on a watched GitHub issue and the task-history lookup for that issue runs with comments in scope
- **THEN** the result contains a `comment` entry with the comment's timestamp and author alongside the event-derived entries

#### Scenario: Category filter excludes comments
- **WHEN** the task-history lookup is requested with categories that exclude `comment`
- **THEN** no comment entries appear in the result

#### Scenario: Merged entries are timestamp-ordered
- **WHEN** a task-history lookup returns both event-derived entries and comment entries
- **THEN** the combined result is ordered by timestamp as one sequence

#### Scenario: Existing event mappings unchanged
- **WHEN** the task-history lookup runs for an issue with non-comment events (opened, closed, reassigned, and similar)
- **THEN** those events map to the same activity categories as before the change

#### Scenario: Uniform across platform instances
- **WHEN** alerts watching the same GitHub issue are delivered through different platform instances (for example Telegram and Mattermost)
- **THEN** both see the same comment activity and fire identically — the behavior is provider-level, not per platform

### Requirement: Filter alerts baseline on their first evaluation cycle

A field-condition alert (one that is neither a pure per-task watch nor a pure activity alert) SHALL record its matched task set on its first evaluation cycle after creation — when it has no recorded matched set and has never fired — and SHALL NOT fire for tasks that already match at that first evaluation, regardless of how many pre-existing tasks match. On later cycles the alert SHALL fire only when a task newly matches relative to the recorded matched set, under the existing matched-set edge semantics. Pure per-task watches and activity alerts SHALL keep their existing baseline behavior (stored snapshots and the activity cursor respectively), and the alert poll's remaining semantics — cooldown, delivery, and pure-watch and activity evaluation — SHALL be unchanged.

#### Scenario: First cycle records the backlog without firing
- **WHEN** a newly created filter alert such as `task.project eq <repo>` is evaluated for the first time and many pre-existing tasks match
- **THEN** the alert records those matched tasks and delivers nothing

#### Scenario: A task newly matching later fires
- **WHEN** a baselined filter alert is evaluated in a later cycle and a task that was not in its recorded matched set now matches
- **THEN** the alert fires and the matched set is updated

#### Scenario: Pre-existing matches never fire
- **WHEN** a baselined filter alert is evaluated and every matching task was already in its recorded matched set
- **THEN** the alert does not fire

#### Scenario: Pure-watch baseline unchanged
- **WHEN** a pure per-task watch is evaluated for the first time after creation
- **THEN** it stores its baseline snapshots and fires nothing, exactly as before this change

#### Scenario: Activity baseline unchanged
- **WHEN** a newly created activity alert is polled for the first time
- **THEN** it establishes its activity cursor and fires nothing, exactly as before this change

#### Scenario: Fired alert keeps existing semantics
- **WHEN** a filter alert that has fired before (it has a last-trigger record) is evaluated
- **THEN** it continues its existing matched-set edge behavior and is not re-baselined

### Requirement: Closes are reported correctly on GitHub

A close of a watched GitHub task SHALL be observable through per-task watches (targeted single-task fetches see closed tasks) and through activity alerts (close events surface as status activity on the task). A close marked "not planned" SHALL NOT be delivered as the task being completed: the task state reported at fire time SHALL distinguish closed-not-planned from a completed close. On GitHub, the whole-list fetch path used by field-condition alerts enumerates open tasks only, so a field condition such as `task.status changed_to "closed"` evaluated on that path SHALL NOT fire for GitHub closes; close coverage on GitHub comes from per-task watches and activity alerts.

#### Scenario: Per-task watch fires on a close
- **WHEN** a per-task watch on a GitHub issue is evaluated after the issue is closed
- **THEN** the watch observes the closed status and fires

#### Scenario: Activity alert surfaces a close as status activity
- **WHEN** a GitHub issue watched by an activity alert is closed
- **THEN** the task-history lookup yields a status activity entry for the close and the alert can fire on it

#### Scenario: Not-planned close is not reported as completed
- **WHEN** a watched GitHub issue is closed as "not planned" and a per-task watch or activity alert fires
- **THEN** the reported task state distinguishes the not-planned close from a completed close and never presents it as completed

#### Scenario: Whole-list field close condition does not fire on GitHub closes
- **WHEN** a filter alert on the whole-list path uses a close-condition field (for example `task.status changed_to "closed"`) and a GitHub issue is closed
- **THEN** the alert does not fire from the whole-list evaluation, since GitHub lists open tasks on that path

### Requirement: Issue-activity alerts deliver within the existing poll cycle

Notifications for new matching issues, new comments, and closes SHALL be delivered through the existing alert delivery path — the alert poll cycle of approximately five minutes, with each alert's cooldown gating eligibility — with no new delivery mechanism, no cadence change, and no change to burst collapse: all firings in one poll cycle SHALL collapse into one merged message per firing cycle as today. The delivered summary SHALL be composed at fire time using the task and comment lookups available to the fire-time execution, and comment-derived content (authors, comment text) SHALL be framed as untrusted external data in the summary so it cannot be mistaken for system output.

#### Scenario: Comment notification arrives within a poll cycle
- **WHEN** a comment is posted on an issue watched by a comment activity alert and the next alert poll cycle runs
- **THEN** the alert fires and the notification is delivered through the alert's configured delivery context, without any reminder-based workaround

#### Scenario: Burst collapse unchanged
- **WHEN** multiple alerts fire in the same poll cycle for a context
- **THEN** they are collapsed into one merged message per firing cycle under the existing cooldown and batching behavior

#### Scenario: Comment content framed as untrusted
- **WHEN** an alert fires whose activity entries contain comment text or author names
- **THEN** the delivered summary frames those values as untrusted external data

#### Scenario: Existing deliveries unchanged
- **WHEN** a pure-watch or field alert that existed before this change fires
- **THEN** its delivery timing, cooldown, and message shape are unchanged
