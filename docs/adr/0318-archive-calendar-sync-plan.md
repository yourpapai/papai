<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0318: Archive the Calendar Sync Implementation Plan — Do Not Implement the CalDAV Sync Feature as Planned

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-04-17-calendar-sync-implementation.md` (~80
checkbox steps across 9+ tasks) proposes adding **bidirectional recurring task
sync and event notifications for Google Calendar and Apple Calendar** via
tsdav (CalDAV) and ical.js. The plan specifies a new `src/calendar/` module
(`CalendarProvider` interface, CalDAV client wrapper, Google OAuth flow with a
local callback server, Apple Basic-auth provider, RRULE ↔ cron parser,
iCalendar event mapper, bidirectional sync engine with ETag/hash change
detection and user-mediated conflict resolution, sync-state DB operations,
notification scheduler, scheduler registration), **10 new chat tools**
(`connect_calendar`, `disconnect_calendar`, `list_calendars`,
`list_calendar_events`, `get_upcoming_events`, `sync_recurring_to_calendar`,
`sync_calendar_to_recurring`, `list_sync_links`, `resolve_sync_conflict`,
`dismiss_calendar_event`), 3 new DB tables (`calendar_connections`,
`calendar_sync_links`, `calendar_event_reminders`) via migration
`024_calendar_sync`, 8 new config keys with encrypted credential storage, and
wiring into `tools-builder.ts`, `scheduler-instance.ts`, and `index.ts`. A
design spec exists at
`docs/superpowers/specs/2026-04-17-calendar-sync-design.md`.

A codebase verification against the current tree (2026-08-07) found the plan
**entirely unimplemented — 0/80 checkbox steps completed**:

- `src/calendar/` does not exist; none of the module files (errors, types,
  rrule-parser, event-mapper, caldav-client, google-auth, google/apple
  providers, factory, sync-engine, sync-state, notification-scheduler,
  calendar-scheduler) are present.
- None of the 10 calendar tools exist under `src/tools/`; no calendar tests
  exist under `tests/calendar/` or `tests/tools/`.
- `package.json` has no `tsdav` or `ical.js` dependencies.
- No calendar config keys in `src/types/config.ts`; `SENSITIVE_KEYS` in
  `src/config.ts` unchanged; no calendar tables in `src/db/schema.ts`; no
  migration `024_calendar_sync` (migrations have since advanced to 073–075);
  no wiring in `src/tools/tools-builder.ts`, `src/scheduler-instance.ts`, or
  `src/index.ts`.

The plan is not marked superseded. Since it was written (2026-04-17), the
codebase has moved on materially: migration numbering has drifted far past
024, and — more significantly — the **scope model and identity model have
changed**. Config and durable assets are now keyed by **config context ids**
(group-shared across threads), platform instances tag all identity, and all
user-facing configuration happens in the **settings UI** (bootstrapped from a
single-use `/config` link), not in chat. The plan's per-user `getConfig`/
`setConfig` credential model and chat-tool-driven connect flow predate these
conventions.

## Decision Drivers

- **Nothing has landed, so archiving costs no sunk implementation.** Unlike
  partially-implemented plans, there is no shipped slice to preserve or
  reconcile — only the plan document and its design spec.
- **The plan's integration points are stale.** Migration 024 is long
  renumbered; the credential model assumes per-user config keys rather than
  the current context-scoped, settings-UI-managed, encrypted configuration;
  a local HTTP OAuth callback server conflicts with the bot's deployed
  settings-UI/web surface, which did not exist in its current form when the
  plan was written.
- **The feature is a large, high-maintenance surface with no demonstrated
  demand.** Bidirectional CalDAV sync means two external provider adapters
  with divergent auth (Google OAuth + token refresh, Apple app passwords), an
  RRULE↔cron lossy conversion layer, a conflict-detection/resolution engine,
  encrypted token storage, two new polling scheduler tasks, and 10 new tools —
  all to be built speculatively. No user request or incident on record drives
  it.
- **The planning workflow has moved to OpenSpec.** Per `AGENTS.md` (Pi
  Workflow), code-behavior work enters through `/opsx:explore` /
  `/opsx:propose` under `openspec/changes/<name>/`. If calendar sync is ever
  wanted, it should be re-proposed there against the then-current scope,
  identity, and settings-UI model — not executed from this legacy plan.
- **Stale plans mislead.** An open, fully-unchecked 80-step plan presents as
  actionable backlog and invites execution against outdated assumptions.
- **The plan lives in a legacy corpus under triage.** `docs/superpowers/` is
  slated for migration per `docs/operations/legacy-migration-runbook.md`
  (archive / adopt / seed / retire lanes).

## Considered Options

### Option 1 — Archive the plan; document the decision in this ADR (chosen)

Mark the plan superseded and relocate it off the active plans shelf (e.g. to
`docs/archive/`) with a pointer to this ADR. Keep the design spec
(`docs/superpowers/specs/2026-04-17-calendar-sync-design.md`) as reference
material. Record that the feature was assessed and not implemented, and that
any future calendar work re-enters through OpenSpec.

- **Pros:** removes a stale, misleading shelf entry; costs nothing in lost
  implementation (none exists); preserves the design spec's domain analysis
  (CalDAV/tsdav choice, RRULE↔cron mapping, conflict model) as reference for
  any future proposal.
- **Cons:** the calendar sync capability remains absent; a future request
  restarts design from the spec rather than from a ready-to-run plan.

### Option 2 — Implement the plan as written (rejected)

Install tsdav/ical.js and execute all 80 steps: the `src/calendar/` module, 3
DB tables, 10 tools, scheduler wiring.

- **Pros:** delivers the full feature matching the plan's stated goal.
- **Cons:** high effort (a new provider-integration subsystem) for a feature
  with no demonstrated demand; the plan is stale at its integration points
  (migration numbering, per-user credential model vs. context-scoped settings
  UI, chat-driven OAuth connect flow vs. settings-UI conventions), so "as
  written" requires rework anyway; adds an ongoing maintenance burden
  (external provider auth expiry, sync conflicts, polling) to the core bot.

### Option 3 — Re-propose calendar sync via OpenSpec now (rejected)

Immediately open an `/opsx:propose` change redesigning calendar sync against
the current scope/settings model.

- **Pros:** produces a correct, current-conventions design.
- **Cons:** speculative — there is no concrete user request; opening a
  proposal now spends design effort on an unrequested feature. The
  re-proposal should happen when demand appears, seeded from the retained
  design spec.

## Decision

**Archive the plan. Do not implement the calendar sync feature on the basis of
this plan. Keep the design spec as reference material.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), with a
   superseded marker and a pointer to this ADR, so it no longer presents as
   actionable backlog.
2. **Do not implement any of the plan's 80 steps** — no `src/calendar/`
   module, no calendar tools, no migration, no `tsdav`/`ical.js` dependencies
   — absent a concrete user request.
3. **Retain the design spec**
   (`docs/superpowers/specs/2026-04-17-calendar-sync-design.md`) as reference
   material: its provider/auth analysis, RRULE↔cron mapping, and conflict
   model remain useful input to any future proposal.
4. **Re-route through OpenSpec if demand appears.** Any future calendar-sync
   work enters through `/opsx:explore` / `/opsx:propose` under
   `openspec/changes/<name>/`, designed against the then-current scope model
   (config context ids), settings-UI configuration conventions, and web
   surface for OAuth callbacks — treating this plan and spec as reference,
   not as a contract.

## Consequences

### Positive

- A high-effort, high-maintenance, demand-free feature is removed from the
  actionable backlog before any effort is sunk into it.
- The active plans shelf no longer carries a fully-unchecked 80-step plan
  whose integration assumptions predate the scope model and settings UI.
- The decision is recorded, so future agents do not "rediscover" the calendar
  plan as pending work.
- The design spec is preserved, so a future, demand-driven proposal does not
  restart domain research from zero.

### Negative

- papai gains no calendar sync / event notification capability; users wanting
  calendar awareness must rely on existing scheduling/reminder features.
- If demand later appears, the redesign and implementation start from scratch
  through OpenSpec (mitigated by the retained spec).

### Risks

- **A user later requests calendar sync and the work must be re-scoped.**
  Mitigation: expected and acceptable — the re-scope goes through OpenSpec
  with the spec as seed material, and would have been required anyway given
  the plan's stale integration points.
- **Future agents treat the stale plan as actionable.** Mitigation: the
  relocated copy and this ADR both carry the superseded marker and a pointer
  here.
- **The plan's domain analysis is lost.** Mitigation: the plan is relocated,
  not deleted, and the design spec remains in place.

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan;
  **ADR-0310** — Archive the Preprocessing Classifier Plan;
  **ADR-0311** — Archive the Layered Architecture Violations Fix Plan;
  **ADR-0312** — Archive the Deep-Thinking Tool Research Plan;
  **ADR-0313** — Archive the User Profile Memory Plan;
  **ADR-0314** — Archive the Phase 09 Event-Driven Suggestions Plan;
  **ADR-0315** — Archive the Test Improvement Roadmap Plan;
  **ADR-0316** — Archive the DB Foreign Keys & Orphan Prevention Plan:
  the precedent for archiving a stale / unimplemented / low-worthiness legacy
  plan with an ADR rather than executing it.
- **Scope model** (`src/chat/context-scope.ts`) and **settings UI**
  conventions (`AGENTS.md`): the architectural evolution that invalidates
  this plan's per-user credential and chat-tool-driven configuration
  assumptions.

## References

- Plan: `docs/superpowers/plans/2026-04-17-calendar-sync-implementation.md`.
- Design spec: `docs/superpowers/specs/2026-04-17-calendar-sync-design.md`.
- Triage basis: `docs/operations/legacy-migration-runbook.md`
  (`docs/superpowers/` → OpenSpec lanes).
- Workflow basis: `AGENTS.md` (Pi Workflow — code-behavior work enters via
  `/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`).
- Codebase verification (2026-08-07): 0/80 checkbox steps completed; no
  `src/calendar/`; no calendar tools or tests; no `tsdav`/`ical.js` in
  `package.json`; no calendar config keys, schema tables, or migration;
  migrations at 073–075; no scheduler/tools wiring; plan not marked
  superseded.
