<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Recommendation: a controlled first proactive product increment

> **Workstream:** WS-G — final decision document
> **Status:** Research recommendation; implementation requires a separate reviewed plan
> **Decision date:** 2026-07-19
> **Inputs:** [scenario catalogue](./01-scenario-catalogue.md),
> [trigger feasibility](./02-trigger-feasibility.md),
> [decide-to-interrupt model](./03-decide-to-interrupt.md),
> [notification controls](./04-notification-controls.md),
> [scope and delivery](./05-scope-and-delivery.md),
> [safety and trust](./06-safety-and-trust.md), and
> [prior-art synthesis](./07-prior-art-and-synthesis.md).

## 1. Decision

**Green-light a design and implementation plan for one opt-in, personal-DM, task-only daily
task-health digest (`TSK-008`)—but do not green-light autonomous immediate nudges, group delivery,
calendar automation, or model-driven effects yet.**

The first increment should prove one proposition: papai can deliver one wanted, accurate, predictable
assistant-initiated message on an allowed workday without crossing scope, permission, delivery, or
trust boundaries. Its content should be a deterministic read-only summary of a user-selected task
scope: open tasks that are overdue, due today, or already in progress, with strict item and length
caps. The message should be generated without a general agent run and should contain no task mutation.

This recommendation is conditional. Before a canary can send, the implementation must add a durable
candidate/outbox lifecycle, default-off settings controls, current-state revalidation, semantic
idempotency, a truthful delivery receipt, post-confirmation history persistence, and metadata-only
observability. It must also fix or explicitly disable unsupported Kontur Talk DM delivery, avoid the
current pre-delivery history/effect retry behavior, and repair the current `/stats/subject/:id` raw
identifier response so the documented anonymous-aggregate contract is true before new metrics land.

`TSK-008` leads because it creates one predictable digest-shaped interruption, fits the existing
clock and provider-read substrate, and tests nearly all shared controls without claiming minute-level
urgency or asking an unsteerable proactive model run to write. The first-overdue action prompt
(`TSK-006`) is the recommended second autonomous scenario after that substrate and trust evidence
exist.

## 2. Decision in one page

| Decision dimension | Recommendation |
| --- | --- |
| First new autonomous scenario | `TSK-008`, narrowed to a deterministic daily task-health digest |
| Audience | One exact recipient in a personal DM configuration context only |
| Trigger | User-selected local time on selected working days; current scheduler substrate |
| Task scope | Explicitly selected provider/task scope; never inferred from a group or sibling thread |
| Included states | Open overdue, open due-today, and in-progress tasks whose relevance rule is deterministic |
| Delivery priority | Digest only; no send-now or quiet-hours bypass |
| Content generation | Deterministic renderer from normalized task fields; no free-form semantic inference |
| Tools/effects | Bounded provider reads only; no general `full` toolset, writes, MCP, web fetch, plugins, or calendar |
| Default | Master assistant proactivity off; feature off |
| Required controls | Feature opt-in, master mute, timezone, working days, digest time, quiet hours, pause/mute; candidate state supports later snooze/dismiss |
| Reliability | Durable occurrence/candidate/outbox, lease, idempotency, frozen rendered payload, bounded retry, explicit unknown outcome |
| History | Append exact assistant message only after confirmed delivery |
| Supported platforms | Telegram, Mattermost, and Discord DMs after receipt-contract tests; Kontur DM disabled until made truthful |
| Observability | First fix the current raw subject-ID stats response; then expose counts, reason codes, timing, and approved low-cardinality bands only—no task/chat content, rendered markdown, secrets, or raw user/context identity in `/stats/*` |
| Rollout | Offline fixtures → no-send shadow → internal opt-in allowlist → small opt-in canary → wider opt-in |
| Explicitly deferred | Group/thread delivery, urgent lane, calendar, broad conversation inference, learned personalization, mutating proactive effects |

## 3. Why this is the first scenario

### 3.1 It offers useful orientation with one interruption

The catalogue identifies daily task orientation as a natural batch for due-today, overdue, and
in-progress state. It gives the recipient a coherent starting view instead of emitting one message per
task. The prior-art review finds repeated support for predictable batching and recipient-controlled
windows, while preserving the caveat that no evidence establishes a universal batch frequency. One
user-chosen workday digest is therefore a conservative product hypothesis rather than a claimed
scientific optimum.

### 3.2 It uses signals papai can obtain today

The scheduler already polls due work every 60 seconds, and both task providers expose current task
list/detail reads. A daily digest does not require provider webhooks, generic state-change history, a
calendar connector, a task-created event, semantic description comparison, or live
interruptibility sensing. A fresh bounded read at the chosen window is sufficient. See
[02-trigger-feasibility.md](./02-trigger-feasibility.md) §§3–6 and §14.

### 3.3 It does not need an urgent claim

A morning task-health view remains useful over a reasonable window. If quiet hours, a non-working day,
route failure, or a recipient policy blocks its scheduled instant, the occurrence can wait until the
next permitted bound or expire. This avoids using the highest-trust “wake me now” path before the
product has evidence that its scope, deduplication, and delivery receipts are correct.

### 3.4 It can be deterministic and read-only

The rich catalogue version classifies `TSK-008` as `full` because an authored briefing might rank,
explain, or propose actions. The first implementation should deliberately narrow that ambition. A
source-linked renderer can group normalized fields, cap items, and state why each task appears without
an LLM. Any proposed mutation can occur later in a normal user-initiated turn with ordinary
confirmation and run-control.

### 3.5 It exercises the shared machinery future scenarios need

The digest requires the same default-off consent, time policy, candidate identity, revalidation,
outbox, delivery receipt, history ordering, suppression reasons, and metrics needed by later overdue,
weekly-review, calendar, and event-driven scenarios. It therefore buys infrastructure evidence rather
than creating a one-off scheduled message.

This choice resolves a real workstream tension rather than hiding it. WS-C favors a candidate with a
stable state transition and names `TSK-006` or hardened explicit reminders as conservative canaries;
WS-F observes that one overdue item has a smaller data/size leakage surface than a briefing. WS-A and
WS-G, however, find `TSK-008` lower-interruption and better suited to proving the control/digest model,
while WS-B confirms the clock/current-read path is feasible. The synthesis selects `TSK-008` only in
the sharply narrowed E0 form here: personal DM, explicit task scope, strict item/length caps,
deterministic source fields, and no model or effects. If those bounds cannot be made reliable,
`TSK-006` becomes the fallback first product candidate—not a reason to ship an unrestricted briefing.

