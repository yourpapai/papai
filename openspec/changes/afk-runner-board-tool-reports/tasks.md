## 1. Delta-based live spend (design D1)

- [x] 1.1 Red-first: a pure spend fold test over fixture lanes — clean lanes render Σdeltas (equal to today's done-based totals), `walk-item-green-live` renders 55.07M tok · $20.00, `killed-turn-usage-undercount-live` keeps its unpriced `costKnown: false` — then implement the board-local union-rule fold and wire `SpendView` to it. Verify: `bun test tests/afk-runner/serve/`
- [x] 1.2 Red-first: portfolio cards and totals carry the delta-based spend (kill lane's card no longer undercounts; totals re-sum it) — extend the view-model tests, then swap `spendOf` to the new fold. Verify: `bun test tests/afk-runner/serve/`

## 2. Feed rebuild (design D2)

- [x] 2.1 Red-first: `summarizeEvent` enrichment — `spawned` names role + model, `finding` names action + class + detail, `done` names model + usage + cost, `retrying`/`killed` name reason/cause + attempt — over unit fixtures and one corpus lane. Verify: `bun test tests/afk-runner/serve/`
- [x] 2.2 Red-first: `auto_decision{pending}` excluded before the feed bound (the 6,339-heartbeat lane leaves signal lines visible in the window); `step_finish` and `agent_todos` excluded the same way. Verify: `bun test tests/afk-runner/serve/`
- [x] 2.3 Red-first: per-agent strip projection — in-flight agents (spawned, no terminal event) render label, model, live delta ticker, last tool + argument, transcript path; the strip collapses at `done`. Verify: `bun test tests/afk-runner/serve/`

## 3. Per-stage accounting (design D4)

- [x] 3.1 Red-first: stage-window fold — enter/exit ts windows summed per stage across re-entries, in-flight stage wall measured latest-enter→`now`, delta spend attributed by ts-window; pinned to a corpus lane's known stage sequence. Verify: `bun test tests/afk-runner/serve/`
- [x] 3.2 Add the stage table to `RunDetailView` and render it in the detail projection tests. Verify: `bun test tests/afk-runner/serve/`

## 4. History pagination (design D3)

- [x] 4.1 Red-first: `/api/runs/:id/events?before=<seq>&limit=<n>` route — token-gated, seam-read, torn-tail tolerant, pages strictly below `seq`, identical content across fetches while the run appends. Verify: `bun test tests/afk-runner/serve/`
- [x] 4.2 Detail payload carries the fat signal-bounded live window; projection tests pin the bound applying to rendered feed content. Verify: `bun test tests/afk-runner/serve/`

## 5. Client page (design D5)

- [x] 5.1 Render tiered feed + strips + stage table in `static/index.html`: enriched signal lines, strip tickers, "load earlier" prepending fetched pages with one-time `scrollTop` adjustment. Verify: `bun run typecheck` + manual board pass over a fixture work dir
- [x] 5.2 Live-pass check: spend moves per sweep while an agent runs (fixture work dir with an appending log), heartbeat floods leave signal visible. Verify: manual + `bun test tests/afk-runner/serve/`

## 6. Close-out

- [x] 6.1 Update `docs/architecture/afk-runner.md` web-board section (delta spend doctrine, feed tiers, pagination route, stage table) and the change's artifacts if implementation diverged. Verify: `bun run lint`
- [x] 6.2 Full gates: `bun test`, `bun run typecheck`, `bun run lint`. Verify: all green
