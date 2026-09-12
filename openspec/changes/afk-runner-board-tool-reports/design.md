# Design — afk-runner board tool reports

## Context

The board's serve module already reads the whole `events.ndjson` into memory per load and projects it through pure folds (`view-model.ts`, `run-detail.ts`); the client is one no-build vanilla page that re-renders fully per SSE snapshot. Nothing in this change touches the kernel, the drive loop, the ladder, or any writer. See `proposal.md` for the motivation and the corpus evidence (delta/done equality on clean agents; the 8.62M tok · $2.85 kill-lossy gap on `walk-item-green-live`).

## Goals / Non-Goals

Goals: honest live spend, a feed that answers "what is happening", history reachability, per-stage accounting — all inside the serve module's pure projections, all read-only.

Non-Goals (beyond the proposal's): no kernel/fold changes (`step_finish` stays L0 noise the kernel never sees); no change to `RunDetailView`'s existing consumers beyond additive fields; no client framework.

## Decisions

### D1 — Spend is a new board-local delta fold, not a `usageTotalsOf` change

`usageTotalsOf` (`work/gate-signals.ts`) feeds the R4 fail-closed ladder, `accounting.ts`, and the analyzer; changing its semantics is a behavioral change to budget enforcement and is declined to its own change. The board gets its own pure fold over the same events array (same shape as `spendOf`/`todosOf` — a scan, no new read):

- **Union rule:** spend = Σ all `step_finish` deltas + Σ per-completion `max(0, done.usage − Σ that agent's deltas since its previous completion)`. On every corpus fixture this equals Σdeltas exactly (clean sessions: done ≡ Σdeltas; killed/retried sessions: deltas ≥ done, the clamp yields 0). The clamp exists for the hypothetical backend that emits a completion aggregate without per-step deltas — the fold then still counts it. Deltas are never counted twice because they are never re-emitted; completions enter only through the clamped residual.
- **costKnown:** false when any contributing delta (or residual) carries tokens > 0 with cost 0 — the per-`done` rule, one altitude finer. Delta cost is opencode's own per-step number (`event-stream.ts` parses it raw), so no pricing knowledge lives in the board.
- A corpus test pins the fold's total to the fixture lanes' known values, including the kill lane.

*Alternative considered:* "Σdeltas + Σdeltas-after-last-done per agent" (skip dones entirely) — simpler, but drops the hypothetical done-without-deltas backend and makes the killed-turn story subtly harder to test. *Alternative rejected:* migrating `usageTotalsOf` in place — the ladder's fail-closed semantics must not drift inside a reporting change.

### D2 — Feed tiers: strips for activity, enriched lines for signal, exclusion for heartbeat

- `step_finish` and `tool_use` never render as feed lines. They project into **per-agent strips** (server-side, in the detail projection): agent label, model, live ticker (the agent's delta sum), most recent tool call + argument, transcript path (`<runDir>/transcripts/<label>-r<round>-a<attempt>.jsonl`, displayed like `gate-<v>.md` already is). A strip collapses into its agent's enriched `done` line when the completion lands. Grouping key: agent label; an agent is in-flight from its `spawned` until its terminal event (`done`/`killed` + no later `spawned`).
- Signal lines are enriched by extending the existing `summarizeEvent` fall-through: `spawned` → role + model; `finding` → action + class + detail; `done` → model + usage + cost; `retrying`/`killed` → reason/cause + attempt; `task`, `convergence`, `stage_*`, `gate` keep their current shapes.
- `auto_decision` with `decision: 'pending'` is excluded **before** the bound is applied, mirroring the `agent_todos` exclusion pattern (a todo burst cannot shrink the feed; a heartbeat flood cannot either — the 6,339-heartbeat lane is the pin).
- *Alternative considered:* a general "collapse consecutive same-type lines + count" rule. Declined: harder to spec and test, and the only known flood is exactly one type; a future flood type adds its own explicit exclusion with its own pin.

### D3 — History: fat signal window + immutable pagination below the tail

- The live window bound applies to **rendered feed content** (signal lines + strip headers), sized so typical runs fit whole (corpus: 60–430 signal events; ~250 covers 10/16 lanes entirely). The number is tunable and not spec-pinned.
- New read-only route `/api/runs/:id/events?before=<seq>&limit=<n>` returns the page strictly below `seq`, riding the same token gate, seam, and torn-tail tolerance. Append-only logs make below-tail pages immutable — the client fetches each page at most once per open run and prepends it. The client keeps a small ephemeral per-run page cache; this is the one deliberate deviation from "no client state beyond token + selected run", bounded and discarded on back-navigation.

### D4 — Per-stage accounting: ts-window join, re-entries summed

Same join as the analyzer's per-round `roundOfOpens` precedent, keyed on `stage_enter`/`stage_exit` timestamps instead: each stage's wall is the sum of its enter→exit windows; the in-flight stage's wall is latest-enter→render-time (`now` already threads through the projections). Token/cost attribution assigns each delta (and completion residual) to the stage whose window contains its `ts`. Wall is **occupancy** time — a gate-parked stage's wait counts toward its stage. Known trade-off, accepted: the stage table answers "where did the run spend its time", not "where did it do work".

### D5 — Client rendering stays full-re-render; scroll is handled explicitly

The page keeps the D6 doctrine (no patch/merge; re-render per snapshot). Two scroll details:

- New feed content appends below the fold; page-level scroll anchors survive re-render because height grows below the viewport.
- "Load earlier" prepends content; the client adjusts `scrollTop` by the prepended height once, so the reading position does not jump.

## Risks / Trade-offs

- [Done-without-deltas backend appears and over-reports] → the union rule's clamp counts the residual exactly once; corpus pins equality today, so any drift fails loudly in tests.
- [Detail payload grows (strips + stage table + fat window)] → measured worst case ~tens of KB at 2s cadence over loopback/LAN; accepted.
- [Heartbeat exclusion is type-specific] → each exclusion carries a fixture pin (the 6,339-heartbeat lane); a new flood type must add its own, per D2.
- [Occupancy wall includes gate-park waits] → documented in D4; a "work-time wall" would need park-aware windows — declined until asked for.
- [`run-detail.ts` approaches `max-lines`] → the feed/strip/stage projections extract into sibling pure modules under `serve/` when the hook signals; the serve module's projection home stays.

## Migration Plan

Additive: one new route, additive `RunDetailView` fields, no persisted state, no writer changes. Rollback is `git revert`; the board degrades to today's rendering if the client cache or new fields are absent.

## Implementation deltas (recorded at close-out)

- The heartbeat pin measures **6,339** pendings on `runner-cli-config-live` (the README's 6,333 was the pre-harvest count); the test pins the fixture's actual number.
- `RECENT_EVENT_LIMIT` (20) became `SIGNAL_EVENT_LIMIT` (250) — same role, renamed for the fat-window semantics (D3).
- The stage fold's windowing rule (D4 precision): a `stage_enter` while the stage is still open **splits** the window at the re-entry (the walk's task-to-task shape re-enters implement without an exit). Completed walls are identical to plain summation (the split parts are contiguous); the in-flight window anchors at the latest entry, exactly as the spec's "latest entry to render time" requires.
- The projections live in sibling modules `serve/spend.ts`, `serve/agent-strips.ts`, `serve/stage-accounts.ts` (the D5 risk note's sanctioned extraction), all pure over the already-loaded events array.
- The transcript pointer is derived display-only (`<label>-r<round>-a<attempt>.jsonl`, round from the latest `round_open`, attempt the spawn ordinal within the round) — the harvested lanes carry no `transcripts/` to verify against, and the board never reads the file.

## TDD / Hooks

`afk-runner/src/serve/**` and `afk-runner/src/**` folds are gateable implementation files — the Write/Edit TDD hook pipeline enforces test-first for every file touched; `static/index.html` is an asset and not gated. Order of work (each step red-first against `tests/afk-runner/serve/` and the fixture corpus):

1. Delta spend fold (pure) — pinned to fixture lanes incl. the kill lane.
2. `summarizeEvent` enrichment + heartbeat exclusion (pure).
3. Strip + stage projections (pure).
4. Pagination route (server seam + route tests).
5. Client page rendering (manual + existing serve test harness where it covers the page).

No papai scope-model, DB, tool-prefs, or platform-instance surface is touched; no new dependencies (Bun, Zod, p-limit only).
