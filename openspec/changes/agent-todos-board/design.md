# agent-todos-board — Design

## Context

Change A (`agent-todos-capture`) lands `L0 agent_todos {agent, todos[]}` in `events.ndjson`; the board already reads that file per sweep change (`serve/load.ts` `readEvents`), re-folds, and pushes portfolio snapshots over SSE. The detail pane is fetched once on open (`static/index.html` `openDetail`); SSE snapshots re-render only the portfolio. Board capability spec is unarchived (proposal.md — Capabilities).

## Goals / Non-Goals

**Goals:**
- Latest-todos-per-agent surfaces in run detail, live while open, at zero risk to the read-only doctrine.
- The SSE contract and the sweep stay byte-identical in what they watch (events.ndjson + state.json) — todo events move their mtime already, so change detection needs no widening.

**Non-Goals:** card rendering, actions, transcript reads, trajectory views (proposal.md).

## Decisions

**D1 — Projection: backwards scan for the last snapshot per agent.** `buildRunDetail` scans the already-loaded events array in reverse, collecting the first `agent_todos` per agent label until labels stop appearing; result lands in `RunDetailView.todos: {agent, updatedAt, items: {content, status}[]}[]`, ordered by most recent activity. `updatedAt` is the snapshot's stamped `ts` — the scan has it in hand, and it is what the panel renders as a muted relative time (D6), so a finished run's panel is distinguishable from a live one. No fold change, no new file read, no sweep change — the array the detail projection already holds is the only input. Alternative rejected: folding todos into kernel context (violates the noise doctrine — the fold never drives on telemetry).

**D2 — Feed filter sits in the projection, not the client, and fills before it cuts.** `recentEventsOf` skips `altitude: 'L0'` `agent_todos` events *before* taking the last `RECENT_EVENT_LIMIT` — the feed stays full during todo bursts by reaching past the excluded events, instead of shrinking below the bound. Filter-then-slice, pinned by test: a tail of todo-only events renders a full feed of the run's other activity. Filtering server-side keeps the static page dumb and makes the behavior testable in `tests/afk-runner/serve/` without DOM plumbing.

**D3 — Detail liveness: re-fetch on snapshot, throttled client-side.** The SSE `snapshot` handler, when `selectedRun` is set, schedules a detail re-fetch through the existing `openDetail(selectedRun)` path, guarded by a throttle (one in-flight fetch, trailing edge — a snapshot during a fetch marks dirty and refetches once after). Cadence rides the sweep interval; the server pushes full snapshots as before, and no todo content enters the portfolio payload, so the D6 doctrine holds unchanged. Alternative rejected: a separate `/api/runs/:id/todos` endpoint polled by the client (new auth-gated route, new seam traversal, no benefit over refetching the one projection). The fix lives in `static/index.html` — outside the mutation gate; the throttle's contract is pinned by the projection/server suites behind it, and the panel's correctness is testable at the `RunDetailView` level.

**D4 — Panel labeling: caption names the source, form differs from the walk.** The panel header reads "agent todos (agent-emitted)" with each agent's label as a sub-heading; items render as checkbox-glyph lines (`✓ / → / ·` for completed/in-progress/pending) inside the panel block — never as rows of the walk table (which keeps id/status/attempts columns). This is the T8 contract from the spec, enforced in markup, not copy alone.

**D5 — Empty state is absence, not a stub.** `todos: []` renders no panel node at all — pre-change runs, S-depth runs without todo-calling agents, and runs started before Change A look exactly as today (spec scenario).

**D6 — Ordering: most-recent-activity first, with the snapshot's age visible.** Agents sort by the seq of their latest snapshot (descending), so the agent the run is currently inside leads the panel — the phone question "what is it doing now" is answered by the top entry, without scrolling. Each agent sub-heading carries `updatedAt` (D1) rendered as a muted relative time ("· 12s"), so a live run's panel reads as live and a finished run's panel honestly shows its age without any extra fetch.

## Risks / Trade-offs

- [Detail re-fetch refolds the log on every throttle window] → the board already refolds per change for the portfolio; the added cost is one projection pass per window, bounded by the throttle, on a local read.
- [Backwards scan cost on long logs] → the scan stops once every seen label has a snapshot and no new labels appear above; in practice labels cluster in the recent tail. Worst case is the same order as the fold the detail already runs.
- [`index.html` grows past its no-build-step simplicity] → the panel and throttle are ~40 lines of vanilla DOM; if the page outgrows that, extraction is a later design question, not this change.
- [L0 label collision — two spawns sharing a label across attempts] → labels are unique per spawn bracket today (attempt suffixes live in the session ledger, not the label); the last-snapshot-wins rule then reflects the live agent, matching every other L0 surface.

## Hook/TDD interactions

Gateable: `afk-runner/src/serve/run-detail.ts` — test-first in `tests/afk-runner/serve/run-detail.test.ts`: (1) todos projection from a log with multiple agents/updates (last-wins, ordering, absence), (2) feed excludes `agent_todos` while keeping other L0/L1 types, (3) spec scenarios for no-telemetry runs. `static/index.html` changes are not gateable; they land after the projection tests, verified by serving a fixture work dir.

## Open Questions

None blocking. Card-level todo hints stay declined; if a later change wants them, the SSE payload doctrine is the design surface to revisit.
