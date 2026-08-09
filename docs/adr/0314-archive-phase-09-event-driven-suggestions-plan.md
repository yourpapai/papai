<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0314: Archive the Phase 9 Event-Driven Suggestions Plan — Do Not Implement as Written

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-03-20-phase-09-event-driven-suggestions.md` is a
909-line development plan that scopes eight user stories (US1–US8): suggestion
payloads after task creation, significant-change detection on task updates,
completion follow-up options, interactive overdue/stale/blocked alert suffixes,
end-of-week summaries, start-of-week kickoffs, and an on-demand
`suggest_next_task` ranking tool. It is built on top of an assumed `src/proactive/`
module — `ProactiveAlertService` (`checkOverdue` / `checkStaleness` /
`checkBlocked`), `BriefingService`, `ProactiveAlertScheduler` — and an assumed
Phase 8 scheduler layer, and it lists both phases as hard prerequisites.

A codebase verification against the current tree (2026-08-07) found the plan
**not implemented** — a companion doc
(`docs/superpowers/remaining/2026-03-20-phase-09-event-driven-suggestions.md`)
records `Status: not_implemented`. Concretely:

- **Nothing from the plan's task breakdown exists.** No `src/suggestions/`
  module (`index.ts`, `types.ts`, `service.ts`, `tools.ts`), no
  `EventSuggestionService`, no `suggestMissingDetails` /
  `detectSignificantChange` / `getCompletionSuggestions` /
  `rankTasksByPriority`, no `suggest_next_task` tool, no `weekly_state` table,
  and no `TASK SUGGESTIONS` section in the system prompt. Zero grep hits for
  any of these names in `src/`.
- **The prerequisite Phase 7 module was removed, not delayed.**
  `src/db/migrations/013_deferred_prompts.ts` drops the `alert_state` table,
  and `src/proactive/` does not exist. The proactive firing path was rerouted
  through `src/deferred-prompts/` (ADR-0030, see also ADR-0302), so the
  `ProactiveAlertService` / `BriefingService` / `ProactiveAlertScheduler`
  classes the plan extends were never built in the assumed form. Phase 5
  (interactive alert suffixes) and Phase 6 (weekly summary/kickoff on
  `BriefingService`) have no target code to act on.
- **The migration slot is reused.** The plan calls for
  `011_event_suggestions.ts`; migration `011` is `011_proactive_alerts.ts`, and
  the codebase has since advanced to migration `075`.
- **The config keys are absent.** `weekly_review`, `workdays`,
  `week_end_time`, and `week_start_time` do not appear in the config key
  definitions.
- **No tests exist.** No `tests/suggestions/`, no
  `tests/proactive/briefing-weekly.test.ts`, no `task-tools.test.ts`
  extensions.
- **The plan carries no task checkboxes** — the only `- [x]` items are
  planning-quality self-assessments, so there is no in-plan progress signal;
  it is 0% implemented by construction.

Executing Phase 9 as written would therefore require first reconstructing the
removed Phase 7/8 service layer — turning the plan's estimated 24h into
multi-phase work against a superseded abstraction — and then layering a
`src/proactive/`-anchored weekly scheduler onto a codebase that delivers
proactive messages through `src/deferred-prompts/` instead.

## Decision Drivers

- **Foundation does not exist.** The services, tables, and config keys the plan
  extends were removed (migration 013) or never created; it cannot be executed
  top-down without first rebuilding its dependency stack.
- **Architecture has diverged.** The proactive path is `src/deferred-prompts/`
  (ADR-0030 / ADR-0302), not `src/proactive/`. Re-introducing that tree would
  create a second delivery abstraction.
- **Plan rot.** Migration slot `011` is occupied and the baseline has moved to
  `075`; Phases 5 and 6 are moot because their edit targets do not exist.
- **Feature value is real but the path is stale.** Event-driven suggestions
  (missing-field nudges, regression alerts, completion follow-ups, next-task
  ranking) and weekly rituals are genuine product value — but not worth the
  cost of resurrecting a superseded two-phase dependency stack.
- **Stale plans mislead.** Leaving an un-implementable plan on the active
  `docs/superpowers/plans/` shelf invites future effort against a target that
  no longer matches the code. This is the same failure mode handled for the
  dependent Phase 10 plan in ADR-0309.

## Considered Options

### Option 1 — Archive the plan; pursue the features (if wanted) via a fresh OpenSpec proposal (chosen)

Mark the plan superseded and move it out of the active plans shelf. If the
user stories (`docs/user-stories/phase-09-event-driven-suggestions.md`) are
still wanted, route them through `/opsx:propose` grounded in the current
architecture — `src/deferred-prompts/` for the proactive/weekly delivery, the
current tool factory conventions for `suggest_next_task` and the
create/update hooks — rather than the assumed `src/proactive/` stack. Keep the
user-stories doc as input.

- **Pros:** stops effort bleeding into an un-implementable target; removes the
  misleading shelf entry; preserves the legitimate user needs as a clean input
  for a grounded re-proposal; no parallel delivery abstraction; consistent
  with ADR-0309's handling of the dependent Phase 10 plan.
- **Cons:** the suggestion and weekly-ritual features remain unavailable until
  a fresh proposal is written and executed; the eight user stories carry a
  one-time re-scoping cost.

### Option 2 — Implement the plan as written (rejected)

Execute Phases 1–8 against the assumed `src/proactive/` architecture.

- **Pros:** the plan is fully specified (909 lines, 8 phases, acceptance
  criteria, risk matrix).
- **Cons:** requires first rebuilding the Phase 7 service layer, tables, and
  config keys the plan extends — multi-phase work against code that was
  deliberately removed. Creates a second proactive delivery path alongside
  `src/deferred-prompts/`. Migration slot conflict. Phases 5–6 have no target
  code. Net effort high, worthiness low.

### Option 3 — Partial salvage: implement only the suggestion service, skip the proactive parts (rejected)

Build `src/suggestions/` and the `create_task` / `update_task` hooks (Phases
1–4, 7, 8) while dropping the alert suffixes and weekly features (Phases 5–6)
that depend on the removed module.

- **Pros:** the `EventSuggestionService` core is the least coupled to the
  removed infrastructure and covers US1–US3 and US8.
- **Cons:** partial execution of a stale plan still anchors the work to the
  plan's outdated file layout, tool-factory signatures, and system-prompt
  patching approach, all of which have drifted. The same features, scoped
  against current code through `/opsx:propose`, cost no more and produce a
  coherent, reviewable change instead of a half-executed legacy plan. Better
  to re-scope cleanly than to land a fragment.

## Decision

**Archive the plan. Do not implement it as written.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), alongside its
   companion `docs/superpowers/remaining/` entry, so it no longer presents as
   actionable backlog.
2. **Do not rebuild the `src/proactive/` service tree.** The proactive firing
   path remains `src/deferred-prompts/`; weekly scheduling and interactive
   alerts, if added, belong in a design that composes with it.
3. **Re-route the user stories if still wanted.** Any future event-driven
   suggestion or weekly-ritual work enters through `/opsx:explore` /
   `/opsx:propose` against the current architecture, treating
   `docs/user-stories/phase-09-event-driven-suggestions.md` as input rather
   than as a contract on the old plan's file structure.
4. **Do not allocate the `011_event_suggestions` migration slot.** That number
   is taken (`011_proactive_alerts.ts`); any future migration is numbered from
   the current baseline.
5. **Salvage by reference, not by execution.** The plan's Jaccard
   title-similarity approach, significance thresholds (≥3-day due-date
   regression, priority-rank reduction), and priority-ranking scoring formula
   remain reasonable design inputs for a future proposal, but they are inputs,
   not instructions.

## Consequences

### Positive

- A multi-phase, low-worthiness effort (rebuilding a removed dependency stack
  against a superseded abstraction) is removed from the actionable backlog.
- The active plans shelf no longer carries a target that contradicts the real
  `src/deferred-prompts/` delivery path.
- The legitimate user needs (US1–US8) are preserved as a re-scoping input
  rather than lost; a future proposal starts from the actual code.
- No second proactive delivery abstraction is introduced.
- Consistent triage with the dependent Phase 10 plan (ADR-0309), which assumed
  this phase's output.

### Negative

- The suggestion features (missing-field nudges, significant-change alerts,
  completion follow-ups, `suggest_next_task`) and weekly rituals (summary,
  kickoff) remain unavailable until a fresh proposal is written and executed.
- One-time cost to re-scope the eight user stories against the current
  architecture.

### Risks

- **The underlying user need goes unmet.** Bare-bones tasks still surface no
  proactive suggestions and there is no weekly summary/kickoff. Mitigation: if
  this pain resurfaces, it is the trigger to open the fresh OpenSpec proposal
  referenced above — the user-stories doc and this plan's design details are
  preserved as input.
- **Future agents rediscover the stale plan and treat it as actionable.**
  Mitigation: the plan's relocated copy and this ADR both carry the superseded
  marker and a pointer here; the `remaining/` companion doc is updated or
  retired to match.
- **Re-proposal re-derives similar design.** Some structure (suggestion
  payloads in tool results, significance thresholds) is likely to recur; that
  is acceptable because it will be grounded in the real tool and delivery
  paths rather than assumed.

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan: the dependent
  plan that assumed this phase's `weekly_state` table and config keys; archived
  for the same reasons.
- **ADR-0030** — Deferred Prompts System ("Supersedes 0026"): the redesign that
  routed the proactive firing path through `src/deferred-prompts/`, making the
  `src/proactive/` stack this plan extends obsolete. (ADR-0030's source file
  was pruned with the 0001–0100 batch; referenced via the `README.md` index.)
- **ADR-0026** — Proactive Assistance (Phase 7): the original proactive layer
  this plan was meant to extend; itself superseded by ADR-0030.
- **ADR-0302** — Remove Deferred-Prompt Execution Modes: documents the current
  shape of the proactive full-generation path that any future weekly or
  suggestion delivery would compose with.

## References

- Plan: `docs/superpowers/plans/2026-03-20-phase-09-event-driven-suggestions.md`
- Companion status doc:
  `docs/superpowers/remaining/2026-03-20-phase-09-event-driven-suggestions.md`
  (`Status: not_implemented`)
- User stories (preserved as future-proposal input):
  `docs/user-stories/phase-09-event-driven-suggestions.md`
- Codebase verification (2026-08-07): `src/suggestions/` and `src/proactive/`
  absent; migration `011` is `011_proactive_alerts.ts`; migration `013` drops
  `alert_state`; none of `weekly_review` / `workdays` / `week_end_time` /
  `week_start_time` / `suggest_next_task` / `EventSuggestionService` appear in
  `src/`; migration baseline at `075`.
