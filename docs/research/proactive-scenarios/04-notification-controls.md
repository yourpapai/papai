<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Notification controls: requirements, scope, and state model

> **Workstream:** WS-D
> **Status:** Research finding; not an implementation specification
> **Evidence date:** 2026-07-19

## Executive conclusion

papai should not expose one undifferentiated “notifications” switch. It has at least four outbound
classes with different user expectations:

1. **User-requested reminders and automations** — an explicit promise made by the user through a
   deferred prompt.
2. **Assistant-initiated suggestions** — task-health nudges, briefings, reviews, and planning prompts
   that papai proposes without a direct request.
3. **Transactional updates** — results of work the user deliberately started elsewhere, such as ACP
   coding-session milestones delivered through `POST /api/notify`.
4. **Operator communications** — opt-in release announcements and exceptional admin broadcasts.

The first proactive product increment should control class 2 and leave the existing class-specific
contracts visible rather than silently redefining them. “Pause suggestions and briefings” can be
default-off and safe. “Mute absolutely every outbound message” would also suppress reminders the
user explicitly requested and work-completion updates they are waiting for; if papai later offers
that emergency switch, the UI must describe those consequences precisely.

The minimum safe control set for assistant-initiated proactivity is:

- a **master opt-in**, default off;
- a **per-feature toggle**, default off for every newly introduced scenario family;
- a required, validated **IANA timezone**;
- **quiet hours**, evaluated in that timezone with no implicit “urgent” bypass;
- **working days** plus an explicit local **digest time**;
- `immediate` / `digest` / `muted` delivery behavior, with digest recommended for task-health
  suggestions;
- durable **deduplication and candidate state** so a held or failed message is not regenerated;
- `snooze` and `dismiss` state designed now, even if rich chat actions ship after the first slice;
- a single settings-UI section that shows effective scope, defaults, next delivery time, and held
  items in plain language.

Controls must run **before LLM/tool execution** and must be re-evaluated immediately before send.
Applying quiet hours only in `proactive-delivery.ts` would still spend tokens, could execute tools,
and would repeat side effects when delivery is retried.

## 1. Evidence and current-state corrections

### 1.1 Binding architecture facts

| Fact | Evidence | Consequence for controls |
| --- | --- | --- |
| On thread-normalizing platforms, durable group configuration is shared across sibling threads while conversation history and deferred-prompt delivery are thread-scoped. Discord thread channels currently remain independent contexts. | `ENTITY_SCOPES` in `src/chat/context-scope.ts:38-66`; `getScopeKey` at lines 23-35; Discord capability/target analysis in `05-scope-and-delivery.md`. | A notification policy belongs to the effective config-context; each candidate must separately retain its exact storage/delivery context, and the UI must describe the platform-specific scope. |
| `user_config` is an effective group-scoped entity despite the historical column name. | `src/chat/context-scope.ts:58`; config-context derivation in `src/chat/scoped-context.ts:83-86`. | Do not infer that a row called `user_config` is a cross-context human preference. |
| All configuration is in the Svelte settings SPA, entered through `/config`. | `docs/architecture/behaviors.md`; `docs/architecture/overview.md:56-57`. | Notification preferences are edited in settings, not through `/set`, `/settings`, or free-form chat. |
| The current generic config surface supports only text, toggle, and select controls. | `ConfigField` in `src/types/config.ts:43-55`; fields are assembled in `src/config-keys.ts:18-90`. | Quiet-hour ranges, weekday multi-select, held items, and reset previews need a purpose-built settings API/section rather than JSON in a text field. |
| Scheduled and alert prompts retain exact group/thread delivery metadata. | `DeferredPromptDelivery` in `src/deferred-prompts/types.ts:13-21`; registry rows at `src/chat/context-scope.ts:48-49`. | Policy lookup and delivery targeting must not be collapsed into one identifier. |
| Proactive full-mode tools receive the config-context tool preferences; `ask` has no interactive approval callback. | `buildFullToolSet` in `src/deferred-prompts/proactive-llm-full.ts:18-35`; `buildFullSystemPrompt` in `proactive-llm-helpers.ts:241-248`; `MakeToolsOptions.askPermission` in `src/tools/types.ts:49-54`. | A muted/held candidate must not start a run. Automatic scenarios also need an effect policy stricter than ordinary `tool_prefs`. |
| Existing release announcements already demonstrate default-off subscription and per-recipient delivery idempotency. | `src/announcements/store.ts:24-79`; `src/announcements/broadcast.ts:93-137`. | Reuse the opt-in and delivery-ledger pattern; do not use conversation text as the dedup store. |

### 1.2 Phase 10 is product intent, not an accurate implementation inventory

