# afk-runner-web-board — Tasks

## 1. View projection (pure core, test-first)

- [x] 1.1 `serve/view-model.ts`: `RunView` + `PortfolioView` types and the pure builder — fold a run's events (`foldEvents` + `readEvents`) joined with its memo; card fields (status, stage, round/cap, gate mode + pending age, task progress line, tokens-first spend with cost lower bound, wall, last activity)
- [x] 1.2 Portfolio sort: gate-pending → running → recently finished; totals footer with unpriced-run count
- [x] 1.3 Run-detail projection: pipeline position, per-round raised/open history, per-task walk with attempts, bounded recent-events feed, pending-gate file pointer
- [x] 1.4 Empty-workdir and torn-tail cases fold to valid views (empty board; incomplete final line treated as absent)

## 2. Read-only fs seam + change sweep

- [x] 2.1 `serve/fs-seam.ts`: injected read-only seam (`readFile`/`readdir`/`stat` only) with a type-level test pinning write members absent
- [x] 2.2 `serve/sweep.ts`: pure "scan run dirs → changed run ids" over memoized (size, mtime) fingerprints; roster growth (new run dir) counted as a change
- [x] 2.3 Torn-tail handling in the sweep path rides `readEvents` tolerance — no new tolerance logic

## 3. Serve verb

- [x] 3.1 `cli.ts`: `serve [--host] [--port] [--token]` routing through `resolveRunnerConfig` (file-declared `workDir` honored); usage line names the new verb
- [x] 3.2 `serve/server.ts`: `Bun.serve` — `GET /` static page, `GET /api/portfolio`, `GET /api/runs/:id`, `GET /events` SSE (snapshot on connect, full snapshot on each sweep change)
- [x] 3.3 Token gate on every route; boot-generated random token printed once as the ready-to-open URL; loopback default bind
- [x] 3.4 `serve/static/index.html`: phone-first portfolio page (vanilla JS + `EventSource`, no build step) — attention-sorted cards with spend bars and task progress lines; run detail with rounds, task walk, recent events, read-only gate render
- [x] 3.5 Read-only proof: serve a live work dir through appends and a gate park; assert event logs, memos, and gate files byte-unchanged

## 4. Verification

- [x] 4.1 Projection/sweep/server suites under `tests/afk-runner/serve/` — `view-model.test.ts` (projection + fs shells), `sweep.test.ts`, `server.test.ts` (route + auth + SSE contract via injected deps), plus `fs-seam.test.ts` (the type-level pin) and `args.test.ts` (nested mirror layout: the TDD test-resolver pairs `afk-runner/src/serve/X.ts` with `tests/afk-runner/serve/X.test.ts`, so the mutation gate finds its companions — the originally sketched flat `serve-*.test.ts` names would pair with nothing)
- [x] 4.2 CLI verb-table + config-ladder tests updated for `serve` (inventory, ladder resolution, passive read-only)
- [x] 4.3 `bun run test:affected` in the loop; full `bun run test`, `bun run lint`, `bun run typecheck`, `bun security` before finishing
- [x] 4.4 Update `docs/architecture/afk-runner.md` with a board section (surface, auth, read-only doctrine) and the module layout entry
