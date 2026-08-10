<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0421: Single-Line Live Renderer — Shipped

## Status

Accepted

## Date

2026-08-10

## Context

`docs/archive/2026-08-09-single-line-live-renderer.md` (paired spec
`docs/archive/2026-08-09-single-line-live-renderer-design.md`) replaced the
scrolling per-step live output in review-loop / mutation-improve with one
updating line per unit of work that freezes as a permanent summary line when
the unit finishes. The design and plan landed on master alongside the
implementation, arriving as a late `docs/superpowers/` addition after the
OpenSpec-migration freeze. It was not swept up by the first late-arrival drain
(ADRs 0383–0419); this ADR is the second such batch (one plan + one spec).

## Decision Drivers

- Autonomous-run output was unscannable: a 10-iteration mutation-improve run
  produced 910+ scrolled lines, one per agent step, burying the useful signal.
- mutation-improve's build/mutation gates emitted no live status, leaving the
  screen idle during 30-minute gate runs.
- Design, plan, and implementation landed together on master (verified merged
  into HEAD: commits below).

## Decision

Archive the plan and spec as shipped. The single-line live renderer landed on
master across four commits — the shared renderer `commit` seam, the line-handler
folding, the mutation-improve iteration wiring, and the docs:

- `cc7512a06` feat(review-loop): add LiveRenderer.commit to freeze slots as
  permanent lines (Task 1)
- `7e80e12c6` feat(review-loop): fold step footers into the live line, commit on
  dispose (Task 2)
- `e39d13db8` feat(mutation-improve): one live line per iteration with committed
  summary (Task 3)
- `dbe562903` docs: document single-line live renderer commit model (Task 4)

It is exercised by the review-loop and mutation-improve test suites.

## Consequences

### Positive

- Autonomous-run output is bounded by unit count: ~10 scrolled lines for a
  10-iteration run instead of 900+, with no output capping needed.
- Long gate phases (build, mutation) now show a live ticker instead of dead air.

### Negative

- The non-TTY behavior change is deliberate and irreversible for callers that
  relied on per-step `slot()`/`live()` output: in non-dynamic mode only
  `event()`/`commit()` print. CI logs get one line per unit of work.

## Implementation Status

Implemented. `ProgressReporter.commit?` is present in
`review-loop/src/progress-log.ts`; the `LiveRenderer.commit` method and the
non-TTY `live()` suppression are in `review-loop/src/live-renderer.ts`; the
token-bearing `formatLiveLine` and the dispose-commit wiring are in
`review-loop/src/live-format.ts` / `review-loop/src/line-handler.ts`; the
iteration slot (`ITER_SLOT_KEY`), `formatIterLine`, and `withIterPhase` are in
`mutation-improve/src/iter-line.ts`, committed by `runPipeline`
(`mutation-improve/src/pipeline.ts`) and wired through `mutation-improve/src/cli.ts`.

## References

- Plan: `docs/archive/2026-08-09-single-line-live-renderer.md`
- Spec: `docs/archive/2026-08-09-single-line-live-renderer-design.md`
- Implementation commits: `cc7512a06`, `7e80e12c6`, `e39d13db8`, `dbe562903`
- Drain context: `docs/superpowers/README.md` "Late arrivals from origin/master";
  lane-0-parity convention per ADR-0418 / ADR-0419