`docs/user-stories/phase-10-notification-controls.md` correctly defines the desired outcomes, but its
implementation notes predate the settings-only configuration migration. The report therefore treats
the acceptance criteria as candidate requirements and verifies current behavior separately.

| Phase 10 claim | Verified current behavior | Research disposition |
| --- | --- | --- |
| Timezone exists and scheduled operations use it. | `timezone` is a required preference field (`src/config-keys.ts:18-26`), normalized by `src/utils/timezone.ts:17-47`, and used when compiling schedules (`src/deferred-prompts/tool-handlers.ts:76-123`). | **Partly verified.** Keep the IANA-timezone substrate. |
| Updating a timezone immediately switches all future scheduled messages. | Recurring prompts persist the timezone used at creation (`src/deferred-prompts/scheduled.ts:50-86`) and subsequent occurrences prefer `prompt.timezone` over current config (`src/deferred-prompts/poller-scheduled.ts:35-38`). One-shot `fireAt` is already fixed in UTC. | **Not satisfied as written.** Notification policy evaluation can use the current timezone immediately, but rebasing existing explicit reminders is a separate migration/product decision. |
| Quiet hours exist. | No quiet-hour field, policy evaluator, or held-candidate state was found. | **Not implemented.** |
| Working days exist. | RRULE supports `byDay`, but there is no reusable work-week preference. | **Not implemented.** A recurrence rule is not a notification policy. |
| Immediate/digest/muted exists. | Scheduled prompts due together may be merged by delivery key (`src/deferred-prompts/poller-groups.ts:8-26`), but there is no user delivery mode, daily digest queue, or global mute. | **Not implemented.** Existing coalescing is an execution optimization, not digest semantics. |
| Per-feature toggles exist. | No proactive scenario registry or feature preference exists. Release-announcement subscription is a separate feature-specific toggle. | **Not implemented.** |
| Snooze/dismiss/reschedule exists. | Deferred prompts can be updated/cancelled, but a delivered message has no candidate identity, returned platform message ID, or notification action route. | **Not implemented.** |
| Preferences can be shown/reset in chat. | All configuration now belongs to the settings UI; retired chat config flows must not be revived. | **Requirement must be translated** to settings summary/reset, while message-specific snooze/dismiss may remain a chat interaction. |

### 1.3 A control is not merely a send-time filter

The present poller generates a response before delivery (`src/deferred-prompts/poller.ts:73-93` and
lines 155-183). Full generation may execute up to 25 model steps with a 20-minute timeout
(`src/deferred-prompts/proactive-llm.ts:228-235`). If a network send fails, the prompt is not finalized
and can execute again on the next poll. Therefore:

- muted candidates must be rejected before generation;
- quiet-hour/digest candidates must be persisted as data, not regenerated later;
- a delivery retry must reuse rendered content and recorded effects;
- a settings change must invalidate or reclassify pending candidates transactionally;
- policy must be checked again at the last send boundary to close mute/quiet-hours races.

## 2. Control taxonomy and precedence

### 2.1 Policy classes

| Policy class | Examples | Default | Subject to assistant master switch? | Quiet hours | Digest | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `assistant_initiated` | overdue digest, stale-task nudge, morning briefing, weekly planning prompt | Off | Yes | Always, unless the user explicitly enables a named urgent class | Yes | This is the scope of the first control surface. |
| `user_scheduled` | “remind me at 14:00”, an explicit recurring automation | Existing behavior retained | No | No initially; later optional per-reminder “respect quiet hours” control | Only if user chooses | The product has made a direct promise; do not silently delay or drop it under assistant-suggestion controls. |
| `transactional` | coding-session permission/input/done milestone | Enabled by initiating the transaction | No | Usually yes; “waiting for permission/input” may have a separately disclosed bypass | Usually no | Requires typed origin and idempotency; raw `/api/notify` has neither today. |
| `release_announcement` | reviewed version announcement | Existing explicit subscription, default off | No | Prefer yes | No | Preserve the current subscription contract. |
| `operator_broadcast` | manual emergency/admin announce | Operator-only | No | Policy decision outside this workstream | No | Must remain visually and operationally distinct from assistant suggestions. |

This taxonomy intentionally differs from a blanket Phase 10 “muted means all proactive messages”
reading. The UI can still offer a separate **Pause all non-reactive messages** emergency action in a
later increment, but only after it can enumerate what will be paused.

Policy class is orthogonal to **candidate origin**. Origin identifies how evidence entered papai
(`explicit_schedule`, `task_observation`, `turn_effect`, `calendar_observation`, `trusted_external`,
`announcement`, or `operational_failure`); policy class selects the consent and delivery contract.
The scenario registry owns a versioned origin→policy-class mapping. For example,
`explicit_schedule` maps to `user_scheduled`, task/calendar observations normally map to
`assistant_initiated`, trusted work milestones normally map to `transactional`, and an announcement
origin maps to either `release_announcement` or `operator_broadcast`.

