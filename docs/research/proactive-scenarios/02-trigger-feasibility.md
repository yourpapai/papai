<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Trigger Feasibility Against Real Signals

> **Workstream:** WS-B — trigger feasibility.
> **Scope:** Current papai repository only. This document evaluates whether a condition can be
> observed and routed; it does not prioritize the product roadmap or define the interruption policy.
> Upstream Kaneo/YouTrack features that are not represented in this repository are treated as
> unknown, not assumed available.

## 1. Reading guide and verdict

This report uses three evidence labels:

- **Verified current** — implemented behavior read in the cited file and symbol.
- **Inference** — a consequence of verified behavior, called out as such rather than presented as
  shipped behavior.
- **Proposal** — new machinery that does not exist today.

The short verdict is:

- **Green:** fixed-time and RRULE triggers, operator-reviewed announcements, and externally rendered
  messages pushed through the trusted notify route have working end-to-end firing/delivery paths
  (`src/deferred-prompts/poller.ts`, `startPollers`; `src/announcements/broadcast.ts`,
  `broadcastAnnouncement`; `src/debug/notify-route.ts`, `handleNotifyRoute`).
- **Yellow:** the existing alert poller can detect a narrow set of level conditions and exact
  `changed_to` transitions. It cannot yet express generic task creation, completion, regression,
  due-date postponement, deletion, or staleness robustly. A reactive turn has enough internal data to
  seed a follow-up, but there is no post-turn trigger/candidate contract
  (`src/deferred-prompts/types.ts`, `FIELD_OPERATORS`; `src/deferred-prompts/snapshots.ts`,
  `SNAPSHOT_FIELDS`; `src/llm-orchestrator.ts`, `runTurn`/`processMessage`).
- **Red:** papai has no task-provider webhook/event-subscription contract and no calendar provider,
  OAuth lifecycle, calendar polling job, or calendar webhook receiver. `/api/notify` is a delivery
  ingress, not a calendar/task event detector (`src/providers/types.ts`, `TaskProvider`;
  `src/plugins/context.ts`, `PluginRegistration`; `src/debug/notify-route.ts`, `NotifyBodySchema`).

The current state is therefore suitable for scheduled briefings and user-authored exact alerts, but
not for a provider-neutral “observe all meaningful work changes” product without new observation and
deduplication machinery.

## 2. Feasibility rubric

| Rating | Meaning in this report | Required evidence |
| --- | --- | --- |
| 🟢 Green | The repository has an end-to-end signal, detector, persistence/retry behavior, and delivery path adequate for this trigger. Product controls may still be missing. | A current source can fire without introducing a new provider contract or inbound integration. |
| 🟡 Yellow | A useful primitive or raw signal exists, but semantics, cursor/state, cross-provider parity, delivery linkage, or reliability controls are missing. | A bounded extension is plausible, but claiming the scenario works today would be false. |
| 🔴 Red | The required signal or integration surface is absent from the repository, or only one side of the path exists. | New provider/inbound/OAuth machinery is required before the trigger can be detected. |

Ratings concern **trigger feasibility**, not desirability. A green trigger can still be unacceptable
without quiet hours, feature toggles, deduplication, or audience controls; those are evaluated by the
other research workstreams.

## 3. Trigger-source inventory

| Source | Current status | Signal and granularity | Detector / state | Delivery and latency | Principal gaps |
| --- | --- | --- | --- | --- | --- |
| Scheduled deferred prompt | 🟢 | One stored prompt, either one-shot `fireAt` or RRULE recurrence, with a thread-addressed delivery target and execution metadata. **Verified current:** `ScheduledPrompt` and `ExecutionMetadata` in `src/deferred-prompts/types.ts`. | `getScheduledPromptsDue()` selects up to 100 active rows with `fireAt <= now`; `pollScheduledOnce()` groups compatible targets and protects process-local duplicates with `inFlightPrompts`. **Verified current:** `src/deferred-prompts/scheduled.ts` (`getScheduledPromptsDue`) and `src/deferred-prompts/poller.ts` (`pollScheduledOnce`). | Scheduler interval is 60 seconds and starts immediately; firing then includes LLM and chat time. Expected detector latency is 0–60 seconds, plus execution. **Verified current:** `SCHEDULED_POLL_MS` and `startPollers` in `src/deferred-prompts/poller.ts`. | No quiet-hours/digest gate. Limit 100 can add backlog delay. `inFlightPrompts` is process-local. Recurrences retain the timezone stored on the prompt rather than automatically adopting a later config change; see §6. |
| Alert predicate over current task state | 🟢 for narrow predicates; 🟡 as a generic event source | Recursive AND/OR over status, priority, assignee, due date, project, and labels. Operators include static equality/range, `overdue`, and exact `changed_to` for status/priority/assignee. **Verified current:** `CONDITION_FIELDS`, `FIELD_OPERATORS`, and `AlertCondition` in `src/deferred-prompts/types.ts`. | Every eligible delivery context fetches all visible tasks and compares selected fields to per-thread snapshots. **Verified current:** `pollAlertsOnce`/`executeAlertsForUser` in `src/deferred-prompts/poller.ts`, `evaluateCondition` in `src/deferred-prompts/condition-eval.ts`, and `getSnapshotsForUser`/`updateSnapshots` in `src/deferred-prompts/snapshots.ts`. | Five-minute scheduler interval, immediate on startup; expected detector latency is 0–5 minutes plus provider calls and optional LLM execution. **Verified current:** `ALERT_POLL_MS` and `startPollers` in `src/deferred-prompts/poller.ts`. | Snapshot and normalized-field limitations make many apparent “events” unobservable. It is polling, not a change feed. No global cursor, event ID, or provider webhook. |
| Recurring-task scheduler | 🟢 but specialized | A stored recurring task occurrence becomes due; this creates a tracker task and sends a fixed confirmation. **Verified current:** `finalizeCreatedRecurringTask` and `notifyUser` in `src/scheduler-recurring.ts`. | Existing recurring store/scheduler, not the deferred-alert snapshot pipeline. | Direct `ChatProvider.sendMessage`; no LLM needed. | It is not a general trigger adapter and cannot detect external task changes. Notifications are DM-oriented and have their own routing behavior. |
| Plugin scheduled job | 🟡 substrate only | Fixed `intervalMs` per declared plugin job, run once per eligible configured context. **Verified current:** `PluginScheduledJob` in `src/plugins/runtime-types.ts`, `PluginRegistration.registerScheduledJob` in `src/plugins/context.ts`, and `registerPluginJobs`/`runPluginScheduledJob` in `src/plugins/contributions.ts`. | Core scheduler invokes the job; the job receives a restricted context and optional task-provider facade. | No chat-send capability is exposed to plugins. **Verified current:** `PluginContext`/`PluginRegistration` in `src/plugins/context.ts` and the context-facade description in `docs/architecture/plugins.md`. | Useful for polling or state preparation, but not end-to-end proactivity by itself. Neither task-provider manifest declares `contributes.jobs` (`plugins/task-provider-kaneo/plugin.json`, `contributes`; `plugins/task-provider-youtrack/plugin.json`, `contributes`). Jobs iterate contexts sequentially in `runPluginScheduledJob`. |
| Reactive turn/tool outcome | 🟡 | The normal turn has user text, scoped history, complete AI SDK response messages, and tool results before the reply is sent. **Verified current:** `callLlm`, `runTurn`, and `processMessage` in `src/llm-orchestrator.ts`; `invokeWithLiveStatus` in `src/llm-orchestrator-support.ts`. | No structured “turn completed” trigger or candidate store exists. `processMessage` returns `void`; the debug reply events contain only context/duration. **Verified current:** `processMessage` in `src/llm-orchestrator.ts`, `emitReplyCompletedIfNeeded` in `src/bot-reply-tracking.ts`, and `emitUser` in `src/debug/event-bus.ts`. | A suggestion can be included in the same reactive response now. A second, asynchronous proactive message needs a new hook and queue. | Risk of double messaging if the original answer already suggested the same action; raw conversation inference adds model cost and semantic false positives. |
| Conversation history / semantic inference | 🟡 for opt-in explicit commitments; 🔴 for broad automatic inference | Thread-scoped conversation history is available to context/full execution. **Verified current:** `buildContextMessages` and `persistContextResponse` in `src/deferred-prompts/proactive-llm-helpers.ts`; `ENTITY_SCOPES` in `src/chat/context-scope.ts` marks conversation history thread-scoped. | No current classifier scans completed turns for promises, blockers, or follow-up dates. The in-memory event bus does not carry final text/tool results and has no durability. **Verified current:** `DebugEvent`, `emitUser`, and `subscribe` in `src/debug/event-bus.ts`. | Would run after a reactive turn or during a periodic history scan. Neither exists. | High false-positive risk from casual language, quoted text, negation, and group speakers; high false-negative risk after history trimming; privacy and interruption controls are prerequisites. |
| Version/manual announcement | 🟢 but operator-driven | Startup detects a new version and creates a review draft; a later admin action fans out to opt-in recipients. **Verified current:** `announceNewVersion` in `src/announcements.ts` and `broadcastAnnouncement` in `src/announcements/broadcast.ts`. | Version row and per-recipient delivery records provide a specialized dedup anchor. | Broadcast is admin-reviewed, not task/context inference. | Valuable precedent for review, opt-in, bounded fan-out, and idempotency; not reusable as a per-task detector without generalization. |
| External service push | 🟢 for pre-rendered markdown; 🟡 as a trigger family | Bearer-authenticated `{contextId, contextType?, threadId?, markdown}`. **Verified current:** `NotifyBodySchema`, `handleNotifyRoute`, and `sendNotify` in `src/debug/notify-route.ts`. | The external caller owns detection, state, retry, and content. papai validates/routs only the final message. | HTTP-to-chat latency; no poll wait and no LLM execution. The route is mounted outside dashboard auth and works when the debug UI is disabled. **Verified current:** `routeRequest` in `src/debug/server.ts`. | Shared trust token, no event ID/idempotency key, no candidate metadata, no quiet-hours/digest decision, and no provider-specific webhook verification. |
| Task-provider webhook / event subscription | 🔴 | No event-subscription method or capability exists on the normalized provider interface; Kaneo and YouTrack provider manifests expose task CRUD/read capabilities only. **Verified current:** `TaskProvider` in `src/providers/types.ts`, `TaskCapability` in `src/providers/task-capability.ts`, and both `plugins/task-provider-*/plugin.json` manifests. | None. Plugin registration supports tools, commands, jobs, transformers, and one task provider type, but not inbound HTTP routes or webhooks. **Verified current:** `PluginRegistration` in `src/plugins/context.ts`. | None. | Requires ingress authentication/verification, subscription lifecycle, provider-instance-to-context fan-out, event cursor/idempotency, and delivery linkage. This report makes no claim about upstream products outside the repo. |
| Calendar read/free-busy/event signal | 🔴 | The normalized provider and plugin-registration contracts expose no calendar/event/OAuth member, and the public route dispatcher has notify but no calendar callback; repo-wide codeindex searches resolve only generic date/time helpers. **Verified current:** `TaskProvider` in `src/providers/types.ts`, `PluginRegistration` in `src/plugins/context.ts`, `routeRequest` in `src/debug/server.ts`, and `makeGetCurrentTimeTool` in `src/tools/get-current-time.ts`. | None. | None, unless an external service pre-renders markdown and calls `/api/notify`. | A real integration needs credentials/OAuth, read/revoke/refresh, event normalization, timezone/all-day semantics, and either just-in-time reads, polling cursors, or webhook leases. |

