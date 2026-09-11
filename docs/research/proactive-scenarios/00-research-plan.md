<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Deep Research Plan: Proactive Scenarios for papai

> **Status:** Research plan (not an implementation plan). Defines the questions, method, and
> deliverables for a deep-research pass on where and how papai should message users **without being
> asked first**. Grounded in the current codebase; every "current state" claim below points at real
> modules so the research can start from fact rather than guesswork.

## 1. Why this research

papai is fundamentally reactive: a user sends a message, the LLM runs tools, the bot replies. A
proactive layer already exists in narrow form — deferred prompts (scheduled + alert), the pollers,
the `POST /api/notify` trust plane, and version-release announcements — but there is no coherent
_product model_ for proactivity: what papai is allowed to interrupt a user for, how it decides an
interruption is worth it, how the user controls the firehose, and how any of it stays inside the
scope, privacy, and trust boundaries the rest of the system is careful about.

The user stories in `docs/user-stories/phase-09-event-driven-suggestions.md`,
`phase-10-notification-controls.md`, and `phase-11-planning-assistant-calendar.md` describe an
ambitious proactive product (task-health nudges, morning briefings, weekly reviews, digest/quiet-hours
controls, calendar-aware planning). Most of Phase 10/11 is unimplemented. Before building, we need a
grounded decision on **which proactive scenarios are worth it, in what order, and under which
guardrails** — that is what this research produces.

The goal is a decision-support document, not code. Output is a prioritized scenario catalogue plus the
architectural, safety, and UX findings needed to green-light the first build increment.

## 2. Research questions

Primary question: **Which proactive scenarios should papai support, and what shared machinery,
controls, and guardrails do they require?**

Decomposed:

1. **Scenario space** — What is the full space of proactive scenarios (time-triggered, event/state-triggered,
   inferred-from-conversation, external-signal-triggered)? Which are valuable vs. noise?
2. **Trigger model** — What can actually fire a proactive message today, and what new trigger sources
   (task-tracker webhooks/polling deltas, calendar, conversation inference) are feasible given
   provider capabilities?
3. **Decide-to-interrupt** — How does papai decide a candidate is worth sending _now_ vs. batching,
   suppressing, or dropping? What's the relevance/urgency model?
4. **User control** — What is the minimum viable control surface (quiet hours, working days, delivery
   mode, per-feature toggles, snooze/dismiss) that keeps proactivity from becoming spam?
5. **Scope & delivery** — How do proactive messages behave under papai's thread/group/user scope model,
   guest mode, per-context `tool_prefs`, and multi-platform delivery?
6. **Safety & trust** — What are the prompt-injection, privacy (`/stats` anonymity, no-secret-logging),
   and unwanted-interruption risks, and how are they contained?
7. **Prior art** — How do comparable assistants (task bots, calendar assistants, notification systems)
   solve interruption budgeting, digesting, and relevance? What's transferable?

## 3. Current-state baseline (established from code — do not re-derive)

The research must start here so it doesn't re-plan what already ships.

### Proactive machinery that exists

- **Deferred prompts** — two kinds, in `src/deferred-prompts/`:
  - _Scheduled_ (`ScheduledPrompt`): one-shot `fire_at` or `rrule` recurrence; polled every **60s**
    (`SCHEDULED_POLL_MS` in `poller.ts`).
  - _Alert_ (`AlertPrompt`): a recursive condition (`AlertCondition`) over task fields
    (`CONDITION_FIELDS`: status, priority, assignee, dueDate, project, labels; ops incl. `changed_to`,
    `overdue`) with a cooldown; polled every **5 min** (`ALERT_POLL_MS`). Deltas tracked via
    per-context task **snapshots** (`snapshots.ts`).
- **Execution pipeline** — `proactive-llm.ts` / `proactive-llm-full.ts` run the firing prompt through
  the LLM in one of three **execution modes** (`lightweight` / `context` / `full`, in `types.ts`),
  then deliver.
- **Trigger framing** — `proactive-trigger.ts` builds a `[PROACTIVE EXECUTION]` system/user split that
  keeps user-authored text out of the system prompt (injection hygiene) and instructs the model to
  _deliver_, not re-schedule.
- **Delivery** — `proactive-delivery.ts` resolves the platform instance and sends; `proactive-history.ts`
  records proactive turns so they appear in conversation history. Platform-instance resolution falls
  back to the id encoded in the storage context id (`resolveDeliveryPlatformInstanceId`).
- **External trust plane** — `POST /api/notify` (`src/debug/notify-route.ts`), bearer-authed by
  `NOTIFY_TOKEN` (not the dashboard cookie), lets operators/services push a proactive markdown message
  into a context. Documented in `docs/adr/0217-papai-core-notify-endpoint.md`.
