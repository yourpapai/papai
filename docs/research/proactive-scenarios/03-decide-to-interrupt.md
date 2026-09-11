<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Decide-to-interrupt model

> **Workstream:** WS-C — relevance, urgency, and interruption budgeting
> **Status:** Proposed decision model; not an implementation commitment
> **As of:** 2026-07-19
> **Inputs:** `01-scenario-catalogue.md`, `02-trigger-feasibility.md`, the current repository,
> and the prior-art dossier prepared for WS-C/WS-G

## 1. Decision and boundaries

papai should not let each trigger send directly. A trigger should create a durable, structured
**candidate**. A deterministic policy then chooses exactly one current disposition:

| Disposition | Meaning | Terminal? |
| --- | --- | --- |
| **send-now** | Claim, revalidate, render, and attempt delivery now. | No; terminal only after confirmed delivery or an explicit terminal failure policy. |
| **digest** | Admit the candidate to one named, recipient-controlled digest window. | No; revalidate at digest composition and immediately before send. |
| **hold** | Do not deliver yet because a bounded condition must clear: quiet hours, non-working day, active conversation, `notBefore`, depleted budget, or transient route failure. Set `nextEvaluationAt` and `expiresAt`. | No. A hold without both timestamps is invalid. |
| **drop** | Suppress permanently for this candidate/state/audience and retain an auditable reason. | Yes. A materially newer state may create a new candidate. |

The order is **hard eligibility gates → deterministic urgency class → score/rules → budget and
window policy → disposition**. An LLM may help extract bounded evidence or write copy, but it must not
override authorization, audience, privacy, feature controls, novelty, expiry, quiet hours, or an
interruption budget.