### 3.1 Execution and delivery cost envelope

The trigger source does not determine execution cost by itself. Each deferred prompt stores one of
three modes (`EXECUTION_MODES` and `executionMetadataSchema`; `src/deferred-prompts/types.ts`):

| Mode | Verified current execution | Cost/latency implication |
| --- | --- | --- |
| `lightweight` | Uses the small model when configured (otherwise main), no conversation history, and only `get_current_time`. **Evidence:** `invokeLightweight`, `makeMinimalTools`, and `modelIdForLightweight`; `src/deferred-prompts/proactive-llm.ts` and `proactive-llm-helpers.ts`. | Lowest context/tool cost, but still permits up to 25 steps and a 20-minute timeout. Appropriate for rendered reminders and simple nudges. |
| `context` | Uses the main model plus the thread's cached conversation history and only `get_current_time`. **Evidence:** `invokeWithContext` and `buildContextMessages`; `src/deferred-prompts/proactive-llm.ts` and `proactive-llm-helpers.ts`. | More prompt tokens; no live task refresh. Suitable when the creation-time snapshot/current conversation is authoritative. |
| `full` | Uses the main model, thread history, provider/providerless system prompt, and the proactive-mode capability/preference-gated tool set. **Evidence:** `prepareFullGenerationInput`/`runFullGeneration`; `src/deferred-prompts/proactive-llm.ts`; `buildFullToolSet`/`buildFullMessages`; `src/deferred-prompts/proactive-llm-full.ts`. | Highest and least predictable latency/cost; it can perform fresh task operations. `buildFullSystemPrompt` disables permission asks, so a proactive run has no permission conversation surface (`src/deferred-prompts/proactive-llm-helpers.ts`). |

**Verified current:** full execution frames stored prompt text and matched task data as user content,
not elevated system instructions (`buildProactiveTrigger`; `src/deferred-prompts/proactive-trigger.ts`;
`buildFullMessages`; `src/deferred-prompts/proactive-llm-full.ts`). Risky empty/tool-failed/tool-capped
outputs can incur a second read-only verifier call before delivery (`buildProactiveVerification` and
`finalizeAndLog`; `src/deferred-prompts/proactive-llm-helpers.ts`). **Inference:** trigger-cost
estimates must budget for the detector calls, one primary LLM run for every matched candidate, and an
occasional verifier run; batching multiple due time prompts before execution is materially cheaper
than firing each separately.

## 4. What the existing task poller can and cannot observe

### 4.1 Exact current data path

**Verified current:** for each five-minute alert pass, `pollAlertsOnce()` loads active alerts whose
cooldown has expired, groups them by the **delivery storage context**, and runs at most ten groups at a
time (`getEligibleAlertPrompts`, `pollAlertsOnce`; `src/deferred-prompts/alerts.ts` and
`src/deferred-prompts/poller.ts`). Each group:

1. Resolves the task provider using the **config context** derived from the delivery target
   (`executeAlertsForUser`, `configContextIdForDelivery`; `src/deferred-prompts/poller.ts`).
2. Calls `fetchAllTasks()`: `listProjects()` plus `listTasks(project.id)` when `projects.list` is
   available, otherwise `searchTasks({query: ''})` (`src/deferred-prompts/fetch-tasks.ts`,
   `fetchAllTasks`). Both shipped providers advertise `projects.list`
   (`plugins/task-provider-kaneo/constants.ts`, `ALL_CAPABILITIES`; and
   `plugins/task-provider-youtrack/constants.ts`, `YOUTRACK_CAPABILITIES`).
3. If any condition references assignee or labels, calls `getTask()` for every listed task
   (`alertsNeedFullTasks`, `enrichTasks`; `src/deferred-prompts/fetch-tasks.ts`).
4. Evaluates each current task against each alert and its previous field values
   (`executeSingleAlert`; `src/deferred-prompts/poller.ts`; `evaluateCondition`;
   `src/deferred-prompts/condition-eval.ts`).
5. Advances snapshots only if every alert evaluation either did not match or matched and was delivered
   (`shouldAdvanceAlertSnapshots`; `src/deferred-prompts/poller.ts`).