### 2.2 Evaluation order

The decision gateway should use deterministic gates in this order:

1. **Validate target and provenance** — scenario ID, candidate origin, policy class, config context, storage/delivery
   context, platform instance, actor/owner, and audience are all present and mutually consistent.
2. **Revalidate authorization** — context/group remains authorized; initiating actor remains eligible;
   blocked users and removed members do not retain standing proactive authority.
3. **Apply policy-class rules** — transactional and user-scheduled promises do not accidentally
   inherit assistant-suggestion defaults.
4. **Apply master opt-in/mute** for assistant-initiated candidates.
5. **Apply per-feature toggle** using a stable scenario-family ID.
6. **Apply privacy/audience policy** before any task or calendar content is rendered.
7. **Deduplicate and test candidate freshness** using structured subject/state fingerprints.
8. **Apply explicit dismiss/snooze state.**
9. **Apply quiet hours and working-day rules** using the current effective timezone.
10. **Apply urgency permission.** “Urgent” is not a model-selected escape hatch; the scenario schema
    and user preference must both allow bypass.
11. **Apply interruption budget and delivery mode** to choose send-now, hold, digest, or drop.
12. **Only then render/run the LLM**, under the scenario's effect policy.
13. **Re-evaluate mutable gates immediately before send** (authorization, mute, feature, quiet
    hours, freshness, and idempotency).
14. **Record an atomic delivery outcome** and only then expose the event to conversation history.

The gateway returns machine-readable reason codes such as `master_disabled`, `feature_disabled`,
`quiet_hours`, `non_working_day`, `digest_queued`, `budget_exhausted`, `duplicate`, `stale`,
`unauthorized`, and `sent`. These are safe for aggregate telemetry; free-form candidate content is not.

## 3. Preference scope and precedence

### 3.1 Recommended MVP scope: config-context policy

Use the **config-context ID** as the notification-policy key:

- in a DM, that is the platform-scoped personal context;
- in a thread-capable Telegram, Mattermost, or Kontur group, it is the group context shared across
  sibling threads; Discord thread channels are independent group contexts because papai has no
  parent-thread scope there;
- the exact candidate target remains a separate thread-scoped storage-context ID.

This matches current settings authorization and the `ENTITY_SCOPES` contract. It avoids inventing a
cross-platform “human” identity that papai does not currently have. A person using Telegram and
Discord should expect separate notification policies unless a future account-linking model explicitly
joins them.

### 3.2 Group semantics

Group policy is administered by group admins. On Telegram, Mattermost, and Kontur it applies across
the sibling threads that normalize to one config context, so the UI may say “Applies to all threads in
this group.” On Discord, each observed thread channel is currently its own group/config context; the UI
must not promise parent/sibling sharing unless a future parent-channel normalization is implemented.
A candidate registration still records its exact originating thread/channel; enabling a feature in
one context must not cause delivery to an arbitrary “current” context.

An individual cannot privately mute a message that is posted to a shared group. Per-person overrides
can suppress an `@mention`, but they cannot un-send the underlying message. For that reason, the first
assistant-initiated increment should be **DM-only**. Group auto-nudges should remain out of scope until
papai has explicit audience rules and a user-visible group-admin control surface.

If group delivery is later enabled, use two layers:

1. group policy keyed by config context, controlled by group admins;
2. optional recipient/mention preference keyed by `(config_context_id, platform_user_id)`, controlled
   by that user, which may remove a personal mention but never override the group's shared-message
   decision.

### 3.3 Preference precedence

For assistant-initiated candidates, the most restrictive applicable rule wins:

```text
authorization
  > policy-class eligibility
  > master switch
  > feature toggle
  > dismiss/snooze
  > privacy/audience gate
  > quiet hours / working days
  > delivery mode / interruption budget
  > scenario default
```

No lower layer may turn a `drop` into a send. An urgency bypass may change `hold` to `send_now` only
when the scenario is allowlisted and the user has opted into that bypass.

## 4. Normative requirements

The terms **MUST**, **SHOULD**, and **MAY** below describe the recommended product contract, not current
implementation.

### 4.1 Master control

- New assistant-initiated proactivity MUST be default off for every existing context.
- Enabling the master switch MUST NOT automatically enable every feature; the UI offers explicit
  feature choices, with a clearly described recommended starter set.
- Disabling the master switch MUST prevent new candidate generation and give every unsent
  assistant-initiated candidate disposition `drop`, state `dropped`, and reason `master_disabled`,
  without deleting audit/dedup state.
- Re-enabling MUST NOT requeue rows dropped for `master_disabled`. Only a new/current observation may
  create a fresh candidate under the scenario's identity rule; old rows remain terminal audit state.
