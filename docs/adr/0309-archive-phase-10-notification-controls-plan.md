<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0309: Archive the Phase 10 Notification Controls Plan — Do Not Implement as Written

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-03-20-phase-10-notification-controls.md` is a 790-line
development plan that scopes seven user stories (timezone, quiet hours, working-day
expansion, delivery mode / digest, per-feature toggles, snooze / dismiss /
reschedule, and a preference view / reset) on top of an assumed `src/proactive/`
module: `ProactiveAlertService`, `BriefingService`, `ReminderService`,
`ProactiveAlertScheduler`, `EventSuggestionService`, and the
`alert_state` / `user_briefing_state` / `reminders` / `weekly_state` tables. It
explicitly lists Phases 7, 8, and 9 as hard dependencies and its own Risk Matrix
flags "Phase 7/8/9 not yet implemented when Phase 10 begins" as High-probability /
High-impact.

A codebase verification against the current tree (2026-08-07) found the plan
**not implemented** — a companion doc
(`docs/superpowers/remaining/2026-03-20-phase-10-notification-controls.md`)
already records `Status: not_implemented`. Concretely:

- **The entire `src/proactive/` directory is absent.** None of the plan's target
  files exist: `timezone.ts`, `quiet-hours.ts`, `sender.ts`,
  `notification-actions.ts`, `notification-tools.ts`, `scheduler.ts`, or
  `index.ts`. (The unrelated `src/proactive-history.ts` is a small helper that
  records delivered messages into history; it satisfies no plan task.)
- **The assumed Phase 7/8/9 dependency layer is not present in the assumed
  shape.** The dependency config keys the plan reads from and migrates onto —
  `briefing_timezone`, `deadline_nudges`, `staleness_days`, `workdays`,
  `weekly_review`, `week_start_time`, `week_end_time` — do not appear in
  `src/types/config.ts`.
- **The migration slot is reused.** `012_notification_controls.ts` was never
  created; migration `012` is `012_user_instructions.ts`. The codebase has since
  advanced to migration `075`.
- **Only one of seven new config keys exists.** `timezone` is present
  (`PreferenceConfigKey`); `quiet_hours_start`, `quiet_hours_end`,
  `delivery_mode`, `digest_time`, `morning_briefing`, and `event_suggestions` are
  absent.
- Concept names (`held_messages`, `digest_queue`, `ProactiveMessageSender`,
  `NotificationActionService`, `resolveUserTimezone`, `snoozed_until`) appear
  **only in markdown** — never in `.ts` source.

Most importantly, the plan's assumed architecture was **superseded** rather than
merely delayed. ADR-0030 ("Deferred Prompts System", status "Implemented —
Supersedes 0026") routed the proactive firing path through
`src/deferred-prompts/` (the poller, `proactive-llm.ts`, progressive disclosure —
see ADR-0302), not through a `src/proactive/` service stack. The
`ProactiveAlertService` / `BriefingService` / `ReminderService` /
`ProactiveAlertScheduler` / `EventSuggestionService` classes the plan extends
were therefore never built in that form, and the plan's Tasks 2.2, 4.2, and 5.x
(migrate `chatProvider.sendMessage` callers, add guards to those services) have no
target code to act on.

Executing Phase 10 as written would thus require first reconstructing the missing
Phase 7/8/9 service layer — turning the plan's estimated 22h into multi-week work
across three phantom phases — and then layering on a `src/proactive/` tree that
duplicates a delivery path the codebase already solved under a different
abstraction.

## Decision Drivers

- **Foundation does not exist.** The plan extends services, tables, and config
  keys that were never created in the assumed form; it cannot be executed
  top-down without first rebuilding its dependency stack.
- **Architecture has diverged.** The proactive path is `src/deferred-prompts/`
  (ADR-0030 / ADR-0302), not `src/proactive/`. Re-introducing a parallel
  service tree would create a second delivery abstraction.
- **Plan rot.** Migration slot `012` is occupied and the migration baseline has
  moved to `075`; several tasks (2.2, 4.2, 5.x) are moot because their edit
  targets do not exist.
- **Feature value is real but the path is stale.** Timezone-aware quiet hours,
  delivery modes, and snooze controls are genuine product value — but not worth
  the cost of resurrecting a superseded three-phase dependency stack.
- **Stale plans mislead.** Leaving an un-implementable plan on the active
  `docs/superpowers/plans/` shelf invites future effort to be spent against a
  target that no longer matches the code.

## Considered Options

### Option 1 — Archive the plan; pursue the feature (if wanted) via a fresh OpenSpec proposal (chosen)

Mark the plan superseded and move it out of the active plans shelf. If the
notification-control user stories
(`docs/user-stories/phase-10-notification-controls.md`) are still wanted, route
them through `/opsx:propose` grounded in the current `src/deferred-prompts/`
architecture rather than the assumed `src/proactive/` stack. Keep the existing
`timezone` config key and the user-stories doc as inputs.

- **Pros:** stops effort bleeding into an un-implementable target; removes the
  misleading shelf entry; preserves the legitimate user needs as a clean input
  for a grounded re-proposal; no parallel delivery abstraction.
- **Cons:** the notification-control feature remains unavailable until a fresh
  proposal is written and executed; the seven user stories carry a one-time
  re-scoping cost.

### Option 2 — Implement the plan as written (rejected)

Execute Phases 1–8 against the assumed `src/proactive/` architecture.

- **Pros:** the plan is already fully specified (790 lines, 8 phases, acceptance
  criteria, risk matrix).
- **Cons:** requires first rebuilding the Phase 7/8/9 service layer, tables, and
  config keys the plan extends — multi-week work across three phantom phases.
  Creates a second proactive delivery path alongside `src/deferred-prompts/`.
  Migration slot conflict. Tasks 2.2 / 4.2 / 5.x have no target code. Net effort
  high, worthiness low.

### Option 3 — Partial salvage: extract the still-valid pieces now (rejected)

Pull out the pieces that do fit the current architecture (e.g. the `timezone`
key already landed; the six missing config keys; the `resolveUserTimezone`
helper) and implement them incrementally without the gating services.

- **Pros:** ships small, correct increments (timezone fallback, config keys)
  without committing to the full gating stack.
- **Cons:** the gating value (quiet hours, digest, snooze/dismiss) lives in the
  services the plan defines; without them the salvaged config keys are inert. A
  feature-key with no consumer is debt, not value. Better to scope the keys
  together with their consumers in a fresh proposal than to land orphans.

## Decision

**Archive the plan. Do not implement it as written.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), alongside its
   companion `docs/superpowers/remaining/` entry, so it no longer presents as
   actionable backlog.
2. **Do not build the `src/proactive/` service tree.** The proactive firing path
   remains `src/deferred-prompts/`; notification gating, if added, belongs there
   or in a design that composes with it — not in a parallel abstraction.
3. **Re-route the user stories if still wanted.** Any future
   notification-control work enters through `/opsx:explore` / `/opsx:propose`
   against the current architecture, treating
   `docs/user-stories/phase-10-notification-controls.md` as input rather than as
   a contract on the old plan's file structure.
4. **Keep the `timezone` config key** that already landed; it is valid
   independent of this plan.
5. **Do not allocate the `012_notification_controls` migration slot.** That
   number is taken (`012_user_instructions.ts`); any future migration is
   numbered from the current baseline.

## Consequences

### Positive

- A multi-week, low-worthiness effort (rebuilding three phantom phases against a
  superseded abstraction) is removed from the actionable backlog.
- The active plans shelf no longer carries a target that contradicts the real
  `src/deferred-prompts/` delivery path.
- The legitimate user needs are preserved as a re-scoping input rather than lost;
  a future proposal starts from the actual code, not from a 790-line assumption.
- No second proactive delivery abstraction is introduced.

### Negative

- The notification-control feature (quiet hours, digest/muted modes,
  snooze/dismiss/reschedule, preference view/reset) remains unavailable until a
  fresh proposal is written and executed.
- The existing `timezone` config key is, for now, an orphan relative to the
  gating consumers this plan would have attached to it.
- One-time cost to re-scope the seven user stories against the current
  architecture.

### Risks

- **The underlying user need goes unmet.** Users in non-UTC timezones or with
  non-standard schedules keep receiving proactive messages at arbitrary local
  times. Mitigation: if this pain resurfaces, it is the trigger to open the fresh
  OpenSpec proposal referenced above — the user-stories doc is preserved as
  input.
- **Future agents rediscover the stale plan and treat it as actionable.**
  Mitigation: the plan's relocated copy and this ADR both carry the superseded
  marker and a pointer here; the `remaining/` companion doc is updated or
  retired to match.
- **Re-proposal re-derives similar design.** Some structure (delivery-mode
  decision tree, quiet-hours gate) is likely to recur; that is acceptable
  because it will be grounded in the real delivery path rather than assumed.

## Related Decisions

- **ADR-0030** — Deferred Prompts System ("Supersedes 0026"): the redesign that
  routed the proactive firing path through `src/deferred-prompts/`, making the
  `src/proactive/` stack this plan extends obsolete. (ADR-0030's source file was
  pruned with the 0001–0100 batch; referenced via the `README.md` index.)
- **ADR-0026** — Proactive Assistance (Phase 7): the original proactive layer
  this plan was meant to extend; itself superseded by ADR-0030.
- **ADR-0302** — Remove Deferred-Prompt Execution Modes: documents the current
  shape of the proactive full-generation path (`buildFullToolSet`,
  `runFullGeneration`, progressive disclosure) that any future notification
  gating would compose with.
- **ADR-0033** — Proactive Delivery Mode — Fix Recursive Scheduling Loop: prior
  delivery-mode work that a fresh proposal would need to stay consistent with.

## References

- Plan: `docs/superpowers/plans/2026-03-20-phase-10-notification-controls.md`
- Companion status doc:
  `docs/superpowers/remaining/2026-03-20-phase-10-notification-controls.md`
  (`Status: not_implemented`)
- User stories (preserved as future-proposal input):
  `docs/user-stories/phase-10-notification-controls.md`
- Codebase verification (2026-08-07): `src/proactive/` absent; `012` migration is
  `012_user_instructions.ts`; only `timezone` of seven planned config keys
  present in `src/types/config.ts`; concept names appear only in markdown.