- **Announcements** — version-release announce (opt-in, admin-reviewed broadcast) and the manual admin
  "Announce" broadcast (`src/announcements/`). A distinct, one-to-many proactive path worth contrasting.
- **Scheduling substrate** — `scheduler-instance.ts` / `scheduler-recurring.ts` (the registered
  interval tasks the pollers hang off).

### Guardrails already in place that proactivity must respect

- **Scope model** (`src/chat/context-scope.ts`): live state is thread-isolated; durable config/assets
  are group-shared; identity + web-fetch quota are per-user. A proactive feature's config and its
  delivery target may live at different scopes.
- **`tool_prefs`** (per-context allow/ask/deny) and **guest mode** (read-only, excluded from memory) —
  proactive runs execute tools too, so gating applies.
- **`normal` mode only for run-control** — per `overview.md`, "proactive runs get no run-control"
  (no mid-run steering / `/stop`). Implication for long proactive turns is an open question.
- **Timezone** is configured and honored by the scheduler (Phase 10 US1, IMPLEMENTED); **quiet hours,
  working days, delivery mode, per-feature toggles, snooze/dismiss are NOT** (Phase 10 US2–7).

### Documented-but-unbuilt product surface (the research prioritizes among these)

Phase 9 (event-driven suggestions: task-created enrichment, status-regression alerts, completion
next-steps, overdue prompts, staleness nudges, weekly summary, weekly planning, "what next?"),
Phase 10 (notification controls), Phase 11 (planning assistant + calendar integration). Treat these as
**candidate scenarios and requirements to validate/prioritize**, not as settled scope.

## 4. Research workstreams

Each workstream has a question, a method, and a concrete artifact. They can run largely in parallel;
WS-A and WS-B feed the prioritization in WS-G.

### WS-A — Scenario catalogue & taxonomy

- **Question:** What is the complete space of proactive scenarios, and how do they classify?
- **Method:** Mine the three Phase docs, `docs/user-stories/usage-scenarios.md`, and
  `docs/superpowers/specs/*proactive*`; enumerate scenarios; classify each by **trigger type**
  (time / task-state-delta / conversation-inference / external-signal), **cardinality** (1:1 DM vs.
  group broadcast), **urgency** (interrupt-now vs. digest-safe), and **execution mode** need
  (lightweight/context/full).
- **Artifact:** `01-scenario-catalogue.md` — a table of every candidate scenario with its
  classification and a one-line value hypothesis.

### WS-B — Trigger feasibility against real signals

- **Question:** For each trigger type, can papai actually detect the firing condition with the
  providers it has (Kaneo/YouTrack) and the platforms it runs on?
- **Method:** Read `src/providers/` + the Kaneo/YouTrack plugins for what task-state change data is
  observable (polling deltas via snapshots vs. any webhook capability); assess conversation-inference
  triggers (can a completed reactive turn spawn a follow-up suggestion?); assess external signals
  (calendar — Phase 11 US3 — as a new connector). Note polling cost/latency (current 60s / 5min).
- **Artifact:** `02-trigger-feasibility.md` — per-trigger feasibility (green/yellow/red), the signal
  source, and cost/latency notes.

### WS-C — Decide-to-interrupt / relevance model

- **Question:** Given a candidate proactive message, how does papai decide send-now / batch / drop?
- **Method:** Survey prior art (notification-budgeting, interruptibility research, digest algorithms);
  map to papai primitives (cooldowns already exist on alerts; execution-mode classification already
  exists). Define an **interruption budget** concept and a relevance/urgency scoring sketch. Consider
  dedup against `proactive-history` and against what the user already saw reactively.
- **Artifact:** `03-decide-to-interrupt.md` — a proposed decision model + where it would live.

### WS-D — User control surface (Phase 10 deep-dive)

- **Question:** What is the MVP control set that makes proactivity opt-in-safe and non-spammy?
- **Method:** Turn Phase 10 US2–7 into concrete requirements; decide storage scope for each
  preference (per-user vs. per-context, via the scope registry); design quiet-hours/working-days
  evaluation against the existing timezone plumbing; specify digest batching and snooze/dismiss
  state. Cross-check with settings-UI conventions (all config is in the Svelte SPA, not chat).
- **Artifact:** `04-notification-controls.md` — requirements + data model + settings-UI surface sketch.

### WS-E — Scope, delivery & multi-platform behavior

- **Question:** How must proactive messages behave under the scope model, guest mode, `tool_prefs`,
  and each platform's delivery constraints (thread-scoping differences, Kontur Talk lacking live
  status, Discord not thread-scoped)?