- The switch MUST state that explicit reminders, initiated-work updates, and subscribed release notes
  are controlled separately.

### 4.2 Per-feature controls

- Each scenario family MUST have a stable, non-localized ID such as `task_health.daily_digest`.
- Display labels and descriptions MAY change without rewriting stored preference keys.
- A newly deployed feature MUST remain off until explicitly enabled, even when the master switch was
  enabled before deployment.
- Disabling a feature MUST suppress its queued candidates and cancel future automatic registration,
  but MUST NOT delete user-authored deferred prompts that happen to mention the same topic.
- Feature controls SHOULD show expected cadence, required data sources, audience, and whether any
  LLM or external connector is used.

### 4.3 Quiet hours

- Quiet hours MUST have an explicit `enabled` flag; `start == end` must never ambiguously mean either
  disabled or 24-hour silence.
- The interval is local-time, half-open `[start, end)`, and may cross midnight.
- Evaluation MUST use the current validated IANA timezone, not a stored UTC offset.
- A held candidate MUST store `next_eligible_at` and be re-evaluated at wake-up; it must not assume it
  is still relevant.
- DST gaps and folds MUST be resolved by timezone-aware local-date arithmetic. Never add a fixed
  number of UTC hours to find the next quiet-hours boundary.
- Invalid/missing timezone MUST block enabling quiet hours. A corrupted legacy value should fail
  closed for assistant-initiated sends and surface a settings error rather than silently sending at
  UTC night.
- “Urgent” MUST be a scenario capability, not model prose or a score alone. The default user setting
  is **no quiet-hours bypass**.
- When bypass is enabled, the message MUST visibly identify the objective reason (for example,
  “deadline in 20 minutes”), not merely add an alarm emoji.

### 4.4 Working days

- Store weekdays as ISO weekday numbers `1..7` or an equivalent validated bitset; never locale-specific
  strings.
- The recommended initial default, used only after opt-in, is Monday-Friday.
- Evaluation uses the local date at the candidate's effective delivery time.
- Scenario metadata declares whether it is `workday_only`, `any_day`, or `deadline_driven`.
- A held workday-only candidate moves to the next configured working day at an allowed local time and
  is rechecked for expiry.
- A timezone or working-days edit MUST recompute pending `next_eligible_at` values.

### 4.5 Delivery mode and digest

- Supported modes are `immediate`, `digest`, and `muted`, but they apply per policy class. This report
  recommends `digest` as the initial default after enabling task-health suggestions.
- Digest mode requires an explicit local `digest_at` time. Phase 10's “end of working day” cannot be
  calculated from working days alone because no workday end is configured.
- A digest is a single decision/rendering unit, not concatenated finished LLM messages.
- Candidates are deduplicated and ranked before rendering. The digest SHOULD cap displayed items
  (initial assumption: 5-7) and state how many lower-ranked items were omitted.
- Items that expire before the next digest are dropped unless their allowlisted urgency permits
  immediate delivery.
- A digest scheduled inside quiet hours moves to the next allowed time; it never bypasses by default.
- A digest on a non-working day moves to the next working day for `workday_only` features.
- Direct replies remain immediate because they never enter the proactive gateway.

### 4.6 Snooze, dismiss, and reschedule

- `snooze` changes one candidate's `next_eligible_at`; it does not create a duplicate deferred prompt.
- `dismiss` initially applies to one candidate/state fingerprint. Broader choices (“hide this task for
  a week”, “turn off this feature”) must be explicit separate actions.
- `reschedule` for a user-authored reminder updates that reminder. For an assistant suggestion it is a
  snooze; the product must not pretend an underlying task due date changed.
- Actions MUST be bound to a candidate ID and the platform message receipt, not inferred from “the
  last notification” in conversation history.
- Action tokens MUST be authenticated, actor-bound, context-bound, single-use or replay-safe, and
  expiry-limited.
- Natural-language replies MAY supplement buttons, but reply-to-message identity is authoritative.
  Ambiguous “dismiss” messages must ask which item the user means.
- The settings UI MUST list pending snoozes with scenario, safe subject label, and local delivery time,
  and allow cancellation.

The present proactive `sendMessage` contract returns only `void`/`boolean`
(`src/chat/types.ts:243-260`) and cannot return a platform message ID. Rich actions therefore require a
delivery receipt contract before they can be reliable. Telegram, Discord, and Mattermost have button
capabilities; Kontur Talk does not (`src/chat/*/metadata.ts`). WS-E covers the degradation matrix.

### 4.7 Review and reset

- “Show my notification settings” becomes a settings-page summary, not a chat configuration command.
- The summary MUST show effective scope, master status, policy-class distinctions, timezone, quiet
  hours, working days, delivery mode/time, enabled features, urgent bypasses, and pending snoozes.