## 4. Why not the other plausible first choices

| Alternative | Attractive property | Why it is not first |
| --- | --- | --- |
| Improve only explicit reminders (`AUT-001`/`AUT-002`) | Highest intent confidence and existing substrate | Reliability hardening is required in Phase 0, but it would not validate an assistant-initiated content product or relevance policy. |
| First-overdue action prompt (`TSK-006`) | Existing `overdue` predicate makes detection look close | Needs completed/cancelled filtering, first-crossing identity, deterministic recipient ownership, deadline lifecycle dedup, nonpunitive actions, and immediate/digest policy. A false or repeated overdue message has higher trust cost. |
| One-day-before deadline (`TSK-011`) | Action can still prevent failure | Date-only tasks do not prove an exact time or hard urgency; several tasks due together create a burst; task rescheduling must supersede stale candidates. It follows the candidate lifecycle work. |
| Weekly review (`TSK-009`) | Low interruption frequency | Slower learning loop and greater dependence on reliable completion/change history; current normalized fields do not fully support a trustworthy completed/slipped window. |
| Weekly planning (`TSK-010`) | High potential habit value | Recommendations need capacity, ownership, preference, and interaction design; the first message should not silently choose priorities. |
| Post-create/post-completion suggestion (`TSK-001`/`TSK-005`) | Context is fresh and actionability can be high | Usually belongs in the same reactive turn. Autonomous follow-up requires a structured turn-effect/exposure hook so it does not duplicate advice already shown or repeat effects. |
| Calendar-enriched briefing (`PLN-004`) | Strong daily-planning value | Requires a new identity-scoped read connector, credentials, privacy/redaction rules, time-zone/recurrence handling, and private-event policy. Task-only value should be proven first. |
| Calendar reminder (`CAL-001`) | Explicit event time makes urgency clear | Risks duplicating native calendar alerts and requires event identity, cancellation/change handling, connector health, and sensitive-title controls. |
| `/api/notify` as a universal ingress | Already posts proactive markdown | It is a final-message trust plane with no event ID, feature, expiry, urgency, candidate lifecycle, rate limit, or universal control gate. Expanding it would bypass the machinery this research says is necessary. |
| Broad conversation inference | Could surface implicit commitments | Highest ambiguity and privacy risk; hypotheticals, quotation, speaker, negation, thread scope, and exposure dedup are not solved. Structured task/time signals should lead. |

## 5. Product contract for the thin first increment

### 5.1 Eligibility

The feature may create an occurrence only when all of these are true:

1. the assistant-proactivity master control is enabled;
2. `daily_task_health_digest` is enabled;
3. the policy belongs to a personal DM config context, not a group/main/thread context;
4. one exact active platform instance and one exact DM recipient are recorded;
5. the task provider instance is still assigned and accessible in that context;
6. the recipient explicitly selected the task scope and relevance filter;
7. today is a selected working day in the current IANA timezone;
8. the local occurrence has not already been created for that policy/date;
9. the current time is within the allowed delivery window and outside quiet hours, or the occurrence
   can be bounded-deferred without passing its expiry;
10. the platform route supports truthful DM delivery.

The policy gate runs before any provider read. Membership/identity, task access, route, feature, and
time policy are checked again immediately before delivery.

### 5.2 Task-scope choice

The system must not infer “my tasks” by comparing chat display names with provider assignee strings.
The settings surface should require one explicit, provider-backed scope:

- selected project(s), with the user knowingly opting into all matching visible tasks; or
- a stable provider assignee/account ID selected from the connected provider, optionally narrowed to
  projects.

If the provider cannot supply stable identity for an assignee filter, the UI must describe the scope
as a project/workspace briefing rather than claiming personal ownership. No group-created task
configuration may silently fan out to a member DM.

### 5.3 Deterministic inclusion rules

The initial renderer admits only normalized structured state:

- **Overdue:** task is not in a provider-declared final/cancelled state and its due date is before the
  recipient's current local date.
- **Due today:** task is not final/cancelled and its due date is the current local date.
- **In progress:** task is in an explicitly mapped in-progress status and is not already included in
  the prior two groups.

No first release inclusion rule uses description text, comments, labels as semantic instructions,
“staleness,” inferred difficulty, inferred importance, calendar gaps, or a model-generated priority.
Unknown status finality fails closed: the item is omitted and the normalization gap is measured; it is
not guessed from arbitrary status substrings in the new product path.

### 5.4 Content shape

A digest should contain:

- local date and selected scope label;
- separate overdue, due-today, and in-progress sections;
- task title, project, due date where present, and a safe provider URL or stable task reference;
- a deterministic reason label for every item;
- an overflow count rather than unbounded continuation;
- a short provenance/footer: feature name, next expected delivery, and where to manage it in settings.

