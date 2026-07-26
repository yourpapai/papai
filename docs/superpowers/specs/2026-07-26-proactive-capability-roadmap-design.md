<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Proactive capability roadmap

**Date:** 2026-07-26

**Status:** Portfolio design approved; written roadmap pending user review;
each delivery phase requires a fresh brainstorming → design spec →
implementation plan → development cycle

**Audience:** Product and engineering

**Decision basis:** [`docs/research/proactive-scenarios/`](../../research/proactive-scenarios/)

## 1. Purpose

This document turns the proactive-scenarios research into an outcome-gated
product and engineering roadmap. It is deliberately more detailed than a
normal feature roadmap so that a fresh agent can use any phase section as the
starting brief for that phase's own brainstorming session.

This document is **not**:

- a file-level implementation plan;
- approval to implement all phases as one project;
- approval for every scenario in the research catalogue;
- a promise of calendar dates;
- permission to weaken an earlier phase's safety contract to reach a later
  product milestone.

The roadmap has one strict critical path:

`Phase 0 → Phase 1 → Phase 2 → Phase 3A → Phase 3B`

Phases 0–3 are specified in depth. Phases 4–5 are directional portfolios whose
individual bets require separate approval. A phase may begin only after the
prior phase's exit evidence is reviewed and accepted.

### 1.1 How a fresh agent must use this roadmap

For one phase at a time, the fresh agent must:

1. work from a branch containing every accepted prior phase;
2. verify the prior phase's committed gate packet certifies the branch
   revision and records an accepted `go`;
3. load the current repository instructions and the `brainstorming` skill;
4. read this document, the named phase brief, and the linked research;
5. inspect the current code and recent commits, preferring `codeindex` for
   structural queries;
6. check whether earlier implementation changed any assumed seam;
7. brainstorm **only that phase**, treating the locked decisions in this
   roadmap as constraints;
8. when the phase contains multiple independently deliverable subsystems,
   decompose it into ordered increments before detailed design;
9. resolve the phase-entry decisions named for the current phase/increment;
10. present and obtain approval for a phase/increment-specific design;
11. write and commit that design spec;
12. self-review the spec and ask the user to review it;
13. after approval, use `writing-plans` to create the implementation plan for
    that phase/increment only;
14. implement, verify, and produce the required checkpoint or exit evidence
    before proposing the next increment/phase.

For Phase 0, step 2 verifies this approved roadmap commit because no earlier
delivery-phase gate exists.

A contradiction between this roadmap and verified current code is not a reason
to improvise. During fresh brainstorming, record it under **Roadmap assumption
deltas** and either preserve the roadmap invariant in the new design or return
for a roadmap amendment. Use `syncing-plan-with-code` only later, when an
already approved phase implementation plan drifts during execution.

### 1.2 Generic fresh-agent kickoff prompt

The following prompt can be paired with the relevant phase section:

> Use the brainstorming skill. Read
> `docs/superpowers/specs/2026-07-26-proactive-capability-roadmap-design.md`
> and brainstorm **Phase N only**. Treat its locked decisions, invariants,
> scope exclusions, entry gate, and exit gate as requirements. Read the
> phase's linked proactive-scenarios research and inspect the current branch
> with codeindex before asking questions. Do not implement. Produce an
> approved phase-specific design spec, commit it, ask me to review it, and
> only after my approval transition to a Phase N implementation plan.

Replace `Phase N` with `Phase 0`, `Phase 1`, `Phase 2`, `Phase 3A`, or
`Phase 3B`. Phase 4 and Phase 5 bets must be named individually rather than
started as whole phases.

## 2. Executive decision

papai should build a controlled proactive capability, not add another direct
scheduled-message path. The first product proof is a default-off, personal-DM,
deterministic, read-only Kaneo task-health digest delivered through Telegram.

Before that product can send, papai must:

1. correct current delivery, history, authority, instruction-boundary, error,
   and statistics defects;
2. build a durable policy, occurrence, candidate, outbox, receipt, and exposure
   substrate;
3. prove that substrate in no-send shadow mode;
4. pass both a hard safety/correctness gate and a predeclared product-value
   gate.

After the digest proves safe and wanted, papai may add a staged deadline
lifecycle:

- Phase 3A: first-overdue recovery (`TSK-006`);
- Phase 3B: one-day-before deadline (`TSK-011`).

Weekly planning, calendar context, provider events, group delivery, urgency,
learned suppression, and semantic inference are later decisions. Success of
the digest does not authorize them.

### 2.1 Decisions locked during roadmap brainstorming

| Decision             | Approved choice                                             |
| -------------------- | ----------------------------------------------------------- |
| Planning horizon     | Phases 0–3 in depth; Phases 4–5 directional                 |
| Roadmap gating       | Outcome gates with relative sizing; no date promises        |
| Delivery approach    | Sequential foundation-first                                 |
| Phase 0 scope        | Shared contracts with selective adoption by affected paths  |
| First vertical slice | Kaneo task provider + Telegram DM                           |
| Canary gate          | Two layers: safety/correctness and product evidence         |
| Phase 3 shape        | Staged deadline lifecycle: first-overdue, then pre-deadline |
| Primary audience     | Product and engineering together                            |
| Visual companion     | Declined; roadmap is text-first                             |

Changing any locked choice requires an explicit roadmap amendment, not a
phase-local implementation shortcut.

## 3. Research and repository context

### 3.1 Research sources

| Source                                                                                              | Use in this roadmap                                                        |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`00-research-plan.md`](../../research/proactive-scenarios/00-research-plan.md)                     | Existing machinery, guardrails, research boundaries                        |
| [`01-scenario-catalogue.md`](../../research/proactive-scenarios/01-scenario-catalogue.md)           | Scenario value, audience, actionability, and risk                          |
| [`02-trigger-feasibility.md`](../../research/proactive-scenarios/02-trigger-feasibility.md)         | Existing clock/task signals, missing candidate layer, provider constraints |
| [`03-decide-to-interrupt.md`](../../research/proactive-scenarios/03-decide-to-interrupt.md)         | Hard gates, dispositions, lifecycle, deduplication, effect policy          |
| [`04-notification-controls.md`](../../research/proactive-scenarios/04-notification-controls.md)     | Consent classes, preferences, settings surface, precedence                 |
| [`05-scope-and-delivery.md`](../../research/proactive-scenarios/05-scope-and-delivery.md)           | Owner/actor/audience/target separation, platform and history contracts     |
| [`06-safety-and-trust.md`](../../research/proactive-scenarios/06-safety-and-trust.md)               | Threat model, release blockers, retry and privacy invariants               |
| [`07-prior-art-and-synthesis.md`](../../research/proactive-scenarios/07-prior-art-and-synthesis.md) | Transferable patterns and unsupported claims                               |
| [`08-recommendation.md`](../../research/proactive-scenarios/08-recommendation.md)                   | Narrowed first increment and original Phase 0–5 recommendation             |

The repository's current scope, settings, tool, and anonymity contracts remain
authoritative:

- [`docs/architecture/behaviors.md`](../../architecture/behaviors.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/architecture/tools.md`](../../architecture/tools.md)

### 3.2 Existing useful primitives

At the research baseline, papai already has:

- one-shot and RRULE scheduling with a 60-second due-work poller;
- narrow task-inventory polling and an `overdue` predicate;
- deferred prompt and alert execution modes;
- platform-instance-aware delivery routing;
- proactive conversation-history helpers;
- a bearer-authenticated `/api/notify` final-message trust plane;
- opt-in release announcements with bounded fan-out and per-recipient delivery
  rows;
- a settings-only configuration convention;
- scoped context IDs and a central `ENTITY_SCOPES` registry;
- `tool_prefs`, guest gating, and normal-turn confirmations;
- anonymous `/stats/*` architecture documentation.

These are inputs, not a complete proactive product. In particular, generic
deferred prompts and `/api/notify` must not be stretched into native candidate
ingress.

### 3.3 Verified structural gaps

The research found that papai does not yet have a shared:

- durable candidate/outbox lifecycle;
- stable source-event and semantic exposure identity;
- universal assistant-initiated control gate;
- typed, truthful cross-platform delivery receipt;
- safe treatment of an unknown delivery outcome;
- exact effect-versus-delivery retry boundary;
- post-confirmation-only history contract across proactive paths;
- structured reactive exposure ledger;
- provider/config-scoped task observation history with tombstones;
- calendar identity, credentials, or normalized read model;
- provider webhook ingestion contract;
- proactive run control equivalent to normal-turn steering and `/stop`.

The research also identified release blockers:

- Kontur Talk DM may warn and return without proving delivery;
- generated/effectful deferred paths can persist before actual send;
- retry can regenerate content or repeat effects;
- user/provider-derived metadata can cross a privileged instruction boundary;
- raw subject identifiers currently contradict the documented `/stats/*`
  anonymity contract;
- raw external errors can reach a user;
- group configuration, thread delivery, creator provenance, and recipient
  authority can be confused if not re-resolved.

### 3.4 Current code seams to re-discover, not hard-code

At the roadmap baseline, relevant seams include:

- `src/deferred-prompts/proactive-delivery.ts`
- `src/deferred-prompts/poller.ts`
- `src/deferred-prompts/proactive-llm-helpers.ts`
- `src/deferred-prompts/proactive-trigger.ts`
- `src/proactive-history.ts`
- `src/scheduler.ts`
- `src/scheduler-recurring.ts`
- `src/announcements/broadcast.ts`
- `src/debug/notify-route.ts`
- `src/chat/delivery-routing.ts`
- `src/chat/context-scope.ts`
- `src/stats/index.ts`
- `src/stats/types.ts`

These paths are orientation, not future plan line items. Every phase agent must
use codeindex to re-resolve symbols and callers because earlier phases and
unrelated branch work may move or replace them.

## 4. Product and safety principles

### 4.1 Policy classes remain distinct

The roadmap preserves at least five policy classes:

| Policy class           | Consent model                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `assistant_initiated`  | Master and feature controls default off; quiet hours, workdays, digest, mute, and budget apply         |
| `user_scheduled`       | Preserve the user's explicit reminder promise initially; not silently governed by the assistant master |
| `transactional`        | Updates from work the user or operator already initiated; separately typed and controlled              |
| `release_announcement` | Preserve explicit default-off subscription                                                             |
| `operator_broadcast`   | Separate reviewed/operational authority and rate policy                                                |

Shared delivery machinery must not collapse these consent semantics.

Candidate origin is a separate typed field describing what produced the
candidate. A versioned, reviewed mapping selects its policy class:

| Candidate-origin example             | Default policy class   |
| ------------------------------------ | ---------------------- |
| Product-owned task/planning scenario | `assistant_initiated`  |
| Explicit one-shot/recurring schedule | `user_scheduled`       |
| External result/input-needed update  | `transactional`        |
| Operational failure notice           | `transactional`        |
| Reviewed release version             | `release_announcement` |
| Manual operator message              | `operator_broadcast`   |

Unknown origin, unknown policy class, or an unreviewed origin-to-class mapping
fails closed.

### 4.2 Denial precedence and evaluation order

The most restrictive applicable rule wins; a later allowance never overrides
an earlier denial. This conflict rule is distinct from runtime evaluation
order because candidate-specific dismissal cannot be checked until semantic
candidate identity exists.

Runtime uses three stages:

1. content-free pre-observation gates: origin/class mapping, exact principals
   and target, current authorization, master/feature controls,
   privacy/surface, provider access, workday/quiet-hours window, and exact
   active-turn signal;
2. post-observation candidate gates: current source truth, expiry, semantic
   identity, novelty, supersession, snooze/dismissal, digest, and load;
3. pre-send revalidation of every mutable gate and included source state.

No score, model judgment, scenario preference, or later-stage allowance may
override a denial.

### 4.3 Scope and authority are exact

Owner, actor, audience, configuration context, storage context, native
delivery target, and platform instance are separate concepts:

- the owner controls the durable policy;
- the actor or explicit service principal supplies current authority;
- the audience describes who the content is for;
- the config context resolves settings and task-provider assignment;
- the storage context owns thread-scoped history and live state;
- the native target identifies the exact platform destination;
- the platform instance chooses the configured adapter credentials.

Configuration scope is never delivery permission. A group-owned policy does not
silently become a member DM or a group broadcast. A failed thread or mention
resolution does not fall back to a broader channel.

### 4.4 Default off, reversible, and settings-owned

Assistant proactivity and every assistant-initiated feature default off.
Durable controls live in the settings SPA, not chat commands. Users can pause,
mute, or disable the feature without deleting audit evidence or affecting
explicit reminders and release subscriptions.

### 4.5 Deterministic safety decisions

Trusted code, not an LLM, decides:

- consent;
- actor and audience;
- scope;
- quiet hours and working days;
- expiry and supersession;
- semantic identity and deduplication;
- delivery disposition;
- effect permissions;
- retry eligibility.

The initial execution class is deterministic direct rendering with bounded
read-only provider access. User/provider text is escaped data, never policy or
instructions.

Direct provider reads still require a code-enforced automatic-observation
authorization derived from current provider capabilities and effective
`tool_prefs`. Only `allow` permits the exact bounded read. `deny` and
unattended `ask` fail closed before provider access; `ask` cannot be converted
into implicit background consent.

### 4.6 Attention is a cost

Every visible assistant-initiated message consumes attention even without a
click. Nonurgent content defaults to predictable batching. The first phases
have no urgent lane or quiet-hours bypass. Universal quotas are not invented
without papai-specific evidence.

### 4.7 Current truth beats scheduled intent

Consent, route, authority, task access, feature policy, source state, and
expiry are checked before content-bearing reads where possible and rechecked
immediately before send. A resolved, changed, inaccessible, or stale item is
not delivered merely because it once produced a candidate.

### 4.8 Delivery truth precedes conversation truth

Only a confirmed receipt creates a delivered exposure and an assistant message
in conversation history. Unknown outcomes are quarantined or reconciled, not
blindly retried. A post-delivery history repair must never resend.

### 4.9 Privacy-minimal observability

Operational and product metrics contain reason codes, counts, timing, bounded
bands, and approved keyed identifiers only. They never contain:

- task/chat/calendar content;
- rendered payloads;
- raw user, context, or platform IDs;
- display names;
- secrets, headers, or credentials;
- raw provider errors.

Low-cardinality provider/platform categories still require approved aggregation
and small-cell suppression when a narrow cohort could make them identifying.

Content-bearing candidate or outbox artifacts use content-equivalent access
control and explicit retention/deletion behavior.

## 5. Roadmap overview

Relative sizes communicate scope, integration surface, and uncertainty:

- **S:** one focused bounded change;
- **M:** one coherent cross-layer increment;
- **L:** several collaborating subsystems and migration/test surfaces;
- **XL:** a staged platform foundation that requires its own internal
  milestones.

They are not sprint or month estimates.

| Phase                         | Outcome                                                                                             | Relative size | Hard exit                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------: | ---------------------------------------------------------------------------------------------------------- |
| **0 — Correctness contracts** | Repair unsafe current behavior and establish shared typed contracts with selective adoption         |             L | Existing affected paths cannot falsely claim delivery, leak unsafe data, or repeat effects on retry        |
| **1 — Proactive foundation**  | Build policy, occurrence, candidate, outbox, receipt, exposure, settings, and shadow infrastructure |            XL | Deterministic time/scope/concurrency/crash fixtures pass with no user-visible send                         |
| **2 — Task-health digest**    | Canary a deterministic, task-only Kaneo briefing in Telegram DMs                                    |             L | Zero safety/correctness violations and predeclared usefulness/retention evidence                           |
| **3A — First overdue**        | Add one lifecycle-aware overdue recovery stage and candidate-bound feedback                         |           M–L | First crossing, supersession, feedback, and retry cannot duplicate or surface stale/wrong-audience prompts |
| **3B — Pre-deadline**         | Add a one-day-before stage to the proven deadline lifecycle                                         |             M | Pre-deadline and overdue stages compose without bursts, stale content, or duplicate lifecycle exposure     |
| **4 — Directional**           | Weekly rituals, then identity-scoped read-only calendar context                                     |   Uncommitted | Each bet receives a separate design and product/connector gate                                             |
| **5 — Directional**           | Event-driven, group, urgent, and learned capabilities                                               |   Uncommitted | Each capability receives independent safety, privacy, and evidence approval                                |

Sequential foundation-first means:

- Phase 0 is complete before Phase 1 implementation starts;
- Phase 1 is complete before Phase 2 can send;
- no thin digest shortcut is used to discover missing delivery contracts;
- offline content fixtures and research may be prepared early, but no
  user-visible scenario bypasses the preceding gate;
- each phase is re-estimated and re-designed against the code produced by the
  prior phase.

## 6. Target architecture

The target is a pipeline of small, typed units rather than one large
"proactivity service."

### 6.1 Unit boundaries

| Unit               | Responsibility                                                                               | Must not do                                                           |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Observer           | Read bounded source state and emit normalized, versioned evidence                            | Choose audience, urgency, policy, or delivery                         |
| Policy/time engine | Resolve consent, scope, quiet hours, workdays, freshness, suppression, load, and disposition | Render prose, authorize effects, or perform unbounded content reads   |
| Lifecycle store    | Own occurrences, candidates, leases, identity, supersession, and expiry                      | Treat conversation text as state or deduplication truth               |
| Renderer           | Convert one admitted candidate/digest into a bounded escaped payload                         | Change included subjects, target, permissions, or priority            |
| Outbox             | Persist one frozen artifact and its send eligibility window                                  | Regenerate content or rerun observation/effects during delivery retry |
| Delivery adapter   | Send a frozen payload to one exact target and return a typed receipt                         | Append conversation history or guess ambiguous success                |
| Finalizer          | Turn confirmed receipts into exposure and exact history; repair finalization idempotently    | Resend or repeat effects                                              |
| Settings/API       | Manage policy and controls, previews, status, and authorized feedback                        | Send messages or perform provider reads inside a settings request     |
| Metrics/audit      | Record content-free decisions and outcomes                                                   | Store content, raw identities, secrets, or raw errors                 |

Each unit must expose an interface understandable without reading its
internals. Internal implementation can change without changing consumers'
behavioral contracts.

### 6.2 Conceptual records

The phase-specific design may choose table and column names, but it must
preserve these logical records.

#### Policy

- stable policy ID and feature/version;
- policy class;
- owner and authorized actor/service principal;
- config context;
- exact recipient, platform instance, and eligible delivery surface;
- master/feature enabled state;
- scenario scope;
- timezone, working days, quiet hours, and digest time;
- pause/mute state;
- policy version and update metadata;
- next occurrence preview without message content.

#### Occurrence

- stable policy ID;
- recipient;
- occurrence kind;
- scheduled local date;
- calculated instant and timezone/DST snapshot;
- policy version snapshot;
- supersession identity;
- lifecycle/lease fields.

For a daily slot, identity is conceptually:

`policy + recipient + occurrence kind + scheduled local date`

A policy or timezone edit may supersede/reclassify the unsent slot but cannot
make two deliverable occurrences for the same logical local date.

#### Candidate

- candidate and source-occurrence IDs;
- immutable candidate origin, policy class, and origin-to-class mapping version;
- replay-stable source-event ID;
- scenario and version;
- owner, actor, audience, config context, storage target, native target, and
  platform instance;
- normalized subject references and source-state versions;
- semantic fingerprint and lifecycle-stage identity;
- evidence time, `notBefore`, next evaluation, and expiry;
- policy version;
- deterministic reason trace;
- render/effect class;
- status and lease information.

#### Frozen payload

- candidate ID;
- renderer/version;
- exact payload;
- length/format metadata;
- content retention class;
- `renderedAt` and `renderExpiresAt`;
- semantic digest fingerprint.

The frozen payload is content-bearing and never enters anonymous stats.

#### Delivery attempt

- candidate/outbox ID;
- exact target identity;
- attempt identity;
- typed receipt;
- provider message/idempotency metadata where available;
- safe error code;
- timing;
- reconciliation/finalization state.

#### Exposure

- scenario/version;
- subject-state identity;
- audience;
- exposure kind;
- source turn/candidate;
- confirmed time;
- canonical coverage such as `mentioned`, `action_offered`, `acknowledged`, or
  `resolved`.

Exposure records are structured deduplication evidence. Conversation prose is
not.

### 6.3 Lifecycle

The shared candidate lifecycle is monotonic:

`observed → pending/held → claimed → rendered → sending → delivered → history_recorded`

Terminal or quarantined outcomes include:

- `dropped`;
- `expired`;
- `superseded`;
- `unsupported`;
- `delivery_unknown`.

Every `held` state has a named reason, next evaluation, and expiry. Every claim
has a lease and compare-and-set semantics. A crash cannot move a record
backward or make an effect eligible twice.

### 6.4 Data flow

The normative flow is:

1. load policy and perform content-free consent/scope/route prechecks;
2. create or claim one logical occurrence;
3. perform bounded source observation;
4. normalize source facts and omit unknown/unsafe data;
5. materialize stable candidate identity;
6. evaluate current authorization, privacy, novelty, freshness,
   supersession, quiet hours, workdays, delivery mode, and load;
7. choose `send`, `digest`, bounded `hold`, or terminal `drop`;
8. claim one eligible candidate/digest;
9. render deterministically and persist one frozen payload;
10. revalidate mutable policy, route, authority, source state, and expiry;
11. send the frozen payload once;
12. record a typed receipt;
13. only after confirmation, write structured exposure and exact visible
    conversation history;
14. repair finalization independently without resending.

### 6.5 Error model

Failures are typed at the boundary that knows their meaning:

- observation returns safe provider/auth/rate/normalization outcomes;
- policy returns reason-coded send/digest/hold/drop decisions;
- rendering returns deterministic validation/length failures;
- delivery returns `confirmed`, definite `failed`, `unknown`, or
  `unsupported`;
- finalization records repairable history/exposure failures.

Temporary provider or route failures may hold only within a scenario-defined
window. Authorization, privacy, scope, duplicate, resolved-state, unsupported,
or expired outcomes fail closed. An unknown delivery outcome never becomes a
blind automatic retry.

### 6.6 Execution/effect classes

The roadmap uses the following conceptual effect ladder:

| Class | Behavior                                                             | Roadmap posture                                             |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| E0    | Deterministic renderer, bounded direct reads, no model/tools/effects | Required for Phases 1–3                                     |
| E1    | Model wording, no tools                                              | Separate later approval after injection/evaluation evidence |
| E2    | Narrow allowlisted read-only enrichment                              | Separate later approval with strict step/time/cost limits   |
| E3    | Proposal only; effect happens in a normal authorized reactive turn   | Allowed pattern for later user actions                      |
| E4    | Product-owned unattended mutation                                    | Prohibited by this roadmap                                  |

`tool_prefs = ask` never authorizes an unattended run. It can only produce a
confirmation/proposal state and stop.

## 7. Phase 0 — Correctness contracts

### 7.1 Phase contract

**Goal:** repair current trust-boundary defects and establish shared contracts
that later lifecycle work can rely on.

**Relative size:** L.

**Entry:** this approved roadmap and the proactive-scenarios research.

**Exit:** affected existing paths cannot falsely claim delivery, repeat an
effect because of delivery retry, append unseen content as delivered history,
elevate untrusted metadata into privileged instructions, expose raw external
errors, or return raw subject identity through `/stats/*`.

Phase 0 is foundation, not a hidden feature release. It adds no
assistant-initiated scenario, master proactivity switch, candidate/outbox
platform, group behavior, urgency, or model-authored proactive content.

### 7.2 Product outcome

Users should not observe a new product surface. They should receive more
truthful behavior from existing proactive paths:

- an unsupported route does not pretend to succeed;
- a failed or ambiguous send does not produce an unseen conversation turn;
- retry does not repeat a task/tool effect;
- failures use stable safe language;
- revoked authority or ambiguous audience stops execution;
- analytics endpoints preserve their documented anonymity contract.

### 7.3 Workstream 0.1 — Origin and consent taxonomy (S)

Define separate `CandidateOrigin` and `PolicyClass` fields plus a versioned
origin-to-policy-class mapping shared by proactive delivery callers. Origin
records why the message exists; policy class selects the consent/control
contract. For example, `operational_failure` is an origin and maps to
`transactional` unless a separately reviewed scenario mapping says otherwise.

This taxonomy does not yet route all origins through the Phase 1 lifecycle or
collapse their existing contracts.

The Phase 0 design must enumerate every current non-turn outbound path and
classify it on both axes. Unknown origin, unknown policy class, or missing
mapping fails closed for any new reusable proactive helper. Normal reactive
replies and ephemeral live status remain outside this migration.

### 7.4 Workstream 0.2 — Typed delivery receipt (M)

Replace `boolean | void`-like proactive delivery semantics with a
discriminated result that can represent:

| Result        | Meaning                                                            | Automatic response                                                                                                         |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `confirmed`   | Provider accepted the exact payload for the exact target           | Eligible for exposure/history finalization                                                                                 |
| `failed`      | Provider definitely did not accept it                              | Retry only when the caller also proves frozen payload, live policy/authority, idempotency, and unexpired retry eligibility |
| `unknown`     | Acceptance cannot be proved                                        | Quarantine/reconcile; never blind retry                                                                                    |
| `unsupported` | Adapter/target combination cannot truthfully perform the operation | Disable or reject that route                                                                                               |

A definite failure includes a safe stable code and whether the transport
condition is retryable. A confirmation includes provider message or
idempotency metadata when available. Raw response bodies and secrets never
enter the public result.

Phase 0 must produce adapter contract tests for Telegram, Mattermost, Discord,
and Kontur Talk. Kontur Talk DM remains `unsupported` until it returns a
truthful result. This does not block the later Kaneo + Telegram vertical.

The phase-specific design must decide whether the typed receipt becomes the
base chat-provider contract or a narrower proactive-delivery capability. The
decision must minimize unrelated reactive churn while preventing proactive
callers from bypassing truth.

### 7.5 Workstream 0.3 — Effect, render, delivery, and history ordering (M)

Affected current paths adopt these invariants:

1. one logical execution/effect identity;
2. effect audit is separate from delivery outcome;
3. generated/rendered output is not proof of delivery;
4. a delivery retry never reruns generation or effects;
5. only a confirmed receipt marks a path-local delivery successful or creates
   history; the shared exposure ledger begins in Phase 1;
6. history repair after confirmed delivery is idempotent and never resends;
7. unknown delivery stays quarantined.

Phase 0 does not pre-build the general Phase 1 candidate/outbox schema. For an
existing path that cannot prove safe retry without that substrate, the safe
Phase 0 behavior is to stop automatic retry or persist the minimum frozen
artifact/effect identity in that path's existing durable record. It is not
acceptable to rerun an effect and hope provider-level deduplication catches it.

#### Selective adoption matrix

| Existing path                | Phase 0 adoption                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Scheduled deferred prompts   | Typed receipt, current-authority check, no repeat generation/effect on delivery retry, confirmed-only history |
| Alerts                       | Same delivery/history contract; static-state cooldown does not become a candidate budget                      |
| Recurring-task notifications | Typed receipt and confirmed-only history; preserve explicit user intent                                       |
| Release announcements        | Map per-recipient delivery rows to truthful receipt outcomes; preserve subscription and bounded fan-out       |
| Manual operator broadcast    | Preserve operator authority; record truthful per-target outcomes and safe errors                              |
| `/api/notify`                | Typed delivery and confirmed-only history; preserve it as a narrow trusted final-message plane                |
| Failure notices              | Stable safe wording/codes and incident-level dedup where already representable                                |
| Normal reactive replies      | No lifecycle migration required in Phase 0                                                                    |

This matrix is a behavioral minimum. The phase agent must re-audit current
callers because the baseline may have changed.

### 7.6 Workstream 0.4 — Authority, scope, and instruction boundaries (M)

Before an affected scheduled/effectful path executes, it re-resolves:

- exact active platform instance;
- exact native recipient;
- current config and storage scope;
- current owner/actor authority;
- current group membership or DM identity;
- current provider assignment and access;
- effective tool/effect permissions where applicable.

Creator provenance is not perpetual authority. Missing, revoked, blocked,
guest-only, or ambiguous authority fails closed before provider/model/tool
work.

User, task-provider, calendar, external-notify, chat, tool, plugin, MCP, and
stored metadata are untrusted. Phase 0 removes or demotes any user-derived
metadata currently placed in a privileged system/instruction channel. Tests
must prove that strings resembling policy, tool instructions, urgency, target
changes, or quiet-hours overrides remain data.

### 7.7 Workstream 0.5 — Safe errors and anonymous stats (S–M)

External/runtime failures map to stable user-safe codes and correlation IDs.
Structured logs may contain approved low-cardinality metadata, but never
credentials, headers, raw provider bodies, task/chat content, or decrypted
configuration.

Repair `/stats/subject/:id` so its response cannot contain raw:

- `storageContextId`;
- `chatUserId`;
- display name;
- another high-cardinality identity capable of reversing the subject.

Remove raw identity/display fields—including any string-capable
`displayName`—from the public response types, not merely from current values.
Serialization uses an explicit aggregate-key allowlist rather than spreading
internal objects. Schema and fuzz tests fail if an unexpected free-form or
seeded identifying field is serializable.

The response must remain aggregate-shaped and match
[`docs/architecture/overview.md`](../../architecture/overview.md)'s anonymity
contract. Seeded identifier canaries must be absent from both global and
subject responses.

Phase 0 also defines the allowed proactive metric vocabulary for later phases:
counts, reason codes, receipt state, scenario/version, timing bands, safe
platform/provider category, and approved keyed identifiers. It does not emit
candidate content.

### 7.8 Phase 0 error behavior

| Condition                              | Required behavior                                                        |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Unsupported target                     | Return `unsupported`; do not call history finalization                   |
| Definite pre-acceptance failure        | Return `failed`; retry only if every retry invariant is already provable |
| Ambiguous timeout/lost acknowledgement | Return `unknown`; quarantine                                             |
| Confirmed send, history failure        | Keep delivery truth; repair history without send                         |
| Authority revoked before execution     | Stop before provider/model/tool work                                     |
| Authority revoked before send          | Drop output; do not deliver                                              |
| Untrusted text contains instructions   | Escape/treat as data; policy/effect behavior unchanged                   |
| Raw provider/runtime error             | Log safe metadata; show stable safe user message                         |

### 7.9 Phase 0 verification matrix

The phase-specific plan must include:

- adapter-level receipt contract tests for every chat provider;
- unsupported Kontur Talk DM coverage;
- confirmed, definite failure, and unknown outcome fixtures;
- crashes before effect, after effect, before send, during send, after
  confirmation, and before history append;
- proof that delivery retry does not repeat generation or effects;
- proof that history repair does not resend;
- actor removal, membership removal, provider reassignment, platform
  replacement, guest, and sibling-context tests;
- prompt-injection-style metadata tests;
- safe user-error snapshots;
- seeded stats/log identifier and content canaries;
- public stats response-type, explicit-key allowlist, serialization, and
  free-form-field fuzz tests;
- regression tests preserving explicit reminder and announcement consent
  semantics.

### 7.10 Gate 0 evidence

Gate 0 passes only when:

- the current outbound-path inventory and classification are reviewed;
- every affected path has an explicit delivery/history/effect posture;
- platform contract tests pass;
- no test path records confirmed history without a confirmed receipt;
- no retry fixture repeats an effect;
- untrusted metadata cannot change policy/effect instructions;
- `/stats/*` identifier canaries are absent;
- public stats response types contain no raw identity/display field and reject
  unexpected free-form keys;
- logs and user-facing failures contain no forbidden content;
- unsupported routes are blocked rather than degraded.

Any unresolved `unknown` outcome is acceptable only if it is visibly
quarantined and cannot trigger a duplicate. A known false-success route is not
acceptable.

### 7.11 Fresh-agent brainstorming brief for Phase 0

**Primary design question:** how should papai introduce truthful delivery and
execution/history ordering across affected current paths without prematurely
building or forcing every origin onto the Phase 1 candidate platform?

**Locked constraints:**

- shared contracts, selective adoption;
- policy classes remain distinct;
- no new assistant-initiated product scenario;
- no broad reactive-send refactor unless the contract cannot otherwise be
  truthful;
- confirmed-only history;
- no blind retry of unknown outcomes;
- no repeated generation/effect;
- raw stats identity defect is in scope;
- Kontur DM is disabled unless made truthful.

**Phase design must resolve:**

1. the exact candidate-origin/policy-class types, mappings, and source-event
   identity;
2. the exact typed receipt API and adapter compatibility strategy;
3. the audited outbound caller inventory and per-caller adoption;
4. the minimum persistence/idempotency needed for current effectful paths;
5. how an `unknown` outcome is represented and surfaced operationally;
6. the exact history finalization/repair boundary;
7. the current authority revalidation API;
8. the instruction-role correction;
9. the safe public error taxonomy;
10. the corrected anonymous stats response;
11. migration and rollback behavior for any changed durable record.

**Required design artifacts:**

- candidate-origin/policy-class taxonomy and versioned mapping table;
- delivery contract and state diagrams;
- selective-adoption caller matrix;
- error/retry/history truth table;
- authority/scope resolution sequence;
- stats response contract;
- test and rollout plan;
- explicit list of deferred Phase 1 lifecycle work.

**Read first:** research reports 03, 05, 06, and 08 §§6–9, 11 Phase 0, 12,
and 14.

**Implementation-plan boundary:** Phase 0 only. Do not include candidate
policies, quiet hours, digest UI, task-health rendering, or Phase 1 migrations.

## 8. Phase 1 — Proactive foundation and shadow mode

### 8.1 Phase contract

**Goal:** build the complete shared assistant-initiated substrate and prove it
with deterministic no-send shadow execution.

**Relative size:** XL.

**Entry:** Gate 0 accepted, including truthful receipt and confirmed-only
history contracts.

**Exit:** policy, time, scope, occurrence, candidate, lease, outbox, delivery,
exposure, retention, settings, and shadow behavior pass deterministic tests;
real Kaneo-backed shadow observations produce stable reason-coded decisions
without rendering, sending, appending history, invoking an LLM, or executing a
mutating tool.

### 8.2 Product outcome

Phase 1 may expose an internal/default-unavailable settings surface and
content-free shadow status, but it sends no new proactive product message.
Product and engineering learn:

- whether policies resolve to exact personal DM recipients;
- whether configured time semantics behave across DST and workdays;
- whether Kaneo facts can be normalized safely enough for the first digest;
- how often candidates are empty, duplicated, held, expired, or unsupported;
- whether provider reads and lifecycle workers fit operational bounds.

Real-data shadow is not a consent bypass. It runs only for an explicitly
enrolled internal/authorized policy whose owner enabled both master and feature
controls and whose current provider authorization passes. A separate
deployment/cohort shadow flag suppresses render, send, history, and feedback;
it does not grant data access. Disabled or unenrolled policies perform no
provider read. Hermetic fixtures remain available without real-data
enrollment.

#### Required Phase 1 internal decomposition

Phase 1 is an XL umbrella, not one implementation plan. Its first fresh
brainstorming session must validate an ordered increment map and then
brainstorm only the first increment. The minimum expected decomposition is:

1. **Phase 1A — policy/time/scope foundation:** policy records, scope registry,
   authorized settings/previews, deterministic time semantics, and no
   content-bearing observation;
2. **Phase 1B — lifecycle foundation:** occurrence/candidate/outbox/receipt/
   exposure stores, leases/workers, fake-adapter lifecycle, retention, and no
   real provider observation;
3. **Phase 1C — Kaneo shadow:** explicitly enrolled real-data observation,
   backpressure, content-free metrics, and end-to-end no-send shadow evidence.

The Phase 1 brainstorming agent may adjust these boundaries when verified code
requires it, but it must preserve ordered, testable no-send increments. Each
increment receives its own approved spec, implementation plan, verification,
and committed checkpoint. Gate 1 is the aggregate exit after every accepted
Phase 1 increment; no one plan spans all Phase 1 workstreams.

### 8.3 Workstream 1.1 — Assistant policy and settings model (M)

Add a purpose-built assistant-initiated policy model containing:

- default-off assistant master control;
- default-off `daily_task_health_digest` feature control;
- exact personal DM config context;
- exact active platform instance and recipient;
- Kaneo task-provider instance;
- explicit provider-backed task scope;
- validated IANA timezone;
- selected ISO working days;
- quiet-hours enable/start/end, including cross-midnight behavior;
- local digest time;
- pause/mute state;
- optimistic policy version;
- next eligible occurrence preview;
- update/audit metadata without message content.

Configuration and delivery target remain separate even when both point to the
same DM. The policy is ineligible in a group/main/thread context. A
group-configured task instance cannot silently fan out into a member DM.

Real-data shadow eligibility is the intersection of an owner-enabled policy
and a separate deployment-controlled cohort flag. Neither substitutes for the
other. Removing either stops future provider reads and expires/supersedes
pending shadow work without releasing a backlog.

The settings surface must explain:

- the feature is read-only;
- it never wakes through quiet hours;
- the selected task scope and recipient;
- the next expected occurrence;
- why the route or scope is ineligible;
- how to pause, mute, or disable it.

No settings mutation request performs a task-provider read or sends a message.
Scope options may be populated through a separate, explicitly authorized
bounded lookup endpoint whose response is designed in the Phase 1 spec.

### 8.4 Workstream 1.2 — Time policy and occurrence engine (M–L)

Create one logical daily occurrence per:

`stable policy + recipient + daily slot + scheduled local date`

Policy version, timezone, DST rule, and calculated instant are immutable
occurrence snapshot metadata, not uniqueness inputs. Scheduler overlap,
restart, and a repeated fall-back clock hour cannot create two eligible
occurrences.

A policy/timezone edit:

- increments the policy version;
- transactionally re-evaluates an unsent occurrence;
- supersedes or reclassifies the old schedule;
- resolves a local-date conflict deterministically;
- never delivers both old and new slots.

The Phase 1 design must lock one user-visible behavior for:

- a nonexistent spring-forward local time;
- a repeated fall-back local time;
- a digest time inside quiet hours;
- crossing-midnight quiet hours;
- a timezone edit while an occurrence is held;
- a new local day arriving while an older digest is held.

Until those choices are explicit, previewed, and tested, the policy cannot be
enabled for live delivery. Phase 1 itself remains shadow-only.

### 8.5 Workstream 1.3 — Lifecycle persistence and workers (L)

Add durable logical storage for:

- policies;
- occurrences;
- candidates;
- candidate subjects/state versions;
- frozen outbox artifacts;
- delivery attempts/receipts;
- structured exposures;
- candidate-bound feedback/suppression state;
- execution/decision audit;
- retention/deletion bookkeeping.

The phase-specific design owns physical normalization and migration shape. It
must keep content-bearing artifacts separate from aggregate analytics and
conversation history.

Every new context-owned table/column must be declared in `ENTITY_SCOPES` and
pass its consistency test. The phase design explicitly documents:

- policy and feature preferences at config/group effective scope (a DM config
  context remains personal);
- candidate `configContextId` at config/group scope;
- candidate `storageContextId` at exact thread/storage scope;
- the composite relationship between policy ownership and delivery target
  rather than forcing both through one key.

Workers use durable leases and compare-and-set state transitions. They support:

- due occurrence claiming;
- held-row reevaluation;
- digest flushing;
- expired/superseded cleanup;
- unknown-outcome reconciliation hooks;
- idempotent delivery finalization/history repair.

Even though Phase 1 does not send a product message, the full lifecycle and
receipt integration must be testable with fake adapters before Phase 2.

### 8.6 Workstream 1.4 — Deterministic policy gateway (L)

Implement the three-stage order from §4.2:

1. **Before content-bearing observation:** validate schema/source
   registration, candidate-origin mapping and policy class, exact
   owner/actor/audience/target, current authorization/membership,
   master/feature controls, surface/privacy permission, current provider/task
   access and effective automatic-read permission, quiet hours/workdays, and
   an active normal turn in the exact storage context.
2. **After observation and semantic identity:** validate current source truth,
   expiry, novelty, deduplication, supersession, snooze/dismissal, digest
   admission, and interruption-load policy.
3. **Immediately before hypothetical/live send:** revalidate every mutable
   gate and every included source-state version.

The gateway returns:

- `send` for an eligible chosen-window digest;
- `digest` when an admitted item belongs to a later batch;
- bounded `hold` with next evaluation and expiry;
- terminal `drop` with a stable reason.

There is no urgent disposition. Scoring may be instrumented only as
counterfactual research; it cannot override a hard gate or send.

An exact in-process active normal turn is an optimization signal, not durable
truth. Nonurgent candidates hold until that turn completes plus a bounded
stabilization point, then consult structured reactive exposure before
re-evaluation. They are never injected into mid-run steering. Candidate leases
and the outbox, not the process-local run registry, remain the durable
concurrency guarantee.

### 8.7 Workstream 1.5 — Exposure and suppression model (M)

Add structured exposure identity across:

- confirmed proactive delivery;
- normal reactive turns;
- acknowledgement;
- resolution;
- candidate-bound feedback.

Reactive code writes privacy-minimal subject/state/audience coverage such as:

- `mentioned`;
- `action_offered`;
- `acknowledged`;
- `resolved`.

It emits an exposure only from structured provenance:

- a successful typed task-tool effect;
- a typed candidate/action included in the final response plan;
- an explicit candidate-bound user acknowledgement.

It never parses user or assistant prose and never invokes an LLM to infer
coverage. If exact subject, state, lifecycle, and audience cannot be proved,
write no exposure and do not suppress a proactive candidate.

This writer must not copy response prose. A recent exposure suppresses a
candidate only when the scenario's explicit semantic identity says the same
subject state and audience were already covered. A materially newer source
state can become eligible under a new state identity.

Snooze/dismiss storage exists in Phase 1 so identity is correct from the
beginning. Rich Telegram controls ship in later phases.

### 8.8 Workstream 1.6 — Kaneo shadow observation (M)

Implement only the bounded Kaneo facts needed to exercise the foundation:

- stable task and project references;
- due date;
- provider-declared or explicitly configured final/cancelled mapping;
- explicitly mapped in-progress state;
- stable assignee/account identity if Kaneo proves one;
- provider link/reference;
- state/version evidence sufficient for bounded revalidation.

The shadow detector may create a
`daily_task_health_digest.v1` candidate containing normalized references and
reason labels. It does not render task titles into a user message and it
cannot invoke an LLM, general tools, plugins, MCP, web fetch, calendar, or
task mutation.

Unknown finality/status is omitted and counted by a safe normalization reason.
If no stable assignee identity exists, shadow scope is explicitly project
scope. That does not block Phase 2's project digest, but it blocks Phase 3
individual ownership prompts.

### 8.9 Workstream 1.7 — Shadow observability and retention (M)

Shadow mode records content-free:

- eligible/empty/suppressed counts;
- gate and drop/hold reasons;
- unknown status/finality count;
- expected section sizes and overflow bands;
- duplicate occurrence/candidate attempts;
- provider call duration/rate-limit outcomes;
- quiet-hours/workday deferral/expiry;
- route/platform eligibility;
- lease conflicts and crash recovery;
- counterfactual visible interruption load.

Observation and delivery infrastructure is backpressure-safe before canary:

- bounded global and per-provider-instance concurrency using the repository's
  bounded-concurrency pattern;
- explicit request/page/item/byte/time limits;
- provider `Retry-After` handling and jittered bounded backoff;
- provider-instance circuit breaking;
- maximum backlog age and candidate expiry;
- load shedding that expires/drops stale work instead of building a burst;
- no unbounded `Promise.all` over remote operations.

The Phase 1 design must choose and document:

- content-bearing candidate/outbox retention;
- decision/receipt audit retention;
- aggregate retention;
- deletion cascades for user/group removal, provider disconnect, policy delete,
  and account erasure;
- authorized debug/audit access.
- concrete concurrency, request/page/byte/time, backoff, circuit, and
  backlog-age bounds.

No live delivery may begin until those choices are locked. The fail-closed
default is to keep content-bearing retention minimal and prevent delivery when
required audit/retry state cannot be retained safely.

### 8.10 Phase 1 normative shadow flow

1. Scheduler identifies one due logical local-date slot.
2. Content-free policy, route, actor, scope, and time pre-gates run.
3. Worker claims the occurrence with a lease.
4. A bounded Kaneo read returns normalized safe facts.
5. Stable candidate identity and subject-state references are persisted.
6. Reactive/proactive exposure and current source state are compared.
7. Gateway calculates send/digest/hold/drop and a reason trace.
8. Shadow records the counterfactual decision and releases/finalizes the
   lifecycle.
9. No renderer, send, history append, user feedback, model, or effect occurs.

### 8.11 Phase 1 error behavior

| Condition                         | Shadow behavior                                     |
| --------------------------------- | --------------------------------------------------- |
| Master/feature off                | Drop before provider read                           |
| Shadow enrollment/cohort absent   | Drop before provider read                           |
| Group or ambiguous target         | Drop before provider read                           |
| Provider assignment/auth revoked  | Drop with safe reason                               |
| Effective read is `deny` or `ask` | Drop before provider read                           |
| Transient Kaneo failure           | Bounded hold if still useful before expiry          |
| Unknown status/finality           | Omit affected item and count safe reason            |
| Duplicate local occurrence        | Existing occurrence wins                            |
| Policy edit while held            | Reclassify/supersede transactionally                |
| Worker crash after claim          | Lease recovery resumes monotonic state              |
| New day while old digest held     | Old occurrence expires/supersedes; no backlog burst |
| Route becomes unsupported         | Drop/unsupported; no fallback target                |
| Exact context has active turn     | Bounded hold; recheck exposure after turn completes |

### 8.12 Phase 1 verification matrix

The phase plan must cover:

- IANA zones with and without DST;
- missing and repeated local times;
- quiet hours within one day and across midnight;
- nonstandard working weeks;
- policy/timezone/scope edits before occurrence, while held, and after
  hypothetical render;
- duplicate ticks, restarts, two workers, lease expiry, and every crash
  boundary;
- DM eligibility and group/main/thread rejection;
- owner-enabled shadow enrollment plus deployment-cohort removal/re-addition;
- platform replacement/deactivation and recipient removal;
- provider removal, credential revocation, permission narrowing, and project
  scope changes;
- effective read `allow → deny/ask` changes before observation and before
  hypothetical send;
- sibling storage/config-context collisions;
- `ENTITY_SCOPES` declarations and consistency coverage for every new
  context-owned entity;
- stable candidate identity and semantic deduplication;
- reactive exposure suppression and materially newer state;
- active normal-turn hold and post-turn exposure re-evaluation;
- Kaneo pagination, truncation, rate limit, missing fields, duplicate tasks,
  invalid links/dates, and unknown statuses;
- production-shaped shadow load, `Retry-After`, circuit-open/recovery,
  backlog-expiry, and load-shedding behavior;
- retention and deletion cascades;
- content/identity canaries in logs, stats, and settings status;
- proof of zero send/history/model/tool/effect in shadow.

### 8.13 Gate 1 evidence

Gate 1 passes only when:

- Gate 0 behavior remains green;
- policy and settings authorization are complete;
- DST, workday, quiet-hours, and edit semantics are explicit and tested;
- one logical occurrence exists per policy/recipient/local date;
- lease/crash/concurrency tests preserve monotonic lifecycle;
- exact scope and target gates fail closed;
- every new context-owned entity passes the scope-registry consistency test;
- direct Kaneo observation occurs only under current effective `allow`;
- Kaneo shadow facts have an accepted normalization contract;
- unknown status/finality rates are measured and within a product-declared
  bound for canary readiness;
- shadow produces no duplicate eligible candidates;
- unenrolled or disabled policies produce no real provider read;
- bounded concurrency/backpressure tests prevent provider or worker overload
  and stale backlog release;
- shadow produces no user-visible messages, history, model calls, or effects;
- retention/deletion and content-free metrics pass privacy review;
- Telegram's Phase 0 receipt contract remains truthful under lifecycle tests.

### 8.14 Fresh-agent brainstorming brief for Phase 1

**Primary design question:** how should papai add a durable, general
assistant-initiated policy and candidate substrate that fits its current scope
registry and scheduler while remaining completely no-send in this phase?

The first Phase 1 session validates the internal increment map in §8.2 and
fully brainstorms **Phase 1A only**. Later fresh sessions use the accepted
checkpoint to brainstorm 1B and then 1C.

**Locked constraints:**

- Gate 0 contracts are inputs, not reopened casually;
- sequential foundation-first;
- personal DM policies only;
- default-off master and feature;
- no urgent lane;
- settings-only durable configuration;
- full occurrence/candidate/outbox/receipt/exposure lifecycle;
- durable leases and monotonic state;
- structured, not prose-based, deduplication;
- Kaneo shadow observation is read-only and deterministic;
- zero new user-visible proactive messages.

**Phase design must resolve:**

The accepted increment map assigns every item below exactly once, except when
it explicitly partitions a cross-cutting contract. The expected ownership is
1A for items 1–3 and 8, 1B for items 4–6 and lifecycle retention in item 10,
and 1C for items 7, 9, 11–12 and provider-observation retention in item 10. A
fresh session resolves only its increment's assigned decisions; later items
appear here to make the aggregate Gate 1 contract complete.

1. physical schema, migration order, and repository boundaries;
2. `ENTITY_SCOPES` declarations and exact policy-owner/config/storage/native
   target representation;
3. DST and policy-edit semantics;
4. scheduler integration versus a separate lifecycle worker;
5. lease, retry, supersession, and reconciliation algorithms;
6. the structured reactive exposure writer;
7. the minimal Kaneo normalization/revalidation contract;
8. the settings API and authorization model;
9. owner consent plus deployment-controlled shadow enrollment;
10. retention/deletion periods and audit access;
11. concurrency, page/byte/time, retry-after, circuit, and load-shedding
    bounds;
12. shadow rollout, metrics, and Gate 1 thresholds.

**Required design artifacts:**

- component and dependency boundaries;
- logical/physical data model;
- lifecycle and policy-edit state diagrams;
- policy precedence and reason catalogue;
- settings/API contract;
- Kaneo shadow normalization contract;
- concurrency/crash/recovery model;
- privacy/retention model;
- test and shadow-rollout plan;
- explicit Phase 2 handoff.

**Read first:** research reports 02–06 and 08 §§5–8, 11 Phase 1, 12, and
13.1.

**Implementation-plan boundary:** one accepted Phase 1 internal increment
only. Do not write one implementation plan spanning Phase 1A–1C. Do not
implement live digest rendering, Telegram feedback, canary sends, deadline
scenarios, calendar, or group delivery.

## 9. Phase 2 — Kaneo + Telegram task-health digest

### 9.1 Phase contract

**Goal:** prove that papai can send one wanted, accurate, predictable
assistant-initiated message on an allowed workday without crossing consent,
scope, privacy, delivery, or trust boundaries.

**Relative size:** L.

**Entry:** Gate 1 accepted, including stable Kaneo shadow normalization and a
truthful Telegram receipt.

**Exit:** the default-off Kaneo + Telegram canary passes both:

1. a zero-tolerance safety/correctness gate; and
2. predeclared usefulness and opt-in retention gates.

Failure of either layer stops expansion.

### 9.2 Product outcome

An opted-in user receives at most one task-health digest for the configured
eligible workday. It is a deterministic orientation view of a selected Kaneo
scope:

- open overdue tasks;
- open tasks due today;
- explicitly mapped in-progress tasks.

The digest does not rank importance, infer urgency, shame the user, mutate a
task, or start an autonomous plan. It explains why each item appears and where
the feature is controlled.

### 9.3 Eligibility

An occurrence can proceed only when all conditions are true:

1. assistant proactivity master control is enabled;
2. `daily_task_health_digest` is enabled;
3. policy belongs to a personal DM config context;
4. exact Telegram platform instance and exact DM recipient are active;
5. assigned Kaneo task-provider instance is active and accessible;
6. current effective automatic-read permission for the exact Kaneo operation
   is `allow`;
7. user selected an explicit provider-backed task scope;
8. current local date is a selected working day;
9. one logical occurrence has not already been consumed for that local date;
10. current time is inside the allowed delivery window and outside quiet
    hours, or bounded deferral remains useful before expiry;
11. Telegram delivery and payload constraints remain supported.

Content-free policy, route, authority, and time gates run before a Kaneo read.
Mutable eligibility, source truth, and expiry run again immediately before
send.

### 9.4 Kaneo scope and normalization contract

The initial scope is one or more explicitly selected Kaneo projects.

If Phase 1 proves a stable Kaneo assignee/account identifier, the user may
optionally narrow selected projects to that identity. A display name,
username-like label, or chat identity comparison is never enough.

If stable assignee identity is absent:

- the digest remains project-scoped;
- UI and message label it as a project/workspace digest;
- it never says "your tasks";
- Phase 3 person-specific deadline prompts remain blocked.

Only structured normalized state is eligible:

- **Overdue:** not final/cancelled and due date is before current recipient
  local date.
- **Due today:** not final/cancelled and due date equals current recipient
  local date.
- **In progress:** explicitly mapped in-progress state and not already in the
  prior groups.

Unknown finality/status omits the item and records a safe reason. The first
digest does not use descriptions, comments, labels, or title semantics to
infer priority, staleness, difficulty, instructions, or urgency.

Provider pagination, truncation, duplicate tasks, invalid dates, invalid URLs,
and partial project access have explicit fail-closed behavior. A response that
cannot prove complete-enough bounded scope for the declared digest is held or
dropped, not presented as a complete view.

### 9.5 Deterministic content contract

The one-message digest contains:

- recipient-local date;
- exact selected scope label;
- separate overdue, due-today, and in-progress sections;
- escaped task title;
- project label;
- due date where present;
- safe Kaneo link or stable reference;
- deterministic reason label for every item;
- overflow count;
- feature/provenance footer;
- next expected delivery and settings-management cue.

Initial bounds are:

- at most five overdue items;
- at most five due-today items;
- at most five in-progress items;
- due date then stable task ID ordering;
- at most 1,800 UTF-16 code units after rendering;
- exactly one Telegram send.

Shadow distributions may lower the item or length bounds before canary. An
increase requires explicit payload/platform evidence and a phase-spec
amendment before live use.

The renderer shortens bounded display fields and increases overflow counts
before violating the cap. It never asks an LLM to choose which items disappear.
It never splits the digest. A later multipart design would require per-part
receipts, resumability, partial-history semantics, and a separate design.

Kaneo links must be validated HTTPS URLs on the configured/approved Kaneo
provider host. Reject URLs with credentials, newlines, mismatched hosts,
non-HTTPS schemes, or active schemes such as `javascript:`/`data:`. Task and
project display fields normalize or visibly escape bidi and zero-width control
characters so untrusted Unicode cannot spoof layout, labels, or links.

If every section is empty, the occurrence ends with `DROP_EMPTY_DIGEST`. No
"all clear" message is sent.

### 9.6 Execution and interaction contract

The digest is E0 deterministic/read-only:

- bounded Kaneo reads only;
- no model call;
- no general toolset;
- no MCP or plugins;
- no web fetch;
- no calendar;
- no memory write;
- no automatic task creation/edit/assignment/reschedule/completion/deletion;
- no new schedule;
- no urgent classification or quiet-hours bypass.

Task/provider strings cannot alter layout, policy, audience, links, or
instructions. Markdown, mentions, control-like text, and prompt-injection-like
titles are escaped.

The message may link to Kaneo and invite a normal reply. A task change begins a
normal reactive turn with current `tool_prefs`, confirmation, steering, and
run control.

Phase 2 adds minimal candidate-bound Telegram feedback:

- `Useful`;
- `Not useful`.

The callback is recipient-bound, candidate-bound, versioned, expiring, and
idempotent. It is also bound to the action, platform instance, native
context/thread, confirmed receipt message ID, nonce, current policy version,
and current source-state version. Current actor/policy authorization is checked
again on use. Pre-receipt, forwarded, cross-instance/context, stale, and
replayed callbacks fail safely. It records product feedback only. Snooze,
dismiss, mute-subject, ownership-mismatch, and task actions remain Phase 3.

### 9.7 Settings contract

The settings surface shows:

- assistant-proactivity master switch, default off;
- daily task-health digest switch, default off;
- exact Telegram recipient/platform;
- exact Kaneo provider and selected project/optional stable-assignee scope;
- validated timezone;
- working-day multiselect;
- local digest time;
- quiet-hours range and cross-midnight preview;
- pause/mute state;
- next eligible delivery preview;
- plain-language read-only/no-quiet-hours-bypass promise;
- recent content-free delivered/suppressed/failed/unknown status;
- safe ineligibility reasons.

The surface cannot reveal task content to a settings viewer who lacks the
underlying task scope. Saving settings reclassifies pending candidates
transactionally but does not read Kaneo or send.

### 9.8 Normative delivery flow

1. Claim one due occurrence.
2. Re-run content-free policy/authority/route/time gates.
3. Perform bounded fresh Kaneo reads.
4. Normalize and omit unsafe/unknown items.
5. Compare structured reactive/proactive exposure.
6. Materialize/update one semantic digest candidate.
7. Apply freshness, deduplication, active-turn, quiet-hours, workday, and
   expiry policy.
8. Render one bounded escaped message.
9. Persist the frozen payload and render expiry.
10. Revalidate policy, route, actor, effective read permission, scope, and
    every included task state.
11. Send the frozen payload once through Telegram.
12. Record the typed receipt.
13. On confirmation, record structured exposure and exact visible history.
14. If history finalization fails, repair it idempotently without resending.

A definite transport retry may reuse the exact frozen payload only while:

- its render TTL is active;
- current policy/route/authority remain valid;
- every included subject state version still matches;
- the delivery attempt is definitely known not to have been accepted;
- idempotency requirements are satisfied.

Retry does not rerun observation, selection, rendering, model work, or effects.
Changed/unproved state supersedes or drops the artifact.

### 9.9 Failure behavior

| Condition                                             | Required outcome                                            |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| Empty normalized digest                               | Drop; no "all clear"                                        |
| Unknown finality/status                               | Omit item; count normalization reason                       |
| Due date/status/access changes before send            | Supersede/drop stale payload                                |
| Transient Kaneo failure within useful window          | Bounded hold                                                |
| Kaneo failure after useful window                     | Expire/drop                                                 |
| Telegram definite failure                             | Eligible for exact-payload retry only under all retry gates |
| Telegram unknown outcome                              | Quarantine/reconcile; no blind retry/history                |
| Payload still over cap after deterministic shortening | Drop render failure; no multipart fallback                  |
| Telegram route deactivated/reassigned                 | Drop; no broader fallback                                   |
| Confirmation succeeds, history fails                  | Keep delivery truth; repair history only                    |
| User disables feature while candidate held            | Drop/reclassify before further provider work                |
| Exact DM has an active normal turn                    | Hold; then recheck exposure and every mutable gate          |

### 9.10 Rollout

Rollout is reversible and cohort-bounded:

1. **Offline fixtures:** curated Kaneo task-state and rendering fixtures.
2. **Content-validating shadow:** real authorized data, no payload delivery or
   conversation history; authorized content audit is separate from aggregate
   metrics.
3. **Internal allowlist:** explicit staff/test recipients only.
4. **Small opt-in canary:** default off; every recipient opts in.
5. **Controlled expansion:** only after Gate 2 review.

Every delivered message states why it was sent and where to control it.

### 9.11 Safety/correctness gate

The canary target is zero for:

- wrong recipient, context, platform, or provider scope;
- guest, membership, or permission violation;
- task outside selected scope;
- quiet-hours or non-working-day violation;
- unsupported/false-success delivery;
- duplicate visible occurrence;
- stale/resolved/final task;
- effect or model/tool execution;
- prompt-influenced policy/layout;
- history without confirmed delivery;
- task/chat/rendered content or raw identity in logs/stats;
- secret/raw provider error exposure.

Additionally:

- every audited item traces to current selected-scope Kaneo state at render
  time;
- at most one message from this feature is visible per eligible workday;
- unknown outcomes are rare enough to manage without unsafe retry;
- provider/read/delivery latency fits the declared window;
- declared provider/send concurrency, page/byte/time, retry-after, circuit,
  backlog-age, and load-shedding bounds hold at production-shaped canary load;
- no content/source audit discrepancy remains unresolved.

Any zero-tolerance event pauses the affected cohort/platform/provider
immediately.

### 9.12 Product gate

Before the live canary, product and engineering must declare:

- cohort definition;
- observation window;
- minimum rated-delivery sample;
- usefulness measure and pass threshold;
- early mute/opt-out threshold;
- opt-in retention measure and pass threshold;
- outcome horizon for meaningful follow-up task action;
- treatment of unrated deliveries;
- expansion and stop rules.

The roadmap does not invent numeric constants unsupported by evidence. The
Phase 2 design must lock them before sending to the canary. Without locked
thresholds or sufficient evidence, expansion is blocked.

The gate considers:

- useful versus not-useful ratings;
- mute/pause/opt-out after first and repeated deliveries;
- 7/30-day opt-in retention where the cohort horizon supports it;
- meaningful task action after delivery without claiming causality;
- direct interruption count;
- qualitative content/source audit.

Clicks and raw reply rate are not success proxies.

### 9.13 Phase 2 verification matrix

The phase plan must cover:

- every Gate 1 time/scope/concurrency fixture under live-send simulation;
- overdue/due-today date boundaries in recipient timezone;
- final/cancelled/in-progress mappings;
- due date cleared/moved and task completed/deleted/access-revoked before
  send;
- unknown statuses and partial provider results;
- duplicate task across projects/pages;
- missing/invalid dates, links, titles, and project labels;
- task text containing Markdown, mentions, control syntax, or instructions;
- URL property/fuzz cases covering credentials, newlines, scheme/host
  mismatch, encoded active schemes, and redirect-like display text;
- Unicode property/fuzz cases covering bidi/zero-width controls, entities,
  Markdown, and length-boundary normalization;
- deterministic ordering, item caps, code-unit cap, and overflow;
- empty digest;
- reactive exposure before render and while held;
- current-state revalidation and artifact supersession;
- Telegram confirmation, definite failure, unknown, callback, and callback
  replay/forwarding/cross-instance/context/pre-receipt use;
- crash before/after render, during send, after confirmation, and before
  exposure/history;
- two workers claiming the same occurrence;
- feature/policy/route/provider changes at every boundary;
- effective read permission changing from `allow` to `deny`/`ask` before read,
  after render, and before retry;
- no content/identity in logs/stats/settings status;
- history repair without resend;
- rollback/kill-switch behavior for each rollout cohort.
- production-shaped concurrent occurrence/provider/send load, rate limiting,
  `Retry-After`, circuit breaking, stale-backlog expiry, and recovery.

### 9.14 Gate 2 evidence

Gate 2 passes only when:

- Gate 1 remains green under production-like delivery;
- safety/correctness gate has zero violations;
- every frozen product denominator, sample requirement, observation horizon,
  and threshold declared before the canary is met;
- content/source audit passes;
- duplicate, failed, unknown, and history-repair outcomes are reviewed;
- operational cost/latency remains bounded;
- production-scale backpressure/load tests and canary bounds pass;
- the evidence packet records either an accepted stable Kaneo
  assignee-to-recipient proof contract plus successful capability probe, or an
  explicit `absent`/`unresolved` result that blocks Phase 3 without blocking
  the project-scoped Phase 2 digest;
- product and engineering jointly recommend expansion.

A narrow or negative product result may lead to revised scope/cadence/content
and another bounded canary. It does not authorize a broader scenario or LLM
ranking.

### 9.15 Fresh-agent brainstorming brief for Phase 2

**Primary design question:** how should the proven Phase 1 substrate deliver
one deterministic Kaneo project/task-health digest through Telegram and
measure whether it is both safe and wanted?

**Locked constraints:**

- Kaneo + Telegram first;
- personal DM only;
- default-off master and feature;
- explicit project scope; stable assignee only if proved;
- overdue/due-today/in-progress structured facts;
- deterministic E0 renderer;
- one bounded message, initial 5/5/5 and 1,800-code-unit hypotheses;
- empty means no send;
- no LLM/tools/effects/calendar/group/urgent behavior;
- Useful/Not useful candidate-bound feedback only;
- staged rollout;
- two-layer gate.

**Phase design must resolve:**

1. exact Kaneo project and optional assignee picker contract;
2. accepted final/cancelled/in-progress normalization;
3. bounded read/pagination/completeness rules;
4. exact source-state revalidation strategy and cost;
5. renderer/escaping/link/length behavior;
6. Telegram receipt, idempotency, callback, and unknown reconciliation;
7. payload/content retention;
8. canary cohort, sample, thresholds, and feedback analysis;
9. operational kill switch and rollback;
10. Gate 2 evidence report format.

**Required design artifacts:**

- complete user stories and eligibility rules;
- Kaneo normalization contract and fixtures;
- settings/API UX contract;
- digest rendering specification;
- delivery/retry/finalization sequence;
- Telegram callback authorization model;
- privacy and retention model;
- test matrix;
- shadow/canary/expansion protocol;
- predeclared product and safety gates.

**Read first:** research reports 01–08, with special attention to 08 §§3–8,
11 Phase 2, 12, and 13.

**Implementation-plan boundary:** Phase 2 only. Do not add first-overdue,
pre-deadline, snooze/dismiss, calendar, another task provider/platform, group
delivery, urgent delivery, or model-authored copy.

## 10. Phase 3 — Staged deadline lifecycle

Phase 3 is intentionally split into two separate design/plan/development
cycles. Gate 3A is required before Phase 3B brainstorming begins.

### 10.1 Shared Phase 3 objective

Prove that papai can turn a structured task-state transition into a
nonpunitive, lifecycle-aware recovery prompt without static-predicate nagging,
wrong-audience delivery, stale delivery, or autonomous mutation.

Phase 3 remains:

- personal DM only;
- Kaneo + Telegram first;
- default off;
- ordinary/digest or next-work-window delivery;
- no urgent lane;
- no quiet-hours bypass;
- E0 deterministic/read-only;
- propose/reactive for any task change.

### 10.2 Deadline controls

Deadline behavior has settings-owned, independently default-off controls:

- assistant-proactivity master;
- `task_deadline_recovery` feature;
- `first_overdue` stage;
- `one_day_before` stage, introduced only in Phase 3B.

Phase 3A requires master, feature, and first-overdue stage enabled. Phase 3B
does not silently enable pre-deadline behavior for existing Phase 3A users;
the new stage requires explicit opt-in. Settings show each stage, its delivery
mode, task/person scope, mute state, next eligible window, and recent
content-free status. Global, provider, platform, cohort, feature, and stage
kill switches are independently enforceable and revalidated before
observation/send.

Candidate-bound callbacks may write only authenticated feedback or
suppression commands through the same policy service. A scenario/task mute
becomes visible and reversible in settings; the callback is not a general chat
configuration API and cannot alter audience, scope, schedule, urgency, or task
state.

### 10.3 Shared deadline observation model

Phase 3 adds provider/config-scoped normalized observation sufficient to
identify deadline lifecycle transitions:

- stable task/project ID;
- stable selected audience/assignee identity accepted by Gate 2;
- due-date value and due-date version;
- normalized final/cancelled state;
- normalized open/in-progress state;
- source state version/evidence time;
- tombstone for disappearance/deletion/access loss;
- last observed lifecycle stage;
- supersession/resolution evidence.

Polling is shared per provider/config scope and fans normalized evidence into
eligible policies. It must not multiply provider reads by every thread or
candidate. Provider webhooks are not required for Phase 3.

Static `overdue = true` is not event identity. The lifecycle identity includes:

`provider + task + due-date version + audience + scenario stage`

A reschedule creates a new due-date version and supersedes pending old stages.
Completion, cancellation, deletion, access loss, or due-date removal resolves
or drops them.

### 10.4 Person-specific eligibility

An individual deadline prompt is eligible only when:

- Kaneo exposes a stable assignee/account identity;
- that identity is mapped to the exact Telegram recipient under the proof
  contract accepted in the Gate 2 packet; and
- the proof and mapping remain current at observation and delivery.

Project visibility alone is not personal ownership. If the complete proof is
unavailable, Phase 3 remains blocked even if the project digest succeeded.

An exact-task subscription is not an alternative hidden inside Phase 3A. It
would require a separate prerequisite brainstorming, design, implementation
plan, development increment, and accepted gate defining who may subscribe,
what task visibility proves, how subscriptions expire, and how assignment
changes behave. Until that prerequisite is accepted and this roadmap is
amended, the stable Gate 2 assignee proof is the only admitted ownership path.

Current recipient, identity mapping, policy, provider access, assignment, and
source state are rechecked before delivery.

## 11. Phase 3A — First-overdue recovery

### 11.1 Phase contract

**Goal:** emit one useful first-overdue recovery candidate for one eligible
task lifecycle and add authenticated candidate-bound control/feedback.

**Relative size:** M–L.

**Entry:** Gate 2 is accepted and its evidence packet explicitly certifies the
stable Kaneo assignee-to-recipient proof contract and successful capability
probe. If the packet records the capability as absent or unresolved, Phase 3A
is blocked; its brainstorming cycle must not invent a subscription path.

**Exit:** first crossing, resolution, rescheduling, retry, feedback, and
authority tests prove that a lifecycle stage is visible at most once and never
for a stale, resolved, inaccessible, or unauthorized-audience task; a separate
two-layer safety/usefulness review accepts the scenario.

### 11.2 Trigger and candidate identity

The trigger is the first observed transition from eligible open/not-overdue to
eligible open/overdue in the recipient's local-date semantics.

The candidate key is conceptually:

`Kaneo task + due-date version + recipient + overdue-first-crossing`

Repeated polls, worker restarts, cooldown expiry, or a still-overdue state do
not create another candidate. A new due-date version may create a new future
lifecycle only after the prior one is explicitly superseded.

#### Bootstrap and observation-continuity baseline

First crossing requires continuous trusted observation, not merely the first
time papai notices an overdue predicate. For each policy, provider scope,
audience, and due-date version, papai establishes or re-establishes a baseline
after:

- initial feature or stage enablement;
- provider connection or authorization establishment;
- reconnect after a gap longer than the accepted observation-freshness bound;
- a long outage or incomplete/truncated provider read;
- timezone or ownership-mapping change;
- disable then re-enable; or
- a new task/due-date version first entering observation.

A task already overdue at baseline creates only an observed-overdue baseline
record. This includes a task first discovered overdue and a task created with
a due date already in the past. It creates no first-crossing candidate and is
never backfilled. Only a due-date version observed eligible, open, and
not-overdue under accepted continuous coverage, and later observed crossing
to overdue without a coverage gap, may create the stage candidate.

After a continuity break, papai establishes a new baseline and waits for a
future provable lifecycle. It does not infer what happened during the gap. A
rescheduled due-date version can become eligible only after that version has
itself been observed not overdue. The Phase 3A design must freeze the
observation-freshness and outage bounds before canary; an unresolved or
exceeded bound fails closed to baseline-only behavior.

### 11.3 Product behavior

The prompt is delivered in the next permitted work-window digest. It is not an
immediate wake-up and does not bypass quiet hours.

The candidate enters the shared digest pipeline; it does not create a second
standalone message in a work window. If that work window's digest has already
been confirmed, the candidate waits for the next eligible digest only while
its source state and scenario expiry remain useful. Otherwise it expires.

Copy is deterministic, factual, and nonpunitive:

- state what became overdue;
- show selected scope/project and due date;
- link to the task;
- explain why papai surfaced it;
- offer recovery directions such as discussing rescheduling, reducing scope,
  or identifying a blocker;
- show controls.

It does not automatically reschedule, reduce scope, comment, reassign,
complete, or create another task. Any such action begins a normal reactive
turn and uses current `tool_prefs`, confirmation, and run control.

### 11.4 Candidate-bound actions

Telegram actions include:

- snooze to an allowed future time;
- dismiss this lifecycle stage;
- mute this scenario;
- mute this task subject where product policy permits;
- already knew;
- not mine / ownership mismatch;
- useful;
- not useful.

Action tokens are:

- opaque or signed;
- bound to candidate, action, actor, platform instance, native context/thread,
  confirmed receipt message ID, nonce, policy version, and source-state
  version;
- short-lived according to the Phase 3A design;
- one-use/idempotent as appropriate;
- checked against current actor authorization, policy, candidate, and source
  state;
- rejected when forwarded, stale, already consumed, unauthorized, or
  superseded, including cross-instance/context and pre-receipt use.

Snooze never extends beyond scenario expiry without creating a new explicit
user-scheduled promise. Unmuting does not release a backlog burst. Dismissal
prevents regeneration of the same lifecycle stage but preserves audit state.

`Not mine / ownership mismatch` is subjective relevance feedback from a
recipient who passed the current authorization and assignee-proof checks. It
suppresses the candidate/subject for that recipient and produces a
privacy-minimal review signal. It does not automatically assign the task to
someone else.

An actual delivery to an unauthorized recipient or audience is a
zero-tolerance safety violation, not a product-feedback rate. It triggers the
automatic stop policy in §15.3 even if the recipient did not use the
ownership-mismatch action.

### 11.5 Interruption-load observation

Phase 3A records counterfactual cross-scenario recent-load pressure in shadow:

- digest deliveries;
- first-overdue candidates;
- recent reactive exposures;
- snoozed/dismissed items.

It does not enforce a universal numeric budget unless Phase 3A evidence and a
separate approved rule justify one. Existing source cooldowns remain separate
guards, not substitutes for lifecycle identity.

### 11.6 Failure behavior

| Condition                                | Required outcome                                     |
| ---------------------------------------- | ---------------------------------------------------- |
| Still overdue on later poll              | No new candidate                                     |
| Completed/cancelled/deleted/inaccessible | Resolve/drop pending candidate                       |
| Due date cleared/moved                   | Supersede old due-version candidate                  |
| Assignee/ownership changes               | Re-evaluate audience; wrong recipient cannot receive |
| First observation is already overdue     | Record baseline only; no candidate/backfill          |
| Task is created already past due         | Record baseline only; no candidate/backfill          |
| Coverage gap exceeds freshness bound     | Rebaseline; do not infer or backfill a crossing      |
| Timezone changes or feature re-enables   | Rebaseline; no synthetic crossing                    |
| Snooze expires after source resolved     | Drop; do not deliver                                 |
| Dismissed stage observed again           | Suppress same lifecycle identity                     |
| Feedback token stale/forwarded           | Reject safely; no state mutation                     |
| Task action requested                    | Start normal reactive flow; no background mutation   |
| Several deadline candidates coincide     | Batch/cap according to digest policy; no burst       |

### 11.7 Phase 3A verification

The plan must cover:

- first crossing and repeated static overdue polls;
- due date, status, finality, assignment, and access changes;
- reschedule before candidate, while held, after render, and after exposure;
- completion/deletion/tombstone behavior;
- duplicate observations and out-of-order provider results;
- initial enablement, provider reconnect, long outage, incomplete reads,
  timezone change, disable/re-enable, and observation-freshness boundaries;
- tasks first discovered overdue and tasks created already past due;
- accepted assignee-to-recipient proof, subjective ownership-mismatch
  feedback, and actual unauthorized-audience paths as separate cases;
- default-off master/feature/stage controls, independent kill switches, and
  enable→disable races before observation/send;
- snooze, dismiss, mute, unmute, already-knew, and rating actions;
- action replay, forwarding, cross-instance/context use, pre-receipt use,
  nonce reuse, expiry, version mismatch, and race with delivery;
- reactive exposure before/after candidate;
- multi-candidate batching/capping;
- deterministic tone/content fixtures;
- no LLM/tool/effect in the proactive path;
- all Phase 2 receipt/crash/privacy tests.

### 11.8 Gate 3A evidence

Before the first Phase 3A canary message, the approved phase design freezes
the cohort, denominators, observation horizon, minimum rated and total
samples, treatment of unrated deliveries, and thresholds for usefulness,
ownership-mismatch feedback, dismissal, mute, and retained opt-in. Gate 3A
uses those unchanged criteria. Insufficient sample or horizon means `hold`;
results cannot be used to redefine a passing denominator.

Gate 3A passes only when:

- every eligible due-version/stage is visibly delivered at most once;
- every delivered first-overdue item has a continuously observed
  not-overdue-to-overdue transition under the frozen freshness contract;
- source changes supersede deterministically;
- no resolved, stale, unauthorized, or wrong-audience prompt is delivered;
- feedback state is durable and cannot regenerate the same stage;
- no task mutation occurs outside a normal authorized turn;
- feature/stage controls and kill switches fail closed at every boundary;
- interruption load remains bounded;
- zero-tolerance safety invariants hold;
- all frozen product denominators, samples, horizons, and usefulness,
  ownership-mismatch, dismiss, mute, and retention thresholds pass;
- tone review finds no punitive or misleading claims.

### 11.9 Fresh-agent brainstorming brief for Phase 3A

**Primary design question:** how should papai detect one trustworthy first
overdue transition and let the exact recipient control that candidate without
turning a static overdue predicate into a nag loop?

**Locked constraints:**

- Phase 2 substrate and gates remain;
- consume and revalidate the stable assignee-to-recipient proof certified by
  Gate 2; absence of that proof blocks this phase;
- exact-task subscription is out of scope unless a separately approved
  prerequisite and roadmap amendment already exist;
- next-work-window/digest delivery, not immediate;
- one first-crossing candidate per due-date version/stage/audience;
- baseline-only behavior for initially overdue tasks or continuity gaps;
- deterministic nonpunitive copy;
- authenticated candidate-bound feedback;
- settings-owned feature/stage controls with callback suppression reflected in
  settings;
- no automatic task mutation;
- interruption-load measurement before enforcement.

**Phase design must resolve:**

1. Kaneo observation/tombstone and due-version algorithm;
2. provider/config shared polling and cost bounds;
3. integration and revalidation of the Gate 2 ownership proof;
4. bootstrap, continuity, first-crossing, and supersession state machine;
5. batching with the existing digest;
6. action-token transport, expiry, authorization, and fallback;
7. snooze/dismiss/mute semantics;
8. tone/content and recovery suggestions;
9. two-layer scenario thresholds;
10. Gate 3A evidence format.

**Required design artifacts:**

- normalized deadline observation contract;
- lifecycle-stage state machine;
- ownership/audience proof;
- digest composition rules;
- action API/security model;
- suppression and unmute behavior;
- error/race/recovery model;
- test and canary plan;
- explicit Phase 3B handoff.

**Read first:** research reports 01–06 and 08 §§4, 10 rank 2, 11 Phase 3,
12–13.

**Implementation-plan boundary:** Phase 3A only. Do not add pre-deadline stage,
urgent delivery, provider webhooks, calendar, group delivery, model ranking, or
automatic task changes.

## 12. Phase 3B — One-day-before deadline stage

### 12.1 Phase contract

**Goal:** add a pre-deadline opportunity window to the proven deadline
lifecycle without duplicating or bursting with first-overdue recovery.

**Relative size:** M.

**Entry:** Gate 3A accepted.

**Exit:** pre-deadline and overdue stages compose under due-date changes,
resolution, exposure, feedback, batching, and retry without stale or duplicate
lifecycle messages; a separate two-layer scenario review accepts the stage.

### 12.2 Trigger and semantics

`TSK-011` becomes eligible on the configured recipient-local work window one
local date before the task's due date.

Date-only task data does not prove an exact due time or urgency. Therefore:

- delivery remains ordinary/digest-only;
- no wake-now claim;
- no quiet-hours bypass;
- no "last chance" wording unless the provider exposes an explicitly designed
  hard-time contract in a later phase.

Candidate identity is conceptually:

`Kaneo task + due-date version + recipient + pre-deadline stage`

A due-date change supersedes the old pre-deadline stage. Completion,
cancellation, deletion, access loss, or assignment change resolves it.

Until the Phase 3B design approves an explicit time truth table and its tests,
the fail-closed behavior is:

- if the recipient-local date one day before due is not a selected working
  day, create no pre-deadline candidate; do not promote it to a previous
  working day;
- if a task or due-date version is first observed inside or after its
  pre-deadline window, establish a baseline only; do not create, advance, or
  backfill the stage;
- if timezone or workday configuration changes during the window, supersede
  and rebaseline rather than synthesize eligibility; and
- if a pre-deadline snooze crosses the overdue boundary, expire that
  pre-deadline candidate; do not convert it into or backfill an overdue
  candidate.

Phase 3A may still create an overdue candidate from its own independently
proved continuous not-overdue-to-overdue transition. A pre-deadline candidate
or snooze is never evidence of that crossing.

### 12.3 Composition with overdue stage

Pre-deadline and first-overdue share:

- source observation;
- due-date version;
- audience proof;
- structured exposure;
- the suppression store, with stage- and subject-scoped keys;
- digest capacity;
- receipt/history/finalization.

Rules:

- the same stage is visible at most once per due-date version/audience;
- a pre-deadline exposure does not erase a materially later overdue stage;
- a reactive resolution suppresses both pending stages;
- a due-date change supersedes both old stages;
- several tasks due together are batched and capped;
- a held pre-deadline item that has crossed into overdue is superseded rather
  than delivered late as pre-deadline content;
- stages cannot produce two visible messages in one work window unless a
  separately approved budget explicitly permits it.

Suppression semantics are explicit:

- **stage dismissal** suppresses only the same
  due-date-version/audience/stage; dismissing pre-deadline does not suppress
  first-overdue;
- **candidate snooze** belongs only to its stage. A pre-deadline snooze that
  reaches the overdue boundary expires with the pre-deadline candidate and
  does not snooze, create, or advance first-overdue;
- **already knew** records feedback and dismisses only the current stage; it
  does not suppress a later overdue stage;
- **scenario/feature mute** suppresses both deadline stages for the recipient;
- **task-subject mute** suppresses both stages for that recipient and task;
- **not mine / ownership mismatch** suppresses the subject for that recipient
  and raises the privacy-minimal review signal defined in Phase 3A; and
- **unmute** admits only newly eligible future observations. It never releases
  or backfills candidates that were suppressed, expired, or crossed a stage
  boundary while muted.

### 12.4 Failure behavior

The Phase 3A failure contract applies. In addition:

- a task created or first observed inside the one-day window establishes a
  baseline only until an explicit late-admission rule is accepted in the
  Phase 3B design; the default does not create or backfill a candidate;
- a task discovered after its pre-deadline window does not backfill a stale
  prompt;
- a non-working one-day-before date is not promoted to an earlier workday
  without an accepted rule;
- timezone or due-date edits recalculate and supersede before delivery;
- all-day/date parsing ambiguity omits the item;
- insufficient digest capacity defers only while the pre-deadline value window
  remains active, then expires;
- a snooze crossing overdue expires the pre-deadline candidate and never
  converts or backfills it as overdue; and
- enabling the new pre-deadline stage is explicit and independent; existing
  first-overdue opt-in alone never creates a pre-deadline candidate.

### 12.5 Phase 3B verification

The plan must cover:

- one-day-before boundaries across timezone and DST;
- one-day-before dates that are not selected working days, with no implicit
  previous-workday promotion;
- tasks created inside/after the stage window;
- due-date move earlier/later/clear;
- pre-deadline held past due;
- pre-deadline exposure followed by overdue crossing;
- reactive resolution between stages;
- many tasks due on the same date;
- snooze crossing from pre-deadline into overdue;
- stage dismissal, stage snooze, already-knew, scenario/feature mute,
  task-subject mute, ownership-mismatch feedback, unmute, and no-backlog
  semantics;
- no duplicate messages under crash/retry/two-worker conditions;
- all Phase 3A ownership, receipt, privacy, and action tests;
- independent default-off pre-deadline toggle and kill-switch races.

### 12.6 Gate 3B evidence

Before the first Phase 3B canary message, the approved phase design freezes
the cohort, denominators, observation horizon, minimum rated and total
samples, treatment of unrated deliveries, and thresholds for usefulness,
already-knew, ownership-mismatch, dismissal, mute, and retained opt-in. Gate
3B applies those unchanged criteria. Insufficient sample or horizon means
`hold`.

Gate 3B passes only when:

- stage composition and supersession are deterministic;
- the accepted local-date/workday/late-observation/snooze truth table is fully
  covered and no implicit promotion or backfill escapes it;
- late/backfill behavior never surfaces stale pre-deadline content;
- no due-version/stage is visible twice;
- same-window attention remains bounded;
- zero-tolerance safety invariants hold;
- all frozen product denominators, samples, horizons, and usefulness,
  already-knew, ownership-mismatch, dismiss, mute, and retention thresholds
  pass;
- product and engineering jointly recommend retaining the stage.

### 12.7 Fresh-agent brainstorming brief for Phase 3B

**Primary design question:** how should the proven deadline lifecycle add one
useful, date-based pre-deadline stage without overstating urgency or colliding
with overdue recovery?

**Locked constraints:**

- Gate 3A implementation is the substrate;
- one local date before due;
- date-only semantics, no exact-time/urgent claim;
- digest-only;
- same stable due-version and audience proof;
- deterministic supersession/composition;
- no stale backfill;
- no new effect or provider-ingress class.

**Phase design must resolve:**

1. exact local-date and work-window calculation;
2. non-working pre-deadline dates, tasks created/first observed inside the
   stage window, and the fail-closed no-promotion/no-backfill defaults;
3. composition with snooze/dismiss/mute;
4. pre-deadline-to-overdue supersession;
5. digest capacity and expiry;
6. copy/tone;
7. scenario-specific product thresholds;
8. Gate 3B evidence format.

**Required design artifacts:**

- stage transition/composition rules;
- time and due-version truth table;
- content/digest specification;
- error and stale-backfill rules;
- test/canary plan;
- post-Phase-3 learning summary template.

**Read first:** research reports 01–06 and 08 §§4, 10 rank 3, 11 Phase 3,
12–13.

**Implementation-plan boundary:** Phase 3B only. Do not add weekly planning,
calendar, event webhooks, groups, urgent delivery, learned behavior, or
semantic inference.

## 13. Phase 4 — Directional planning and private calendar context

Phase 4 is a direction, not an approved implementation bundle. Its two product
bets receive separate brainstorming/design/plan/development cycles.

### 13.1 Entry posture

Phase 4 discussion begins only after:

- Gate 3B evidence is accepted;
- task-only proactivity has sustained safety and usefulness;
- completion/workweek data quality is measured;
- personal-DM policy and delivery controls are stable;
- product chooses one Phase 4 bet rather than starting both by default.

### 13.2 Bet 4A — Weekly review and planning ritual

The likely order is:

1. `TSK-009` weekly review after completion/slip history is trustworthy;
2. `TSK-010` weekly planning opener as one prompt followed by a normal
   reactive planning conversation.

Directional constraints:

- default off and personal DM;
- recipient-selected workweek;
- low-frequency digest;
- factual, nonblaming review;
- no inferred capacity or priority without explicit data;
- no autonomous plan mutation;
- one planning opener, then normal reactive tools/confirmation/run control;
- no silent conversion of existing reactive planning stories into unsolicited
  messages.

#### Fresh-agent kickoff for Bet 4A

> Use the brainstorming skill and treat roadmap §13.2 as the scope. First
> verify whether Kaneo now exposes trustworthy completion, slip, status, and
> workweek evidence. Choose weekly review or weekly planning as the first
> single bet; do not combine them automatically. Preserve all Phase 0–3
> controls and produce a separate approved design before planning.

The design must define the evidence window, workweek semantics, content
contract, reactive handoff, product gate, and what happens when historical
data is incomplete. Incomplete evidence defaults to omission or no message.

### 13.3 Bet 4B — Read-only calendar enrichment

Calendar follows, rather than precedes, proof that a task-only briefing is
valuable. The first calendar capability is identity-scoped, personal,
read-only, and just-in-time.

Directional requirements:

- explicit connect/disconnect and capability consent;
- recipient-owned credentials and identity;
- exact calendar selection;
- private-event and redaction policy;
- timezone, recurrence, all-day, and cancellation semantics;
- bounded event/free-busy reads;
- connector health and revocation behavior;
- personal DM only;
- no group/private calendar content;
- no calendar-to-task automatic mutation;
- no calendar webhooks merely to enrich a scheduled daily/weekly read.

Provider/event webhooks are added only if a later selected scenario proves it
needs sub-briefing event-change latency.

#### Fresh-agent kickoff for Bet 4B

> Use the brainstorming skill and treat roadmap §13.3 as the scope. Begin with
> user stories and privacy boundaries for one identity-scoped read-only
> calendar connector and one existing-briefing enrichment. Do not select a
> provider, request broad OAuth scope, add webhooks, support groups, or create
> tasks until those choices are explicitly designed and approved.

The design must resolve provider choice, credential ownership, OAuth scopes,
event normalization, private-title behavior, all-day/timezone semantics,
revocation, bounded reads, display/redaction, and a task-only fallback when
calendar is unavailable.

### 13.4 Phase 4 non-goals

- calendar reminders duplicating native alerts;
- recurring-event-to-task creation;
- calendar conflict automation;
- group scheduling;
- automatic capacity optimization;
- model-selected priorities;
- unattended task/calendar writes;
- calendar webhooks without a latency-requiring user story.

## 14. Phase 5 — Directional independent bets

Phase 5 is not a single phase to implement. It is a portfolio of capabilities
that may proceed, be reordered, or remain unbuilt. Each receives its own
research update, brainstorming cycle, design, gate, and implementation plan.

### 14.1 Bet 5A — Richer provider observations or webhooks

Potential value:

- exact old/new task deltas;
- lower-latency lifecycle events;
- completion/regression/reschedule evidence;
- reduced broad polling.

Required before design approval:

- selected scenario with a latency need;
- verified Kaneo/provider webhook or event API;
- callback authentication;
- subscription lifecycle and renewal;
- cursor/replay/order semantics;
- stable provider event identity;
- rate/backpressure behavior;
- reauthorization and deletion;
- mapping into the existing canonical candidate gateway.

External events create observations/candidates, not direct messages.

### 14.2 Bet 5B — Group/thread delivery

Group delivery is a separate product model, not a DM feature flag.

Required before design approval:

- explicit shared/group benefit;
- owner/admin and member consent semantics;
- public-field allowlist and redaction;
- current membership revalidation;
- exact per-platform main/thread behavior;
- mention policy;
- bystander interruption accounting;
- group-scoped deduplication and reactive exposure;
- guest-readable-definition implications;
- proof that unsupported thread semantics cannot fall back to a broader
  channel;
- separation of group-owned definitions from personal DM subscriptions.

Mentions route attention; they do not make group content confidential.

### 14.3 Bet 5C — Urgent delivery

Urgency is reserved for objective value-decay classes with an explicit hard
deadline and separate user authorization.

Required before design approval:

- named eligible scenario classes;
- explicit urgent opt-in;
- objective hard-time evidence;
- reserved and visible interruption budget;
- strict expiry;
- quiet-hours policy and zero-defect proof;
- platform capability semantics;
- copy that explains urgency and controls;
- fallback to ordinary/digest delivery;
- independent stop/kill switch.

An LLM cannot authorize urgency or quiet-hours bypass. OS/platform
"time-sensitive" capabilities are not user consent.

### 14.4 Bet 5D — Learned suppression

Required before design approval:

- sufficient recipient-labelled observations;
- per-scenario calibration;
- transparent learned rule;
- explicit user approval;
- versioning and rollback;
- explanation and control surface;
- holdout/evaluation design;
- protection against silently suppressing safety-critical explicit reminders.

The first learned behavior should suppress or digest conservatively. It does
not expand audience, urgency, effects, or data access.

### 14.5 Bet 5E — Semantic task/conversation inference

Required before design approval:

- narrow user story not served by structured state;
- privacy and retention review;
- bounded classifier/extractor;
- speaker, quotation, negation, hypothetical, and instruction-injection tests;
- calibrated precision and adjudication;
- source quotation/redaction policy;
- digest-only default;
- no model authority over audience, urgency, effects, or retry.

Broad conversation monitoring and live interruptibility sensing remain outside
this roadmap.

### 14.6 Phase 5 prohibited shortcuts

- raw `/api/notify` as universal candidate ingress;
- provider webhook directly sending chat content;
- group fallback when DM/thread resolution fails;
- sending every true trigger and relying on later mute;
- LLM-selected audience, scope, urgency, quiet-hours bypass, identity, or
  effect permission;
- full proactive agent runs for convenience;
- product-owned unattended mutations;
- plugin/MCP/open-world execution in an automatic scenario;
- copying a competitor quota/default as papai evidence.

## 15. Cross-phase verification and gate governance

### 15.1 Evidence packet

Every completed phase commits its gate packet at:

`docs/superpowers/evidence/YYYY-MM-DD-proactive-phase-<phase>-gate.md`

Internal Phase 1 increments use the same directory with
`phase-1a-checkpoint`, `phase-1b-checkpoint`, and so on. A packet records:

- exact implementation commit SHA it certifies;
- branch/base and migration state;
- commands, artifact links, and evidence summaries;
- known deviations from the approved phase design;
- unresolved unknown delivery outcomes;
- product and engineering decision: `go`, `hold`, `narrow`, or `stop`;
- accepting product and engineering owners plus acceptance date.

Only a jointly accepted `go` whose certified SHA is an ancestor of the next
phase branch satisfies an entry gate. A missing packet, stale/non-ancestor SHA,
unresolved required deviation, or `hold`/`narrow`/`stop` blocks the next phase.
Phase 0 uses this approved roadmap commit as its entry evidence.

Every phase gate produces a reviewable packet containing:

- phase-specific contract and invariant results;
- full affected regression results;
- migration/rollback evidence;
- crash, lease, retry, and idempotency outcomes;
- delivery `confirmed`/`failed`/`unknown`/`unsupported` counts;
- unresolved unknown-outcome reconciliation;
- privacy/log/stats canary results;
- duplicate, expiry, suppression, and supersession counts;
- provider/platform capability findings;
- operational duration/rate/cost bands;
- product evidence for user-visible phases;
- deviations from the approved phase design;
- a joint product/engineering recommendation: `go`, `hold`, `narrow`, or
  `stop`.

Gate evidence contains no task/chat/calendar content or raw identity.
Authorized content audit is conducted separately and reported as pass/fail
counts with safe discrepancy categories.

### 15.2 Test layers

Every phase plan selects the applicable layers:

1. **Pure unit/property tests:** time policy, identity, state transitions,
   reason codes, renderer bounds.
2. **Store/migration tests:** constraints, CAS/lease behavior, retention,
   deletion, rollback.
3. **Provider/adapter contract tests:** Kaneo normalization and chat receipt
   behavior.
4. **Integration tests:** scheduler → policy → lifecycle → renderer → fake
   delivery → finalization.
5. **Crash/recovery tests:** every boundary before and after durable state.
6. **Authorization/scope matrix:** DM/group/thread/guest/member/provider
   changes.
7. **Injection/privacy tests:** untrusted strings, logs, stats, settings, and
   error surfaces.
8. **Hermetic end-to-end scenarios:** deterministic external fixtures and
   exact observable outcomes.
9. **Shadow/canary evidence:** live authorized conditions under explicit
   cohort and kill-switch controls.

Arbitrary sleeps and timing assumptions are not acceptable substitutes for
event/state-based tests.

### 15.3 Automatic stop conditions

Pause the affected cohort, platform, provider, or feature immediately for:

- wrong recipient, audience, context, thread, platform instance, or task scope;
- guest/membership/permission/authority violation;
- private data on an unauthorized surface;
- quiet-hours or non-working-day violation;
- repeated automatic effect;
- visible duplicate for the same occurrence/stage;
- delivery marked confirmed when the adapter did not send;
- conversation history claiming an unseen message;
- expired or resolved content delivered;
- task/provider text changing policy, layout, audience, or instructions;
- content, raw identity, credential, or raw error in anonymous stats/logs;
- lifecycle state that cannot reconstruct whether/what/where delivery
  occurred.

Pause and redesign the product rather than widen when:

- rated usefulness remains poor;
- opt-in users routinely mute after one or two deliveries;
- subjective ownership-mismatch/already-knew rates remain high despite
  technically valid authorization;
- normalization omits too much source state for an honest product claim;
- provider load or delivery latency exceeds declared bounds;
- unknown outcomes cannot be reconciled safely.

### 15.4 Rollback principles

Every user-visible phase has:

- global feature kill switch;
- provider/platform/cohort disablement;
- default-off policy;
- monotonic lifecycle states;
- no backlog release on re-enable;
- safe migration rollback or forward repair;
- retained aggregate evidence without retained content beyond policy;
- ability to drop/supersede pending candidates without deleting confirmed
  delivery audit.

Disabling assistant proactivity does not silently cancel user-scheduled
reminders or release subscriptions.

## 16. Product measurement contract

### 16.1 What counts

Useful measures include:

- explicit useful/not-useful;
- already-knew;
- not-mine/ownership-mismatch feedback, kept distinct from an actual
  unauthorized-audience safety incident;
- snooze/dismiss/mute/opt-out;
- retained opt-in;
- direct interruptions per eligible workday;
- task action within a declared horizon, described as association rather than
  causation;
- source/content audit accuracy;
- duplicate caught/escaped;
- delivery unknown and repair outcomes.

### 16.2 What does not count alone

Do not widen based only on:

- opens/views;
- link clicks;
- raw reply rate;
- delivery volume;
- model confidence;
- competitor defaults;
- a universal notification-frequency claim.

### 16.3 Threshold policy

Numeric thresholds, denominator definitions, sample requirements, and
observation horizons are approved phase-design decisions because the research
does not validate universal constants. They must be:

- frozen before the first canary message;
- versioned with the experiment;
- visible in the evidence packet;
- unchanged after results are known unless the canary is explicitly restarted;
- paired with zero-tolerance safety invariants.

Missing thresholds or insufficient evidence means `hold`, not implicit
approval.

## 17. Risk register

| Risk                                                   | Earliest affected phase | Containment                                                                          |
| ------------------------------------------------------ | ----------------------: | ------------------------------------------------------------------------------------ |
| False success or lost acknowledgement causes duplicate |                       0 | Typed receipt, unknown quarantine, frozen artifact, idempotency                      |
| Delivery retry repeats generation/tool effect          |                       0 | Separate effect identity, no rerun on transport retry                                |
| History claims unseen content                          |                       0 | Confirmed-only finalization and idempotent repair                                    |
| Untrusted metadata becomes instructions                |                       0 | Correct role boundary and injection fixtures                                         |
| Raw identity/content leaks through stats/logs          |                       0 | Anonymous schema, low-cardinality allowlist, seeded canaries                         |
| Owner/actor/audience/target confusion                  |                       0 | Exact typed principals and execution/send revalidation                               |
| DST/policy edit creates duplicate occurrence           |                       1 | Local-date identity, transactional supersession, deterministic tests                 |
| Worker crash creates duplicate or stuck lifecycle      |                       1 | Lease/CAS, monotonic state, crash fixtures                                           |
| Static overdue predicate becomes nag loop              |                      3A | Due-version/stage/audience identity and durable dismissal                            |
| Kaneo status/finality ambiguity creates false content  |                     1–3 | Explicit mapping, unknown omission, content audit                                    |
| Project visibility is mistaken for personal ownership  |                     2–3 | Honest project label; Phase 3 blocked without Gate 2-certified stable assignee proof |
| Provider reads scale with contexts/threads             |                     1–3 | Shared provider/config observation, bounded concurrency/pagination                   |
| Digest overflows or splits inconsistently              |                       2 | One-message deterministic bounds and overflow                                        |
| Quiet-hours/unmute creates backlog burst               |                     1–3 | Expiry, supersession, cap, no backlog release                                        |
| Feedback action is forwarded/replayed                  |                     2–3 | Recipient/candidate/version binding, expiry, idempotency                             |
| Group bystanders bear privacy/attention cost           |                       5 | Separate group product model and public-field policy                                 |
| Calendar exposes private events                        |                       4 | Identity-scoped read-only connector and redaction policy                             |
| LLM changes urgency/audience/effects                   |                     4–5 | Deterministic hard gates; model never receives that authority                        |
| Learned suppression hides wanted content               |                       5 | Explicit approval, explainability, versioning, rollback                              |

## 18. Phase-entry decision register and fail-closed defaults

These decisions are intentionally resolved inside the named phase's
brainstorming cycle because earlier implementation evidence changes the
available choices. The roadmap still defines the behavior when the decision
has not been accepted.

| Phase | Decision                                                   | Default until accepted                                                           |
| ----- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0     | Base chat-provider receipt vs proactive capability receipt | New proactive callers cannot use an untyped send                                 |
| 0     | Minimum persistence for existing effectful retry           | Disable automatic retry rather than rerun                                        |
| 0     | Exact affected caller inventory                            | Unclassified new proactive caller fails review/gating                            |
| 1     | Physical tables and module boundaries                      | No live feature enablement                                                       |
| 1     | Spring-forward/fall-back semantics                         | No live policy enablement until preview/tests lock behavior                      |
| 1     | Content/audit retention periods                            | Keep content minimal; block delivery when safe retry/audit cannot be retained    |
| 1     | Worker integration strategy                                | Shadow only; no send                                                             |
| 2     | Stable Kaneo assignee mapping and capability probe         | Project-scoped digest; never say "your tasks"; Gate 2 records Phase 3 as blocked |
| 2     | Final/cancelled/in-progress mappings                       | Unknown item omitted                                                             |
| 2     | Second read vs state-version revalidation                  | No send when freshness cannot be proved                                          |
| 2     | Canary thresholds/sample                                   | No expansion                                                                     |
| 2     | Larger item/length cap                                     | Keep 5/5/5 and 1,800-code-unit maximum; lowering is allowed from shadow evidence |
| 3A    | Gate 2-certified personal ownership proof absent           | Phase 3 blocked; subscription requires its own prerequisite cycle and gate       |
| 3A    | Action-token/expiry/fallback details                       | No rich action enabled                                                           |
| 3A    | Snooze beyond scenario expiry                              | Do not deliver; require a separate explicit reminder design                      |
| 3A    | Interruption-budget constants                              | Measure only; do not enforce invented quota                                      |
| 3B    | Ambiguous date/all-day semantics                           | Omit candidate                                                                   |
| 3B    | One-day-before date is not a selected workday              | No candidate; no previous-workday promotion                                      |
| 3B    | Task/due-version first observed inside the stage window    | Baseline only; no create, advance, or backfill                                   |
| 3B    | Pre-deadline snooze crosses overdue                        | Expire pre-deadline; never convert or backfill overdue                           |
| 4     | Calendar provider and scopes                               | No connector                                                                     |
| 5     | Group, urgent, learned, or semantic capability             | Capability remains disabled/unbuilt                                              |

## 19. Decision traceability

| Roadmap decision                      | Primary research anchors                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily task-health digest first        | [`01` task-health scenarios](../../research/proactive-scenarios/01-scenario-catalogue.md#32-task-health-deadlines-and-work-rhythm), [`02` time feasibility](../../research/proactive-scenarios/02-trigger-feasibility.md#6-time-trigger-feasibility), [`08` decision](../../research/proactive-scenarios/08-recommendation.md#1-decision) |
| Default-off settings controls         | [`04` taxonomy/requirements](../../research/proactive-scenarios/04-notification-controls.md#2-control-taxonomy-and-precedence), [`08` controls](../../research/proactive-scenarios/08-recommendation.md#56-controls-shown-in-settings)                                                                                                    |
| Personal DM only                      | [`05` group/DM rules](../../research/proactive-scenarios/05-scope-and-delivery.md#6-group-and-dm-product-rules), [`08` scope rules](../../research/proactive-scenarios/08-recommendation.md#7-scope-and-platform-rules)                                                                                                                   |
| Exact scope, no inferred ownership    | [`05` actor/authority](../../research/proactive-scenarios/05-scope-and-delivery.md#4-actor-owner-guest-membership-and-tool-permissions), [`08` task scope](../../research/proactive-scenarios/08-recommendation.md#52-task-scope-choice)                                                                                                  |
| Deterministic read-only renderer      | [`03` effect policy](../../research/proactive-scenarios/03-decide-to-interrupt.md#13-llm-execution-and-effect-policy), [`06` safe execution](../../research/proactive-scenarios/06-safety-and-trust.md#9-safe-execution-and-effect-policy)                                                                                                |
| No urgent lane initially              | [`03` hard gates/budget](../../research/proactive-scenarios/03-decide-to-interrupt.md#5-hard-eligibility-gates-before-scoring), [`08` product contract](../../research/proactive-scenarios/08-recommendation.md#5-product-contract-for-the-thin-first-increment)                                                                          |
| Durable occurrence/candidate/outbox   | [`02` minimum trigger architecture](../../research/proactive-scenarios/02-trigger-feasibility.md#14-minimum-trigger-architecture-recommendation), [`03` lifecycle](../../research/proactive-scenarios/03-decide-to-interrupt.md#12-state-machine-and-architecture-placement)                                                              |
| Frozen retry and typed receipt        | [`03` retry invariant](../../research/proactive-scenarios/03-decide-to-interrupt.md#122-retry-and-side-effect-invariant), [`05` delivery lifecycle](../../research/proactive-scenarios/05-scope-and-delivery.md#7-delivery-and-history-lifecycle)                                                                                         |
| Confirmed-only history                | [`05` delivery/history lifecycle](../../research/proactive-scenarios/05-scope-and-delivery.md#7-delivery-and-history-lifecycle), [`08` shared architecture](../../research/proactive-scenarios/08-recommendation.md#6-required-shared-architecture)                                                                                       |
| Repair stats before proactive metrics | [`06` findings](../../research/proactive-scenarios/06-safety-and-trust.md#7-verification-of-suspected-issues-and-audit-findings), [`08` blockers](../../research/proactive-scenarios/08-recommendation.md#8-safety-and-trust-release-blockers)                                                                                            |
| Overdue then pre-deadline             | [`08` scenario ranking](../../research/proactive-scenarios/08-recommendation.md#10-prioritized-scenario-roadmap), [`08` Phase 3](../../research/proactive-scenarios/08-recommendation.md#phase-3--deadline-lifecycle-and-user-feedback)                                                                                                   |
| Calendar/group/urgent/learned later   | [`07` unsupported claims](../../research/proactive-scenarios/07-prior-art-and-synthesis.md#8-claims-the-evidence-does-not-support), [`08` Phases 4–5](../../research/proactive-scenarios/08-recommendation.md#phase-4--weekly-planning-and-read-only-calendar-enrichment)                                                                 |

## 20. Phase document set and handoff

Suggested future design-spec names:

- `YYYY-MM-DD-proactive-phase-0-correctness-contracts-design.md`
- `YYYY-MM-DD-proactive-phase-1a-policy-time-scope-design.md`
- `YYYY-MM-DD-proactive-phase-1b-lifecycle-foundation-design.md`
- `YYYY-MM-DD-proactive-phase-1c-kaneo-shadow-design.md`
- `YYYY-MM-DD-proactive-phase-2-kaneo-telegram-digest-design.md`
- `YYYY-MM-DD-proactive-phase-3a-first-overdue-design.md`
- `YYYY-MM-DD-proactive-phase-3b-pre-deadline-design.md`

The Phase 1 increment-map design may refine the 1A/1B/1C labels and file names,
but it must retain separate ordered specs, plans, checkpoints, and the
aggregate Gate 1 exit.

Each design receives a matching phase-specific implementation plan only after
user review. Plans for unstarted later phases must not be written early.

At phase completion, the handoff to the next fresh agent includes:

- accepted phase design and implementation plan;
- merged commit/branch;
- committed gate evidence packet and its certified implementation SHA;
- architecture/behavior documentation updates;
- migration and rollback notes;
- measured provider/platform constraints;
- deviations and newly learned constraints;
- unresolved risks that do not violate the gate;
- explicit statement that the prior gate passed.

The next agent must still inspect current code and recent commits. A handoff is
context, not permission to reuse stale line numbers or snippets.

## 21. Roadmap change policy

A phase-specific design may refine implementation details while preserving
this roadmap's locked outcomes and invariants.

The roadmap itself must be amended and re-approved before a phase design can:

- reorder the critical path;
- skip Phase 0 or Phase 1;
- change the first provider/platform vertical;
- move from sequential foundation-first to scenario-first delivery;
- weaken default-off or personal-DM scope;
- add an urgent lane;
- introduce model/tool/effect execution into Phases 1–3;
- infer personal ownership from project visibility/display names;
- weaken confirmed-only history or unknown-outcome quarantine;
- replace the two-layer canary gate;
- combine Phase 3A and Phase 3B into one ungated release;
- treat a Phase 4/5 directional bet as already approved.

If implementation reveals that a locked requirement is infeasible, the phase
stops and returns for roadmap/design review. Infeasibility is not permission to
silently degrade scope, audience, privacy, delivery truth, or safety.

## 22. Final approval statement

This roadmap approves the sequence and phase-level product/architecture
contracts described above.

It approves **brainstorming Phase 0 next**.

It does not approve:

- a single implementation plan spanning all phases;
- live task-health delivery before Gates 0 and 1;
- any Phase 4 or Phase 5 capability;
- shortcuts that schedule a full proactive prompt and call the existing
  sender.

The intended next workflow is:

`fresh Phase 0 brainstorming → approved Phase 0 spec → Phase 0 plan → Phase 0 development → Gate 0 evidence`

Only then should a fresh agent begin Phase 1 brainstorming.