- Reset MUST show a preview and require confirmation.
- Reset returns assistant-initiated policy to default-off, but MUST NOT cancel explicit deferred
  prompts or change release-announcement subscriptions unless the preview names those actions.
- Resetting pending candidate policy MUST move unsent rows to `dropped` with a reset reason, not erase
  them, so retry and dedup behavior remains auditable.

## 5. Logical data model

This model is intentionally implementation-neutral. A later plan may choose normalized SQLite tables
or a hybrid, but the invariants should survive that choice.

Use the WS-C vocabulary as the canonical cross-report model:

- **disposition** is one decision among `send-now`, `digest`, `hold`, or `drop`;
- **state** is lifecycle progress: `detected`, `eligible`, `held`, `digest_pending`, `send_ready`,
  `executing`, `rendered`, `sending`, `delivered`, `delivery_unknown`, `failed_retryable`,
  `failed_terminal`, `dropped`, `expired`, `superseded`, or `dismissed`;
- **reason code** explains why a disposition or transition occurred.

Earlier product words map as follows: “bounded defer” means disposition `hold`; `digest_queued` means
state `digest_pending`; `sent` means `delivered`; and “suppressed” is not an extra state—it is a
`drop` disposition/`dropped` state with a reason such as `master_disabled`, `feature_disabled`, or
`muted`. An implementation may choose different enum spellings only if it publishes one lossless
mapping across policy, storage, metrics, and UI.

### 5.1 `notification_policy`

One row per config context:

| Field | Shape | Notes |
| --- | --- | --- |
| `config_context_id` | string PK | Effective `group` scope in `ENTITY_SCOPES`; DM contexts remain personal. |
| `assistant_enabled` | boolean | Default `false`. |
| `assistant_delivery_mode` | enum | `immediate` / `digest` / `muted`; recommended enabled default `digest`. |
| `timezone` | IANA string or reference | Prefer the canonical existing `timezone` value rather than a second copy. |
| `quiet_hours_enabled` | boolean | Explicit; avoids sentinel-time ambiguity. |
| `quiet_start_local` | `HH:MM` | Required when enabled. |
| `quiet_end_local` | `HH:MM` | Required when enabled. |
| `working_days` | validated weekday set | Initial assumption `[1,2,3,4,5]`. |
| `digest_at_local` | `HH:MM` | Required in digest mode. |
| `allow_urgent_quiet_bypass` | boolean | Default `false`; only allowlisted scenario classes can use it. |
| `version` | integer | Optimistic concurrency for settings edits and queued-candidate policy snapshots. |
| `updated_at` | UTC timestamp | Operational metadata only. |

Do not put this compound structure into an opaque JSON text field in `user_config`. The settings API
needs field-level validation, migrations, queryable defaults, and transactional candidate updates.

### 5.2 `notification_feature_preference`

| Field | Shape | Notes |
| --- | --- | --- |
| `config_context_id` | string | FK/logical owner. |
| `scenario_family` | stable string | Example `task_health.daily_digest`. |
| `enabled` | boolean | Default false for newly discovered families. |
| `delivery_mode_override` | nullable enum | Avoid in MVP unless a validated need exists. |
| `urgent_bypass_allowed` | boolean | Default false and constrained by scenario capability. |
| `updated_at` | UTC timestamp | No free-form content. |

Primary key: `(config_context_id, scenario_family)`.

### 5.3 `proactive_candidate` / outbox

Controls require a durable candidate, not just a direct call to `sendMessage`:

| Field group | Required content |
| --- | --- |
| Identity | candidate UUID; stable idempotency key; scenario ID/version; candidate origin; policy class |
| Scope | config-context ID; exact storage-context ID; native delivery context/thread; platform instance; context type; audience; actor/owner identity where applicable |
| Subject | typed subject kind and provider ID; state fingerprint; never a free-form title as identity |
| Decision inputs | created/detected time; expiry; urgency band; confidence band; digestability; workday policy; effect policy |
| Content | minimized structured facts or an encrypted/private render payload; final rendered markdown stored only when needed for retry |
| State | Canonical lifecycle state above; disposition and reason code are stored separately. |
| Scheduling | `next_eligible_at`, attempt count, lease/lock, last decision reason |
| Outcome | sent time, platform receipt/message ID, delivery error class, policy version used |

Unique idempotency should include at least
`(scenario_id, config_context_id, storage_context_id, subject_key, state_fingerprint, time_bucket)`.
The exact time bucket is scenario-specific: a state transition should key on the transition/version,
while a daily summary keys on local date.

### 5.4 `notification_suppression`

Represent dismiss/snooze without mutating the underlying task:

