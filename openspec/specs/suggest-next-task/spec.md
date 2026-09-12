# suggest-next-task Specification

## Purpose

Gives the assistant an on-demand, read-only way to answer "what should I work on next?": a deterministic, explainable ranking of the context's open tracker tasks with one-line reasons, without touching tracker state.

## Requirements

### Requirement: Read-only suggestion tool availability

The system SHALL expose a `suggest_next_task` tool in DM and group contexts, in both normal and proactive modes, whenever a task instance is configured for the context, and SHALL NOT expose it when the context's task instance is unconfigured (`null`). The tool SHALL be classified as read-risk, so its default `tool_prefs` permission SHALL be `allow`, it SHALL remain available under the guest-mode read-only toolset, and it SHALL be subject to the standard `tool_prefs` allow/ask/deny resolution. Executing the tool SHALL NOT create, modify, or delete any tracker entity.

#### Scenario: No task instance configured

- **WHEN** a context has no task instance configured and the toolset is assembled
- **THEN** `suggest_next_task` is not offered, matching the other task tools

#### Scenario: Guest-mode session

- **WHEN** a guest-mode user in a group receives the fixed read-only toolset
- **THEN** `suggest_next_task` is included, and invoking it performs no tracker mutation

#### Scenario: Ask permission

- **WHEN** the context's `tool_prefs` resolve `suggest_next_task` to `ask` and the model invokes it
- **THEN** the standard confirmation flow gates execution, and a denial returns the structured `permission_denied` result

#### Scenario: Deny permission

- **WHEN** the context's `tool_prefs` resolve `suggest_next_task` to `deny`
- **THEN** the tool is absent from the offered toolset and cannot be invoked

### Requirement: Suggestion request parameters

The tool SHALL accept an optional `projectId` restricting candidates to one project (default: all projects reachable from the configured task instance), an optional `assigneeId` that supports the literal `me`, and an optional integer `limit` between 1 and 5 defaulting to 3. Values outside the declared ranges SHALL be rejected by input validation before execution.

#### Scenario: Default limit

- **WHEN** the tool is invoked without `limit` and more than three open tasks match
- **THEN** at most three suggestions are returned

#### Scenario: Out-of-range limit

- **WHEN** the tool is invoked with `limit` set to 0 or 6
- **THEN** the invocation is rejected by schema validation and no ranking runs

#### Scenario: Unresolvable me reference

- **WHEN** `assigneeId` is `me` and no identity is stored for the calling user in this context
- **THEN** the tool returns `{ status: 'identity_required', message }` guidance instead of suggestions

#### Scenario: Resolved me reference

- **WHEN** `assigneeId` is `me` and an identity is stored for the calling user
- **THEN** only tasks assigned to that user's tracker identity are considered

### Requirement: Candidate collection

The tool SHALL build its candidate set from open tasks only. An explicit `projectId` SHALL restrict collection to that project; otherwise collection SHALL span every project reported by the task instance's project listing. When no `projectId` is given and the task instance cannot enumerate projects, the tool SHALL return `{ status: 'project_required', message }` guidance instructing the caller to specify a project. Tasks marked resolved SHALL be excluded from the candidate set.

#### Scenario: Explicit project scope

- **WHEN** the tool is invoked with a `projectId` among the context's projects
- **THEN** every suggestion comes from that project and other projects are not queried

#### Scenario: Project listing unavailable

- **WHEN** the task instance does not expose project listing and no `projectId` is given
- **THEN** the tool returns `project_required` guidance rather than an error

#### Scenario: Resolved tasks excluded

- **WHEN** the candidate projects contain tasks that are marked resolved
- **THEN** none of those tasks appears in the suggestions or the considered count

### Requirement: Deterministic ranking

Ranking SHALL be a pure function of the candidate set and the evaluation time: identical inputs SHALL yield identical order. Due-date urgency SHALL dominate recency — an overdue task SHALL outrank a task due within 48 hours, which SHALL outrank a task due within 7 days, which SHALL outrank a task with no due-date signal. Overdue dominance SHALL scale with days overdue. Priority signals SHALL stack onto due-date signals, so equally overdue tasks SHALL be ordered by priority strength. Tasks with no due-date or priority signal SHALL be ordered by creation recency, newest first.

#### Scenario: Urgency precedence

- **WHEN** candidates include one overdue task, one due tomorrow, one due in five days, and one undated task
- **THEN** they are suggested in exactly that order

#### Scenario: Overdue magnitude

- **WHEN** two candidates are equally prioritized but one is five days overdue and the other one day overdue
- **THEN** the five-days-overdue task ranks first

#### Scenario: Priority stacking

- **WHEN** two candidates are equally overdue and one carries an urgent-priority marker while the other does not
- **THEN** the urgent task ranks first

#### Scenario: Recency fallback

- **WHEN** candidates carry no due-date and no recognized priority signal
- **THEN** they are ordered newest-created first

#### Scenario: Stable ordering

- **WHEN** the tool is invoked twice with the same arguments against unchanged tracker state
- **THEN** both invocations return the suggestions in the same order

### Requirement: Suggestion payload

Each suggestion SHALL identify the task (`id`, `title`, tracker `number` and `url` when the task instance provides them, `projectId`) and carry the optional `dueDate`, the raw `priority` when set, the numeric `score`, and a one-line `reason`. The result SHALL also report `considered`, the number of open candidate tasks examined, and SHALL respect the requested `limit` in the suggestion count. Due dates SHALL be rendered in the context timezone resolved identically to other task-list output: read from the group-shared config context (so all threads of a group render alike), falling back to UTC when unset. When no open tasks match, the result SHALL be `{ suggestions: [], considered: 0 }`.

#### Scenario: Group-shared timezone

- **WHEN** the tool runs in two different threads of the same group with a timezone configured for that group
- **THEN** both render due dates in that group's timezone

#### Scenario: Empty result

- **WHEN** the candidate projects contain no open unresolved tasks
- **THEN** the tool returns `suggestions: []` and `considered: 0` without error

#### Scenario: Limit respected

- **WHEN** ten open tasks match and `limit` is 2
- **THEN** exactly the top two suggestions are returned while `considered` reflects the wider candidate set

### Requirement: Factual reason lines

A suggestion's `reason` SHALL be assembled exclusively from the facts that contributed to its ranking (overdue magnitude, due-window, priority signal, creation recency), phrased as a single human-readable line. Facts that did not contribute SHALL NOT appear in the reason.

#### Scenario: Overdue task with priority

- **WHEN** a task ranks first because it is two days overdue and carries a high priority marker
- **THEN** its reason mentions both the overdue fact and the priority fact

#### Scenario: Unscheduled task

- **WHEN** a task ranks only by creation recency with no due date or priority signal
- **THEN** its reason does not claim any due-date or priority fact
