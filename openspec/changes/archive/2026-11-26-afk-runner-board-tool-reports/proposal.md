## Why

The afk-runner web board's run detail answers none of the operator's live questions. The recent-events feed renders `tool_use`/`step_finish`/`spawned` as bare type names while the events carry agent, tool, argument, model, and full token/cost deltas; it is capped at 20 events with no access to earlier ones; the header spend (`9.34M tok · ≥ $4.31`) only moves when an agent finishes; and there is no per-stage wall/tokens/cost breakdown — only run totals. Worse, the done-event-only spend fold is **kill-lossy**: on the C9 live lane (`walk-item-green-live`) the true delta-based spend is 55.07M tok · $20.00 while the done-based total the board shows is 46.46M · $17.15 — 16% of real spend invisible after kills and validation retries. Corpus measurement: `step_finish` deltas equal `done.usage` exactly for clean agents, so the delta stream is the honest live accumulator.

## What Changes

- **Live honest spend**: a new pure delta-based fold (Σ `step_finish` tokens/cost, `costKnown` fail-closed per delta with tokens>0 ∧ cost=0) feeds cards, the detail header, agent strips, and the stage table. Board-local; `usageTotalsOf` and its ladder/accounting consumers are untouched.
- **Feed rebuild**: three tiers — L0 activity collapsed into per-agent strips (live token ticker, last tool, model, transcript path), enriched signal lines for every event type (tool+arg, class+detail, model+usage on `done`), and heartbeat (`auto_decision{pending}`) excluded before the bound.
- **History access**: a fat signal-bounded live window (corpus: ~250 covers 10/16 lanes whole) plus a paginated, immutable-below-the-tail events endpoint (`?before=<seq>`) with a "load earlier" affordance.
- **Per-stage accounting**: wall/tokens/cost per stage from `stage_enter`/`stage_exit` ts-windows with delta attribution (the `roundOfOpens` precedent), re-entries summed, active stage measured enter→now.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `afk-runner-web-board`: spend rendering changes source and cadence (delta-based, updates per event append, not per agent completion); the run-detail requirement's bounded feed becomes tiered with enriched summaries plus history pagination; a per-stage accounting table and in-flight agent strips are added to run detail.

## Impact

- Code: `afk-runner/src/serve/` — `view-model.ts`, `run-detail.ts`, `server.ts` (new events route), `load.ts`, `static/index.html`; tests under `tests/afk-runner/serve/`.
- Docs: `docs/architecture/afk-runner.md` web-board section.
- No papai platform/task instances, config contexts, or DB schemas are touched — afk-runner-local, read-only doctrine unchanged (file access still rides the read-only seam).

## Non-goals

- **Migrating `usageTotalsOf` consumers** (budget ladder R4, `accounting.ts`, `analyze-usage.ts`) to delta-based spend — the undercount fix there is its own change; this change only adds the board-local fold.
- **Transcript serving** — raw opencode NDJSON needs a decoder; the board shows the transcript path (like `gate-<v>.md`) so a terminal operator can `tail -f`. Declined as a later surface.
- **Browser settling / steering** — standing board non-goal.
- **Log-side `auto_decision{pending}` flood dedup** — F-U1 family territory; the feed merely tolerates floods (exclusion before the bound).
- **Transport changes** (`fs.watch`, per-event SSE) — the 2s sweep cadence already delivers per-append freshness; unchanged.