This is an at-least-once polling shape, not an event log. A failed matched delivery deliberately keeps
the old snapshots, allowing a later poll to see the edge again. There is no persistent event/candidate
ID that makes a retry exactly once.

### 4.2 Snapshot semantics and error modes

| Behavior | Verified consequence | False-positive / false-negative risk |
| --- | --- | --- |
| Snapshot key is `${taskId}:${field}` and values are strings. Stored fields are status, priority, assignee, dueDate, and project. **Evidence:** `SNAPSHOT_FIELDS`, `getSnapshotsForUser`; `src/deferred-prompts/snapshots.ts`. | No snapshot exists for title, description, labels, created/updated/resolved timestamps, comments, relations, or task existence. | Description/scope change, label change, comment activity, staleness, creation, completion timestamp, deletion, and relation change cannot be derived from current snapshots. |
| `changed_to` returns false when no previous value exists. **Evidence:** `evaluateLeaf`; `src/deferred-prompts/condition-eval.ts`. | First observation establishes a baseline rather than treating every existing task as newly changed. | Correctly avoids startup floods, but newly created tasks also have no baseline and therefore cannot trigger `changed_to` on their initial state. |
| Snapshot writes skip `null`; old per-field rows are not deleted when a current task field becomes null. **Evidence:** `SNAPSHOT_FIELDS` and the `value !== null` branch in `updateSnapshots`; `src/deferred-prompts/snapshots.ts`. | Unassigning a task or clearing a due date leaves the previous snapshot value behind. | Future comparison can use stale previous values; field-cleared events are not expressible and later re-assignment can look like a change from an older value. |
| Tasks missing from the current list have their snapshots deleted. **Evidence:** `notInArray` pruning in `updateSnapshots`; `src/deferred-prompts/snapshots.ts`. | Deletion/archive/disappearance is erased, not emitted. | A deleted or newly hidden task cannot produce a proactive event. Reappearance is treated as a first observation. |
| `overdue` tests only `new Date(dueDate) < now`. **Evidence:** `evaluateLeaf`; `src/deferred-prompts/condition-eval.ts`. | It is level-triggered and does not check whether the task is open/final. | A still-overdue task can re-fire after every cooldown; a completed task with an old due date can match unless the user adds a separate provider-specific status condition. |
| Full enrichment drops failed `getTask` calls and returns only fulfilled values. **Evidence:** `enrichTasks`; `src/deferred-prompts/fetch-tasks.ts`. | A transient detail-fetch failure removes that task from evaluation for the pass. If the rest of the pass succeeds, snapshot pruning can also remove its baseline. | Missed alerts and later “first observation” behavior. |
| Alert snapshots are declared thread-scoped while provider config is group-scoped. **Evidence:** `ENTITY_SCOPES`; `src/chat/context-scope.ts`. | Two alerts in sibling threads can fetch the same group tracker independently and maintain different baselines. | Extra provider load and inconsistent edge timing across threads; a future shared observation layer should separate tracker observation scope from delivery-subscription scope. |

### 4.3 Cost, latency, and scaling

Let `C` be active delivery contexts with at least one cooldown-eligible alert, `P` visible projects per
context, and `N` visible tasks per context.

- **Verified current:** the baseline cycle is approximately one `listProjects` plus `P` `listTasks`
  operations per context. Assignee/label conditions add `N` `getTask` calls
  (`fetchViaProjects`, `enrichTasks`; `src/deferred-prompts/fetch-tasks.ts`). Project fetches and full
  task enrichment use `Promise.all`/`Promise.allSettled` within a context, so they are not bounded by
  the cross-context `p-limit` (`fetchViaProjects`, `enrichTasks`).
- **Verified current:** `MAX_CONCURRENT_USERS` limits alert delivery contexts to ten, but the
  five-call LLM limiter is instantiated inside each context. Inference: up to roughly 50 matched-alert
  LLM calls can run concurrently across ten contexts, rather than five globally
  (`pollAlertsOnce`, `executeAlertsForUser`; `src/deferred-prompts/poller.ts`). Scheduled prompts use
  one shared five-call limiter per poll (`pollScheduledOnce`; same file).
- **Verified current, Kaneo:** list results are one board request per project and contain columns plus
  planned tasks; archived tasks are parsed but excluded from `TaskResource.list()`'s returned array
  (`TaskResource.list`; `plugins/task-provider-kaneo/task-resource.ts`; `ListTasksResponseSchema`;
  `plugins/task-provider-kaneo/schemas/list-tasks.ts`). Full `getTask()` also loads relations
  (`TaskResource.get`; `plugins/task-provider-kaneo/task-resource.ts`). Inference: relation loading
  makes a blanket enrichment pass more expensive than one request per task.
- **Verified current, YouTrack:** project and issue lists paginate sequentially in pages of 100 and
  stop after ten pages; each per-project task list first fetches the project's `shortName`
  (`paginate`; `plugins/task-provider-youtrack/helpers.ts`; `listYouTrackTasks` and
  `fetchTasksWithPagination`; `plugins/task-provider-youtrack/operations/tasks.ts` and
  `operations/task-list-fetch.ts`). Inference: large installations can be truncated at 1,000 projects
  or 1,000 issues per project and incur an extra project lookup per board per poll.
- **Latency:** task-state detection is bounded below by the five-minute poll, then provider fan-out,
  optional full enrichment, LLM execution (up to 25 steps and a 20-minute timeout), and chat delivery
  (`startPollers`; `src/deferred-prompts/poller.ts`; `invokeLightweight`, `invokeWithContext`, and
  `runFullGeneration`; `src/deferred-prompts/proactive-llm.ts`). This is appropriate for stale/overdue
  nudges, not “the moment a task changes” semantics.

**Inference:** increasing poll frequency without changing the observation model scales provider reads
approximately with `C × (1 + P [+ N])`. A shared provider/config-scoped observation cache and bounded
remote concurrency are prerequisites before treating the alert poller as a universal event bus.

## 5. Provider-specific observability

### 5.1 Comparison

