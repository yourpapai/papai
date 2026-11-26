<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

# Tasks — afk-runner-service

Phases 0–1 only (design D1); the Phase 2 daemon and Phase 3 bridge are
follow-up proposals gated on this change's evidence artifacts.

## 1. Phase 0 — gate attendance metric (analyzer extension)

- [x] 1.1 Red-first: new `tests/afk-runner/analyze-gate-attendance.test.ts` plus
      synthetic-marked scenario fixtures for the five attendance shapes —
      human-settled gate (no `auto_decision`), policy-settled (record before the
      answer), waiter-settled (record after), never-answered pending gate,
      unjoinable answered gate (torn presentation records) — asserting per-gate
      origin attribution, the wait-latency join, the corpus human-settle rate
      with pending gates listed beside it, and unknown-with-reason degradation.
      Watch it fail. → `bun test tests/afk-runner/analyze-gate-attendance.test.ts`
- [x] 1.2 Implement: new `afk-runner/src/analyze-attendance.ts` — the
      emission-order origin join (shared shape with the extend-origin rule in
      `analyze-gates.ts`, never a copy of its code unless that is the family
      pattern) joined with presented→answered latency; wired into
      `analyze-corpus.ts`/`analyze-report.ts`; JSON output carries per-gate rows
      and the aggregate (rate, median + upper-bound human wait); the
      era-contamination flag excludes development-era runs from the aggregate
      like every other corpus metric. → `bun test tests/afk-runner/analyze-gate-attendance.test.ts`
- [x] 1.3 Sweep the analyzer family for regressions. → `bun test tests/afk-runner/analyze-gates.test.ts tests/afk-runner/analyze.test.ts`
- [x] 1.4 Evidence: run `analyze` over the retained corpus workdirs (`--json`),
      record the attendance numbers — human-settle rate, human-wait summary,
      pending gates — and the promote/demote reading for the Phase 3 settle
      plane into `openspec/changes/afk-runner-service/notes.md` (create it).
      → `bun afk-runner/src/cli.ts analyze <retained workdirs> --json`

## 2. Phase 1 — central-store contract

- [x] 2.1 Red-first: extend `tests/afk-runner/config.test.ts` pinning the
      relocation contract of the `afk-runner-store` spec — a config file with an
      absolute `workDir` resolves bookkeeping to that path (nothing created under
      `<repoRoot>/.afk-runner/` beyond the config itself), the lookup candidate
      stays `<repoRoot>/.afk-runner/config.json`, and a `config.json` inside the
      declared store is never consulted for launch resolution. Watch the new
      cases fail or pin already-passing behavior explicitly. → `bun test tests/afk-runner/config.test.ts`
- [x] 2.2 Audit `afk-runner/src/` for `workDir ⊆ repoRoot` assumptions (path
      joins, relative resolutions); every finding gets its failing test first,
      then the fix. Record the audit result (even zero findings) in `notes.md`.
      → `bun run typecheck && bun test tests/afk-runner/`
- [x] 2.3 New `tests/afk-runner/shared-store.test.ts`: a synthetic store
      holding runs started from two distinct repoRoots — the `runs` roster and
      the serve portfolio render both distinguished by their memos' `repoRoot`,
      run-id resolution works over the store, and both runs keep independent
      directories. Red-first where behavior is new. → `bun test tests/afk-runner/shared-store.test.ts`
- [x] 2.4 Sweep the serve/config suites for regressions. → `bun test tests/afk-runner/serve tests/afk-runner/config-strict.test.ts`

## 3. Phase 1 — dogfood and docs

- [x] 3.1 Move-and-cutover (copy, never move): create
      `~/.afk-runner/projects/<slug>/`, copy the two live worktrees' `runs/`
      into it, write each worktree's pointer config
      (`{"repoRoot": <abs>, "workDir": <abs store>}`), verify `status`, `runs`,
      and `serve` over the store from both worktrees; record the procedure and
      results in `notes.md`. → `bun afk-runner/src/cli.ts runs` (in each worktree)
- [x] 3.2 Dogfood at least one attended gate cycle through the store: the
      pointer line names the store path, a hand-edited settle at that location
      flows through the normal seam, and waiter/steer polling across the
      relocated directory shows no observable latency change. Decide the
      grouping-by-project question (ship now vs ride Phase 2) from the evidence
      and record the decision in `notes.md`. → recorded in `openspec/changes/afk-runner-service/notes.md`
- [x] 3.3 Rollback drill: flip one worktree's config back to local bookkeeping,
      confirm a new run lands under `<repoRoot>/.afk-runner/` while the store's
      historical runs remain listable; record. → `bun afk-runner/src/cli.ts runs`
- [x] 3.4 Docs: update `docs/architecture/afk-runner.md` — a central-store
      layout section (pointer configs, per-project slugs, rollback), the phased
      service roadmap with the Phase 2/3 doctrine pointers (design D5/D6), and
      the evidence-artifact pointers. → `bun run lint`

## 4. Final sweep

- [x] 4.1 Full suite, checks, and strict validation; confirm `notes.md` carries
      both evidence sets (attendance numbers + dogfood record). → `bun test && bun run typecheck && bun run lint && openspec validate afk-runner-service --strict`