| Field | Purpose |
| --- | --- |
| `candidate_id` | Exact message/action identity. |
| `scope` | `candidate`, later optionally `subject` or `scenario_family`. |
| `action` | `snooze` / `dismiss`. |
| `until` | Required for snooze or time-bounded subject suppression. |
| `actor_id` | The authenticated user who acted. |
| `context_id` | Prevent cross-context action-token replay. |
| `created_at` | Audit and expiry. |

### 5.5 Delivery ledger

Keep an append-only outcome or attempt ledger separate from current conversation history. The existing
announcement implementation already records per-recipient `sent`/`failed` outcomes and avoids
re-sending a successful `(version, recipient)` pair (`src/announcements/broadcast.ts:103-133`). The
generic proactive path should adopt the same invariant with candidate IDs.

Conversation history is a consumer of a confirmed `sent` outcome, not the source of truth for
delivery or deduplication.

### 5.6 Scope registry additions

Any new context-owned tables MUST be declared in `ENTITY_SCOPES` and covered by its consistency test.
Recommended effective scopes:

| Entity | Effective scope |
| --- | --- |
| `notification_policy` | `group` (DM config context naturally remains personal) |
| `notification_feature_preference` | `group` |
| `proactive_candidate.config_context_id` | `group` |
| `proactive_candidate.storage_context_id` | `thread` |
| recipient/mention override, if later added | `user` within an explicit config-context composite; do not force it through a single-key registry abstraction without documenting the composite |

The candidate carries both group and thread keys because no single effective scope describes both its
policy owner and its delivery destination.

## 6. Settings-UI surface sketch

Add a top-level **Notifications** section to the Svelte settings SPA. It should not be hidden under
generic “Preferences” because the master state and scope need to be obvious.

### 6.1 Summary header

- Scope badge: “Personal chat”, “Group · applies to all threads” only on thread-normalizing
  platforms, or “Discord channel/thread · separate settings” on current Discord.
- Master state: “Suggestions & briefings are Off / On”.
- Next planned delivery in local time, or “Nothing queued”.
- A short policy-class note: “Reminders you asked for, coding-session updates, and release notes have
  separate controls.”

### 6.2 Schedule card

- existing timezone selector, with IANA search and current UTC offset shown only as a hint;
- quiet-hours toggle plus start/end time inputs;
- weekday multi-select;
- delivery style (`Daily digest` recommended, `Immediate`, `Muted`);
- digest time, shown only for digest mode;
- a preview sentence generated deterministically, for example:
  “On Mon-Fri, hold non-urgent suggestions from 22:00 to 07:00 and send one digest at 16:30
  Asia/Yekaterinburg.”

The preview should include the next DST offset change when one is near, but the stored rule remains
local-time/IANA based.

### 6.3 Feature card

Each feature row shows:

- plain-language name and value proposition;
- expected maximum cadence;
- data sources (“task tracker”, later “calendar”);
- audience (“this personal chat” initially);
- toggle, default off;
- a “Why might I receive this?” explanation.

Avoid a single “Enable all” action. New features must not silently inherit an old blanket opt-in.

### 6.4 Held and snoozed items

Show only safe labels and local times. Do not expose task/calendar content to a settings principal that
does not already have context access. Actions are cancel snooze, dismiss candidate, or open the
relevant feature setting.

### 6.5 Reset

“Reset suggestions & briefings” opens a confirmation summary. It does not reset timezone by default
because timezone is used beyond notifications, and it does not cancel explicit reminders. Offer those
as separately named actions if product research later proves they are needed.

## 7. Settings API contract

A purpose-built API is preferable to extending the generic field editor:

- `GET /settings/api/notifications` — effective policy, available scenario families, safe queue
  summary, defaults, validation/version metadata;
- `PATCH /settings/api/notifications` — strict discriminated partial updates with optimistic version;
- `POST /settings/api/notifications/reset` — explicit reset scope and expected version;
- `GET /settings/api/notifications/snoozes` — scoped, safe list;
- `DELETE /settings/api/notifications/snoozes/:id` — cancel one snooze.

All writes use the existing settings session, synchronizer-token CSRF protection, and `requireScope`
authorization described in `docs/architecture/overview.md:56-57`. Group writes require group-admin
scope; DM writes require the DM owner. Zod schemas should reject unknown fields.

Validation requirements:

- timezone must normalize to an IANA zone;
- local times use strict `HH:MM` 24-hour format;
- weekday set is non-empty for workday-only features;
- digest time is required in digest mode;
- urgent bypass cannot be enabled globally without at least one allowlisted urgent feature;
- policy update returns the recomputed next allowed/digest timestamp for user verification;
- stale `version` returns a conflict rather than silently overwriting a concurrent edit.

## 8. Delivery-time algorithms

### 8.1 Quiet-hours membership

For local time `t`, start `s`, and end `e`:

```text
if s < e: quiet = s <= t < e
if s > e: quiet = t >= s or t < e
```