This is deliberately a four-way model rather than “notify/don't notify.” The strongest transferable
research direction is that delivery itself can impose attention cost even without interaction
([Stothart et al., randomized laboratory study](https://www.enfokt.co/_files/ugd/964c27_34556868a8794542af7c6403f7089ced.pdf));
the limitation is a short sustained-attention task with a young sample, not work chat. Predictable
batching improved several attention and perceived-control outcomes in one two-week smartphone field
experiment, while total blocking also produced anxiety for some participants
([Fitz et al.](https://static1.squarespace.com/static/57a40c19414fb54f51f8095f/t/614a55faa7b89e25f4e48ad1/1632261627146/2019%2Bfitz%2Bbatching.pdf));
the experiment was in one country, bundled all smartphone notifications, and does not validate a
batch frequency for papai. These findings support conservative batching and explicit controls, not
the numeric policy constants proposed below.

### 1.1 Non-negotiable separations

1. **Detection is not delivery permission.** A true `overdue` predicate is evidence about a task,
   not evidence that this recipient should be interrupted.
2. **Importance is not urgency.** Importance is consequence magnitude; urgency is how quickly useful
   action value decays.
3. **Execution mode is not delivery priority.** `lightweight`/`context`/`full` controls model, data,
   and tool cost. A `full` briefing can be digest-safe; a fixed direct service notice can be urgent.
4. **Delivery policy is not effect permission.** A send-now candidate does not gain permission to
   mutate tasks. Tool preferences and effect confirmation remain separate.
5. **Conversation history is not an outbox.** Model messages help future turns, but do not carry a
   candidate identity, delivery acknowledgement, suppression reason, or retry lease.
6. **Holding is not escalation.** Approaching expiry does not automatically make a candidate urgent.
   Only a scenario rule and user-authorized urgent class can do that.

Apple's platform model is useful conceptual prior art because relevance ordering and interruption
level are separate developer inputs, while the user controls Focus and summaries
([Apple relevance score](https://developer.apple.com/documentation/usernotifications/unmutablenotificationcontent/relevancescore),
[Apple time-sensitive level](https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive),
[Apple Focus](https://support.apple.com/en-lamr/guide/iphone/-iph5c3f5b77b/ios)). This is current product
behavior, not evidence that papai can classify urgency correctly; in particular it does not authorize
an LLM-selected quiet-hours bypass.

## 2. Current papai primitives and exact gaps

| Concern | Current primitive | What it establishes | Exact gap for this model |
| --- | --- | --- | --- |
| Scheduled source | `ScheduledPrompt`, `getScheduledPromptsDue`, `pollScheduledOnce`, and `startPollers` in `src/deferred-prompts/types.ts`, `scheduled.ts`, and `poller.ts` | One-shot/RRULE prompts are selected every 60 seconds; compatible due prompts are grouped and run with bounded LLM concurrency. | Due rows flow directly to execution. There is no candidate gate, quiet-hours evaluation, digest admission, recipient budget, expiry, or durable claim across processes. `inFlightPrompts` is process-local. |
| Alert source | `getEligibleAlertPrompts` in `src/deferred-prompts/alerts.ts`; `pollAlertsOnce`, `executeAlertsForUser`, and `executeSingleAlert` in `src/deferred-prompts/poller.ts` | Active alerts are selected when `lastTriggeredAt + cooldownMinutes <= now`, evaluated against current tasks/snapshots every five minutes, then executed and sent. | Cooldown is per alert definition, defaults to 60 minutes (`src/db/deferred-schema.ts`), and is updated only after delivery. It is neither per-recipient fatigue accounting nor semantic state dedup. Persistent level predicates can re-fire indefinitely. |
| State snapshots | `SNAPSHOT_FIELDS`, `getSnapshotsForUser`, and `updateSnapshots` in `src/deferred-prompts/snapshots.ts`; `shouldAdvanceAlertSnapshots` in `poller.ts` | Thread-scoped prior values support narrow `changed_to` edges and are retained after a matched delivery failure. | No stable event/candidate ID, task lifecycle stage, expiry, tombstone, or provider/config-scoped observation. Sibling threads can observe the same tracker independently. |
| Execution modes | `EXECUTION_MODES`, `ExecutionMetadata`, and `dispatchExecution` in `src/deferred-prompts/types.ts` and `proactive-llm.ts` | Current code selects `lightweight`, `context`, or `full`; full mode builds a toolset with contextual preferences via `buildFullToolSet` in `proactive-llm-full.ts`. | Mode does not encode delivery urgency or effect policy. Full proactive runs can last up to 25 steps/20 minutes and are outside normal run-control. No model field should be repurposed as interruption privilege. |
| Prompt framing | `buildProactiveTrigger` in `src/deferred-prompts/proactive-trigger.ts` | Stored prompt text and matched-task summary are placed in a user-role message rather than the trigger's system context. | This is not a complete trust boundary: `buildMetadataMessages` in `proactive-llm-helpers.ts` inserts stored `delivery_brief` and `context_snapshot` as system-role messages, although those values can derive from user conversation. Candidate policy must treat all derived text as untrusted and keep policy inputs structured. |
| Delivery routing | `resolveProactivePlatformInstanceId` and `sendProactiveMessage` in `src/deferred-prompts/proactive-delivery.ts`; `resolveDeliveryPlatformInstanceId` in `src/chat/delivery-routing.ts` | The stored target is routed to an active platform instance, with scoped-context fallback. | The result contract is only `boolean`/`void`; `sendProactiveMessage` treats anything except `false` as success. It has no provider message ID, idempotency key, ambiguous-send state, or universal control gate. `02-trigger-feasibility.md` documents that a Kontur Talk DM no-op can consequently appear successful. |
| Proactive history | `recordProactiveInHistory` in `src/proactive-history.ts`; `conversationHistory` in `src/db/schema.ts` | Several direct paths append assistant text after a reported successful send, scoped to the exact conversation. | History is a JSON message sequence keyed by storage context, with no candidate/state/audience key, delivery status, acknowledgement, reason code, or queryable exposure record. It cannot support deterministic dedup by itself. |
| Deferred LLM persistence | `persistLightweightResponse`, `persistContextResponse`, and `persistProactiveResults` in `src/deferred-prompts/proactive-llm-helpers.ts`; callers in `proactive-llm.ts` | Generated SDK messages, tool traces, facts, and memory work are persisted for later context. | These helpers run **before** `executeScheduledPromptsForGroup`/`executeSingleAlert` calls `sendProactiveMessage`. A failed send can leave an unseen assistant turn in history; retry can regenerate, repeat tool effects, and append another turn. This conflicts with using conversation history as delivered truth. |
| Reactive turn state | `runRegistry` in `src/run-control/registry.ts`; `handleMessage` in `src/bot.ts`; `recordAssistantTurn` in `src/llm-history.ts` | One normal run per storage context is discoverable in memory; new user messages steer that run. Normal turns retain structured AI SDK tool messages while being processed. | Proactive sources do not consult active runs. `processMessage` publishes no durable structured “this subject/state was shown or resolved” exposure, and proactive runs are not in `runRegistry`. A text scan of history would be ambiguous and privacy-sensitive. |
| Scope registry | `ENTITY_SCOPES` in `src/chat/context-scope.ts` | Conversation history, prompt delivery, and snapshots are thread-scoped; prompt creator/config rows are group-scoped; identities are user-scoped. | A decision needs distinct observation, preference, budget, and delivery keys. A single `userId` or task-instance key is insufficient, especially for group/thread candidates. |
| External notify | `NotifyBodySchema`, `buildNotifyTarget`, `sendNotify`, and `handleNotifyRoute` in `src/debug/notify-route.ts` | Bearer-authenticated trusted services can post final markdown into a target and record it after send. | The payload has no source event ID, feature, urgency, expiry, dedup key, sensitivity, or candidate controls. This route is a final-message trust plane, not a native decision ingress. |
| Announcement precedent | `broadcastAnnouncement` and its `isDelivered`/`recordDelivery` dependency in `src/announcements/broadcast.ts` | Release delivery is opt-in, admin-reviewed, bounded to five concurrent sends, and idempotent per release/recipient. | It is specialized, not a shared candidate ledger. It does demonstrate that delivery idempotency belongs in structured records rather than conversation-text comparison. |
| Scheduling substrate | `scheduler` in `src/scheduler-instance.ts`; `startPollers` in `src/deferred-prompts/poller.ts` | Named periodic tasks, retries, and immediate/non-immediate starts already exist. | There is no outbox re-evaluator or digest-flush task. Scheduler retries alone cannot make an LLM/tool/send sequence idempotent. |

The existing alert cooldown should remain as a source-specific pressure guard during migration, but it
must not be called the interruption budget. It answers “may this alert definition be evaluated again?”
The new budget answers “should this audience receive another visible interruption now, considering all
sources?”

## 3. Typed candidate envelope

The following is a proposal, not a settled storage schema. Fields are intentionally structured so
policy never needs to interpret rendered prose.

```ts
type IsoInstant = string
type CandidateDisposition = 'send-now' | 'digest' | 'hold' | 'drop'
type CandidateState =
  | 'detected'
  | 'eligible'
  | 'held'
  | 'digest_pending'
  | 'send_ready'
  | 'executing'
  | 'rendered'
  | 'sending'
  | 'delivered'
  | 'delivery_unknown'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'dropped'
  | 'expired'
  | 'superseded'
  | 'dismissed'

type CandidateOrigin =
  | 'explicit_schedule'
  | 'task_observation'
  | 'turn_effect'
  | 'calendar_observation'
  | 'trusted_external'
  | 'announcement'
  | 'operational_failure'

type PolicyClass =
  | 'assistant_initiated'
  | 'user_scheduled'
  | 'transactional'
  | 'release_announcement'
  | 'operator_broadcast'

type EffectPolicy =
  | { kind: 'render_only' }
  | { kind: 'read_only'; allowedCapabilities: readonly string[] }
  | { kind: 'propose_mutation'; allowedCapabilities: readonly string[] }
  | { kind: 'preauthorized_effect'; effectId: string; allowedCapabilities: readonly string[] }

type Audience = Readonly<{
  platformInstanceId: string
  storageContextId: string
  configContextId: string
  contextType: 'dm' | 'group'
  nativeContextId: string
  threadId: string | null
  audience: 'personal' | 'shared'
  recipientUserIds: readonly string[]
  mentionUserIds: readonly string[]
  audienceKey: string
}>

type CandidateFactor = 0 | 1 | 2 | 3 | 4

type ProactiveCandidate = Readonly<{
  candidateId: string
  featureId: string                 // stable scenario family, e.g. "TSK-006"
  featureVersion: number            // increments when candidate semantics change
  origin: CandidateOrigin             // how evidence entered papai
  policyClass: PolicyClass            // which consent/control contract governs it
  sourceEventId: string             // provider event, prompt occurrence, turn/effect, or incident id
  sourcePromptId: string | null

  subjectType: 'task' | 'task_set' | 'calendar_event' | 'session' | 'release' | 'incident'
  subjectIds: readonly string[]
  lifecycleKey: string              // groups deadline stages or one long-running conflict
  stateVersion: string              // meaningful normalized state, not arbitrary updatedAt alone
  dedupKey: string

  observationConfigContextId: string
  taskInstanceId: string | null
  observedAt: IsoInstant
  evidence: readonly Readonly<{
    kind: string
    ref: string
    value: string | number | boolean | null
  }>[]
  confidence: number                // 0..1, calibrated per feature if possible
  confidenceReason: string

  audience: Audience
  sensitivity: 'public' | 'context' | 'private' | 'restricted'
  permittedSurfaces: readonly ('dm' | 'group')[]
  actorCanAct: boolean

  notBefore: IsoInstant
  nextEvaluationAt: IsoInstant
  expiresAt: IsoInstant
  digestEligible: boolean
  digestKey: string | null
  workdayPolicy: 'ignore' | 'hold_to_next_work_window'
  quietHoursPolicy: 'respect' | 'explicit_user_override'
  urgentClass: 'none' | 'explicit_exact_time' | 'hard_deadline' | 'input_required' | 'safety_or_integrity'

  factors: Readonly<{
    urgency: CandidateFactor
    relevance: CandidateFactor
    confidence: CandidateFactor
    actionability: CandidateFactor
    novelty: CandidateFactor
    interruptionCost: CandidateFactor
    residualPrivacyRisk: CandidateFactor
    fatiguePressure: CandidateFactor
  }>

  executionMode: 'direct' | 'lightweight' | 'context' | 'full'
  effectPolicy: EffectPolicy
  renderTemplateId: string | null
  payload: Readonly<Record<string, unknown>>

  state: CandidateState
  disposition: CandidateDisposition | null
  primaryReasonCode: DecisionReasonCode | null
  reasonCodes: readonly DecisionReasonCode[]
  decisionPolicyVersion: number
  decisionTrace: Readonly<Record<string, string | number | boolean | null>>
  attemptCount: number
  leaseUntil: IsoInstant | null
  renderedMarkdown: string | null
  deliveredAt: IsoInstant | null
  providerMessageId: string | null
}>
```

`payload` may contain normalized task/event facts, but never credentials, raw provider tokens, or a
model-authored policy override. Sensitive raw evidence should remain in its owning store and be
referenced by an opaque ID where possible.

`origin` and `policyClass` are deliberately separate. An origin describes the detector/trust path;
the policy class selects master, quiet-hour, digest, and budget semantics. A task/calendar observation
normally maps to `assistant_initiated`; an explicit schedule maps to `user_scheduled`; trusted external
work milestones and operational failures normally map to `transactional`; an announcement origin
maps to either `release_announcement` or `operator_broadcast` according to its reviewed/subscription
contract. The mapping is scenario-owned and versioned rather than inferred from prose.

### 3.1 Identity fields have different jobs

- `candidateId` identifies one durable row/attempt lineage.
- `sourceEventId` prevents a detector replay from producing another row.
- `dedupKey` answers whether the same scenario/state/audience was already exposed.
- `lifecycleKey` lets a newer stage supersede an older pending item, such as TSK-011 → TSK-012 →
  TSK-006 → TSK-013 for one task/audience.
- `digestKey` groups only policy-compatible items, such as one recipient, storage context,
  sensitivity class, and digest window. It must never combine private DM facts into a group digest.

## 4. Evidence basis and limits

The proposed rules use prior art as directional evidence only:

| Finding used | Evidence strength | Limitation and resulting constraint |
| --- | --- | --- |
| Interruptions during task execution were more costly than interruptions at boundaries in controlled desktop tasks. [Bailey & Konstan](https://www.sciencedirect.com/science/article/pii/S074756320500107X) studied 50 participants; [Adamczyk & Bailey](https://interruptions.net/literature/Adamczyk-CHI04-p271-adamczyk.pdf) studied 16. | Moderate causal evidence for coarse timing. | Artificial tasks, small/older samples, and no chat context. Use quiet hours, digest windows, and active-turn holds as coarse proxies; do not build invasive “perfect moment” sensing. |
| Bounded deferral reduced frustration in a small desktop study, with average deferral under 90 seconds. [Iqbal & Bailey](https://interruptions.net/literature/Iqbal-CHI08.pdf) | Moderate, directionally consistent with boundary work. | Six-person model development and 16-person evaluation in two domains; modest breakpoint precision. Every hold needs a bound and expiry, but no duration transfers directly. |
| Recent notification load affected rated interruption quality in an in-the-wild prompting prototype. [Pejovic & Musolesi](https://www.mircomusolesi.org/papers/ubicomp14.pdf) | Weak-to-moderate field evidence for including recent load. | Tiny samples and survey prompts; response-time effects were not conventionally significant. Instrument a budget and use conservative product hypotheses; do not claim an optimal quota. |
| Recipient, usefulness, urgency, content, and task phase contributed separately to receptivity. [Mehrotra et al.](https://discovery.ucl.ac.uk/id/eprint/1502364/) | Useful observational evidence for separate factors. | Analysis centered on 20 high-response users, inferred viewing, and self-report. Do not turn clicks or a single score into ground truth. |
| High-precision learned suppression rules were accepted when users could inspect and approve them. [PrefMiner](https://www.mircomusolesi.org/papers/ubicomp16.pdf) | Weak-to-moderate prototype evidence for transparent personalization. | Sixteen analyzed users over 15 days; acceptance is not long-term benefit. Learned suppression belongs after deterministic rules and explicit feedback. |
| Role-specific alerting appears preferable to undifferentiated alerts. [Hussain et al. systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6748819/) | Broad review evidence within clinical decision support. | Clinical alerts differ materially, and heterogeneous measures prevented meta-analysis. Treat audience specificity as a safety rule, not a transferable effect size. |
| Canonical inbox plus conditional external delivery exists in Notion, Asana, and Linear. [Notion](https://www.notion.com/help/notification-settings), [Asana](https://help.asana.com/s/article/inbox), [Linear](https://linear.app/docs/inbox) | Strong product precedent, no causal outcome evidence. | Current documentation may change and product event models are more explicit than papai's inference. Use it as an architecture pattern, not proof of benefit. |
| Schedules, quiet modes, categories, grouping, and narrow bypass paths are exposed by Slack, Teams, and Android. [Slack](https://slack.com/help/articles/214908388-Pause-your-Slack-notifications), [Teams](https://support.microsoft.com/en-US/teams/platform/quiet-time-in-microsoft-teams-for-mobile-devices), [Android channels](https://developer.android.com/develop/ui/compose/notifications/channels) | Strong evidence of current user-control patterns, no effectiveness claim. | OS/product semantics vary. papai still needs its own cross-platform policy because chat adapters cannot guarantee device-level behavior. |

No reviewed source validates LLM-generated relevance/urgency for autonomous task notifications, a
universal daily quota, or the numeric weights in §6. Those are explicit experiment assumptions.

## 5. Hard eligibility gates before scoring

Run gates in a fixed order and record every failed reason, while returning one stable primary reason.
Gates use structured fields and current state; a model cannot waive them.

1. **Schema and source authenticity**
   - Candidate schema and policy version are supported.
   - `sourceEventId` is authentic for its adapter; trusted external ingress is authenticated and
     mapped to a declared origin plus policy class.
   - Failure: `DROP_INVALID_CANDIDATE` or `DROP_UNTRUSTED_SOURCE`.
2. **Source-appropriate consent and master control**
   - `assistant_initiated` scenarios are explicitly enabled at the applicable preference scope and
     the assistant-proactivity master is on.
   - Existing user-authored AUT-001/002 prompts count as `user_scheduled` scenario-level intent and
     follow their own active/pause policy; the assistant master neither disables them nor implies
     consent to unrelated product nudges.
   - Transactional, release, and operator classes use their separately documented initiation,
     subscription, and operator controls.
   - Failure: `DROP_FEATURE_OFF` or `DROP_MASTER_MUTED`.
3. **Scope, membership, and audience authorization**
   - Re-resolve platform instance, storage/config context, current membership, recipient ownership,
     and exact thread.
   - A group candidate needs an explicit group-benefit and group-visibility rule. “Task is visible to
     a tracker user” is not sufficient permission to broadcast it.
   - Guests never acquire a proactive audience or richer tool access merely by appearing in a group.
   - Failure: `DROP_SCOPE_MISMATCH`, `DROP_AUDIENCE_UNAUTHORIZED`, `DROP_GUEST_BOUNDARY`, or
     `DROP_NO_ACTIONABLE_AUDIENCE`.
4. **Sensitivity and surface**
   - Candidate sensitivity is permitted on the selected DM/group surface; private calendar details
     default to DM.
   - Redaction is deterministic. If safe redaction would destroy actionability, drop instead of asking
     a model to improvise.
   - Failure: `DROP_SENSITIVE_SURFACE` or `DROP_REDACTION_NOT_ACTIONABLE`.
5. **Tool/effect authorization**
   - Candidate generation needs no capability denied by `tool_prefs`.
   - The planned effect is allowed by `effectPolicy`; absence of interactive confirmation on a
     proactive run forces `render_only`, `read_only`, or `propose_mutation`.
   - Failure: `DROP_TOOL_POLICY` or `DROP_EFFECT_NOT_AUTHORIZED`.
6. **Current truth and freshness**
   - Revalidate the feature's predicates. Subject still exists, recipient can still act, and task/event
     is not resolved/cancelled.
   - `now < expiresAt`; source state is not older than an already observed version.
   - Failure: `DROP_RESOLVED`, `DROP_EXPIRED`, `DROP_STALE`, or `DROP_SUBJECT_MISSING`.
7. **Confidence floor**
   - Each feature declares a minimum calibrated confidence. Pure semantic inferences require a higher
     floor than exact task transitions or explicit schedules.
   - Failure: `DROP_LOW_CONFIDENCE`.
8. **Deterministic novelty and prior exposure**
   - Check source-event identity, candidate key, lifecycle supersession, delivered proactive exposure,
     and structured reactive exposure as described in §8.
   - Failure: `DROP_DUPLICATE_PROACTIVE`, `DROP_ALREADY_REACTIVE`, `DROP_SUPERSEDED`,
     `DROP_ALREADY_ACKNOWLEDGED`, or `DROP_ALREADY_ACTED`.
9. **Scenario cooldown**
   - Enforce per-feature/subject/audience cooldown after novelty. A new urgent lifecycle stage can have
     an explicit exception; the same level predicate cannot.
   - Failure: `DROP_COOLDOWN` or, if still useful later, `HOLD_COOLDOWN`.
10. **Quiet-hours policy and urgent authorization**
   - For `assistant_initiated` and every other policy class configured to respect quiet hours, only a
     declared urgent class separately enabled by the user may continue to send-now consideration. A
     high score is not an override.
   - A preserved existing `user_scheduled` exact-time occurrence follows its explicit-schedule
     promise and is not reclassified as urgent. If a later automation-specific control opts that
     reminder into quiet hours, choose hold/digest instead, provided it will remain useful.

Authorization, privacy, guest, effect, and feature-control failures are terminal for that candidate.
For policy classes that respect them, quiet hours and workdays are potentially temporary and
therefore generally produce `hold`, subject to expiry. Cooldown, route failure, active conversation,
and budget exhaustion are likewise potentially temporary.

## 6. Rules-first relevance and scoring sketch

### 6.1 Factor definitions

Each feature owns a deterministic factor extractor. Scores are 0–4 ordinal bins, not probabilities.

| Factor | 0 | 2 | 4 |
| --- | --- | --- | --- |
| **Urgency** | No meaningful decay before next normal digest. | Action loses material value within the workday. | Value decays before the next allowed window; grounded in an exact user time, hard deadline, blocked integrity workflow, or explicit input-needed state. |
| **Relevance** | Recipient has no ownership/role. | Recipient is an informed stakeholder. | Recipient is explicit creator/assignee/owner or the only authorized actor. |
| **Confidence** | Unsupported inference. | Mixed/partial evidence above the feature floor. | Exact user-authored schedule or stable structured transition with revalidation. |
| **Actionability** | Awareness only, no safe next step. | One useful next step exists but needs context. | A concrete, low-effort, authorized action can be taken now. |
| **Novelty** | Same subject/state was already shown. | New aggregation or material detail. | First observation of a meaningful transition/lifecycle stage. |
| **Interruption cost** | User-selected window or already-open digest surface. | Ordinary DM during allowed work time. | Group broadcast, quiet hours, active turn, or high-intrusiveness surface. |
| **Residual privacy risk** | DM and unambiguous ownership. | Context-visible information with explicit role. | Broad group visibility, mixed sensitivity, or uncertain audience. A value above the hard scenario maximum should already have failed a gate. |
| **Fatigue pressure** | No recent related delivery and bucket full. | One or two recent deliveries/holds. | Bucket nearly empty, repeated subject/scenario, or recent dismiss/mute signal. |

Static predicates and true deltas differ: after first delivery, a still-true AUT-003/AUT-005 level
predicate receives novelty `0`; an exact newer `changed_to` event can receive novelty `4` if its state
version and lifecycle stage differ.

### 6.2 Provisional score

After hard gates:

```text
benefit = 3*urgency + 2*relevance + 2*confidence + 2*actionability + novelty
cost    = 2*interruptionCost + 3*residualPrivacyRisk + 2*fatiguePressure
score   = benefit - cost
```

**These coefficients and thresholds are not scientifically validated.** They are deliberately simple,
monotonic starting hypotheses chosen to make policy reviewable. They should be versioned, evaluated in
shadow mode, calibrated per scenario, and changed only with measured reasons.

Rules take precedence over score:

1. `send-now` is even eligible only when `urgentClass != 'none'`, value would materially decay before
   the next allowed window, and the class is authorized for this time/surface.
2. Provisional `send-now`: score ≥ 12, the relevant token lane can spend, no active-conversation hold,
   and expiry/revalidation permit immediate work.
3. Provisional `digest`: score ≥ 5, `digestEligible`, and the candidate remains useful at the next
   digest window.
4. `hold`: score ≥ 5 but a temporary constraint applies, or a send-now candidate cannot currently
   spend and remains valuable at `nextEvaluationAt`.
5. `drop`: score < 5, novelty is zero, actionability is zero for a nudge scenario, or no allowed
   future window exists before expiry.

The “score ≥ 12” rule must never turn an ordinary candidate into urgent. Conversely, an urgent-class
candidate with a low score can be digested or dropped; the class creates eligibility, not entitlement.

### 6.3 Why not a model-only ranker

Decision-theoretic alerting provides a useful conceptual frame—compare interruption cost with the cost
of delay ([Horvitz, Jacobs, and Hovel](https://erichorvitz.com/attend.htm))—but it is foundational
prototype work, not validation of this formula or a modern chat outcome. A rules-first implementation
keeps decisions reproducible, allows counterfactual shadow evaluation, and prevents untrusted task or
calendar text from becoming a policy instruction. A later model may supply a bounded semantic fact
such as “description scope probably reduced” plus calibrated confidence, never the final bypass flag.

## 7. Interruption budget and token buckets

### 7.1 Budget keys and accounting

Use separate buckets because a group message consumes bystander attention and cannot reliably observe
each member's device/presence:

- **DM ordinary bucket:** `(canonicalRecipientId, configContextId, platformInstanceId, 'dm')`.
- **Group ordinary bucket:** `(storageContextId, platformInstanceId, 'group')`; thread identity is
  retained where the platform supports it.
- **Reserved-class ledger:** same keys plus urgent/policy class. This is separately capped and audited;
  it is not an invisible infinite bypass.

Count every reported visible delivery, not only clicks or replies. The Stothart study supports this
direction, but only in a laboratory phone-alert setting
([paper](https://www.enfokt.co/_files/ugd/964c27_34556868a8794542af7c6403f7089ced.pdf)). A failed or
definitely unsupported send consumes no token; `delivery_unknown` reserves the attempted cost until
reconciled so retries cannot double-spend or double-send.

### 7.2 Provisional, explicitly unvalidated defaults

| Surface | Capacity/refill | Cost | Behavior at exhaustion |
| --- | --- | --- | --- |
| DM ordinary | Capacity 6 points; refill 1 point per 2 hours **inside allowed work windows**. | Ordinary immediate 2; digest envelope 1 plus 0.1 per included item, capped at 2. | Digest if useful there; otherwise hold to next refill/window; drop low-score items. |
| Group ordinary | Capacity 4 points; refill 1 point per 4 allowed work hours. | Shared immediate 4; group digest 2 plus 0.25 per included item, capped at 4. | Default to digest/hold. Only one ordinary group interruption can consume a full bucket. |
| DM reserved | Capacity 2; refill 1 per 12 elapsed hours. | Authorized urgent/input-required delivery 1. | Hold until refill only if value remains; otherwise apply the feature's explicit escalation/failure policy. Never borrow automatically from future days. |
| Group reserved | Capacity 1; refill 1 per 24 elapsed hours. | Authorized safety/integrity group delivery 1. | No generic task-health scenario uses this lane initially. Operator emergency behavior stays separate. |

These values are conservative product hypotheses, not research results. The three-batches-per-day arm
in Fitz et al. is not evidence for “three papai messages per day,” because it batched all phone
notifications in a different population and setting
([study](https://static1.squarespace.com/static/57a40c19414fb54f51f8095f/t/614a55faa7b89e25f4e48ad1/1632261627146/2019%2Bfitz%2Bbatching.pdf)).
Start by computing both enforced and counterfactual dispositions in shadow mode; enforcement can begin
with tighter per-scenario caps before enabling cross-scenario refill behavior.

### 7.3 Policy-class exemptions and reserved behavior

“Exempt” means bypassing the **ordinary** bucket only. Scope, privacy, the source's own consent/control
contract, expiry, dedup, and source-specific caps still apply. The assistant-proactivity master does
not govern explicit user schedules.

| Source/event subtype | Ordinary-budget treatment | Quiet-hours treatment | Additional cap |
| --- | --- | --- | --- |
| AUT-001 user-authored one-shot at an exact time | Exempt after explicit intent; record cost in the reserved ledger. | Preserve the existing exact-time promise initially; assistant quiet hours do not retroactively delay it. A future automation-specific control can offer “respect quiet hours” or an explicit all-nonreactive pause. | One delivery per occurrence; no regeneration after ambiguous send. |
| AUT-002 recurring user reminder | Keep its stored recurrence contract outside the assistant master; record visible cost and apply source-specific dedup/caps. | Preserve existing recurrence timing until an automation-specific quiet-hours migration is explicitly disclosed; new series may later offer that choice at creation. | Per-series cooldown and stale-series review. |
| AUT-006 coding/service `input_needed` tied to an active user-started session | Reserved `input_required`. Completion/progress messages are ordinary/digest-safe. | Bypass only if the session control explicitly enabled it. | One outstanding input-needed candidate per session state; newer state supersedes. |
| AUT-012 failure of an explicitly requested automation | Reserved reliability notice, because silence can falsely imply success. | Hold to next allowed window unless a preauthorized effect may still be running or integrity is at risk. | One notice per incident/effect ID per six hours; repeated failures update one canonical item. |
| TSK-012 hard due-time reminder | Reserved only when the user marked the deadline hard and enabled urgent delivery. Date-only “due today” is not enough. | May bypass under that explicit class. | One per task/stage; no automatic urgent promotion from TSK-011/006. |
| CAL-003 blocking sync conflict | Reserved safety/integrity lane for the connection owner, normally DM. | May bypass only when further writes are paused and user authorization says conflicts are urgent. | One outstanding conflict version; resolution/supersession closes it. |
| AUT-010 release broadcast | Ordinary/digest-safe despite admin approval. | Respect quiet hours. | Existing per-release/recipient idempotency remains. |
| AUT-011 manual admin emergency | Outside product-scenario bucket only when the operator explicitly selects an emergency class. | Separate operator policy may bypass. | Audit, operator rate limit, and post-incident review; ordinary announcements are not emergency. |

Official Slack documentation shows a visible pause state, schedules, and a narrow sender-driven urgent
path ([pause notifications](https://slack.com/help/articles/214908388-Pause-your-Slack-notifications),
[configure notifications](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications)).
That is product precedent, not causal evidence, and its exact availability can change. The transferable
constraint is that exceptions are scarce, explicit, and visible—not that papai should copy Slack's
quota or let a model declare urgency.

## 8. Deterministic dedup, reactive exposure, and supersession

### 8.1 Keys

Never deduplicate by rendered-text similarity. Copy changes, localization, model variation, or a task
title edit should not create another exposure; conversely, similar prose can describe a different
authorized audience or state.

Canonicalize arrays by stable sorting, timestamps to the feature's declared precision, and provider
IDs to `(taskInstanceId, providerEntityId)`. Then compute:

```text
audienceKey = sha256(
  "aud:v1\0" + platformInstanceId + "\0" + storageContextId + "\0" +
  audience + "\0" + sorted(recipientUserIds) + "\0" + sorted(mentionUserIds)
)

stateVersion = feature-owned canonical value, for example:
  TSK-006: "task:<id>|deadline:<iso/date>|final:false|stage:first-overdue"
  TSK-003: "task:<id>|status:<oldStableId>-><newStableId>|workflowVersion:<v>"
  CAL-003: "sync:<linkId>|calendarRev:<x>|taskRev:<y>|conflict:both-modified"
  AUT-001: "prompt:<promptId>|occurrence:<fireAtIso>"

dedupKey = sha256(
  "pc:v1\0" + featureId + "@" + featureVersion + "\0" + subjectType + "\0" +
  sorted(subjectIds) + "\0" + stateVersion + "\0" + audienceKey
)

lifecycleKey = sha256(
  "life:v1\0" + lifecycleFamily + "\0" + sorted(subjectIds) + "\0" + audienceKey
)
```

A `stateVersion` contains only fields meaningful to the feature. An arbitrary provider `updatedAt`
would make unrelated edits look novel. Where a provider supplies a stable event/revision ID, retain
it as evidence and source id, but still derive feature state for cross-provider semantics.

### 8.2 Structured reactive exposure ledger

Current reactive history preserves AI SDK messages but does not say which scenario/state the user saw.
Add a small durable ledger written from structured turn effects and the final response plan:

```ts
type ReactiveExposure = Readonly<{
  exposureId: string
  turnId: string
  storageContextId: string
  configContextId: string
  audienceKey: string
  featureId: string
  subjectType: ProactiveCandidate['subjectType']
  subjectIds: readonly string[]
  stateVersion: string
  lifecycleKey: string
  effectIds: readonly string[]
  coverage: 'mentioned' | 'action_offered' | 'acknowledged' | 'resolved'
  exposedAt: IsoInstant
}>
```

The normal turn should emit this only when it has structured provenance: a successful task tool effect,
a typed candidate/action included in the final response plan, or an explicit user acknowledgement.
Do not infer it by comparing prose. For TSK-001, a successful `create_task` effect plus a reply that
already asks for missing due date/assignee can record `action_offered`; the later task-created detector
then drops `DROP_ALREADY_REACTIVE`.

At decision and again before send:

1. Exact delivered `dedupKey` → drop duplicate.
2. Same lifecycle with a newer or terminal exposure (`resolved`/`acknowledged`) → drop.
3. Same lifecycle, newer candidate state → mark older pending candidate `superseded` and retain only
   the newest compatible digest item.
4. Same candidate referenced in an active normal turn → hold until the turn records exposure or ends.
5. Unstructured legacy history → do not run semantic similarity. It may be shown to the model for
   conversational coherence, but cannot prove delivery or novelty.

Notion suppressing some secondary delivery when the source is already being viewed, Asana checking
canonical inbox state, and Linear gating secondary surfaces on unread state are useful current product
precedents ([Notion](https://www.notion.com/help/notification-settings),
[Asana email notifications](https://help.asana.com/s/article/email-notifications),
[Linear notifications](https://linear.app/docs/notifications)). They are not controlled evaluations
and their internal algorithms are not fully documented; the transferable principle is one canonical
event with conditional surfaces.

## 9. Freshness, expiry, and revalidation

Every scenario defines three times:

- `observedAt`: when papai obtained the evidence;
- `nextEvaluationAt`: when a held/digest candidate must be checked again;
- `expiresAt`: when this candidate/stage can no longer be delivered.

Revalidate before expensive LLM work, after any long execution, when composing a digest, and
immediately before send. A revalidation reads only the minimal structured fields required by the
feature. If the state changed, either update/supersede the candidate deterministically or drop it;
do not ask the rendering LLM whether old facts “still sound useful.”

Provisional scenario rules, all hypotheses for WS-G/implementation planning:

| Scenario | Freshness/expiry rule |
| --- | --- |
| AUT-001 | Occurrence identity is the exact `fireAt`. Expire after the user-selected grace period; absent one, hold no longer than 24 hours. Never rerun a preauthorized effect merely to regenerate wording. |
| AUT-003/005 | Revalidate predicate and open/final state. A delivered level state has no novelty until its relevant state version changes. |
| TSK-011 | Expires at the due boundary. It never survives into TSK-012/006; those are newer lifecycle stages. |
| TSK-012 | Expires at due-time plus a narrow feature grace; if date-only, it is digest-safe and expires at local day end rather than being labeled urgent. |
| TSK-006 | First-overdue stage remains fresh only while task is open and deadline unchanged. Drop or supersede at next deadline stage, reschedule, completion, dismissal, or one workday after first observation. |
| TSK-008/PLN-004 | Briefing expires when too little of the planned work window remains; regenerate from live task/calendar facts at its chosen window rather than replaying held prose. |
| CAL-001 | Drop on cancellation, start-time passage plus user grace, or when the same event/lead-time was already delivered by papai. Native-calendar duplicate suppression needs an explicit source flag; title similarity is insufficient. |
| CAL-003 | Hold one canonical conflict until resolved; new task/calendar revisions supersede its state. Do not repeat at cooldown while the same conflict remains outstanding. |

Bounded deferral research supports requiring an explicit deadline for queued notifications
([Horvitz, Apacible, and Subramani](https://www.microsoft.com/en-us/research/publication/balancing-awareness-interruption-investigation-notification-deferral-policies/)),
but the evaluation was extremely small and in an older desktop/email environment. It supports the
shape—next check plus expiry—not any duration above.

## 10. Quiet hours, workdays, digests, and active conversations

### 10.1 Deterministic window order

Evaluate local-time controls in this order:

1. Resolve the applicable preference timezone. Existing scheduled prompts retain their stored
   recurrence timezone (`finalizeRecurring` in `src/deferred-prompts/poller-scheduled.ts`), so a later
   implementation must define migration rather than assuming settings changes update old rows.
2. If master mute is active, drop product candidates. Preserve their audit rows but do not queue a
   catch-up flood. Explicit user schedules and operator emergencies need separately documented scope.
3. If non-working day and `workdayPolicy` says hold, compute the next allowed work window.
4. If the candidate's policy class respects quiet hours and the recipient is currently inside them,
   compute quiet-hours end inside an allowed workday. Explicit user-authored schedules retain their
   stored delivery promise unless a separate automation-specific control says otherwise.
5. Compare the next allowed time with `expiresAt`. If the candidate will be stale, drop; do not
   promote it to urgent.
6. If a configured digest occurs before expiry, admit digest-safe candidates to that exact window.
7. Otherwise hold to the earliest allowed reevaluation/refill point.

At window release, sort by authorized urgency, lifecycle stage, score, and observation time; revalidate;
dedup; then enforce maximum digest item/character counts. Overflow stays only if another configured
window occurs before expiry. Never dump all weekend backlog on Monday morning.

Teams' current quiet-time behavior separates suppressed push/sound from activity that remains
available when opened ([Microsoft documentation](https://support.microsoft.com/en-US/teams/platform/quiet-time-in-microsoft-teams-for-mobile-devices)).
This is product behavior, not outcome evidence, but it supports retaining canonical candidate/audit
state while suppressing interruption.

### 10.2 Active conversation handling

Current `runRegistry.get(storageContextId)` can identify a normal in-flight turn in the exact thread.
Use it as an optimization signal, not durable truth, because it is process-local and proactive runs
are not registered.

- **Same storage context has an active normal run:** hold nonurgent candidates until turn completion
  plus a short stabilization point. Do not inject them into the user steering queue. After the turn,
  consult `ReactiveExposure`; drop if covered, otherwise re-evaluate for digest/send.
- **Candidate subject is already part of the active run:** always hold, including an otherwise ordinary
  send-now candidate, unless a separately authorized hard deadline will pass before the run can
  reasonably finish. The normal reply is the lower-interruption surface.
- **Unrelated hard urgent candidate:** it may send now only under its urgent class and reserved budget;
  active conversation raises `interruptionCost` and the reason trace records the override.
- **Active group thread/channel:** default all ordinary group candidates to hold/digest. Group
  bystanders make a second bot message costlier and evidence for group interruptibility is thin.
- **Active proactive execution:** a durable candidate lease prevents another worker from executing the
  same candidate. Because current proactive work is absent from `runRegistry`, the outbox, not the
  run registry, owns this guarantee.

Research on task boundaries supports the direction of deferring to coarse breakpoints, but does not
validate “turn completion” as papai's perfect breakpoint
([Bailey & Konstan](https://www.sciencedirect.com/science/article/pii/S074756320500107X),
[Iqbal & Bailey](https://interruptions.net/literature/Iqbal-CHI08.pdf)). The product should measure
delay and outcomes rather than claim inferred interruptibility.

## 11. Decision reason codes

Reason codes are stable API/analytics values; human text is localized separately. Store one primary
code and all contributing codes.

```ts
type DecisionReasonCode =
  | 'SEND_EXPLICIT_EXACT_TIME'
  | 'SEND_VALUE_DECAYS_BEFORE_WINDOW'
  | 'SEND_INPUT_REQUIRED'
  | 'SEND_SAFETY_OR_INTEGRITY'
  | 'DIGEST_DEFAULT_NONURGENT'
  | 'DIGEST_BUDGET_EXHAUSTED'
  | 'DIGEST_GROUP_POLICY'
  | 'DIGEST_QUIET_HOURS_RELEASE'
  | 'HOLD_NOT_BEFORE'
  | 'HOLD_QUIET_HOURS'
  | 'HOLD_NON_WORKDAY'
  | 'HOLD_ACTIVE_CONVERSATION'
  | 'HOLD_BUDGET_REFILL'
  | 'HOLD_COOLDOWN'
  | 'HOLD_ROUTE_UNAVAILABLE'
  | 'HOLD_TRANSIENT_REVALIDATION_FAILURE'
  | 'DROP_INVALID_CANDIDATE'
  | 'DROP_UNTRUSTED_SOURCE'
  | 'DROP_FEATURE_OFF'
  | 'DROP_MASTER_MUTED'
  | 'DROP_SCOPE_MISMATCH'
  | 'DROP_AUDIENCE_UNAUTHORIZED'
  | 'DROP_GUEST_BOUNDARY'
  | 'DROP_NO_ACTIONABLE_AUDIENCE'
  | 'DROP_SENSITIVE_SURFACE'
  | 'DROP_REDACTION_NOT_ACTIONABLE'
  | 'DROP_TOOL_POLICY'
  | 'DROP_EFFECT_NOT_AUTHORIZED'
  | 'DROP_RESOLVED'
  | 'DROP_EXPIRED'
  | 'DROP_STALE'
  | 'DROP_SUBJECT_MISSING'
  | 'DROP_LOW_CONFIDENCE'
  | 'DROP_DUPLICATE_SOURCE_EVENT'
  | 'DROP_DUPLICATE_PROACTIVE'
  | 'DROP_ALREADY_REACTIVE'
  | 'DROP_ALREADY_ACKNOWLEDGED'
  | 'DROP_ALREADY_ACTED'
  | 'DROP_SUPERSEDED'
  | 'DROP_COOLDOWN'
  | 'DROP_SCORE_BELOW_THRESHOLD'
  | 'DROP_NOT_ACTIONABLE'
  | 'DROP_NO_VALID_FUTURE_WINDOW'
  | 'DROP_DIGEST_OVERFLOW_EXPIRED'
  | 'DROP_DELIVERY_FAILED_TERMINAL'
  | 'DELIVERY_CONFIRMED'
  | 'DELIVERY_UNKNOWN'
```

Do not log candidate prose, secrets, raw calendar bodies, or credentials in decision traces. Log IDs,
feature/version, scope hashes, factor bins, reason codes, timings, and capability names.

## 12. State machine and architecture placement

```text
detector / explicit schedule / candidate ingress
                    |
                    v
               [detected outbox]
                    |
          gates + dedup + revalidation
          /         |          \
         v          v           v
     [dropped]   [held]    [digest_pending]
                    \          /
                     \ reevaluate / flush
                      v      v
                     [send_ready]
                          |
                  claim durable lease
                          v
                     [executing]
                          |
              render/read/propose under effectPolicy
                          v
                      [rendered]
                          |
                  final revalidation + budget spend
                          v
                      [sending]
                    /       |       \
                   v        v        v
            [delivered] [delivery_unknown] [failed_retryable]
                   |                     \        /
                   v                      reconcile
      exposure ledger + conversation history
```

### 12.1 Placement

- Add a core proactive-candidate/outbox service adjacent to `src/deferred-prompts/`, not inside a chat
  adapter and not in conversation history.
- A content-free registration/subscription lookup runs before an assistant-owned observer fetches task
  or calendar data. Disabled/unregistered scopes perform no provider read and create no content-bearing
  candidate; an optional minimal audit tombstone may record only policy/version/reason metadata.
- Existing scheduled/alert pollers become **detectors** that insert/upsert candidates only for an
  active source-specific registration. They stop calling `dispatchExecution` and
  `sendProactiveMessage` directly for product-controlled paths.
- A named scheduler job on the existing `scheduler` re-evaluates held rows and flushes due digest
  windows. Claim rows with a database lease/compare-and-set so multiple processes cannot execute one
  candidate concurrently.
- A decision service resolves preferences, scope, audience, exposure, budget, freshness, and reason
  codes. It is deterministic for a policy version.
- An execution service invokes direct templates or current L/C/F machinery under `effectPolicy`.
- A delivery service requires a richer receipt than current `boolean | void`: at least `confirmed`,
  `failed`, or `unknown`, with platform message ID when available.
- Only confirmed delivery writes the delivery exposure and the user-visible assistant history entry.
  Generated tool traces/facts may need their own execution audit, but must not masquerade as delivered
  conversation.

### 12.2 Retry and side-effect invariant

Persist rendered markdown and completed effect IDs before send. On a definite delivery failure, retry
the **same rendered payload**; do not rerun the LLM or repeat effects. On an ambiguous send, enter
`delivery_unknown`; reconcile by provider message ID/idempotency support or stop for bounded/manual
handling. This directly closes the current pre-send history persistence and regeneration gap.

Announcement delivery records are a narrow internal precedent: `broadcastAnnouncement` checks
`isDelivered(version, contextId)` and records each recipient outcome before later attempts. The shared
outbox generalizes that pattern to `(scenario,state,audience)` and adds hold/digest/expiry.

## 13. LLM, execution, and effect policy

### 13.1 Allowed LLM roles

An LLM may:

- extract a scenario-bounded semantic label with confidence from untrusted data;
- summarize already admitted digest items while preserving each item ID and action;
- render conversational copy from a structured, redacted payload;
- propose a normal-turn action the user can confirm.

An LLM may not:

- select or alter audience/scope;
- authorize sensitivity or guest exposure;
- enable a feature, urgent class, or quiet-hours bypass;
- fabricate a dedup/state version;
- change expiry or budget cost;
- drop provenance from a digest;
- gain task mutation permission because delivery is urgent.

### 13.2 Default effect policy

Product-owned inferred candidates default to `read_only` or `propose_mutation`. The message can say
“I can reschedule this” or offer buttons/a normal reply, but the write occurs in a subsequent normal
turn with ordinary confirmation and run-control. This matters because current full proactive prompts
run with `askPermissionAvailable: false` in `buildFullSystemPrompt` and cannot be steered/stopped via
`runRegistry`; see `buildFullSystemPrompt` in `proactive-llm-helpers.ts`, `buildFullToolSet` in
`proactive-llm-full.ts`, and `docs/architecture/overview.md`.

The automatic-effect matrix is strict:

| Candidate origin | Tools during proactive execution | Automatic effects |
| --- | --- | --- |
| Product-owned task/calendar observation (TSK-*/CAL-*) | Direct template or read-only capabilities needed to revalidate/render. | **None.** `propose_mutation` means proposing copy/actions only; it does not expose mutation tools. |
| Conversation-derived `turn_effect` | Prefer no second execution; otherwise read-only revalidation. | **None.** A prior normal-turn effect may be referenced by stable ID, never repeated. |
| Digest composition | No provider tools after item-level revalidation, unless a bounded read-only refresh is explicitly designed. | **None.** Composer cannot execute item actions. |
| Trusted external final message | No LLM/tools on the legacy `/api/notify` path. | **None inside papai.** The caller's external effect is separate provenance. |
| AUT-001/002 explicit deferred action | Only capabilities named by the creation-time authorization and still allowed by current `tool_prefs`. | At most the exact `preauthorized_effect.effectId`, once. No adjacent “helpful” writes. |
| Operational failure/announcement | Direct render/send. | **None.** |

Urgency, budget exemption, retry, digest admission, or an LLM recommendation cannot upgrade any row
in this matrix. If the exact preauthorized capability is no longer allowed at execution time, the
effect fails closed and papai delivers at most a truthful read-only failure notice under its own
dedup/cooldown policy.

A `preauthorized_effect` is limited to the exact effect explicitly created by the user (for example,
an AUT-001 deferred action), has a stable `effectId`, and records completion independently of message
delivery. Delivery failure must never cause the effect to rerun. Reclaim's current product material
describes preview/suggestion before some high-impact scheduling changes
([Reclaim 2.0 FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)); this is volatile
product precedent, not an outcome study, but supports the conservative propose-before-mutate shape.

## 14. Scenario examples

| Scenario and candidate | Gate/factor highlights | Outcome and reasons |
| --- | --- | --- |
| **AUT-001:** “Remind me at 14:00 to join the interview,” DM, exact occurrence, feature intent exists, not quiet, no duplicate. | Urgency 4, relevance/confidence/actionability/novelty 4; ordinary score is high. Explicit occurrence key. | **send-now**, reserved explicit-intent lane: `SEND_EXPLICIT_EXACT_TIME`. If send becomes unknown, do not regenerate; reconcile the same payload. |
| **AUT-001 during assistant quiet hours.** | Exact time is explicit `user_scheduled` intent; the current product has no automation-specific quiet-hours control. | **send-now** under the initially preserved promise: `SEND_EXPLICIT_EXACT_TIME`. A future automation control may opt this reminder into holding, but assistant controls cannot silently change it. |
| **AUT-003:** static predicate `status != Done` remains true two hours after the same state was delivered. | Revalidation true, but `stateVersion` and audience key match delivered exposure; novelty 0. Current alert cooldown alone would permit another firing. | **drop**: `DROP_DUPLICATE_PROACTIVE`/`DROP_COOLDOWN`. A later real status transition creates a new key. |
| **TSK-001:** papai just created a sparse task and the reactive reply already asked whether to add a due date. | `ReactiveExposure` from the create effect covers same task/state/audience with `action_offered`. | **drop**: `DROP_ALREADY_REACTIVE`. Do not compare wording. |
| **TSK-003:** a critical task regressed to “Blocked,” but the candidate targets a broad project group and no manager/owner audience policy is resolved. | High possible urgency, but hard audience/role gate fails; privacy risk is not something score can compensate for. | **drop**: `DROP_NO_ACTIONABLE_AUDIENCE` or `DROP_AUDIENCE_UNAUTHORIZED`. Recreate only for an explicit authorized owner/manager DM. |
| **TSK-006:** first overdue crossing for an open task assigned to the opted-in DM recipient at 11:00 on a workday. | Exact edge, fresh and actionable; not automatically hard-urgent because the deadline already passed and no due-time policy proves minute-level decay. | **digest** by default (`DIGEST_DEFAULT_NONURGENT`) or **send-now** only if the user chose immediate overdue nudges and score/budget permit. Never bypass quiet hours merely because it is overdue. |
| **TSK-011 → TSK-012:** one-day-before item is queued, then the hard due-time stage arrives. | Same lifecycle, newer state/stage; user marked deadline hard and authorized urgent delivery. | Mark TSK-011 **superseded** (`DROP_SUPERSEDED`); TSK-012 can **send-now** (`SEND_VALUE_DECAYS_BEFORE_WINDOW`) using reserved lane. |
| **TSK-008:** daily task briefing at chosen 09:00, seven items plus two lower-value stale nudges. | Scheduled window, digest-safe, same DM/sensitivity/digest key. Revalidate all tasks at composition. | One **digest**. Envelope spends once; items removed as resolved get `DROP_RESOLVED`. The briefing remains a content product, not the generic digest policy itself. |
| **PLN-004:** calendar-enriched briefing accidentally configured for a group while events are private. | Permitted surface excludes group. Redacting event content would defeat schedule planning. | **drop**: `DROP_SENSITIVE_SURFACE`/`DROP_REDACTION_NOT_ACTIONABLE`; offer settings remediation in a normal authorized surface, not in the group. |
| **CAL-001:** papai calendar reminder matches a native-calendar notification source marker already acknowledged. | Exact event ID and lead-time exposure exists; title similarity is irrelevant. | **drop**: `DROP_ALREADY_ACKNOWLEDGED`. Without a structured source marker, treat native-delivery knowledge as unknown rather than guessing from text. |
| **CAL-003:** both task and event changed, sync writes are paused, owner DM is authorized, conflict unresolved. | Integrity class, relevance/actionability 4, exact revision pair, one outstanding candidate. | **send-now** if reserved policy permits: `SEND_SAFETY_OR_INTEGRITY`. New revisions supersede; same conflict does not repeat at cooldown. |
| **AUT-006:** coding session finishes successfully while the recipient is in an active unrelated turn. | Completion is digest-safe; exact context has an active run. | **hold** (`HOLD_ACTIVE_CONVERSATION`), then digest or send after reactive-exposure check. The same session's `input_needed` may use the reserved lane. |
| **AUT-010:** reviewed release announcement to an opt-in group during quiet hours. | Trusted/admin-reviewed does not mean urgent. Existing version/recipient key prevents duplicates. | **hold/digest** (`HOLD_QUIET_HOURS`); release messages do not consume an emergency bypass. |

## 15. Failure modes and containment

| Failure mode | Consequence | Containment / decision behavior |
| --- | --- | --- |
| LLM labels its own candidate urgent | Quiet-hours/budget bypass becomes prompt-injectable. | Urgent class comes only from scenario rule + structured user preference; model output cannot set it. |
| User-derived `delivery_brief`/`context_snapshot` acts as system instruction | Candidate generation or tools follow elevated untrusted text. | Treat metadata as untrusted content; move derived context to user/data role in any redesign; policy never consumes prose. Current `buildMetadataMessages` gap is release-relevant for autonomous full runs. |
| History written before send, then send fails | Future turn believes user saw a message; retry regenerates or repeats effects. | Separate execution audit, rendered artifact, delivery exposure, and conversation history. Append user-visible history only after confirmed send. |
| Send succeeds but acknowledgement is lost | Retry duplicates the message. | `delivery_unknown`, provider idempotency/message ID where possible, same rendered payload, no effect rerun, bounded reconciliation. |
| Worker crash after claiming candidate | Candidate is stuck or processed twice. | Durable lease with expiry, monotonic state transitions, compare-and-set, idempotent exposure key. |
| Quiet hours end releases a large backlog | Burst causes fatigue and stale advice. | Revalidate, lifecycle-collapse, score, digest cap, and expire overflow; no Monday catch-up dump. |
| Budget tokens refill while muted | Unmute produces an immediate burst. | Muted candidates are terminally dropped unless an explicit “keep for later” policy exists; reset/limit bucket on unmute. |
| Same task appears in sibling threads | Duplicate or wrong-context messages. | Observation can be provider/config-scoped, but candidate dedup/audience keys remain exact delivery scopes. Never fan out without explicit subscriptions. |
| Group candidate contains private ownership/calendar detail | Privacy incident affects bystanders. | Group permitted-surface gate and explicit group-benefit rule; private defaults to DM. Wrong-context delivery is a release blocker. |
| Static alert remains true | Periodic nag loop. | Relevant-state `stateVersion`, delivered exposure, lifecycle record, and per-subject cooldown; novelty zero after first exposure. |
| Semantic state hash changes on irrelevant edits | False novelty. | Feature-owned canonical fields, not generic `updatedAt` or entire-object hash. |
| Digest LLM merges items or loses provenance | User cannot tell why item appeared or mute it; action may target wrong task. | Composer receives immutable candidate IDs and required item/action slots; deterministic validator checks all admitted IDs and no new subjects. |
| Score drifts across policy versions | Inconsistent treatment and irreproducible experiments. | Store policy version and factor trace; shadow old/new policies on same candidate set. |
| Kontur Talk DM no-op appears successful | Candidate/history marked delivered when user saw nothing. | Capability gate rejects unsupported DM; richer receipt required before using that route for reliable proactive delivery. |
| External notify caller retries | Duplicate arbitrary markdown bypasses controls. | Keep legacy final-message route narrow; add a versioned candidate ingress with source event ID for native controlled scenarios. |
| Effects run in a long proactive full turn | User cannot stop/steer; retry may repeat writes. | Default inferred candidates to read/propose; exact preauthorized effects have effect IDs and independent idempotency. |

## 16. Metrics and experiment design

### 16.1 Invariant metrics (target zero)

- wrong recipient, group, thread, or platform instance;
- guest, membership, `tool_prefs`, or effect-policy violation;
- sensitive data on a forbidden surface;
- delivery after expiry;
- quiet-hours bypass without a recorded authorized urgent class;
- duplicate proactive/reactive exposure for the same dedup key;
- repeated preauthorized effect after retry;
- “delivered” history without a confirmed delivery receipt.

Any invariant violation is segmented by feature/platform/surface, triggers automatic rollout halt for
the affected cell, and is never optimized against engagement.

### 16.2 Candidate funnel and policy metrics

Record by scenario, feature version, policy version, DM/group, platform, and preference scope:

- detected, schema-rejected, gate-rejected by reason, eligible;
- send-now, digest, hold, drop, superseded, expired, dismissed;
- candidate age at each transition and final delivery;
- revalidation removals and changes;
- score/factor distribution and disposition threshold margins;
- ordinary/reserved token balance, spends, exhaustion, overrides, and counterfactual spends;
- digest size, provenance retention, overflow, and items dropped before send;
- send attempts, confirmed/failed/unknown receipts, retries, reconciliation, and latency;
- proactive/proactive and proactive/reactive duplicates caught and escaped.

### 16.3 Value, trust, and fatigue proxies

- explicit useful/not-useful, already-knew, wrong-person, and too-frequent feedback;
- snooze, dismiss, per-feature mute, master mute, and opt-out retention at 7/30/90 days;
- scenario-appropriate meaningful action within a predeclared horizon;
- task state change attributable to an action link/confirmed conversation, with careful causality
  wording;
- wanted-now precision and adjudicated time-sensitive recall;
- time to action by immediate/digest/hold delay bucket;
- repeated subject/state exposure and response decline across repetitions;
- direct interruptions per recipient per workday and rolling two-hour window;
- group complaints/bystander feedback separately from actor response.

Do not equate clicks, replies, or silence with usefulness. The “My Phone and Me” observational study
found disruption, sender, usefulness, content, and urgency interacted, but its subset and self-report
limits make it unsuitable as a direct label recipe
([Mehrotra et al.](https://discovery.ucl.ac.uk/id/eprint/1502364/)). Likewise, the clinical alert-fatigue
review found heterogeneous definitions and could not support a common metric
([Hussain et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6748819/)). papai should report concrete
exposure, dismissal, mute, usefulness, and outcome measures rather than claim a clinical fatigue score.

### 16.4 Experiment sequence

1. **Offline fixtures:** deterministic candidate/gate/dedup/window tests across DST, cross-midnight
   quiet hours, non-working days, lifecycle supersession, group audiences, and retries.
2. **Shadow detection:** create candidates and compute dispositions, factors, tokens, and reason codes;
   send nothing and run no mutating effects. Compare candidates with later task state and normal-turn
   exposures.
3. **Authorized review sample:** for one selected scenario, have authorized internal reviewers label
   wanted-now/digest/drop and gate errors from redacted structured evidence. Never expose one user's
   content to another participant.
4. **Opt-in canary:** one conservative DM scenario with explicit scope and deterministic state.
   WS-C's illustrative candidates were TSK-006 first-overdue or an improved AUT-001 lifecycle; the
   final WS-G synthesis in `08-recommendation.md` instead selects a narrowly deterministic TSK-008
   digest and explains the trade-off. Default off; master mute, quiet hours, working days,
   deterministic dedup, and reason history are prerequisites for assistant-initiated candidates.
5. **Digest experiment:** among opted-in eligible users, randomize by recipient/config context—not by
   message—to immediate ordinary delivery versus one user-chosen digest window. Predeclare a 24-hour
   meaningful-action non-inferiority margin and direct-interruption reduction target. The dossier's
   illustrative hypothesis uses 5 percentage points and 30%, but those are planning assumptions that
   require power analysis, not inherited facts.
6. **Budget experiment:** shadow the token bucket first, then compare cooldown-only with budget +
   cooldown. Safety/urgent cases remain invariant; do not randomize scope, privacy, consent, or quiet
   hours.
7. **Group work only after DM evidence:** randomize at group/thread level to avoid contamination, use
   explicit admin/member consent, and set a much stricter safety stop.

Every experiment predeclares unit, sample/power analysis, outcome horizon, treatment contamination,
missing-data handling, stopping rule, and rollback. Calibration plots should compare score bins with
wanted-now labels per scenario; aggregate calibration can hide a bad low-volume scenario.

### 16.5 Falsifiers and stop conditions

Stop or redesign if:

- deterministic gates cannot produce acceptable wanted-notification precision for the first scenario;
- wrong-audience/privacy/quiet-hours/effect invariants are violated;
- digest loses more meaningful outcomes than the predeclared non-inferiority margin;
- users commonly mute after one or two deliveries;
- urgent/reserved delivery becomes routine rather than exceptional;
- budget gains exist only in clicks, not usefulness, trust, or scenario outcomes;
- dedup collapses materially different state transitions or fails across reactive/proactive paths;
- decisions cannot be reconstructed from candidate state, policy version, and reason codes.

## 17. Rollout and shadow-mode plan

| Phase | Behavior | Exit criteria |
| --- | --- | --- |
| 0 — schema/audit only | Candidate and reactive-exposure ledgers behind a flag; existing delivery unchanged. Backfill no semantic history. | State/keys are stable; no sensitive logs; deterministic replay matches. |
| 1 — shadow policy | Existing paths still send, while policy records `wouldSendNow`/`wouldDigest`/`wouldHold`/`wouldDrop` and counterfactual tokens. For new product scenarios, send nothing. | Gate/dedup review acceptable; budget distributions understood by DM/group/platform. |
| 2 — one opt-in DM canary | Enforce all gates and windows for one scenario, read/propose effects only, small allowlist. | Zero safety invariants; predefined wanted precision/retention; delivery receipt correctness. |
| 3 — digest and controls | Add one chosen digest window, master mute, snooze/dismiss, and lifecycle supersession. | Revalidation removes stale items correctly; no backlog bursts; non-inferior outcome target. |
| 4 — cross-scenario budget | Enforce ordinary buckets across a small set of DM scenarios; reserved lanes remain narrowly hard-coded. | Fewer interruptions/mutes without missing adjudicated urgent cases. |
| 5 — limited group and external ingress | Explicit group policy and versioned candidate ingress; no private calendar content. | Per-platform scope tests and group safety review pass. |
| 6 — semantic/personalized ranking | Only after sufficient labeled observations; user-approved suppression rules before opaque personalization. | Per-scenario calibration, explainability, opt-out, and rollback meet predeclared bars. |

Shadow records must be privacy-minimal and retention-limited. Store factor bins and opaque evidence
references, not task/calendar bodies. “Would have sent” must never call a mutating tool, generate an
external message, consume a real budget token, or append conversation history.

## 18. Inputs to `08-recommendation.md`

The later recommendation should treat these as WS-C constraints:

1. A durable candidate/outbox and structured exposure ledger are shared prerequisites for quiet hours,
   digests, retries, and cross-reactive dedup; conversation history cannot substitute.
2. The first product scenario should have explicit scope, deterministic normalized state, and a
   read/propose-only effect policy. A transition scenario such as TSK-006 additionally needs open-state
   filtering, first-edge identity, controls, and lifecycle dedup. If WS-G selects a snapshot digest
   instead, it must define provider-neutral finality/in-progress/date rules and explicit task scope;
   `08-recommendation.md` does so for the narrowed TSK-008 choice.
3. Default ordinary delivery is digest/next-work-window, especially for groups. Send-now is a narrow,
   separately authorized class grounded in value decay.
4. AUT-001/002 explicit intent, AUT-006 input-needed, AUT-012 failure truthfulness, announcements, and
   operator emergencies need explicit source-lane decisions; they must not become accidental universal
   exemptions.
5. Current execution/history ordering is a correctness gap: persist generated work/effects separately,
   send the same rendered artifact, and add user-visible history only after confirmed delivery.
6. Current prompt framing is incomplete for autonomous semantics because user-derived execution metadata
   can be system-role content. Policy must remain structured and unoverrideable; autonomous full runs
   should not ship until this boundary is addressed.
7. Numeric weights, thresholds, capacities, refill rates, and outcome margins in this report are
   transparent starting hypotheses. None is validated for papai; shadow evidence and opt-in experiments
   must determine whether they survive.

## 19. Bottom line

papai already knows how to detect some times and task predicates, execute three LLM modes, route to an
exact platform context, apply tool preferences, and append proactive history. It does not yet know
whether a detected condition deserves an interruption, whether the same state was already covered in
a normal reply, whether a recipient/group has recently absorbed too many messages, or whether an LLM
result recorded in history was actually delivered.

The smallest coherent decide-to-interrupt layer is therefore not “add a relevance score.” It is a
durable candidate/outbox with hard scope/privacy/consent/freshness gates, deterministic lifecycle and
reactive-exposure keys, bounded hold/digest states, a conservative recipient/group budget, explicit
reason codes, and strict separation of delivery urgency from LLM/tool effects. Scoring is a reviewable
tie-breaker inside those boundaries, not the authority that creates them.