Recommended initial caps are product hypotheses to tune in shadow mode: at most five overdue, five
due-today, and five in-progress items, ordered by due date then stable task ID. The entire logical
message must fit a single adapter send under the strictest verified eligible-platform envelope. For
the first increment, use a shared post-render cap of at most 1,800 UTF-16 code units, then let each
adapter reject rather than split any payload that still exceeds its verified limit. Shorten fields and
increase the deterministic overflow count before rendering; never emit a multi-part digest and never
ask an LLM to choose which overflow items disappear. A future multi-part design would first need the
per-chunk receipts, resumable delivery, partial-visibility history, and reconciliation contract in
[report 05 section 13.2](./05-scope-and-delivery.md#132-typed-delivery-receipt).

If all sections are empty, default to **no message** with `DROP_EMPTY_DIGEST`. An optional “all clear”
message would spend attention without a concrete action and requires separate user research.

### 5.5 Interaction and effect policy

The digest is informational. It may expose provider links or invite a normal reply, but it cannot:

- create, edit, assign, reschedule, complete, or delete a task;
- call the general `full` toolset;
- invoke MCP, plugins, web fetch, calendar, memory writes, or background automation;
- mark a deadline urgent or bypass quiet hours;
- start another proactive schedule;
- act on text embedded in a title or provider field.

Any later task action starts a normal reactive turn and uses the current effective `tool_prefs`, guest
policy, confirmation behavior, and run-control. Delivery priority never upgrades effect permission.

### 5.6 Controls shown in settings

All durable configuration remains in the settings SPA. The first surface should show:

- a master “Assistant suggestions and briefings” switch, default off;
- “Daily task health digest,” default off;
- exact effective scope and DM recipient/platform;
- task provider and selected project/assignee scope;
- validated IANA timezone;
- working-day multi-select;
- local digest time;
- quiet-hours range, including cross-midnight preview;
- pause/mute state and next eligible delivery preview;
- a plain-language statement that the digest is read-only and never wakes through quiet hours;
- recent delivery/suppression status without exposing task content to settings users who cannot view
  the underlying task scope.

The shared state model should support candidate dismiss/snooze from day one, but cross-platform chat
buttons may ship after the first canary. Deferring the button must not mean regenerating a dismissed
candidate or losing the ability to add that control later.

## 6. Required shared architecture

This section defines behavioral seams, not table/column names for implementation.

### 6.1 Policy record

The policy record belongs to the applicable config context but records that its first-release use is
valid only for a personal DM context. It contains:

- policy and feature versions;
- master and feature enabled states;
- exact recipient/platform/config context;
- provider instance and explicit task scope;
- timezone, working days, digest time, quiet hours, and DST interpretation;
- pause/mute state;
- next occurrence preview and update metadata that does not include message content.

Configuration and delivery target are separate concepts even when both point at the same DM in this
increment. That separation is necessary before group-derived policies or multi-surface delivery are
considered.

### 6.2 Occurrence and candidate

Create one durable occurrence per
`(stablePolicyId, recipient, occurrenceKind, scheduledLocalDate)`, where `occurrenceKind` is the stable
daily-digest slot rather than a policy or timezone version. It prevents scheduler overlap/restart and
fall-back clock repetition from running the same logical daily read twice. Policy version, timezone,
DST rule, and calculated instant are immutable occurrence snapshot metadata, not uniqueness inputs.
A policy/timezone edit transactionally reclassifies or supersedes the existing unsent slot; it cannot
create a second eligible occurrence for that policy, recipient, and scheduled local date. If an edit
moves the calculated instant across a date boundary, the scheduler must record one deterministic
supersession from the old slot to the new slot and resolve any uniqueness conflict without delivering
both. After a bounded fresh read, materialize a candidate containing:

- stable candidate and source occurrence IDs;
- scenario/version (`TSK-008` / `daily_task_health_digest.v1`);
- exact audience, config, provider, and delivery scope;
- structured admitted item references and state versions;
- semantic digest fingerprint;
- evidence time, `notBefore`, next evaluation, and expiry;
- policy version and deterministic gate/reason trace;
- render/effect policy (`deterministic`, `read_only`, `no_effects`);
- lifecycle state and lease information.

Task bodies, descriptions, comments, or rendered markdown should not be copied into analytics tables.
The outbox may retain the exact rendered payload for reliable retry under a content-retention policy,
but it must remain outside `/stats/*` and must be access-controlled like conversation content.

### 6.3 Decision and revalidation

For this first scenario, the generic four-way policy collapses to three practical outcomes:

- **digest/send at the chosen window** when all gates pass and at least one item remains;
- **bounded hold** for quiet hours, workday boundary, transient provider/route failure, or an active
  conflicting condition, with next check and expiry;
- **drop** for feature off, scope/auth failure, empty content, duplicate, resolved items, or expiry.

There is no urgent disposition. Item state is refreshed before rendering and again as close to send as
bounded provider cost permits. A newer occurrence supersedes an old held daily digest; the system
must not release several missed days at once.

### 6.4 Delivery outbox and receipt

The delivery contract must distinguish:

- `confirmed`: provider accepted the message for the exact target;
- `failed`: provider definitely did not accept it and retry policy may apply;
- `unknown`: outcome cannot be proved; do not blindly resend;
- `unsupported`: platform/target combination cannot deliver truthfully.

Persist one frozen rendered artifact before the first send with a short, scenario-defined
`renderExpiresAt`. A definite retry may send that exact artifact only while it remains inside that TTL,
after current policy/route/authorization revalidation and a bounded read-only comparison of every
included item's provider state version. That validation does not rerun the detector, renderer, an LLM,
or an effect. If a state version changed, the artifact expired, or freshness cannot be proved before
expiry, supersede or drop the old candidate; any replacement is a new candidate that traverses the
normal pipeline. `unknown` enters bounded reconciliation/manual handling and is never blindly retried.
Record provider message ID/idempotency metadata when available.

Current `boolean | void` semantics are insufficient because a Kontur Talk DM warning/void is converted
into upstream success. Until fixed, the capability gate returns `unsupported` and no Kontur DM policy
can be enabled.

### 6.5 History and exposure ledger

Only `confirmed` delivery may append the exact user-visible assistant text to conversation history and
create a delivered exposure. Generated evidence, a provider read, or a rendered payload is not a user
turn. The exposure ledger records structured `(scenario, state, audience)` identity and supports
deduplication against later proactive candidates and structured reactive exposures.

This ordering replaces the current deferred LLM pattern in which generated messages/tool traces can be
persisted before chat send. It also prevents a failed delivery retry from regenerating prose or
repeating a tool effect.

### 6.6 Execution audit versus conversation history

Keep operational execution state separate from user-visible history:

- occurrence/candidate state explains detection and decisions;
- effect audit proves which reads/effects occurred;
- rendered artifact supports exact retry;
- delivery ledger proves target/outcome;
- conversation history represents confirmed visible dialogue.

This separation is required even though the first scenario has no writes. It is the invariant later
explicit deferred actions need to prevent delivery retry from repeating a preauthorized effect.

## 7. Scope and platform rules

### 7.1 First-release scope rule

Only a policy created and stored for a personal DM configuration context is eligible. The system may
not take a group-shared policy, group task instance, group thread history, or group storage owner and
choose a private recipient. This avoids the current ambiguity between group-scoped configuration,
thread-scoped delivery/history, and the stored prompt creator/owner identity.

For every occurrence, re-resolve:

- exact active platform instance;
- exact DM recipient identity;
- current context authorization and provider access;
- effective feature policy and task scope;
- current effective read permissions.

The creator identity captured at configuration time is provenance, not perpetual authorization.

### 7.2 Platform matrix for the first increment

| Platform | First-increment posture | Required proof |
| --- | --- | --- |
| Telegram DM | Eligible after tests | Exact numeric chat identity, single-message escaping/render limit, confirmed receipt, retry behavior. No mention or group thread. |
| Mattermost DM | Eligible after tests | Correct DM channel resolution, exact user target, single-message markdown/limit behavior, confirmed receipt. No group root/mention policy. |
| Discord DM | Eligible after tests | Exact user DM, one post-render payload below the verified message limit, no raw group mention, confirmed/unknown behavior. |
| Kontur Talk DM | **Ineligible until fixed** | Adapter must return a truthful supported/confirmed/failed result rather than warn and return `void`. |

No platform's lack of rich actions blocks the first digest because durable controls live in settings.
It does block claiming cross-platform snooze/dismiss buttons until a fallback interaction is designed.

### 7.3 Group/thread expansion gate

Group delivery is a separate product increment, not a flag flip. It requires:

- explicit group benefit and audience owner;
- admin/member consent semantics;
- data visibility/redaction rules;
- exact main-context/thread behavior per platform;
- mention policy and bystander interruption budget;
- current membership revalidation;
- an explicit rule that group-owned definitions are guest-readable under current read-only guest
  semantics, with minimized/redacted stored fields and personal subscriptions kept in DM ownership;
- group-scoped dedup and reactive exposure;
- proof that unsupported thread semantics cannot silently fall back to a broader channel.

Until those exist, a candidate that originates in a group does not become a DM and does not become a
group broadcast; it is simply outside the first feature's eligible scope.

## 8. Safety and trust release blockers

Any blocker below prevents the canary cell from sending.

| Blocker | Required containment | Evidence/result |
| --- | --- | --- |
| Wrong actor or stale authorization | Re-resolve recipient, context, provider access, and effective permissions at execution and again before send. Configuration-time creator ID is insufficient. | Scope/delivery and safety reports. |
| Group/thread/DM scope ambiguity | Personal DM config contexts only; no fallback audience selection or group-to-DM conversion. | `context-scope.ts` findings in reports 04–06. |
| Kontur false success | Typed `unsupported`/receipt or a real DM implementation; disable policy creation otherwise. | Reports 02, 03, 05, and 06. |
| Untrusted text elevated to instructions | First renderer treats titles/fields as escaped data and uses no LLM. The shared `buildMetadataMessages` system-role elevation must also be fixed or removed before the canary so another automatic path cannot retain the unsafe boundary. | Reports 01, 03, and 06. |
| Automatic tool effects | First feature exposes no general tools and performs bounded reads only. Later inferred candidates remain read/propose by default. | Reports 03 and 06. |
| Effect, stale state, or prose repeated on retry | Stable occurrence/candidate/effect identities; frozen payload with a short TTL; bounded current policy/route/auth and item-state-version validation before a definite retry. Retry never reruns detection/model/effects, and changed or unproved state supersedes or drops the artifact. | Reports 02, 03, and 06. |
| History claims unseen delivery | Append conversation history and delivered exposure only after a confirmed receipt. | Reports 03, 05, and 06. |
| Raw internal error sent to user | Map provider/model/runtime failures to safe stable messages/status; log structured error metadata without secrets or task/chat content. | Scenario `AUT-012` and report 06. |
| Quiet-hours or non-working-day leak | Deterministic recipient-local evaluation before reads and immediately before send, including cross-midnight and DST fixtures. No urgent bypass. | Reports 03 and 04. |
| Duplicate or stale digest | One occurrence per local date, semantic item/candidate keys, current-state refresh, supersession, and expiry. | Reports 02–04. |
| Current `/stats/*` anonymity violation and future content leak | Remove or keyed-hash the raw `storageContextId`/`chatUserId` returned by `getSubjectStats`, remove string-capable `displayName` from the anonymous response schema, and update tests to reject seeded identifiers. Thereafter expose aggregate counts/reason codes only—never task/chat/calendar content, rendered markdown, raw errors, or raw identities. | `src/stats/index.ts:86-97`, `src/stats/types.ts:119-124`, `tests/debug/server-stats.test.ts:111-128`, architecture contract, and report 06 F-11/C-05/RB-14. |
| Secret/token exposure | Never log provider credentials, notify token, session cookies, headers, prompt bodies, or decrypted config. Redact error details. | Repository logging rule and report 06. |
| Unbounded execution | No agent loop in the first feature; bound provider requests, item counts, render length, leases, and retries. | No proactive run-control constraint and reports 02/03/06. |

## 9. Existing proactive paths: preserve their contracts

The first product control must not silently redefine every outbound class.

### 9.1 Explicit user-authored reminders and alerts

`AUT-001`–`AUT-005` carry explicit intent and remain distinct from assistant suggestions. Phase 0
should harden their delivery/history/effect lifecycle, but the new assistant master switch must not
quietly cancel or delay a reminder the user requested. Initially preserve the stored exact-time/
recurrence promise even during assistant quiet hours and label that separation. A future
automation-specific control may offer “respect quiet hours” or a clearly enumerated pause-all-
nonreactive action; it must not be inferred from the assistant-suggestions switch.

### 9.2 Transactional external updates

`AUT-006` (`POST /api/notify`) represents results/input-needed messages from work the user or operator
started elsewhere. Keep it a narrow final-message trust plane while adding rate, event identity, and
control requirements in a separate design. Do not route native task-health candidates through it.

### 9.3 Operator and release communications

Release announcements already demonstrate opt-in, review, bounded fan-out, and per-recipient delivery
records. Manual admin broadcast is a distinct operator path. Neither should become a hidden bypass for
assistant feature controls, and their urgency/rate policy needs separate product ownership.

### 9.4 Operational failures

Failure visibility is important because silence can imply a promised automation succeeded. It still
must use safe, stable error wording, incident-level dedup, and a delivery path that does not expose raw
exceptions or repeatedly nag at an alert cooldown.

## 10. Prioritized scenario roadmap

This ranking covers new/unbuilt proactive product work. Existing `AUT-*` paths are Phase 0 hardening,
not competitors for the first new scenario. Reactive-only planning records remain valuable but are not
permission to initiate a message.

| Rank | Scenario(s) | Recommended posture | Why here | Gate before advancement |
| ---: | --- | --- | --- | --- |
| 1 | `TSK-008` daily task-health digest | **Build first, narrowed as this document specifies** | High orientation value, predictable batch, feasible clock/read signal, no urgency or write required. | All blockers in §8; useful/accurate opt-in canary. |
| 2 | `TSK-006` first-overdue action prompt | **Second autonomous scenario; DM/digest default** | Existing overdue substrate and concrete recovery actions. | Reliable final-state filter, first-crossing identity, owner/scope rule, snooze/dismiss, lifecycle dedup. |
| 3 | `TSK-011` one-day-before deadline stage | **Add to the same deadline lifecycle** | Earlier action window and digest compatibility. | Reschedule supersession, task link, date/time semantics, per-day batching. |
| 4 | `TSK-014` task-linked relative reminder | **Explicit-intent automation follow-on** | Dynamic task linkage can keep a requested reminder accurate after task changes. | First-class task/occurrence link, due-date/status revalidation, reschedule supersession, delivery/effect idempotency. |
| 5 | `TSK-009` weekly review | **Low-frequency follow-on** | Low interruption pressure and reflective value. | Reliable completion/slip window, workweek settings, nonblaming/private rendering. |
| 6 | `TSK-010` weekly planning opener | **One prompt, then reactive planning** | Can form a useful ritual without autonomous plan mutation. | Capacity/priority evidence, plan-state ownership, explicit reply flow. |
| 7 | `TSK-001` and `TSK-005` create/completion suggestions | **Improve same-turn reactive behavior first** | Context is freshest and duplicate risk lowest inside the originating turn. | Structured turn effects/exposures; no repeated write; follow-up only if separately opted in. |
| 8 | `TSK-015` repeat-until-complete reminder | **Explicit-intent composition; conservative cadence** | Can satisfy a clear user request, but is also an easy nag loop. | Unified schedule+completion gate, hard per-series cap, open/final revalidation, snooze/stop, and no repeat after confirmed completion. |
| 9 | `PLN-003` task-only workload warning | **Digest enrichment, not standalone interrupt** | Can make the daily brief more actionable. | Explicit capacity/effort model; calibrated overload rule; no chronic warning. |
| 10 | `PLN-004` calendar-enriched briefing | **Read-only DM enrichment** | High planning value after task-only briefing is trusted. | Identity-scoped connector, private-event policy, free/busy semantics, connector health. |
| 11 | `CAL-004` and `CAL-003` auth/sync conflict notices | **Owner-DM operational lane** | Actionable integrity failures with clear responsible recipient. | Calendar connector, stable incident/revision identity, bounded retries, safe details. |
| 12 | `CAL-001` upcoming event reminder | **Only with explicit lead time and source dedup** | Strong time semantics. | Native-calendar duplicate strategy, recurrence/cancellation handling, privacy, expiry. |
| 13 | `CAL-002` recurring-event task proposal | **Digest/propose only** | Useful bridge without automatic task creation. | High-precision match, dismissal memory, untrusted-event-text containment. |
| 14 | `TSK-007` stale-task nudge | **Defer; digest-only experiment** | Potential backlog recovery. | Normalized updated/comment signal, waiting/parked semantics, precision evidence. |
| 15 | `TSK-002`/`TSK-003` due-date or workflow regression | **Defer pending richer event normalization** | Can expose schedule/workflow risk. | Exact old/new values, stable status order/finality, role audience, false-positive adjudication. |
| 16 | `TSK-004` semantic scope-reduction detection | **Do not schedule early** | Potentially valuable but highly ambiguous and injection/privacy sensitive. | Description history, bounded classifier, calibration, digest-only policy, source quoting/redaction. |
| 17 | `TSK-012`/`TSK-013` urgent due-day/overdue escalation | **Defer the urgent lane** | Real value for truly hard deadlines, but highest trust cost. | Explicit hard due time, separate urgent opt-in, reserved budget, zero quiet-hour bypass defects. |

### 10.1 Reactive planning lane

`PLN-001`, `PLN-002`, `PLN-005`, `PLN-006`, and `PLN-007` are explicitly user-initiated in their
stories. They can be improved on their own reactive roadmap without waiting for proactive delivery.
That work must not silently convert them into scheduled interruptions. `PLN-008` missed-briefing
catch-up should remain deferred until activity/presence and reactive-exposure behavior is reliable.

### 10.2 Controls are prerequisite, not roadmap scenarios

`CTL-001`, `CTL-003`, `CTL-005`, and `CTL-006`—quiet hours, workdays, master mute, and per-feature
control—are required for rank 1. `CTL-004` supplies generic digest/candidate semantics even though
`TSK-008` is itself a content product. `CTL-007`/`CTL-008` snooze/dismiss state must be designed into
identity and lifecycle; rich cross-platform actions can follow. `CTL-002` urgent bypass is explicitly
deferred. `CTL-009` timezone exists but needs the current-vs-persisted schedule distinction described
in report 04. `CTL-010` lives in settings, not chat configuration.

### 10.3 Disposition of catalogue records outside the ranked new-scenario table

| Records | Disposition |
| --- | --- |
| `AUT-001`, `AUT-002`, `AUT-003`, `AUT-004`, `AUT-005` | Existing explicit deferred substrate: Phase 0 reliability/authority/history hardening, then source-appropriate controls; not new autonomous competitors. |
| `AUT-006` | Existing transactional external trust plane: keep narrow and design typed/scoped hardening separately. |
| `AUT-007` | Existing recurring-task-created confirmation: add truthful delivery and later digest/mute policy without changing the task-creation contract silently. |
| `AUT-008` | Existing silent configured automation, not a proactive message; retain effect-idempotency review but do not put it in the message roadmap. |
| `AUT-009`, `AUT-010`, `AUT-011` | Existing release-review, opt-in release, and manual operator paths: preserve their distinct review/subscription/operator contracts. |
| `AUT-012` | Existing failure notice: harden safe error rendering, incident dedup, and truthful receipt as Phase 0 reliability work. |
| `PLN-001`, `PLN-002`, `PLN-005`, `PLN-006`, `PLN-007` | Reactive planning lane only; improve without creating unsolicited triggers. |
| `PLN-008` | Missed-briefing catch-up deferred until activity and structured reactive exposure are reliable. |
| `CTL-001`, `CTL-003`, `CTL-004`, `CTL-005`, `CTL-006` | First-increment shared control prerequisites. |
| `CTL-002` | Urgent quiet-hours bypass deferred with `TSK-012`/`TSK-013`. |
| `CTL-007`, `CTL-008` | Snooze/dismiss lifecycle designed in the foundation; cross-platform actions follow typed receipts and action authorization. |
| `CTL-009`, `CTL-010` | Timezone behavior retained/corrected and notification configuration kept in settings. |
| `CTL-011` | Calendar connection/capability consent belongs to the later identity-scoped read-only connector phase. |

## 11. Sequenced delivery plan for a later implementation plan

### Phase 0 — correctness hardening and contracts

- define candidate origins separately from policy classes so assistant suggestions, explicit
  reminders, transactional updates, and operator messages keep distinct consent semantics;
- introduce a truthful delivery result and block unsupported routes;
- separate execution audit, rendered artifact, delivery exposure, and conversation history;
- ensure failed/unknown send never reruns an effect;
- revalidate actor/context/membership/effective permissions at execution;
- remove user-derived metadata from privileged policy/instruction channels before the canary, even
  though the first E0 renderer does not call an LLM;
- map raw failures to safe error taxonomy;
- repair the current subject-stats response/schema/tests so `/stats/*` returns only anonymous
  aggregate-shaped data and approved keyed identifiers;
- establish privacy-minimal reason/receipt metrics.

**Exit:** platform contract tests and lifecycle crash/retry fixtures pass; current prompt/alert paths
do not claim confirmed delivery or repeat writes incorrectly.

### Phase 1 — policy, occurrence, candidate, and settings foundation

- add default-off master/feature policy for assistant suggestions;
- add timezone/workday/digest/quiet-hours evaluator and previews;
- add durable occurrence, candidate/outbox, lease, reason codes, expiry, and delivery ledger;
- add a privacy-minimal structured reactive-exposure writer for normal turns, keyed by exact
  task/state/audience and canonical coverage (`mentioned`, `action_offered`, `acknowledged`,
  `resolved`), so dedup never depends on text similarity;
- add personal-DM eligibility and explicit task-scope selection;
- create shadow-only detection with no message, history, or mutating tool call.

**Exit:** deterministic fixtures cover DST, cross-midnight quiet hours, non-working days, edits while
held, duplicate scheduler ticks, crashes, and policy changes.

### Phase 2 — deterministic `TSK-008` canary

- perform bounded fresh provider reads after pre-gates;
- normalize final/in-progress state without substring guessing;
- render bounded source-linked sections;
- suppress or update items already shown/acted on in a recent structured reactive exposure window;
- revalidate, freeze payload, send once, record confirmed exposure/history;
- expose settings pause/mute and next delivery;
- roll out only to an explicit internal allowlist, then a small opt-in cohort.

**Exit:** zero safety invariant violations, no duplicate/false delivery records, content/source audit
passes, and predeclared usefulness/retention gates are met.

### Phase 3 — deadline lifecycle and user feedback

- add first-crossing state for `TSK-006` and pre-deadline `TSK-011`;
- add item-level snooze, dismiss, mute-subject/scenario, already-knew, and wrong-person feedback;
- keep default delivery digest/next-work-window and effects propose-only;
- instrument cross-scenario recent-load budget in shadow before enforcement.

**Exit:** lifecycle stages deduplicate, reschedules/resolutions supersede, tone/action testing passes,
and immediate delivery remains unnecessary for the ordinary class.

### Phase 4 — weekly planning and read-only calendar enrichment

- add `TSK-009`/`TSK-010` only after completion/workweek data is trustworthy;
- design identity-scoped read-only calendar connector and privacy rules;
- enrich `PLN-004` just in time; do not add calendar webhooks merely for a daily read;
- keep group/private event data out of scope.

### Phase 5 — limited event-driven, group, urgent, and learned behavior

Each is a separate approval:

- richer provider observations/webhooks for precise deltas;
- group/thread delivery with per-platform and bystander policy;
- urgent class with explicit hard-deadline authorization;
- user-approved learned suppression after adequate observations;
- semantic description/conversation inference only after calibration and privacy review.

None is implied by success of the daily digest.

## 12. Verification and test matrix required before canary

### 12.1 Policy time matrix

- IANA zones with and without DST;
- spring-forward missing local time and fall-back repeated local time;
- quiet periods contained in one day and crossing midnight;
- digest time inside quiet hours;
- working-day boundary after a weekend/nonstandard week;
- timezone/policy edit before occurrence, while held, and after rendering;
- restart/overlap at the exact local occurrence minute;
- old held occurrence when the next local day arrives.

Expected invariant: at most one eligible daily occurrence per policy/local date; a held old digest is
refreshed or superseded, never burst with newer days.

### 12.2 Scope and authorization matrix

- personal DM happy path for each platform;
- group main and group thread rejected;
- group-config-to-DM rejected;
- inactive/replaced platform instance;
- recipient identity changed/removed;
- task instance removed or credentials revoked;
- provider permissions narrowed after candidate creation;
- guest/unknown actor paths rejected;
- sibling thread/config context collision;
- task URL/project outside selected scope omitted.

### 12.3 Task-state matrix

- overdue/due-today across recipient timezone;
- final/cancelled task exclusion;
- due date cleared or moved while held;
- task completed/deleted/access-revoked before send;
- unknown finality/status mapping;
- duplicate task across pages/projects;
- missing/invalid dates and URLs;
- provider pagination/truncation/rate-limit behavior;
- title containing Markdown, mentions, control-like text, or prompt-injection instructions;
- no matching tasks and deterministic overflow;
- same task/state surfaced in a normal turn before rendering or while the digest is held;
- a materially newer task state after a reactive exposure remains eligible under a new state key.

### 12.4 Delivery/retry matrix

- provider confirms; history/exposure appears once;
- definite failure before acceptance; the same frozen payload retries only within its TTL after policy,
  route, authorization, and item-state-version validation;
- ambiguous timeout; no blind duplicate and no history claim;
- crash before lease, after lease, after render, during send, after confirmation, and before history;
- overlength input is deterministically shortened with an overflow count and produces exactly one
  adapter send; multi-part delivery is prohibited;
- unsupported Kontur route;
- platform deactivation while held;
- two workers polling the same occurrence;
- delivery succeeds but history append temporarily fails.

The last case must preserve delivery truth and repair history idempotently; it must not resend.

### 12.5 Privacy, logs, and stats matrix

- no task title/description/comment/rendered message in structured logs;
- no credential/token/session/header in success or error logs;
- raw provider errors redacted before user delivery and aggregation;
- `/stats/*` exposes only anonymous aggregates and suppresses unsafe small/identifying dimensions;
- seeded `storageContextId`, `chatUserId`, and display-name canaries never appear in either global or
  subject response bodies;
- candidate audit access follows content authorization;
- retention/deletion removes content artifacts without corrupting aggregate delivery counts;
- settings status never reveals task data to an unauthorized settings viewer.

## 13. Rollout and measurement

### 13.1 Shadow phase

Run occurrence, gates, task normalization, candidate generation, disposition, and counterfactual
budget without sending, appending history, or invoking a model/effect. Review redacted structured
evidence only with authorized participants. Measure:

- eligible/empty/suppressed counts and reasons;
- task category accuracy and unknown status/finality rate;
- expected digest size/overflow;
- duplicate occurrence/candidate attempts;
- provider call duration/rate-limit pressure;
- how often quiet hours/workdays defer or expire an occurrence;
- platform/route eligibility.

### 13.2 Opt-in canary

The canary must remain default off and reversible. Every message says why it was sent and where the
feature is controlled. Track:

- explicit useful/not-useful/too-frequent/already-knew feedback when available;
- mute/pause/opt-out and 7/30-day retention;
- meaningful task action within a predeclared horizon, without overstating causality;
- delivered, failed, unknown, duplicate-caught, duplicate-escaped, and history-repair outcomes;
- direct interruptions per allowed workday (expected maximum: one from this feature);
- content/source audit accuracy.

### 13.3 Provisional pilot gates

The following are planning hypotheses, not literature-derived constants. Product/research owners
should predeclare final thresholds and sample/power requirements before the canary:

- **zero** wrong-recipient/context, permission, sensitivity, quiet-hours, effect, secret, or
  false-delivery-history incidents;
- **zero** known duplicate visible messages for the same occurrence after retry;
- **100%** audited included items trace to current selected-scope task state at render time;
- one or fewer visible feature interruptions per eligible workday;
- a clearly positive useful-minus-not-useful balance among rated deliveries;
- no early pattern of users muting after one or two deliveries;
- bounded provider/read and delivery latency within the product's declared window;
- unknown delivery outcomes rare enough to handle without unsafe automatic retry.

Do not widen because open/click rates look high. Widen only when safety invariants hold and explicit
usefulness/retention plus task-state outcomes justify the interruption.

### 13.4 Automatic stop conditions

Pause the affected platform/provider/cohort immediately for:

- any wrong audience, private data, guest, permission, or secret incident;
- quiet-hours/non-working-day delivery outside declared semantics;
- repeated automatic effect or duplicate due to retry;
- a route marked delivered when the adapter did not send;
- task/provider text changing policy, instructions, audience, or rendering structure;
- content appearing in anonymous stats/logs;
- unreconstructable candidate/decision/delivery state.

Pause and redesign the product if useful precision remains poor after deterministic scope, state, and
size gates, or if opt-in users routinely mute after the first deliveries.

## 14. Rejected architectural shortcuts

1. **Put quiet hours inside `sendProactiveMessage`.** Too late: model/tool work and effects may have
   happened, held state is not durable, and retries can repeat them.
2. **Use conversation history as the queue/dedup store.** It cannot represent candidate identity,
   expiry, reasons, leases, delivery unknown, or reactive structured exposure; current generated
   messages may exist before send.
3. **Treat alert cooldown as the interruption budget.** It is per alert definition and permits
   cross-feature pressure and repeated static-state nags.
4. **Send every true trigger and let users mute later.** Violates default-off consent and makes trust
   damage the onboarding mechanism.
5. **Let the LLM decide urgency, audience, or quiet-hours bypass.** No external evidence validates it,
   untrusted task/calendar text can influence it, and these are deterministic safety decisions.
6. **Reuse the full proactive run for convenience.** It can run many steps without run-control,
   assemble context/tool capabilities, persist before final send, and create effects a digest does
   not need.
7. **Use `/api/notify` for native candidates.** It is a trusted final-message endpoint, not a
   candidate/control ingress.
8. **Infer personal ownership from a group policy or display name.** Scope and identity are not
   interchangeable, and the result can leak group/task information.
9. **Start with group delivery because the task config is group-shared.** Configuration scope is not
   audience permission; platform thread/mention capabilities differ and group bystanders bear cost.
10. **Copy a competitor's default or research quota.** Official product behavior is precedent, not
    outcome evidence, and notification studies do not establish papai-specific numbers.

## 15. Decision traceability

| Recommendation | Primary evidence |
| --- | --- |
| Choose `TSK-008` task-only digest first | [Catalogue task-health scenarios](./01-scenario-catalogue.md#32-task-health-deadlines-and-work-rhythm) and [research conclusions](./01-scenario-catalogue.md#7-research-conclusions-feeding-later-workstreams); [time feasibility](./02-trigger-feasibility.md#6-time-trigger-feasibility) and [minimum trigger architecture](./02-trigger-feasibility.md#14-minimum-trigger-architecture-recommendation); [scenario synthesis](./07-prior-art-and-synthesis.md#6-synthesis-against-papais-scenario-space) and [transfer decisions](./07-prior-art-and-synthesis.md#10-transfer-decisions-for-the-final-recommendation) |
| Default off, feature-specific, settings-only controls | [Research plan section 7](./00-research-plan.md); [control taxonomy](./04-notification-controls.md#2-control-taxonomy-and-precedence), [normative requirements](./04-notification-controls.md#4-normative-requirements), and [settings surface](./04-notification-controls.md#6-settings-ui-surface-sketch); [product prior art](./07-prior-art-and-synthesis.md#4-current-product-prior-art) |
| Personal DM config contexts only | [Control scope](./04-notification-controls.md#3-preference-scope-and-precedence); [scope invariants](./05-scope-and-delivery.md#3-scope-key-glossary-and-invariants) and [group/DM rules](./05-scope-and-delivery.md#6-group-and-dm-product-rules); [safety revocation rules](./06-safety-and-trust.md#11-scope-audience-privacy-and-revocation-rules) |
| Use explicit task scope, not inferred ownership | [Catalogue audience analysis](./01-scenario-catalogue.md#4-scenario-family-analysis); [provider observability](./02-trigger-feasibility.md#5-provider-specific-observability); [actor/authority findings](./05-scope-and-delivery.md#4-actor-owner-guest-membership-and-tool-permissions) and [safety rules](./06-safety-and-trust.md#11-scope-audience-privacy-and-revocation-rules) |
| Deterministic read-only renderer | [WS-C effect policy](./03-decide-to-interrupt.md#13-llm-execution-and-effect-policy); [no-run-control implications](./05-scope-and-delivery.md#11-run-control-and-live-status-implications); [safe execution policy](./06-safety-and-trust.md#9-safe-execution-and-effect-policy) and [prompt-injection suite](./06-safety-and-trust.md#10-prompt-injection-stress-suite) |
| No urgent lane in first increment | [Hard gates](./03-decide-to-interrupt.md#5-hard-eligibility-gates-before-scoring) and [interruption budget](./03-decide-to-interrupt.md#7-interruption-budget-and-token-buckets); [control requirements](./04-notification-controls.md#4-normative-requirements); [evidence-informed decision model](./07-prior-art-and-synthesis.md#5-evidence-informed-decision-model) |
| Durable occurrence/candidate/outbox | [Minimum trigger architecture](./02-trigger-feasibility.md#14-minimum-trigger-architecture-recommendation); [candidate envelope](./03-decide-to-interrupt.md#3-typed-candidate-envelope) and [state machine](./03-decide-to-interrupt.md#12-state-machine-and-architecture-placement); [control data model](./04-notification-controls.md#5-logical-data-model); [reliability bounds](./06-safety-and-trust.md#13-reliability-history-ordering-and-no-run-control-bounds) |
| Freeze payload; validate freshness without rerunning detection or effects on send retry | [WS-C retry/effect invariant](./03-decide-to-interrupt.md#122-retry-and-side-effect-invariant); [delivery lifecycle](./05-scope-and-delivery.md#7-delivery-and-history-lifecycle) and [retry analysis](./05-scope-and-delivery.md#8-failure-retry-and-idempotency); [safety reliability model](./06-safety-and-trust.md#13-reliability-history-ordering-and-no-run-control-bounds) |
| Truthful delivery receipt and Kontur disablement | [Platform constraints](./02-trigger-feasibility.md#9-chat-platform-delivery-constraints); [platform matrix](./05-scope-and-delivery.md#5-per-platform-delivery-matrix) and [release blockers](./05-scope-and-delivery.md#15-release-blockers); [F-08/RB-08](./06-safety-and-trust.md#7-verification-of-suspected-issues-and-audit-findings) |
| History only after confirmed delivery | [Current persistence gap](./03-decide-to-interrupt.md#2-current-papai-primitives-and-exact-gaps) and [state machine](./03-decide-to-interrupt.md#12-state-machine-and-architecture-placement); [delivery/history lifecycle](./05-scope-and-delivery.md#7-delivery-and-history-lifecycle); [safety reliability model](./06-safety-and-trust.md#13-reliability-history-ordering-and-no-run-control-bounds) |
| Repair `/stats/*`, then keep observability aggregate-only | [Architecture anonymity contract](../../architecture/overview.md#anonymity-contract-for-stats); [controls observability](./04-notification-controls.md#10-observability-and-privacy); [F-11/C-05/RB-14](./06-safety-and-trust.md#7-verification-of-suspected-issues-and-audit-findings) and [logs/stats analysis](./06-safety-and-trust.md#14-logs-errors-retention-stats-and-future-surfaces) |
| `TSK-006` second, calendar later | [Catalogue conclusions](./01-scenario-catalogue.md#7-research-conclusions-feeding-later-workstreams); [Phase 9–11 feasibility matrices](./02-trigger-feasibility.md#10-candidate-matrix-phase-9); [value/effort/risk synthesis](./07-prior-art-and-synthesis.md#6-synthesis-against-papais-scenario-space) |
| Group, semantic inference, learned suppression later | [Group/DM rules](./05-scope-and-delivery.md#6-group-and-dm-product-rules) and [release blockers](./05-scope-and-delivery.md#15-release-blockers); [safety revocation rules](./06-safety-and-trust.md#11-scope-audience-privacy-and-revocation-rules); [unsupported claims](./07-prior-art-and-synthesis.md#8-claims-the-evidence-does-not-support) and [transfer decisions](./07-prior-art-and-synthesis.md#10-transfer-decisions-for-the-final-recommendation) |

## 16. Open decisions for the implementation plan

The recommendation is specific enough to approve a design phase, but the implementation plan must
resolve these without weakening the contract:

1. Which provider-stable project/assignee identifiers can populate the task-scope picker for Kaneo
   and YouTrack, and how unsupported identity mappings are described.
2. The exact normalized final/in-progress status contract and how provider-specific unknowns fail
   closed.
3. Whether a fresh second provider read immediately before send is affordable or item version checks
   can provide equivalent bounded revalidation.
4. The platform delivery-receipt type, single-message identity, and reconciliation possible for each
   adapter; per-chunk identity remains a later prerequisite if multi-part delivery is ever proposed.
5. Candidate/rendered-content retention and deletion periods, separate from anonymous aggregates.
6. Settings authorization when a personal context's configuration is edited and how a task scope is
   previewed without leaking data.
7. Exact DST behavior when the selected local digest time is missing or repeated; the UI must preview
   it and tests must lock it down.
8. Message length/item cap after real provider-title distributions are observed in shadow mode.
9. The feedback fallback for platforms without buttons; configuration remains in settings, but
   message-specific interaction must not rely on ambiguous free text.
10. Pilot thresholds, labeling method, cohort/sample size, outcome horizon, and retention policy.

These are plan inputs, not reasons to broaden the first increment. If exact recipient, task scope,
status finality, or delivery truth cannot be resolved, the correct result is no send.

## 17. Final green-light statement

Proceed to a separate implementation design for the narrowed `TSK-008` increment **only if** the
candidate/outbox, controls, scope, effect, delivery, history, privacy, and verification requirements
in this document are accepted as part of the feature—not optional follow-up hardening.

Do not approve a shortcut that merely schedules a `full` proactive prompt which lists tasks and calls
the existing sender. That would produce the appearance of the selected scenario without the product
model this research was commissioned to establish. The decision is to build a controlled proactive
capability and use a daily task-health digest as its first proof, not to add one more source of bot
messages.