`s == e` is invalid while quiet hours are enabled. Determine the next end boundary as a local
date/time in the policy's IANA zone, then resolve it through timezone rules. On an ambiguous fold,
choose the later instant for silence; on a nonexistent local time, choose the first valid instant after
the gap. This biases toward not disturbing the user.

### 8.2 Next eligible workday

Starting from the candidate's local date:

1. find the first configured working day not earlier than “now”;
2. choose the scenario's allowed time (digest time for digest candidates; quiet-hours end for held
   immediate candidates);
3. resolve in the IANA timezone;
4. repeat if that instant is still in quiet hours;
5. cap search and fail closed on invalid policy;
6. at wake-up, re-evaluate expiry, feature state, subject state, and dedup.

### 8.3 Policy edit

On timezone, quiet-hours, workdays, digest-time, mode, or feature changes:

- increment policy version;
- select unsent candidates for that config context;
- re-evaluate deterministic gates and `next_eligible_at` in one transaction or a resumable job;
- never render or send inside the settings request;
- prevent a burst by applying the current interruption budget when previously held candidates become
  eligible together.

## 9. Platform behavior and graceful degradation

The detailed matrix is in `05-scope-and-delivery.md`; controls impose these minimum rules:

- A platform that cannot deliver a target MUST return a truthful failure, not `void` after silently
  doing nothing.
- Message-specific actions appear only when the platform can bind callbacks to the sent message.
- On platforms without buttons, show short reply instructions, but never claim a snooze succeeded
  until an authenticated reply is correlated to the candidate.
- Group auto-notifications stay disabled where mention/audience semantics cannot be honored.
- Digest rendering must respect `ChatProviderTraits.maxMessageLength`; a delivery adapter either
  chunks safely or the gateway produces a bounded summary.

Kontur Talk currently logs and returns from proactive DM delivery without a failure result
(`src/chat/kontur-talk/index.ts:226-240`), while the router treats any non-`false` result as success
(`src/chat/router.ts:187-195`). That contract must be corrected before any DM-only proactive feature
is advertised as supported on Kontur Talk.

## 10. Observability and privacy

Useful metrics are aggregate event counts by:

- scenario family, candidate origin, and policy class;
- decision reason;
- delivery mode;
- urgency band;
- platform type;
- sent/failed/snoozed/dismissed/expired outcome;
- local-hour and workday/non-workday band;
- interruption-budget utilization.

Do not include task titles, task descriptions, candidate markdown, calendar event names, usernames,
raw context IDs, or raw provider URLs. `/stats/*` may return only anonymous aggregate-shaped data; any
content leak is release-blocking (`docs/architecture/overview.md:59-66`). High-cardinality identifiers
must be keyed-hashed. This is not fully true of current code: `getSubjectStats()` returns raw
`storageContextId`/`chatUserId`, its public response type permits `displayName`, and a server test
asserts the raw storage ID (`src/stats/index.ts:86-97`, `src/stats/types.ts:119-124`,
`tests/debug/server-stats.test.ts:111-128`). That existing release blocker must be repaired before
candidate metrics are added. Logs likewise use opaque IDs/reason codes and never tokens or message
content.

Product success should be measured by value and restraint together:

- action or substantive reply within a scenario-specific window;
- snooze/dismiss/mute rates;
- repeat engagement after several weeks;
- candidates suppressed by dedup/budget;
- false-urgency reports;
- delivery lateness and expiry;
- task outcome change where causal interpretation is explicitly limited.

A low send count can be healthy if the gateway drops low-value candidates. “Messages delivered” is
not a standalone success metric.

## 11. Recommended control slice for the first increment

For one opt-in, DM-only daily task-health digest:

1. Add the Notifications settings section and config-context policy.
2. Offer one feature toggle: `task_health.daily_digest`, default off.
3. Require timezone, working days, quiet hours, and digest time.
4. Use a durable candidate/outbox with structured dedup and confirmed-send history.
5. Require an explicit provider-backed project/assignee scope. Normalize due-day in the policy
   timezone, exclude only provider-declared final/cancelled states, and include “in progress” only
   when a provider-neutral mapping is proved. Never infer “my tasks” from display-name equality; omit
   unsupported categories or disable the feature for that provider/scope.
6. Fetch/render only those bounded read-only normalized facts; do not expose mutating, destructive,
   MCP, plugin, or web tools.
7. Apply master/feature/quiet/workday/dedup policy before task fetch or model use and again before send.
8. Support settings-page cancellation of held items; defer rich snooze/dismiss buttons until delivery
   receipts exist.
9. Cap the digest and record aggregate decision/outcome metrics.

Not required for this first slice:

- per-feature cadence overrides;
- group delivery or per-member group preferences;
- quiet-hours urgent bypass;
- natural-language notification configuration;
- cross-platform preference synchronization;
- calendar controls;
- global “mute transactional work updates” behavior;
- LLM-ranked personal interruption timing.

