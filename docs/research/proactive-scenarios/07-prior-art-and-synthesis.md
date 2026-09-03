<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Prior art and evidence synthesis for proactive messaging

> **Workstream:** WS-G — prior art and cross-workstream synthesis
> **Status:** Decision-support research; not an implementation commitment
> **Evidence cutoff:** 2026-07-19
> **Scope:** Attention and interruption research, current notification-product patterns, and their
> transferability to papai's verified architecture.

## 1. Executive conclusion

The evidence supports a four-outcome policy, not a binary “notify or do not notify” switch:

1. **Drop** a candidate that fails authorization, audience, sensitivity, confidence, novelty,
   actionability, or expiry gates.
2. **Send now** only when material value will decay before the next permitted delivery window.
3. **Add to a digest** when the information remains useful after predictable delay.
4. **Bounded-defer** a temporarily ineligible candidate until a named re-evaluation time, then
   refresh, digest, send, or expire it.

The strongest research finding is that receiving an alert can impose an attention cost even when the
recipient does not open it. The most consistent product pattern is a canonical inbox/history plus
recipient-controlled schedules, stable categories, grouping, snooze/mute, and a visibly exceptional
urgent path. Together, these findings support **default-off, digest-first assistant suggestions** and
do not support default-on proactivity, an opaque LLM-only urgency decision, or a universal numerical
message quota.

For papai, the result is more restrictive than simply adding quiet hours to the existing deferred
prompt poller. Detection, execution, and delivery are currently too tightly coupled for reliable
holding, deduplication, revalidation, and retry. The shared product boundary should be a durable,
auditable candidate/outbox evaluated before tools or an LLM run and again immediately before send.
That conclusion independently follows from the [trigger feasibility report](./02-trigger-feasibility.md),
the [notification-control model](./04-notification-controls.md), and the external evidence below.

## 2. How to read the evidence

### 2.1 Evidence classes

| Class | What it can establish | What it cannot establish |
| --- | --- | --- |
| Peer-reviewed experiments and field studies | Directional effects of interruption timing, batching, alert exposure, and individual differences | papai-specific thresholds, group-chat behavior, or the accuracy of LLM-generated urgency |
| Systematic review | Repeated design risks across many studies, especially alert fatigue and recipient specificity | Direct effect sizes for a general-purpose task bot |
| Research prototypes | Useful decision concepts such as expected interruption cost and bounded deferral | Production reliability or a validated default policy |
| Official product documentation | Current market patterns and available user controls | Evidence that those controls improve outcomes or that their current defaults suit papai |
| papai code and repository documents | Current feasibility, scope, delivery, and security facts | Whether a proposed scenario will create enough user value |
| Synthesis/inference | A testable policy derived from several evidence classes | A settled fact; each inference needs metrics and falsifiers |

Product documentation was checked against official publisher pages. It is treated as volatile prior
art, not causal evidence. The research literature is used directionally and its population, duration,
setting, and measurement limitations are preserved rather than averaged into a spurious score.

### 2.2 Important evidence gaps

No reviewed source directly tests an autonomous LLM task assistant deciding when to message a person
or group without a request. Most notification studies concern one person and one device; evidence for
group-chat bystanders, cross-platform identity, and shared conversation scope is sparse. No source
establishes a universal “messages per day” budget, proves that clicks equal usefulness, or validates
semantic task urgency inferred from untrusted free text. Those gaps make papai's deterministic scope,
permission, provenance, and expiry rules release invariants rather than tunable ranking features.

## 3. Research evidence

### 3.1 Compact evidence matrix