| Signal | Kaneo | YouTrack | Current cross-provider conclusion |
| --- | --- | --- | --- |
| Current task inventory | `listTasks` returns normalized id/title/number/status/priority/dueDate; it includes column tasks and planned tasks but not archived tasks. **Evidence:** `TaskResource.list`; `plugins/task-provider-kaneo/task-resource.ts`; `mapTaskListItem`; `plugins/task-provider-kaneo/mappers.ts`. | `listYouTrackTasks` returns id/title/number/status/priority/dueDate plus `resolved`, with sequential pagination. **Evidence:** `listYouTrackTasks`; `plugins/task-provider-youtrack/operations/tasks.ts`; `mapIssueToListItem`; `plugins/task-provider-youtrack/mappers.ts`. | Sufficient for current state, overdue date, priority, and exact status predicates. Not an event feed. |
| Full task detail | `mapTaskDetails` adds description, assignee, created/start/due dates, project, and relations, but not labels or an updated timestamp. **Evidence:** `mapTaskDetails`; `plugins/task-provider-kaneo/mappers.ts`. | `mapIssueToTask` adds description, assignee, labels, relations, created and resolved time, but drops the raw issue's `updated` timestamp. **Evidence:** `ISSUE_FIELDS`; `plugins/task-provider-youtrack/constants.ts`; `IssueSchema`; `plugins/task-provider-youtrack/schemas/issue.ts`; `mapIssueToTask`; `plugins/task-provider-youtrack/mappers.ts`. | Neither normalized `Task` exposes `updatedAt`; generic staleness is unavailable. YouTrack is richer for labels/completion. |
| Labels in current alert enrichment | Kaneo supports `listTaskLabels`, but `enrichTasks()` calls only `getTask()`, whose mapper omits labels. **Evidence:** `KaneoProvider.listTaskLabels`; `plugins/task-provider-kaneo/provider.ts`; `mapTaskDetails`; `plugins/task-provider-kaneo/mappers.ts`; `enrichTasks`; `src/deferred-prompts/fetch-tasks.ts`. | YouTrack's full issue maps tags to normalized labels. **Evidence:** `mapIssueToTask`; `plugins/task-provider-youtrack/mappers.ts`. | **Inference:** a Kaneo `labels contains` alert is a false negative; `labels not_contains` can be a false positive. This is a current parity defect, not merely future machinery. |
| Status ordering/finality | `listStatuses` exposes name and `isFinal`; Kaneo's normalized mapper drops board order. **Evidence:** `kaneoListStatuses`; `plugins/task-provider-kaneo/operations/statuses.ts`; `mapColumn`; `plugins/task-provider-kaneo/mappers.ts`. | `listYouTrackStatuses` exposes name, ordinal as `order`, and `isResolved` as `isFinal`. **Evidence:** `listYouTrackStatuses`; `plugins/task-provider-youtrack/operations/statuses.ts`. | Both can identify final states if the poller starts consulting statuses. Only YouTrack currently exposes an order suitable for generic regression comparison through `Column.order`. The current poller consults neither. |
| Completion timestamp | No normalized resolved/completed timestamp. A final column can describe current finality, not when completion happened. | List and full task mapping preserve YouTrack's `resolved` timestamp. **Evidence:** `mapIssueToListItem` and `mapIssueToTask`; `plugins/task-provider-youtrack/mappers.ts`. | Exact “completed this week” is provider-asymmetric. Current `fetchViaProjects()` drops `TaskListItem.resolved` when converting to `Task`, so even YouTrack's value is unavailable to the alert evaluator (`src/deferred-prompts/fetch-tasks.ts`, `fetchViaProjects`). |
| Change/audit history | No `activities.read` capability or `getTaskHistory` implementation in `ALL_CAPABILITIES`/`KaneoProvider`. **Evidence:** `plugins/task-provider-kaneo/constants.ts` and `plugins/task-provider-kaneo/provider.ts`. | `activities.read` plus `getTaskHistory(taskId,{start,end,categories,...})`, returning timestamp/category/field/added/removed. **Evidence:** `YOUTRACK_CAPABILITIES`; `plugins/task-provider-youtrack/constants.ts`; `YouTrackPhaseFiveProvider.getTaskHistory`; `plugins/task-provider-youtrack/phase-five-provider.ts`; `getYouTrackTaskHistory`; `plugins/task-provider-youtrack/operations/activities.ts`. | YouTrack has a latent per-task audit signal for description/status/comment change; current proactive code never uses it. It still requires an inventory, per-task calls, cursors, and dedup. No equivalent Kaneo abstraction exists. |
| Stable event identity / webhook | No provider event methods or webhook contribution. | No provider event methods or webhook contribution. | Red across both in the current repository. Provider-specific upstream possibilities remain unverified. |

### 5.2 Provider-specific detection options

**Kaneo — inference/proposal:** continue snapshot polling for low-frequency status/priority/due-date
signals. For generic completion, query `listStatuses()` and compare current status to `isFinal`.
Generic regression needs the provider to preserve column position/order. Staleness and description
scope-change detection require a new normalized update/activity signal; repeatedly fetching full tasks
still does not supply `updatedAt`. Fix label enrichment before relying on label-triggered scenarios.

**YouTrack — inference/proposal:** two incremental options exist. The cheaper provider-neutral option is
still list/snapshot diff, enhanced with `resolved`, `updatedAt`, status finality/order, and existence.
The richer YouTrack-only option polls `getTaskHistory()` with a persisted timestamp/activity-ID cursor.
The latter can distinguish description, field, comment, resolution, and link events, but an API call per
tracked task is too expensive for an unbounded five-minute full-workspace scan. A provider-level
“recent activities across project/context” operation would be preferable if upstream supports one;
that support is not established by this repository.

## 6. Time-trigger feasibility

### 6.1 Current capability

