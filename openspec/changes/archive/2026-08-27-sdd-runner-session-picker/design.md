# Design: sdd-runner-session-picker

## Context

The pipeline consumes `{ taskText, changeName }` strings everywhere except
`runStart` (orchestrator.ts), which reads the task file and derives the change
name from its first `#` heading (`deriveChangeName`, config.ts). Run identity
is a datetime id (`makeRunId`) that names both the storage dir and the CLI
vocabulary; routing lives in `cli-routing.ts` (`resolveTarget`,
`routeByState`, `routeBySoleCandidate`) and fails loudly on ambiguity by
design. Ink front-ends exist for the run view and gate screen
(`tui-run-session.ts`, `tui-gate-session.ts`); `render-mode.ts` picks TUI vs
line renderer once at startup. Cheap run summaries already exist
(`run-lite.ts`, `PersistedLite`). See proposal.md — Why — for motivation.

## Goals / Non-Goals

Goals: one command answers "what is running and what do I do next"; session
identity reads as the task name; starting needs no repo file. Non-goals as in
the proposal (no rename/delete/liveness/filtering).

## Decisions

**D1 — Slug id becomes the storage key for new runs (Option A over a display-name field).**
`makeRunId` is replaced at creation time by slugify(title) with collision
handling: refuse while a non-terminal run holds the name; otherwise take the
next free `<slug>-2`, `<slug>-3`. Legacy datetime dirs are never rewritten;
`resolveRunId` prefix matching already handles them. Rejected alternative B
(keep datetime keys, add `name` to state.json): two identities to keep in sync,
and every surface (dir listings, prefixes, transcripts paths) keeps speaking
the opaque key. Slug rules: lowercase, `[a-z0-9-]`, collapse separators, clamp
to 64 chars — deterministic and filesystem-safe.

**D2 — The session screen is a front-end over existing routing, not new routing.**
A pure `listSessions(workDir)` returns display rows (state.json fields + a
progress projection from the run's event log tail + usage aggregates); the Ink
screen renders rows and returns a selection; selection re-enters
`resolveTarget`-equivalent verbs (`runGateResume`, `runResume`,
`buildReport`). Ambiguity on a terminal therefore routes through the same code
path scripts use, keeping the non-TTY contract byte-identical. Row actions call
the existing harness seams (`requestCalmStop`, `runGateReopen`) — no new
orchestrator verbs. `runGateReopen` already accepts any run with a settled gate
event (gate.ts), so ABORT-settled gates need no relaxation.

**D3 — Inline start rides the existing string seam.**
`StartOptions` gains a text variant (`taskText` + explicit name or
title-derived); `runStart` stops being the only file reader by branching once:
file source reads bytes then continues, text source persists `task.md` into the
freshly created run dir first so provenance and later resumes never depend on a
repo file. Name derivation stays `deriveChangeName` semantics — first line of
the description is the heading. Depth override flow unchanged.

**D4 — Progress projection is derived, never stored.**
Rows compute stage/round/cap from `readAllRunStates`, review-round detail from
the last events, token/cost from the usage aggregator, recency from
`updatedAt`. Long event logs are read tail-only; `PersistedLite` is reused
where it already covers a field. No schema/migration: state.json gains no
fields (D1 ids carry the name).

**D5 — Zombie rows render persisted truth.**
Status comes from disk only; a stale `running` row says running. Selecting it
attaches via the existing run-screen remount (event re-fold). Exclusive-claim
liveness is deliberately deferred to the driver-claim work planned in
`sdd-runner-decomposition` (design D8); this change neither preempts nor
duplicates it.

Scope-model note: no chat surfaces, tools, or tool-prefs gating are touched;
all new persisted state is runner-local under `.sdd-runner/runs/<id>/` keyed by
run id only — no user/group/thread context keys. No DB or drizzle changes. No
new dependencies: Ink, react, and existing helpers cover the screen (dependency
question answered one level in: `tui-gate-session.ts` is the pattern).

Hook/TDD interaction: new modules (`session-list.ts`, `tui-session-screen.ts`
or similar under `sdd-runner/src/`) and their tests fall under the Write/Edit
TDD hook pipeline; work proceeds test-first per tasks.md ordering.

## Risks / Trade-offs

- [Same title, different intent] → D1 refuses loudly naming the active holder;
  suffixing only past terminal states.
- [Slugification surprises (unicode, very long titles)] → clamped ASCII slug +
  full title kept verbatim inside the run dir's task record; id lossy, content
  not.
- [Listing cost on many/large runs] → tail-only event reads and lite states;
  screen renders after list resolves, line renderer unaffected.
- [Picker hides scripted determinism] → non-TTY path untouched and pinned by
  the modified spec scenarios.

## Migration Plan

No data migration: new ids apply only to newly created runs; existing datetime
dirs operate as before. Rollback is a plain revert — no persisted shape changes
beyond new run directories already self-describing.

## Open Questions

- Exact keymap and whether a completed row's Enter prints the report inline vs
  opening a scrollable view.
- Screen behavior when runs exceed one page (pagination vs scroll).