This slice is deliberately smaller than all Phase 10 stories, but it establishes the policy and state
machinery those stories need without shipping a firehose first.

## 12. Acceptance and edge-case matrix for a later implementation plan

| Case | Expected result |
| --- | --- |
| Existing context after migration | Assistant master and all new feature toggles are off; no candidate is generated. |
| User enables digest with no valid timezone | Save is rejected with a field error. |
| Quiet interval `22:00-07:00`, candidate at 23:00 | Candidate is held without LLM/tool execution; next eligibility is 07:00 local, then freshness is rechecked. |
| Quiet interval across spring-forward gap | Next eligibility resolves to the first valid instant at/after the configured local end. |
| Ambiguous fall-back quiet end | Silence lasts until the later matching instant. |
| Candidate on a non-working Friday for a Tue-Sat schedule | Friday is eligible; Sunday/Monday workday-only candidates move to Tuesday. |
| Digest time falls inside quiet hours | Move to the first allowed time, do not bypass. |
| Feature disabled with held candidates | Candidates become `dropped` with reason `feature_disabled`; re-enable does not requeue or burst stale items. |
| Master muted while a candidate is rendering | Last-mile policy check prevents send; no new effects are allowed after the changed policy version is observed. |
| Same task/state detected by repeated poll | Unique idempotency key yields one candidate. |
| Delivery fails transiently | Retry the persisted rendered candidate; do not rerun task mutations or LLM tools. |
| Delivery succeeds but process crashes before acknowledgement | Idempotent delivery/receipt reconciliation prevents a second successful send where the platform permits; at minimum the attempt ledger exposes uncertainty. |
| Timezone changes with queued candidates | Recompute local schedule; do not reinterpret already sent outcomes. |
| Timezone changes with an explicit existing recurring reminder | Notification policy changes immediately; reminder rebasing follows its separately disclosed product rule, not an accidental side effect. |
| Group admin opens settings from one thread | On Telegram/Mattermost/Kontur, UI states that policy applies to sibling threads while targets remain exact; on Discord it states that the current channel/thread has separate settings. |
| Removed group member owns an old automatic registration | Execution-time authorization suppresses it. |
| Kontur Talk DM candidate | Unsupported/failure is explicit until real proactive DM delivery exists. |
| Reset suggestions policy | Master/features return to off and pending assistant candidates become `dropped` with a reset/disabled reason; explicit reminders and release subscription remain unchanged. |
| Stats query | Only aggregate enum/count/time-band data is returned; no free-form content or raw identifiers. |

## 13. Open product decisions

These do not block the research recommendation, but a later implementation plan must settle them:

1. Should explicit user-requested reminders obey quiet hours by default, or preserve exact-time delivery
   unless the user opts in? This report recommends preserving the promise initially and labeling the
   distinction.
2. Is an “urgent during quiet hours” bypass valuable enough to ship, and which objective scenario
   classes qualify? The safe first increment omits it.
3. Should a timezone edit rebase existing recurring reminders? Current code does not; changing this
   can surprise users in either direction and needs its own migration semantics.
4. What is the initial digest cap and interruption budget? Values should be explicit rollout
   assumptions and tuned from opt-in telemetry, not presented as scientific constants.
5. When group delivery arrives, can a member opt out of being mentioned while the group message still
   posts, and how is that distinction explained?
6. How long are candidate render payloads and action records retained? The answer must account for
   task/calendar sensitivity, debugging needs, and deletion requests.

## 14. Traceability

| Requirement source | Where addressed |
| --- | --- |
| Phase 10 US1 timezone | Sections 1.2, 4.3-4.4, 8, 12; includes the existing-reminder rebasing gap. |
| Phase 10 US2 quiet hours | Sections 4.3, 8.1, 12. |
| Phase 10 US3 working days | Sections 4.4, 8.2, 12. |
| Phase 10 US4 delivery modes | Sections 2, 4.5, 5, 11. |
| Phase 10 US5 per-feature toggles | Sections 4.2, 5.2, 6.3. |
| Phase 10 US6 snooze/dismiss/reschedule | Sections 4.6, 5.4, 6.4. |
| Phase 10 US7 review/reset | Sections 4.7, 6.1, 6.5, 7. |
| Scope-model hard constraint | Sections 1.1, 3, 5.6. |
| Settings-only hard constraint | Sections 1.2, 4.7, 6-7. |
| Default-off, user-controlled, dedup-aware bias | Executive conclusion; Sections 4-5 and 11. |
| `tool_prefs`/guest gating and no proactive run-control | Sections 1.1, 1.3, 2.2, 11; threat implications are expanded in `06-safety-and-trust.md`. |