- **Verified current:** one-shot local date/time and RRULE (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`,
  `byDay`, month/day/hour/minute, `until`/`count`) are accepted by `scheduleSchema` and
  `rruleInputSchema` (`src/deferred-prompts/types.ts`).
- **Verified current:** due rows are ordered by `fireAt` and capped at 100 per poll
  (`getScheduledPromptsDue`; `src/deferred-prompts/scheduled.ts`). Due prompts sharing the same owner,
  delivery target, audience, and mentions are merged into one execution, using the most capable
  execution mode among them (`groupScheduledPromptsByDelivery` and `mergeExecutionMetadata`;
  `src/deferred-prompts/poller-groups.ts` and `src/deferred-prompts/poller-scheduled.ts`).
- **Verified current:** prompts finalize only after `sendProactiveMessage()` reports success. One-shot
  prompts complete; recurring prompts calculate and store the next occurrence (`executeScheduledPromptsForGroup`;
  `src/deferred-prompts/poller.ts`; `finalizeAllPrompts`; `src/deferred-prompts/poller-scheduled.ts`).
- **Verified current:** the recurrence uses `prompt.timezone` when stored, and only falls back to the
  caller's current timezone when that value is null (`finalizeRecurring`; `src/deferred-prompts/poller-scheduled.ts`).
  `createScheduledPrompt()` persists the compiled timezone (`src/deferred-prompts/scheduled.ts`).
  **Inference:** changing the user's timezone does not by itself migrate an existing recurrence whose
  row already has a timezone. Phase 10's “immediately switch all future messages” acceptance criterion
  therefore needs explicit rescheduling/migration behavior.

### 6.2 Fit by scenario shape

| Time shape | Rating | Notes |
| --- | --- | --- |
| One-time reminder / snoozed retry | 🟢 primitive | Exact `fireAt` and update/cancel operations exist. A generic nudge still needs a durable identity linking the received message to the underlying candidate. |
| Daily/morning briefing at a configured time | 🟢 trigger, 🟡 product | RRULE can fire it. Working days, quiet hours, per-feature enablement, and digest policy are absent. |
| First/last configured workday weekly planning/review | 🟡 | RRULE `byDay` can encode a known fixed schedule; dynamic working-day preferences and a shared feature toggle are absent. |
| End-of-quiet-hours release / end-of-day digest flush | 🔴 current | No held-candidate/digest queue exists. A new scheduler row alone cannot preserve suppression reason, urgency, dedup key, or batch membership. |
| Imminent deadline | 🟡 | Can be approximated by a static due-date condition or periodic full-mode scheduled prompt, but there is no “due within N minutes from now” operator or rolling deadline index. |

## 7. Conversation-inference feasibility

### 7.1 Where a hook could exist

**Verified current:** `callLlm()` receives the assembled tool set and returns the AI SDK response;
`invokeWithLiveStatus()` has the response messages and tool results, persists facts, optionally verifies
the answer, and calls `sendLlmResponse()`; `runTurn()` then records the assistant turn
(`src/llm-orchestrator.ts`, `callLlm`/`runTurn`; `src/llm-orchestrator-support.ts`,
`invokeWithLiveStatus`; `src/llm-orchestrator-send.ts`, `sendLlmResponse`). This is enough internal
information to identify a task that papai itself just created or marked complete.

**Verified current:** no downstream listener receives that structured result. `processMessage()` returns
`Promise<void>`. The emitted `reply:sent`/`message:replied` debug events contain only context and
duration, and the event bus is process-local (`src/llm-orchestrator.ts`, `processMessage`;
`src/bot-reply-tracking.ts`, `emitReplyCompletedIfNeeded`; `src/debug/event-bus.ts`, `DebugEvent` and
`subscribe`).

**Inference:** the lowest-noise conversation-derived trigger is not a second semantic scan of the raw
chat. It is a structured post-tool outcome hook, for example “`create_task` succeeded with task X and
these fields were omitted” or “`update_task` changed X to a provider-final status.” This has strong
provenance and can be deduplicated by turn/tool-call ID. It can either enrich the same reactive answer
(not proactive) or enqueue a separately controlled candidate (proactive).

### 7.2 Inference classes

| Inference class | Rating | Detection method | Risks |
| --- | --- | --- | --- |
| Papai-created task missing due date/assignee/labels | 🟡 | Inspect successful task-create tool result plus original input at turn completion. | Low signal ambiguity, but a second message duplicates the original reply unless the main response/candidate system coordinates. Provider tools may use different wire names; capability IDs or normalized effects are preferable. |
| Papai-marked completion | 🟡 | Inspect successful task update plus provider status finality. | Must distinguish requested vs. actual update and final vs. merely named “Done”; relation/next-step lookup adds provider calls. |
| Explicit user promise with a date (“I will do this Friday”) | 🟡 | Opt-in classifier after the turn, producing a proposed scheduled prompt for confirmation. | Negation, quotes, hypotheticals, timezone, and group speaker ownership; confirmation should precede sending. |
| Implicit blocker/energy/workload inference | 🔴 as automatic trigger | Semantic classifier over history and task state. | High false positives, privacy concerns, model cost, history trimming, and no objective event boundary. Better used reactively or inside an already scheduled planning session. |
| “No reply for N days” / conversational follow-up | 🔴 current | Requires last-user/last-assistant activity index, follow-up intent state, and scheduler. | Silence does not imply neglect; group threads and multiple speakers make ownership ambiguous. |

### 7.3 Platform effects on inferred follow-ups

- **Verified current:** live conversation and proactive history are thread-scoped
  (`ENTITY_SCOPES`; `src/chat/context-scope.ts`; `recordProactiveInHistory`;
  `src/proactive-history.ts`). A follow-up inferred in one Telegram/Mattermost/Kontur thread should not
  read or deliver into a sibling thread without an explicit cross-thread policy.
- **Verified current:** normal group text is ignored unless it mentions the bot or is marked as a
  reply to the bot (`shouldIgnoreGroupMessage`; `src/bot.ts`). Telegram and Discord map replies to the
  bot into that path, while Discord otherwise observes mentions only (`TelegramChatProvider.extractMessage`;
  `src/chat/telegram/index.ts`; `mapDiscordMessage`; `src/chat/discord/map-message.ts`;
  `discordTraits`; `src/chat/discord/metadata.ts`).
- **Inference:** natural-language “snooze” or “dismiss” replies are discoverable most reliably in DM.
  In groups, Mattermost/Kontur users may need an explicit mention, and speaker ownership must be
  checked against the candidate audience. Buttons could reduce ambiguity on Telegram/Mattermost/Discord;
  Kontur Talk advertises no callback/button capability (`konturTalkCapabilities`;
  `src/chat/kontur-talk/metadata.ts`).

## 8. External, webhook, and calendar paths

### 8.1 What `/api/notify` does and does not do

**Verified current:** `/api/notify` authenticates a long-lived bearer via SHA-256 plus
`timingSafeEqual`, validates a final markdown payload, resolves the delivery platform, calls
`ChatRouter.sendMessage`, and records the successfully sent markdown in proactive history
(`checkAuth`, `NotifyBodySchema`, `sendNotify`, `handleNotifyRoute`;
`src/debug/notify-route.ts`). It is mounted before dashboard authorization and is not a debug-only path
(`routeRequest`; `src/debug/server.ts`).

This makes an external calendar service, workflow engine, or coding-session service capable of
detecting an event elsewhere and posting the **finished message** with near-immediate latency. It does
not make that external event a native papai trigger:

- The payload has no `eventId`, source, observed time, urgency, expiry, or idempotency key
  (`NotifyBodySchema`; `src/debug/notify-route.ts`). A caller retry after an uncertain response can
  duplicate a message.
- The route bypasses the proactive LLM/tool execution pipeline. It does not call `dispatchExecution`,
  consult alert snapshots, or generate a candidate (`handleNotifyRoute`; `src/debug/notify-route.ts`;
  `dispatchExecution`; `src/deferred-prompts/proactive-llm.ts`).
- It has no quiet-hours, digest, feature-toggle, or interruption-budget check. Those controls do not
  exist anywhere on the route.
- A thread-scoped storage ID is inferred as a group, but a non-thread group ID is ambiguous and must
  pass `contextType: 'group'` explicitly (`buildNotifyTarget`; `src/debug/notify-route.ts`). This is
  especially important for Discord, which reports no separate thread scope
  (`DiscordChatProvider.threadCapabilities`; `src/chat/discord/index.ts`).

**Proposal:** retain `/api/notify` for trusted, pre-rendered operational milestones. If external task
or calendar events are to participate in papai's user controls, introduce a separate candidate/event
ingress (or extend the contract versionedly) with source-specific authentication, event ID,
context/config mapping, urgency, not-before/expiry, and idempotency. Do not overload markdown delivery
with webhook verification and event normalization.

### 8.2 Webhook/event-subscription availability

**Verified current negative finding:** `TaskProvider` contains CRUD/read operations and optional
activity history, but no `subscribe`, webhook-registration, event-stream, or change-cursor member
(`src/providers/types.ts`, `TaskProvider`). `TaskCapability` has no event capability
(`src/providers/task-capability.ts`, `TaskCapability`). Neither task-provider manifest declares a
webhook contribution (`plugins/task-provider-kaneo/plugin.json` and
`plugins/task-provider-youtrack/plugin.json`). `PluginRegistration` offers no HTTP route contribution
(`src/plugins/context.ts`, `PluginRegistration`). The only relevant inbound targeted send surface is
the core notify route (`src/debug/server.ts`, `routeRequest`; `src/debug/notify-route.ts`,
`handleNotifyRoute`).

Therefore:

- **Kaneo webhook feasibility in papai today: 🔴.** No repo-side receiver/registration/normalizer.
- **YouTrack webhook feasibility in papai today: 🔴.** `activities.read` is polling history, not an
  event subscription (`YouTrackPhaseFiveProvider.getTaskHistory`;
  `plugins/task-provider-youtrack/phase-five-provider.ts`).
- Whether either upstream product can emit suitable webhooks is outside the evidence in this repo and
  must be separately verified before an implementation plan assumes it.

A webhook implementation would need: provider-specific signature/secret verification; public callback
routing independent of dashboard sessions; create/renew/delete subscription lifecycle; mapping from a
task instance/project to every eligible config and delivery subscription; raw-event storage; stable
event ID/cursor dedup; replay/out-of-order handling; and a normalized observation/candidate boundary.

### 8.3 Calendar path

There are three materially different calendar paths:

1. **External pre-rendered notification — 🟢 transport, 🔴 native integration.** An external calendar
   worker can own OAuth/event detection and call `/api/notify`. Latency and scaling belong to that
   worker. papai cannot apply native candidate controls or use the calendar data in later LLM planning.
2. **Just-in-time read for a scheduled/reactive run — 🔴 current, 🟡 architectural fit.** A new
   read-only calendar provider/tool could fetch today's events/free-busy when a morning RRULE fires or
   when the user asks for planning. This needs no webhook and minimizes retained calendar data. It does
   need OAuth/connect/disconnect/refresh/revoke, encrypted identity-scoped credentials, event/timezone
   normalization, and tool permission controls. The current plugin HTTP facade could support outbound
   calls, but plugins cannot register the OAuth callback route or send chat messages
   (`PluginContext`/`PluginRegistration`; `src/plugins/context.ts`; `docs/architecture/plugins.md`).
3. **Calendar event-driven automation — 🔴.** Automatic “a free block just opened” or event-change
   nudges require polling with a sync token/cursor or webhook subscriptions with renewal. No such
   store/job/ingress exists. This is higher cost and higher privacy risk than fetching a daily window
   inside an already requested/scheduled planning run.

**Proposal:** for trigger feasibility, the minimum calendar architecture is read-only, just-in-time
event/free-busy retrieval inside existing scheduled and reactive executions. Defer calendar webhooks
until a scenario specifically requires event-change latency below the briefing cadence. This is an
architecture minimum, not a roadmap ranking.

## 9. Chat-platform delivery constraints

| Platform | Current proactive target | Trigger-related constraints |
| --- | --- | --- |
| Telegram | DM or group; group delivery can set `message_thread_id`; personal audience creates text-mention entities. **Evidence:** `TelegramChatProvider.sendMessage`; `src/chat/telegram/index.ts`; `buildTelegramMentionPrefix`; `src/chat/telegram/reply-helpers.ts`. | Thread-specific trigger state/delivery is feasible. Max message size metadata is 4,096, but proactive send does not visibly chunk in `sendMessage`; large generated digests need care (`telegramTraits`; `src/chat/telegram/metadata.ts`). Buttons/callbacks are available for future candidate actions. |
| Mattermost | DM opens a direct channel; group posts can set `root_id` and prepend personal mentions. **Evidence:** `sendMattermostDeferredMessage`; `src/chat/mattermost/reply-helpers.ts`. | Thread-specific delivery is feasible. Natural-language replies in groups still pass papai's mention gate; buttons/callbacks are available. Max metadata length is 16,383 (`mattermostTraits`; `src/chat/mattermost/metadata.ts`). |
| Discord | DM or channel, explicit personal mentions; output is chunked to 2,000 characters. **Evidence:** `sendDiscordMessage`; `src/chat/discord/send-message.ts`; `discordTraits`; `src/chat/discord/metadata.ts`. | `threadCapabilities.supportsThreads` is false, so alerts/history/snapshots share the channel context rather than a distinct Discord thread (`DiscordChatProvider.threadCapabilities`; `src/chat/discord/index.ts`). Group input is mentions-only, though replies to the bot are mapped as mentions. |
| Kontur Talk | Group posts can include `thread_id`. **Verified current:** DM targets log a warning and return without sending; outbound `mentions` is always empty. **Evidence:** `KonturTalkChatProvider.sendMessage`; `src/chat/kontur-talk/index.ts`. | No proactive DM, buttons, callbacks, or live-status capability (`konturTalkCapabilities`; `src/chat/kontur-talk/metadata.ts`). **Verified current/inference:** because the adapter's no-op DM returns `void`, `ChatRouter.sendMessage()` converts it to `true`, and `sendProactiveMessage()` treats it as success (`ChatRouter.sendMessage`; `src/chat/router.ts`; `sendProactiveMessage`; `src/deferred-prompts/proactive-delivery.ts`). A DM prompt can therefore finalize/advance despite no visible message. This is a delivery correctness concern for any trigger using Kontur DMs. |

Cross-platform observations:

- **Verified current:** delivery first resolves the assigned active platform instance and falls back to
  the platform encoded in a scoped storage context ID (`resolveDeliveryPlatformInstanceId`;
  `src/chat/delivery-routing.ts`; `resolveProactivePlatformInstanceId`;
  `src/deferred-prompts/proactive-delivery.ts`).
- **Verified current:** the target carries context type, native context, thread, audience, mention IDs,
  creator, and optional scoped storage ID (`DeferredDeliveryTarget`;
  `src/chat/deferred-target.ts`). Detection subscriptions must preserve this entire target; a bare task
  instance or user ID is insufficient for reliable multi-instance delivery.
- **Verified current:** proactive executions can run up to 25 model steps with a 20-minute timeout, but
  do not enter the normal `runRegistry` path (`invokeLightweight`, `invokeWithContext`,
  `runFullGeneration`; `src/deferred-prompts/proactive-llm.ts`; compare `runTurn`;
  `src/llm-orchestrator.ts`). Users cannot steer or stop a long proactive run. Trigger design should
  prefer lightweight/context execution unless live tools are required.
- **Verified current:** successful LLM generations are appended to history before chat delivery
  (`persistLightweightResponse`, `persistContextResponse`, `persistProactiveResults`;
  `src/deferred-prompts/proactive-llm-helpers.ts`; delivery occurs later in
  `executeScheduledPromptsForGroup`/`executeSingleAlert`; `src/deferred-prompts/poller.ts`).
  **Inference:** a failed send can leave an unseen assistant turn in history, and retry can add another
  generated turn. A general candidate/outbox should define persistence at candidate, execution, and
  delivered stages explicitly.

## 10. Candidate matrix: Phase 9

| Candidate | Rating | Exact signal / detection method | Provider differences | Errors, latency, and cost | Missing machinery |
| --- | --- | --- | --- | --- | --- |
| US1 — suggestions after creating a task | 🟡 when papai creates it; 🔴 for external creation | Papai-created: post-tool outcome from successful `createTask`. External: inventory set-diff against a persisted existence baseline. Current `changed_to` cannot fire on a new task because no previous snapshot exists (`evaluateLeaf`; `src/deferred-prompts/condition-eval.ts`). | Both return created tasks. Kaneo full detail lacks labels; YouTrack can expose project fields and labels. | Turn-local path is immediate and cheap; inventory polling is 0–5 min and mistakes reappearing/visibility-changed tasks for creation without tombstones. | Structured turn-effect hook; task-existence observations; candidate dedup; coordination with the original reactive answer. |
| US2a — due date pushed back | 🔴 current | Requires comparing previous and current due date and testing `current > previous`. Snapshots store both values, but the alert language offers only exact `changed_to` for status/priority/assignee and static `lt`/`gt` for due date (`FIELD_OPERATORS`; `src/deferred-prompts/types.ts`; `evaluateLeaf`; `src/deferred-prompts/condition-eval.ts`). | Both list due dates. YouTrack is date-only; Kaneo can carry a timestamp (`normalizeYouTrackDueDateInput`; `plugins/task-provider-youtrack/due-date.ts`; `KaneoProvider.normalizeDueDateInput`; `plugins/task-provider-kaneo/provider.ts`). | Five-minute poll plus provider reads. Clearing due date leaves a stale snapshot. | Delta operators (`changed`, increased/decreased, cleared), normalized date precision, event dedup. |
| US2b — status regressed | 🟡 YouTrack; 🔴 generic Kaneo; 🟢 only for a configured exact `changed_to` target | Exact target is supported today. Generic regression requires mapping old/new statuses to order. | YouTrack `listStatuses` exposes `order`; Kaneo's normalized status mapper omits order. Both expose `isFinal` (`plugins/task-provider-youtrack/operations/statuses.ts`, `listYouTrackStatuses`; `plugins/task-provider-kaneo/mappers.ts`, `mapColumn`). | Five-minute poll. Board reorder/rename can create apparent regressions if identity is name/slug based. | Stable status IDs in observations; per-project status-order cache/version; regression semantics for unordered workflows. |
| US2c — description changed to reduced scope | 🔴 cross-provider; 🟡 YouTrack-only research path | Description is absent from snapshots/conditions. YouTrack per-task activity history includes description categories and old/new values; current proactive code does not call it (`DEFAULT_ACTIVITY_CATEGORIES`; `plugins/task-provider-youtrack/constants.ts`; `getYouTrackTaskHistory`; `plugins/task-provider-youtrack/operations/activities.ts`). | Kaneo has no normalized activity history. Both full tasks expose current description, but current-only text cannot prove reduction without a prior copy and semantic comparison. | Per-task history polling is expensive; semantic “reduced scope” classification is noisy and model-costly. | Description/version observations or activity cursor, semantic classifier, confirmation/relevance policy, Kaneo parity strategy. |
| US3 — next steps on completion | 🟡 | Exact `changed_to` final status can trigger if configured. Generic completion should compare current status to provider `isFinal`, or use YouTrack `resolved`. Full execution can then fetch relations. | YouTrack has `resolved` and status finality/order; Kaneo has finality but no completion timestamp/order. Current poller ignores all of these and list-only tasks omit relations (`fetchViaProjects`; `src/deferred-prompts/fetch-tasks.ts`). | 0–5 min, not “the moment.” False completion if status names are misconfigured; retry duplication without candidate IDs. | Generic completion detector; final-state cache; normalized relation enrichment; per-event dedup; audience/ownership rules. |
| US4 — overdue response prompt | 🟡, closest state-trigger candidate | Current `overdue` condition detects any task whose due date is before now. Add an open/final-state test and an edge record for “first became overdue.” | Both expose due date and status; finality is available via `listStatuses` but unused. YouTrack date-only means the boundary is day-level; Kaneo may include time. | 0–5 min. Current level predicate can repeat every cooldown and can include completed work. | Open/final filtering, first-overdue edge/idempotency, working-day/quiet-hour policy, candidate actions. |
| US5 — stale task | 🔴 cross-provider; 🟡 YouTrack-specific | Needs last update/comment/activity time. Normalized `Task` has no `updatedAt`; snapshots have no activity field (`Task`; `src/providers/domain-types.ts`; `SNAPSHOT_FIELDS`; `src/deferred-prompts/snapshots.ts`). | YouTrack activity history could derive last meaningful activity. Kaneo has no normalized activity source. Raw created time is not a substitute for update time. | Full-inventory/full-detail polling every five minutes is expensive and still wrong. Per-task histories are worse. | Normalized activity/update timestamp or change feed, definition of meaningful touch, threshold state, user/assignee ownership. |
| US6 — end-of-week summary | 🟢 time trigger; 🟡 exact task facts | RRULE can fire the summary. Full mode can list current tasks. “Completed this week” requires completion history/time. | YouTrack list results carry `resolved`; current alert conversion drops it. Kaneo cannot timestamp completion. | Weekly cadence makes provider cost acceptable; content false negatives arise from archived/hidden tasks and absent completion time. | Working-day preference, completion-window query/history, digest controls, bounded cross-project fetch. |
| US7 — first-workday planning prompt | 🟢 fixed RRULE; 🟡 configurable product | RRULE `byDay` plus full-mode backlog query. | Both list overdue/high-priority backlog. | Weekly cost is low; trigger is only correct if workdays/timezone remain synchronized. | Working-day config/evaluator, feature toggle, quiet hours, timezone migration of existing recurrence. |
| US8 — “what should I work on next?” | Not proactive; 🟢 reactive metadata ranking, 🟡 richer ranking | Normal reactive message invokes provider list/search tools. Due date and priority exist. | Both support those fields and relations; effort/duration/energy metadata is not normalized. | Immediate, user-initiated, no interruption risk. Cross-project listing cost still applies. | Ranking policy and optional effort metadata, not a new proactive trigger. |

## 11. Candidate matrix: Phase 10

| Candidate | Rating | Trigger feasibility | Current evidence and gap |
| --- | --- | --- | --- |
| US1 — timezone | 🟢 for creating/firing local schedules; 🟡 for changing existing recurrence | Current scheduler compiles and stores timezone-aware recurrence. Existing rows prefer their stored timezone. | `rruleInputSchema`/`ScheduledPrompt`; `src/deferred-prompts/types.ts`; `createScheduledPrompt`; `src/deferred-prompts/scheduled.ts`; `finalizeRecurring`; `src/deferred-prompts/poller-scheduled.ts`. New migration/reschedule behavior is needed for “immediate switch.” |
| US2 — quiet hours | 🔴 current | This is a delivery gate and delayed-release trigger, not expressible as an alert predicate. | No candidate/held-message store is consulted by `sendProactiveMessage` or `sendNotify` (`src/deferred-prompts/proactive-delivery.ts`, `sendProactiveMessage`; `src/debug/notify-route.ts`, `sendNotify`). Need not-before queue and urgent-bypass metadata. |
| US3 — working days | 🟡 | RRULE can encode fixed weekdays; no shared preference evaluator suppresses other task nudges on non-workdays. | `rruleInputSchema.byDay`; `src/deferred-prompts/types.ts`. Need settings-backed calendar-day evaluation used by every candidate source. |
| US4 — immediate/digest/muted | 🟢 immediate; 🔴 digest/muted control | Current sources send immediately after execution. No daily batch store/flush trigger. | `executeScheduledPromptsForGroup`/`executeSingleAlert`; `src/deferred-prompts/poller.ts`; `sendNotify`; `src/debug/notify-route.ts`. Need durable candidates, batch key, expiry, digest scheduler, and a universal mute gate. |
| US5 — per-feature toggles | 🔴 current | Sources have prompt status/cancel controls, but no feature taxonomy/config gate covering generated scenarios. | `ScheduledPrompt.status`/`AlertPrompt.status`; `src/deferred-prompts/types.ts` are individual prompt state, not feature preferences. Need a stable candidate feature ID and settings lookup before execution/delivery. |
| US6 — snooze/dismiss/reschedule | 🟡 for existing deferred prompts; 🔴 for generic nudges | Scheduled prompts can be updated/cancelled and proactive output is in history, but a generic received message has no durable candidate ID exposed to the next turn. | `updateScheduledPrompt`/`cancelScheduledPrompt`; `src/deferred-prompts/scheduled.ts`; `recordProactiveInHistory`; `src/proactive-history.ts`. Need candidate identity, response-to-candidate resolution, snooze row, and platform-specific actions/fallbacks. |
| US7 — review/reset preferences | Not a trigger; 🔴 current settings surface | It is reactive/settings management. Timezone exists, but the remaining notification preferences do not. | No current trigger implementation can infer these controls; the repository convention places config in the settings UI (`docs/architecture/behaviors.md`). |

## 12. Candidate matrix: Phase 11

| Candidate | Rating | Exact signal / detector | Risks and gaps |
| --- | --- | --- | --- |
| US1 — next best action with available time/energy | 🟡 reactive | Normal turn supplies user-stated time/energy; task due date/priority can be queried. | No normalized effort/duration/complexity signal. Model-inferred effort can be useful but uncertain. No proactive trigger is needed. |
| US2 — workload overload warning | 🟡 heuristic; 🔴 capacity-accurate | Scheduled morning run or due-date state scan counts tasks per day. | Count is available, but feasibility needs effort/capacity, calendar availability, working hours, and dedup. Avoid claiming “more than feasible” from task count alone. |
| US3 — connect/disconnect calendar | 🔴 | No current calendar/OAuth signal path. | Needs settings/OAuth initiation and callback, encrypted identity-scoped refresh credentials, revoke/disconnect, provider config, and permission model. `/api/notify` cannot provide later calendar reads. |
| US4 — calendar-enriched morning briefing | 🟢 clock trigger + 🔴 calendar signal = 🔴 current | Existing RRULE fires a full/context run; new just-in-time calendar event/free-busy read supplies today's events. | Event timezone/all-day/recurrence/privacy semantics, OAuth, free-block computation, working days, and quiet hours. No webhook is needed for the first viable shape. |
| US5 — structured daily planning | 🟡 task-only; 🔴 full calendar acceptance | Reactive turn can list due/overdue tasks. | Calendar unavailable; no durable “today's top three” plan/blocker schema for the later review. Conversation facts alone are not a reliable plan ledger. |
| US6 — time-aware task nudges/gap recommendations | 🔴 calendar-aware current; 🟡 reactive after connector | On user request, fetch next event/free window just in time and rank tasks. Automatic gap-start nudges additionally require polling/event subscriptions. | No calendar connector and no task duration signal. Automatic nudges risk interrupting during travel/preparation buffers. |
| US7 — end-of-day review against plan | 🟡 | Fixed schedule or reactive request; compare durable daily plan task IDs with current task state. | No daily-plan store exists. Kaneo cannot timestamp completion but current final/open state is enough for same-day plan comparison; delivery controls still missing. |

## 13. False-positive and false-negative summary

| Trigger family | Dominant false positives | Dominant false negatives |
| --- | --- | --- |
| Clock/RRULE | Stale schedules after preference/timezone changes; duplicate execution after uncertain delivery/restart boundaries. | Due-row limit/backlog; inactive platform; Kontur DM no-op reported as success. |
| Snapshot state level | Repeated overdue alerts after cooldown; completed overdue tasks; `not_contains` on missing Kaneo labels. | First-seen/new tasks, deletions, field clears, transient full-detail failures, archived Kaneo tasks. |
| Snapshot delta | Status rename/reorder interpreted as work movement; stale null snapshots. | Generic regression/completion, due postponement, description/label/comment change, update timestamps. |
| YouTrack activity polling | Replayed/out-of-order activity without a persistent `(timestamp,id)` cursor; semantic over-interpretation of description changes. | Tasks outside inventory/permissions, history truncation/limits, categories omitted, polling windows with clock skew. |
| Turn-local outcome | Second nudge duplicates advice already in the reactive reply. | Tool aliases/unstructured plugin results; requested operation failed or was only partially completed. |
| Semantic conversation inference | Hypotheticals, quotes, sarcasm, negation, wrong speaker/owner. | Trimmed context, implicit commitments, cross-thread context, non-text interactions. |
| External notify | Duplicate caller retries; wrong group/DM classification when `contextType` is omitted. | External detector outage, no retry, inactive platform, no papai-side event knowledge. |
| Calendar | Wrong free time around all-day events, travel/buffer time, tentative/private events, timezone/DST. | Secondary calendars, declined/recurring exceptions, stale sync token, revoked credentials. |

## 14. Minimum trigger architecture recommendation

This section describes the smallest coherent trigger architecture implied by the feasibility findings.
It intentionally does **not** choose the scenario roadmap.

### 14.1 Separate observation, candidate, execution, and delivery

**Proposal:** introduce a durable `ProactiveCandidate` (or equivalent outbox) with at least:

- stable `candidateId` and source `eventId`/idempotency key;
- `source` and stable `featureId`;
- observation scope (`taskInstanceId` + config context) distinct from delivery subscription/target;
- `observedAt`, `notBefore`, `expiresAt`, urgency, and digest key;
- normalized payload/evidence and optional task IDs;
- execution mode/brief, delivery target, and lifecycle (`pending`, `held`, `executing`, `delivered`,
  `dismissed`, `expired`, `failed`).

Detectors should write candidates; a later control stage decides hold/send/drop; existing
`dispatchExecution()` and `sendProactiveMessage()` can remain the execution/delivery seams. External
pre-rendered operational notices may continue to use `/api/notify`, but native task/calendar events
should enter before the control stage.

### 14.2 Observe task state once per provider/config scope

**Proposal:** replace per-thread full-workspace baselines as the primary event source with a
provider/config-scoped observation store. Keep thread-scoped subscriptions and delivery targets, but
poll a shared task instance once and fan out matched candidates. Normalize at least:

- task existence and stable provider ID;
- project ID;
- status stable ID/name/order/finality;
- priority, assignee, labels, due date;
- created, updated, and resolved/completed timestamps when supported;
- a field hash/version and provider cursor/event ID when supported.

Use bounded provider concurrency and explicit pagination/truncation metrics. Preserve tombstones long
enough to distinguish delete/archive/visibility loss from first observation. Represent unsupported
fields explicitly so Kaneo/YouTrack parity decisions are visible rather than silently defaulting to
empty arrays/nulls.

### 14.3 Add two narrow trigger adapters first, not a generic semantic bus

**Proposal:**

- a **task observation adapter** that emits normalized create/change/overdue/finality events from
  polling now and can accept provider webhooks later without changing candidate semantics; and
- a **turn-effect adapter** that consumes structured successful tool outcomes before the normal turn
  is discarded, with turn/tool-call IDs for dedup.

Broad conversation inference should be a separately opt-in classifier, not the default path for task
events that already have structured provenance.

### 14.4 Treat calendar as read enrichment before event automation

**Proposal:** define a minimal read-only calendar interface (list events/free-busy for a bounded time
window) plus identity-scoped credential lifecycle. Invoke it just in time from existing scheduled or
reactive runs. Add sync-token polling or webhook subscriptions only when a selected scenario truly
requires calendar-change latency. This keeps the first integration's state, privacy exposure, and
subscription-renewal burden bounded.

### 14.5 Delivery correctness prerequisites

Before any trigger is treated as reliable, the shared path needs:

- persistent idempotency across detection, LLM execution, and chat send;
- universal quiet-hours/mute/digest/feature gates applied to internal and external candidates;
- bounded retries with an explicit delivered acknowledgment;
- a fix for Kontur Talk DM no-op success or an explicit “DM unsupported” routing result;
- storage of generated assistant history at a lifecycle point consistent with actual delivery;
- metrics for poll duration, pages/tasks observed, truncation, candidates emitted/suppressed, send
  retries, and per-provider rate limits.

## 15. Gaps/new machinery checklist

| Gap | Needed for | Current nearest primitive |
| --- | --- | --- |
| Provider/config-scoped observation store with tombstones | Create/delete/change dedup; avoid sibling-thread duplicate polling | Thread-scoped `task_snapshots` (`src/chat/context-scope.ts`, `ENTITY_SCOPES`) |
| Normalized update/resolved/status-order/finality fields | Staleness, completion, regression, weekly completion window | `Task`, `TaskListItem`, `Column` (`src/providers/domain-types.ts`) |
| Delta operators and event IDs | Due-date push, clear/unassign, exact retries | `AlertCondition` and string snapshots (`src/deferred-prompts/types.ts`; `src/deferred-prompts/snapshots.ts`) |
| Provider event/webhook contract | Low-latency external task changes | None; only provider CRUD/history and plugin interval jobs |
| Durable candidate/control/outbox | Quiet hours, digest, mute, idempotency, snooze/dismiss | Direct poller → LLM → send path (`src/deferred-prompts/poller.ts`) |
| Structured post-turn effect hook | Create enrichment and papai-authored completion next steps | AI SDK result inside `runTurn`/`invokeWithLiveStatus` |
| Calendar read/OAuth integration | Phase 11 calendar stories | Generic time tool plus scheduled/full execution |
| Calendar sync/webhook lifecycle | Automatic gap/event-change triggers | None |
| Provider-bounded polling/pagination visibility | Safe scale | Cross-context `p-limit`; provider-specific pagination |
| Delivery capability result stronger than boolean/void | Avoid silent unsupported routes | `ChatProvider.sendMessage` and router boolean conversion (`src/chat/types.ts`; `src/chat/router.ts`) |

## 16. Final feasibility conclusion

The existing architecture already has a credible **clock → execute → deliver** path and a useful but
narrow **poll current tasks → compare string snapshots → execute → deliver** path
(`pollScheduledOnce`/`pollAlertsOnce`; `src/deferred-prompts/poller.ts`; `updateSnapshots`;
`src/deferred-prompts/snapshots.ts`). It also has a trusted way for an external service to post
completed markdown (`handleNotifyRoute`; `src/debug/notify-route.ts`). Those three facts make
scheduled planning, operator notices, and explicitly configured low-frequency alerts feasible without
a new transport.

They do not amount to a general event-driven assistant. Generic task lifecycle events require a
provider/config-scoped observation model, richer normalized fields, stable event identity, and a
candidate/outbox boundary. Conversation-derived follow-ups require a structured turn-effect hook and
dedup with the original response. Calendar-aware planning requires a new read/OAuth integration;
calendar webhooks are not necessary for just-in-time briefings and should not be assumed. These are
feasibility constraints for the later synthesis, not a prioritization decision.