- **Method:** Trace an alert from poller → `proactive-delivery` → `ChatRouter.sendMessage` per
  platform; enumerate group vs. DM audience/mention rules (`deliveryPolicySchema`); confirm guest and
  `tool_prefs` interaction with proactive tool execution; check the run-control exclusion's impact.
- **Artifact:** `05-scope-and-delivery.md` — a per-platform delivery matrix + edge cases.

### WS-F — Safety, privacy & trust

- **Question:** What can go wrong (injection, leakage, over-interruption, wrong-context delivery), and
  how is each contained?
- **Method:** Threat-model the proactive paths: prompt-injection via task data flowing into a firing
  prompt (the system/user split in `proactive-trigger.ts` is the current mitigation — stress-test it);
  `/api/notify` abuse surface; leakage vs. the `/stats/*` anonymity contract and the no-secrets-logging
  rule; delivering a group-scoped nudge to the wrong thread; guest exposure. Run `bun security`
  mentally over proposed flows.
- **Artifact:** `06-safety-and-trust.md` — threat table with mitigations and release-blocker flags.

### WS-G — Prior art & synthesis / prioritization

- **Question:** How do comparable systems solve this, and given all findings, what should papai build
  first?
- **Method:** Web research on task-bot/calendar-assistant/notification-system design (interruption
  budgeting, digesting, relevance ranking, opt-in defaults). Then synthesize WS-A…F into a
  prioritized roadmap using a value/effort/risk lens, with a recommended **thin first increment**
  (likely: one high-value scenario end-to-end + quiet-hours + a master mute).
- **Artifact:** `07-prior-art-and-synthesis.md` + `08-recommendation.md` (the decision doc).

## 5. Method & sources

- **Internal (primary):** the modules and docs cited above. Use the codebase-search protocol from
  `CLAUDE.md` (codeindex `code_search`/`code_symbol`/`code_impact`; grep only for non-indexed docs).
  Prefer reading the real `src/deferred-prompts/*`, `src/providers/*`, `src/chat/context-scope.ts`,
  and `src/debug/notify-route.ts` over restating this plan.
- **External (secondary):** web search for interruption/notification design literature and comparable
  product behavior — used only in WS-C and WS-G, adversarially verified before it lands in a finding.
  For an execute pass, the repo's `deep-research` skill fits the WS-G literature sweep.
- **Evidence bar:** every "current behavior" claim cites a file/symbol; every external claim cites a
  source and is cross-checked; recommendations state assumptions explicitly.

## 6. Deliverables

A `docs/research/proactive-scenarios/` set:

| File                          | Contents                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `00-research-plan.md`         | This plan.                                                      |
| `01-scenario-catalogue.md`    | Classified candidate scenarios + value hypotheses (WS-A).       |
| `02-trigger-feasibility.md`   | Per-trigger feasibility vs. real signals (WS-B).                |
| `03-decide-to-interrupt.md`   | Relevance/urgency + interruption-budget model (WS-C).           |
| `04-notification-controls.md` | Control-surface requirements + data model (WS-D).               |
| `05-scope-and-delivery.md`    | Scope/guest/`tool_prefs`/per-platform delivery matrix (WS-E).   |
| `06-safety-and-trust.md`      | Threat model + mitigations + release-blockers (WS-F).           |
| `07-prior-art-and-synthesis.md` | External prior art, transferable patterns (WS-G).            |
| `08-recommendation.md`        | Prioritized roadmap + recommended thin first increment (WS-G).  |

## 7. Constraints & non-goals

- **Non-goals:** no code, no migrations, no settings-UI changes in this research pass; no commitment to
  build any specific scenario. This is decision-support that a later implementation plan consumes.
- **Hard constraints any recommendation must honor:** the scope model (`context-scope.ts` is the single
  source of truth); config lives in the settings UI, not chat; `/stats/*` anonymity contract; never log
  secrets; `tool_prefs`/guest gating applies to proactive tool runs; proactive runs get no run-control.
- **Bias toward opt-in:** default-off, user-controllable, dedup-aware. A proactive feature that can spam
  is worse than not shipping it.

## 8. Sequencing & success criteria

1. WS-A + WS-B first (define and reality-check the space) — they gate everything.
2. WS-C, WS-D, WS-E, WS-F in parallel once the catalogue exists.
3. WS-G synthesizes last and produces `08-recommendation.md`.

**Done when** `08-recommendation.md` names a ranked scenario list, a defensible first increment scoped
to existing machinery plus the smallest new pieces, and every recommendation traces to a finding with
its guardrails identified. A reviewer should be able to green-light (or reject) the first build from
this document alone.