| Evidence | Method and principal result | Transferable constraint for papai | Principal limitation |
| --- | --- | --- | --- |
| [Bailey & Konstan, 2006](https://doi.org/10.1016/j.chb.2005.12.009) | Controlled study of 50 participants found materially higher completion time, errors, annoyance, and anxiety when interruptions arrived during task execution rather than at boundaries. | Prefer user-chosen delivery windows or coarse safe boundaries for nonurgent candidates. | Artificial desktop tasks, one session, and old notification forms. |
| [Adamczyk & Bailey, 2004](https://doi.org/10.1145/985692.985727) | Repeated-measures lab study with 16 students found predicted “best” interruption points less annoying and demanding than predicted worst or random points. | Timing changes interruption cost, but explicit schedules are safer than invasive live sensing. | Tiny student sample and unusually intrusive full-screen alerts. |
| [Iqbal & Bailey, 2008](https://doi.org/10.1145/1357054.1357070) | Two small studies found breakpoint deferral reduced frustration with short average delay; relevant content tolerated finer-grained delivery. | Use bounded deferral with a deadline/expiry; do not wait indefinitely for a perfect moment. | Two desktop domains, small samples, and modest breakpoint-model accuracy. |
| [Stothart, Mitchum & Yehnert, 2015](https://doi.org/10.1037/xhp0000100) | Randomized sustained-attention experiment (166 analyzed participants) found calls and texts disrupted performance without requiring interaction with the phone. | Count visible/audible delivery itself against an interruption budget; “no reply” does not mean “no cost.” | Young lab population and a short cognitive task. |
| [Fitz et al., 2019](https://doi.org/10.1016/j.chb.2019.07.016) | Two-week, four-arm field experiment with 237 smartphone users found three predictable daily batches improved several self-reported outcomes; total blocking increased anxiety/FoMO. | Predictable batching is a strong default for nonurgent items; keep mute reversible and history accessible. | One country, two weeks, blanket phone alerts, and substantial self-report; it does not prove three batches is optimal. |
| [Kushlev, Proulx & Dunn, 2016](https://doi.org/10.1145/2858036.2858359) | Counterbalanced two-week field experiment with 221 students associated high alert exposure with more inattention/hyperactivity symptoms and lower reported productivity. | Optimize useful outcomes per interruption, not message volume or engagement. | Phone placement and alert state changed together; student sample. |
| [Ohly & Bastin, 2023](https://doi.org/10.1002/1348-9585.12408) | Randomized one-workday study of 247 workers found notification blocking reduced interruptions and strain; effects differed by FoMO and telepressure. | Provide explicit, reversible controls and expect user segments to prefer different regimes. | One workday, mostly young/German sample, and self-reported outcomes. |
| [Pielot & Rello, 2017](https://doi.org/10.1145/3098279.3098526) | Thirty-person 24-hour no-push study reported less distraction but some anxiety and social disconnection, with a later behavior follow-up. | A master mute is valuable, but silence should preserve visible history and should not be framed as universally beneficial. | Small, non-randomized, short intervention. |
| [Pejovic & Musolesi, 2014](https://doi.org/10.1145/2632048.2632062) | Small in-the-wild studies found context-guided prompts more often rated as good interruption moments and recent notification load strongly associated with lower receptivity. | Include recent visible delivery load in a recipient budget and re-evaluate queued candidates. | Tiny survey-prompt samples and privacy-heavy context sensing. |
| [Mehrotra et al., 2016, “My Phone and Me”](https://doi.org/10.1145/2858036.2858566) | Two-month logging deployment analyzed 10,372 notifications for a highly responsive subset; sender, content, usefulness, urgency, task complexity, and task phase differed in receptivity. | Model importance, urgency, relevance, actionability, and interruption cost separately. | Selected 20-person analysis subset and inferred viewing/self-reported disruption. |
| [Fischer et al., 2010](https://doi.org/10.1145/1851600.1851620) | Eleven-person SMS study found a large content effect and no timing effect under its manipulation. | Relevance/content is necessary, but cannot replace timing and quiet-hour controls. | The nominal “good time” manipulation failed; too small to establish that content generally dominates timing. |
| [Mehrotra, Hendley & Musolesi, 2016, PrefMiner](https://doi.org/10.1145/2971648.2971747) | Sixteen analyzed users received proposed high-precision suppression rules and explicitly accepted, deferred, or rejected them; about 57% of rules were accepted. | Any learned suppression should be transparent, inspectable, high precision, and user-approved. | Small, short Android study; rule acceptance is not long-term benefit. |
| [Pielot et al., 2017](https://doi.org/10.1145/3130956) | Four-week observational/predictive study of 337 participants improved engagement precision relative to a low baseline by attempting few opportunities; past behavior helped. | If personalization is added, optimize absolute precision and preserve privacy; relative lift is insufficient. | Absolute precision remained low and generic prompt content was unknown before click. |
| [Horvitz, Jacobs & Hovel, 1999](https://www.microsoft.com/en-us/research/publication/attention-sensitive-alerting/) | Decision-theoretic prototype balances expected cost of interruption with the cost of delaying information. | Make benefit, decay, and interruption factors auditable; avoid one opaque priority label. | Foundational prototype, not a modern outcome trial. |
| [Horvitz, Apacible & Subramani, 2005](https://www.microsoft.com/en-us/research/publication/balancing-awareness-interruption-investigation-notification-deferral-policies/) | Prototype studied deferring while busy until a transition or bounded deadline. | Every deferred item needs `notBefore`, a next check, and an expiry/escalation policy. | Very small evaluation in an older desktop/email environment. |
| [Hussain, Reynolds & Zheng, 2019](https://doi.org/10.1093/jamia/ocz095) | PRISMA review of 39 clinical-alert studies found modal prescriber popups least accepted and role tailoring the clearest promising alternative; measures were too heterogeneous for meta-analysis. | Prefer recipient/role specificity and tiering; never broadcast just because a problem was detected. | High-stakes clinical systems differ from task chat, and effect sizes do not transfer. |

### 3.2 What the studies jointly support

The studies do not offer a single production algorithm, but their consistent directional findings
justify six starting principles:

1. **Delivery has a cost independent of response.** Unopened notifications still consume attention;
   therefore an ignored message cannot be scored as harmless.
2. **Timing and content interact.** Useful content can justify some disruption, but timing controls
   remain valuable and an irrelevant message is not rescued by perfect timing.
3. **Predictable batching is safer than a continuous trickle.** The exact number of windows is a
   product hypothesis, not a scientific constant.
4. **Deferral must be bounded.** A held item needs a next check and expiry so quiet hours do not
   create an invisible, stale backlog.
5. **Recent load matters.** Candidate-level relevance is insufficient when the recipient has already
   received several messages.
6. **Individual control dominates inferred preference.** Learned rules may help later, but should be
   proposed transparently rather than silently imposed.

## 4. Current-product prior art

Official product behavior demonstrates understandable control patterns. It does not prove outcome
quality, and product defaults are deliberately not copied where they conflict with papai's opt-in
bias.

| Product | Documented pattern | Transferable to papai | Do not infer |
| --- | --- | --- | --- |
| [Slack](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications) | Notification schedules, snooze, event/category controls, keywords, and a scarce explicit urgent override. | Recipient-local schedule, visible mute, stable categories, separately authorized bypass. | That semantic keywords are enough for task relevance, or that an LLM may bypass quiet hours. |
| [Microsoft Teams](https://support.microsoft.com/en-us/teams/notifications-settings/manage-notifications-in-microsoft-teams) | Scheduled quiet time and category/channel controls; activity remains accessible while push is quiet. | Separate canonical availability from interruptive delivery; honor selected days and local time. | That device/account semantics map directly onto papai's config-context scope. |
| [GitHub](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications) | Watch/participation/mention/assignment provenance, web/email surfaces, per-thread unsubscribe, bulk subscription management. | Explain why a notification was sent and expose scenario/subject unsubscribe. | That inferred task-health state is as reliable as GitHub's structured event provenance. |
| [Google Calendar](https://support.google.com/calendar/answer/37242) | Personal calendar defaults, per-event overrides, multiple lead times/channels, and attendance-sensitive relevance. | Layered defaults, per-subject override, state-dependent relevance, user-chosen lead time. | That tasks without exact time semantics justify event-style immediate reminders. |
| [Todoist](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU) | Explicit relative/custom/recurring reminders, channel and snooze choices, optional exceptional alarm-like delivery. | Treat explicit user-created intent as higher confidence than inferred alerts; separate ordinary and urgent modalities. | That autonomous suggestions inherit the same permission as user-created reminders. |
| [Notion](https://www.notion.com/help/notification-settings) | Canonical in-app Inbox with conditional email/push and suppression when the user is already viewing the source. | Deduplicate against reactive visibility and keep one canonical item across surfaces. | That presence or viewed-state is consistently available across papai chat platforms. |
| [Asana](https://help.asana.com/s/article/inbox) | Inbox, filters, archive/unread state, pause controls, daily/weekly summaries, lower-priority batching, and rapid-handle suppression. | Revalidate just before external delivery; split immediate assignment-like events from grouped summaries. | That Asana's structured event priority can be reproduced by an LLM score. |
| [Linear](https://linear.app/docs/notifications) | Canonical Inbox, configurable desktop/mobile/Slack/email surfaces, immediate or digest email, unread gating, grouping, snooze, and unsubscribe. | Keep candidate state separate from per-surface delivery state and suppress already-handled items. | That an unread chat message is a sufficient usefulness signal. |
| [Reclaim notification controls](https://help.reclaim.ai/en/articles/6179615-manage-notifications-for-reclaim-events), [weekly reports](https://help.reclaim.ai/en/articles/5389397-weekly-reports-overview), and [versioned 2.0 FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq) | Notification controls and summaries, a warning about duplicate source-calendar alerts, and versioned 2.0 preview/suggestion behavior before some consequential changes. | Avoid duplicate source alerts and preview consequential automation rather than silently execute. | The pages span 1.0/current and 2.0/early-access behavior; defaults and availability are volatile, and papai should remain default off. |
| [Apple](https://support.apple.com/guide/iphone/view-and-respond-to-notifications-iph6534c01bc/ios) | Scheduled summaries and Focus; relevance ordering is separate from interruption level; time-sensitive delivery is exceptional. | Separate relevance rank from interruption privilege and keep the user in control of summaries/quiet modes. | That a high relevance score automatically grants an urgent bypass. |
| [Android](https://developer.android.com/develop/ui/compose/notifications/channels) | Stable channels/categories, user-owned importance, grouping, scheduled modes, snooze, and category disablement. | Maintain a stable scenario taxonomy and group related items under a summary. | That OS grouping alone prevents content-level overload. |

### 4.1 Repeated product patterns

Across otherwise different systems, seven patterns recur:

- a canonical inbox/history exists independently of push or chat delivery;
- notification categories are stable enough for durable preferences;
- the recipient, not the sender or classifier, owns quiet schedules and category importance;
- user-created subscriptions/reminders have explicit provenance;
- low-priority items are grouped or digested;
- seen, archived, acknowledged, or handled items are suppressed on secondary surfaces;
- urgent bypass is exceptional, visible, and narrower than ordinary relevance ranking.

papai currently has fragments of these patterns: explicit deferred prompts, opt-in release
announcements, per-recipient announcement delivery rows, and proactive conversation history. It does
not yet have a canonical candidate lifecycle, universal controls, or delivery acknowledgment with
the semantics needed to make suppression and retries reliable.

## 5. Evidence-informed decision model

### 5.1 Candidate record before ranking

Before observing assistant-owned task/calendar content, a content-free registration lookup must prove
that the master, feature, and exact observation scope are enabled. Disabled/unregistered scopes make
no provider read and persist no content-bearing candidate; a privacy-minimal reason tombstone is
optional. After that early gate, the detector should materialize a deterministic candidate before any
LLM is asked to rank or phrase it. The later decision service rechecks consent as defense in depth.
At minimum, the record needs:

- stable scenario ID/version and source event ID;
- recipient/audience, actor, platform instance, config context, and exact storage/delivery context;
- subject/entity identity and observed state/version;
- evidence timestamp, confidence, and uncertainty reason;
- importance, deadline/value-decay basis, relevance, actionability, and sensitivity class;
- semantic fingerprint and links to related reactive/proactive events;
- `notBefore`, next digest/window, expiry, and requested execution mode;
- candidate, execution, and per-surface delivery lifecycle state with reason codes.

This record is the seam where [trigger feasibility](./02-trigger-feasibility.md) hands off to the
[control policy](./04-notification-controls.md). It also prevents generated prose from becoming the
only evidence for why a message was sent.

### 5.2 Non-negotiable hard gates

A candidate is ineligible when any of the following is true:

- master proactivity or the scenario is off;
- the observed data, recipient, actor, group, platform, or context no longer passes authorization;
- guest mode or effective tool permissions prohibit the required read/effect;
- delivery would cross thread, group, config-context, or platform-instance boundaries;
- the candidate contains data not permitted on the target chat surface;
- confidence is below the scenario's declared minimum;
- the state is resolved, superseded, stale, expired, or no longer actionable;
- equivalent/newer information was delivered, acknowledged, acted on, or surfaced reactively;
- no authorized recipient can take a safe concrete next step;
- the candidate's policy class is configured to respect quiet hours and no rule-grounded authorized
  bypass applies. Assistant suggestions always respect them initially; existing explicit schedules
  preserve their separate stored-time promise until an automation-specific control is introduced.

These gates must execute before LLM/tool work and again before send. A model can help summarize or
rank eligible candidates but cannot override a gate.

### 5.3 Importance, urgency, relevance, and actionability

These dimensions must remain distinct:

- **importance** is the magnitude of the underlying consequence;
- **urgency** is how quickly the value of action decays;
- **relevance** is whether this recipient owns, is mentioned in, or can affect the subject;
- **actionability** is whether the message offers a concrete, safe next step;
- **confidence** is how strongly the evidence supports the claimed state;
- **interruption cost** reflects delivery surface, local time, recent load, and recipient policy.

A high-importance weekly trend belongs in a digest if its value does not decay today. A modest event
with a ten-minute decision deadline may justify immediate delivery. An important problem sent to an
uninvolved group member remains irrelevant. A high-confidence observation with no safe next action is
better history/digest material than an interruption.

### 5.4 Four dispositions

The policy should compare immediate value with interruption cost and expected value at the next
allowed window. A sketch—not a validated formula—is:

`immediate benefit = impact × value decay × relevance × confidence × actionability`

`net send-now value = immediate benefit − interruption cost − recent-load cost − scope/sensitivity risk`

The terms should initially be auditable scenario rules and coarse calibrated bands, not pseudo-precise
floating-point truth.

| Disposition | Required condition | Lifecycle requirement |
| --- | --- | --- |
| **Send now** | Eligible, and material useful value would decay before the next allowed window enough to exceed interruption cost. | Revalidate, reserve idempotency key, deliver once, confirm outcome, then record delivered history. |
| **Digest** | Eligible and actionable, but useful value persists until the recipient's chosen digest. | Upsert by semantic fingerprint, group without crossing audiences, refresh/drop at composition time. |
| **Bounded-defer** | Temporarily blocked by quiet time, recent-load budget, or transient uncertainty while value remains. | Store next evaluation and expiry; never leave indefinitely pending. |
| **Drop** | Ineligible, redundant, stale, resolved, low-confidence, low-value, non-actionable, or expired. | Preserve a non-content reason code/metric where privacy permits; do not execute tools or generate prose. |

Execution mode is orthogonal. `lightweight`, `context`, and `full` describe computation and access;
none grants permission to interrupt. Conversely, a direct operational message can be urgent without
using an LLM.

### 5.5 Interruption budget

Research supports accounting for recent delivery load but not a universal quota. The first budget
should therefore be an observable policy parameter:

- scoped per recipient and config context, with platform/surface visibility;
- rolling-window points rather than only a daily raw count;
- direct messages costing more than adding one item to a digest;
- the digest itself costing points while additional grouped items cost less;
- every visible delivery counted even if ignored;
- per-scenario and per-fingerprint cooldowns applied in addition to the recipient budget;
- explicitly requested reminders and separately authorized urgent classes using reserved tiers;
- exhaustion routing useful nonexpiring items to a digest and dropping low-value items;
- every override rare, explained, logged without content, and measured separately.

The initial product should instrument candidate and delivery load before enforcing an aggressively
numerical budget. A default such as “three messages per day” would be a product experiment, not an
evidence-backed constant.

### 5.6 Deduplication across reactive and proactive paths

The semantic identity should include at least:

`scenario + subject/entity + meaningful state/version + authorized audience/scope`

Immediately before delivery, compare pending candidates with proactive history and reactive events
since the source version. Then:

- update an existing digest item when fresher state arrives;
- suppress a push if the reactive turn already reported or resolved it;
- suppress alternate surfaces after acknowledgement, dismissal, action, or confirmed view where the
  platform can establish that fact;
- retain a materially new state transition as a new candidate;
- record `duplicate`, `already_handled`, `superseded`, `stale`, or `cooldown` as the disposition.

Silence is not automatically negative feedback. A reminder can be useful without an in-chat action,
while a click can reflect confusion. Explicit useful/not-useful, snooze, mute-scenario, already-knew,
and wrong-person feedback is more interpretable.

## 6. Synthesis against papai's scenario space

The [scenario catalogue](./01-scenario-catalogue.md) contains 50 stable records. Prior art changes the
recommended delivery posture of those candidates more than it changes their trigger feasibility.

| Scenario family | User value | Trigger/implementation effort | Interruption and trust risk | Evidence-informed posture |
| --- | --- | --- | --- | --- |
| Existing user-authored reminders/alerts (`AUT-001`–`AUT-005`) | High because intent is explicit | Low-medium; substrate exists | Repetition, stale schedules, retry/effect duplication | Preserve explicit-intent priority; add truthful lifecycle, quiet-time semantics chosen by user, and dedup before expanding autonomous scenarios. |
| Daily task-health briefing (`TSK-008`) | High orientation value with one predictable touchpoint | Medium; scheduled full read exists, but candidate/outbox and controls do not | Long lists, wrong workday/scope, duplicate nudges | Best autonomous learning slice if DM-only, task-only, deterministic, digest-shaped, default off, and revalidated. |
| Weekly review/planning (`TSK-009`, `TSK-010`) | Potentially high reflective value | Medium | Low urgency, stale/poor metadata, guilt or team comparison | Digest-safe follow-on after daily briefing proves wanted; never urgent. |
| Overdue/deadline lifecycle (`TSK-006`, `TSK-011`–`TSK-013`) | High when deadlines are real and actionable | Medium; overdue substrate exists but lifecycle identity does not | Shame loops, false urgency, duplicate stages, wrong owner | One lifecycle with first-crossing semantics, explicit deadline class, owner DM, snooze/dismiss, and later digest; do not start with quiet-hour bypass. |
| Completion/enrichment follow-ups (`TSK-001`, `TSK-005`) | Contextually valuable | Medium-high; needs structured turn effects or richer observation | Duplicates normal reply; unsafe suggested mutations | Prefer same-turn reactive/contextual suggestions first; autonomous follow-up only after structured outcome dedup. |
| Staleness and semantic change (`TSK-002`–`TSK-004`, `TSK-007`) | Variable and potentially valuable | High; signals incomplete and semantic ambiguity high | False positives, untrusted text, broad privacy exposure | Defer until richer provider-normalized events and precision measurements exist; digest only initially. |
| Calendar briefing enrichment (`PLN-004`) | Potentially high planning value | High; new read connector/identity/privacy scope | Private event leakage, stale sync, duration errors | Read-only, just-in-time DM enrichment after task-only briefing; no calendar webhook required initially. |
| Calendar reminders/conflicts (`CAL-001`–`CAL-004`) | High for explicit events/conflicts | High; connector plus durable event identity | Duplicate native alerts, private titles, sync loops | Later, narrowly scoped and source-deduped; auth/sync conflict can be immediate only for the connection owner. |
| Broad conversation inference | Uncertain | Very high | Hypotheticals, wrong speaker, cross-thread leakage, opaque surveillance | Do not include in the first increments; prefer structured turn outcomes and explicit schedules. |
| Group/team proactive delivery | Potential coordination value | High | Bystander interruption, wrong audience, thread/platform mismatch, privacy incidents | DM-only first. Require explicit owner/admin policy and platform capability proof before group rollout. |

### 6.1 Why a digest-shaped task briefing leads

The evidence favors `TSK-008` over an immediate overdue nudge as the first autonomous product test:

- it naturally batches several low/medium-value states into one predictable interruption;
- it uses the existing scheduler and current task reads rather than a new webhook/calendar source;
- users can evaluate its completeness and usefulness without accepting a write action;
- it avoids claiming semantic urgency or inferring live interruptibility;
- it creates a realistic proving ground for opt-in, workdays, timezone, quiet hours, candidate
  identity, revalidation, delivery acknowledgment, history, and feedback.

This is not an argument to generate a polished narrative with unrestricted tools. A safer first
briefing is a deterministic, read-only list of overdue, due-today, and currently in-progress tasks,
bounded in size and linked to sources. “My,” “open/final,” “due today,” and “in progress” are not
provider-neutral assumptions: the first slice must require an explicit provider-backed project or
stable assignee scope, evaluate dates in the policy timezone, use proved finality/status mappings, and
omit or disable unsupported categories. `08-recommendation.md` makes that contract explicit. LLM
composition can be evaluated later once provenance and item-level dedup remain visible.

### 6.2 Why the obvious overdue alert is not first

`TSK-006` has the shortest path from the current `overdue` condition, but trigger proximity is not
product readiness. It requires reliable completed/cancelled filtering, first-crossing identity,
assignee/owner authorization, weekend/date-only semantics, lifecycle dedup with `TSK-011`–`TSK-013`,
and a nonpunitive action model. Immediate delivery also exercises the highest-trust part of the
policy before the quieter digest path has proved reliable. It remains a strong second scenario after
the candidate/control substrate is operational.

## 7. Metrics and experiments

### 7.1 Safety invariants

Target zero unless an explicitly authorized policy says otherwise:

- wrong recipient, group, thread, platform instance, actor, or config context;
- guest or effective-permission violation;
- sensitive or secret-bearing content on an unauthorized surface or in logs;
- delivery outside an allowed time window;
- expired/resolved candidate delivery;
- duplicate across proactive and reactive surfaces;
- unapproved quiet-hours or budget override;
- mutation caused by a supposedly read-only automatic scenario.

### 7.2 Candidate and delivery funnel

Measure by scenario, provider, platform, DM/group, and config context:

- candidates detected and rejected by each hard-gate reason;
- sent now, digested, deferred, superseded, expired, dismissed, and dropped;
- age/delay at final disposition and revalidation-drop rate;
- direct interruptions and digest size per recipient/day and rolling two-hour window;
- budget consumption, exhaustion, and override count;
- execution retries, side-effect attempts, send attempts, confirmed delivery, and uncertain outcome;
- opt-in retention and scenario/master mute at 7, 30, and 90 days.

### 7.3 Value and trust outcomes

- explicit useful/not-useful, wrong-person, already-knew, and too-frequent feedback;
- acknowledgement or meaningful safe action within a predeclared horizon;
- tracked task-state improvement appropriate to the scenario;
- notification-to-useful-outcome ratio;
- snooze/dismiss and repeated-message rates;
- complaints, unread direct messages, and response decline for repeated fingerprints;
- time-to-action for adjudicated deadline-bound candidates;
- precision among items recipients say were wanted **now**, not merely wanted eventually.

Clicks and replies are supporting signals, not the north-star metric. The product should not label a
recipient “fatigued” from one behavioral proxy; measure concrete exposure, suppression, mute, and
usefulness instead.

### 7.4 Testable hypotheses

1. Routing nonurgent task-health candidates to one user-chosen workday digest reduces direct
   interruptions materially without lowering 24-hour meaningful-action rate beyond a predeclared
   non-inferiority margin.
2. Requiring explicit ownership, novel state, confidence, and a concrete next action improves useful
   precision and reduces dismissals relative to trigger-only delivery.
3. Candidate fingerprints checked against both proactive history and reactive events reduce
   duplicate visible reports without collapsing materially different state transitions.
4. Next-work-window deferral eliminates accidental quiet-hour delivery while preserving next-day
   action for nonurgent candidates.
5. A rolling recipient budget plus subject cooldown lowers dismissal/mute rates relative to cooldown
   alone without suppressing adjudicated time-sensitive cases.
6. Explaining scenario provenance and exposing snooze/mute improves opt-in retention compared with an
   otherwise identical bare message.
7. Transparent, user-approved suppression rules improve wanted-notification precision only after a
   minimum observation count; silent learned suppression is not an acceptable control group.

Every experiment should predeclare randomization unit, group-chat contamination risk, outcome
horizon, safety rollback, stopping rule, and minimum sample. Consent, scope, and permissions are
invariants—not experimental variables.

## 8. Claims the evidence does not support

- “Three notifications or three batches per day is optimal.” One study found benefit for three
  daily batches in one setting; the number is not universal.
- “Content always matters more than timing.” The most direct supporting study was tiny and its
  timing manipulation failed.
- “No click means no value” or “no reply means no interruption cost.” Both are contradicted by the
  broader evidence and by ordinary reminder behavior.
- “A learned model can reliably find the perfect moment.” Predictive work reports useful relative
  lifts from low absolute precision and often relies on privacy-heavy sensing.
- “OS time-sensitive channels authorize papai to bypass quiet hours.” They show a capability and a
  user-control pattern, not permission for an autonomous classifier.
- “Alert-fatigue findings provide a papai threshold.” Clinical studies support role specificity and
  caution but use heterogeneous definitions and a materially different domain.
- “Current product defaults are evidence-based requirements.” They are market precedents and may be
  plan-specific, volatile, or contrary to papai's default-off requirement.
- “LLM prose can serve as event identity or provenance.” Delivery dedup and auditability require
  structured source/version/audience records.

## 9. Falsifiers and stop conditions

The proposed direction should be paused or redesigned if:

- the conservative task-health briefing cannot reach an agreed wanted-message precision after
  deterministic ownership, novelty, and size gates;
- users commonly disable the scenario or master control after one or two deliveries;
- digesting loses more meaningful outcomes than the predeclared non-inferiority margin;
- the candidate fingerprint collapses distinct authorized audiences or state transitions;
- confirmed wrong-context, wrong-recipient, or permission incidents occur;
- an “urgent” class becomes routine rather than exceptional;
- outcome gains exist only in opens/clicks, not explicit usefulness, safe action, or task state;
- the system cannot explain from durable state why an item was sent, held, suppressed, retried, or
  overridden;
- retry uncertainty can cause an automatic full-mode run or mutating effect to execute twice.

## 10. Transfer decisions for the final recommendation

| Pattern | Decision | Rationale |
| --- | --- | --- |
| Default-off master and per-scenario controls | **Adopt in first increment** | Required for consent and repeatedly supported by product patterns. |
| Recipient-local timezone, working days, quiet hours, and one digest window | **Adopt in first increment** | Safer breakpoint proxy with strong directional support. |
| Durable candidate/outbox with reason-coded lifecycle | **Adopt in first increment** | Required by controls, idempotency, revalidation, audit, and truthful history. |
| DM-only autonomous scenario | **Adopt in first increment** | Group evidence is weak and current platform/scope behavior is heterogeneous. |
| Deterministic task-health digest | **Adopt as first scenario candidate** | High learning value, existing clock/read substrate, low urgency claim, bounded effects. |
| Interruption-load instrumentation | **Adopt in first increment** | Needed before setting numerical budgets. |
| Enforced numerical recipient budget | **Pilot conservatively after instrumentation** | Direction is supported; no defensible universal threshold exists. |
| Quiet-hours urgent bypass | **Defer** | High trust risk; first scenario does not need it. |
| LLM relevance/urgency score | **Defer; assist only after hard gates** | No direct validation and current injection/effect boundaries require strengthening. |
| Learned suppression | **Defer; require user approval** | Potential value but weak absolute precision and privacy/explainability costs. |
| Calendar event automation | **Defer behind read-only enrichment** | New connector and identity/privacy lifecycle are substantial; webhooks are unnecessary for briefing enrichment. |
| Broad conversation inference and live interruptibility sensing | **Do not include in early roadmap** | Weak transfer evidence, high false-positive/privacy cost, and structured signals exist for nearer scenarios. |

The [final recommendation](./08-recommendation.md) converts these transfer decisions, the scenario
catalogue, feasibility constraints, control model, scope analysis, and threat model into a sequenced
build decision.

## 11. Source notes

Research sources are linked in §3. Product sources in §4 are official documentation; additional
official pages consulted include
[Slack notification pause/schedules](https://slack.com/help/articles/214908388-Pause-your-Slack-notifications),
[Teams quiet time](https://support.microsoft.com/en-us/office/quiet-time-in-microsoft-teams-for-mobile-devices-174c4d2d-c7c1-4228-80a7-031c14f9bcf2),
[GitHub subscription management](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-subscriptions-for-activity-on-github/managing-your-subscriptions),
[Notion reminders](https://www.notion.com/help/reminders),
[Asana email notifications](https://help.asana.com/s/article/email-notifications),
[Linear Inbox](https://linear.app/docs/inbox),
[Apple Focus](https://support.apple.com/guide/iphone/turn-on-or-schedule-a-focus-iph5c3f5b77b/ios),
[Apple relevance score](https://developer.apple.com/documentation/usernotifications/unmutablenotificationcontent/relevancescore),
[Apple time-sensitive interruption level](https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive),
[Android notification grouping](https://developer.android.com/develop/ui/views/notifications/group),
and [Android modes/Do Not Disturb](https://support.google.com/android/answer/9069335).

Access dates and the evidence cutoff are 2026-07-19 unless an official page displays a newer update
date. Product documentation is expected to change; implementation planning should re-verify any API-
or version-specific behavior that becomes a dependency.
