<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## Context

See `proposal.md` — Why for the fragmentation problem. The facts that shape this design:

- **Fold-is-truth**: run state is a pure projection of the append-only `events.ndjson`; `state.json` is a derived memo. Storage is dumb files — a run dir copied anywhere still folds. A central store adds no state ownership, only location.
- **The workDir already relocates**: the five-key ladder (`config.ts`, D1–D8 in `openspec/changes/task/design.md`) resolves `workDir` via `path.resolve(repoRoot, workDir)` — an absolute value wins. Central storage is reachable by config today; what is missing is a *pinned contract*, a layout, and evidence.
- **The read surfaces are DI-seamed**: `BoardOptions` injects `loadPortfolio`/`loadRunDetail`/`sweep` (`serve/server.ts:41-43`); multi-store aggregation is a new loader, not a rewrite.
- **The write-race machinery exists**: gate claims are pid-carried first-writer-wins (C4, dead-pid steal proven at C7); the steer grammar is a text protocol; `holder.json` + `kill(pid, 0)` (`stop-controller.ts:85`) is a per-run process table that survives any observer's restart.
- **The daemon pattern exists in-repo**: the context-vault indexer (`docs/architecture/context-vault.md`) — lock-file singleton, TTL-authoritative reclaim, 0600 unix-socket registration, N repos one daemon, repo identity from `.git` gitdir, token never on disk.
- **The analyzer already attributes settle origin** per gate by emission order (record-before-answer → policy, record-after → waiter, no record → human) — the human-attendance question is answerable zero-spawn.

Constraints: runs are terminal-tethered today (`start` parks-and-exits; the waiter rides `resume`; a live run dies with its shell, recovered by refold); `.afk-runner/` is git-ignored per-checkout by design (config is per-checkout, never round-trips a clone); the event schema is the inter-version contract, with two-layer fold tolerance.

## Goals / Non-Goals

**Goals:**

- Pin central per-project storage as a contract of the existing ladder, and dogfood it live on two worktrees.
- Deliver the gate-attendance forensics metric that prices the later remote-control phases.
- Map the full phased arc — including the Option 2 (aggregator) vs Option 3 (bridge) comparison — so each follow-up change starts from decided doctrine, not re-exploration.

**Non-Goals (design-level):**

- No daemon, no control plane, no settle delegation in this change (Phases 2–3 below).
- No change to the config ladder's resolution order or the non-relocatable lookup (the circularity guard holds: the candidate is always `<repoRoot>/.afk-runner/config.json`).
- No engine or fold changes; the kernel, drive loop, settle seam, and waiter are untouched.

## Decisions

### D1 — Evidence-gated phasing; this change delivers Phases 0–1 only

The arc, each phase its own explored change:

```
Phase 0  gate-attendance forensics      zero-spawn analyzer metric
Phase 1  central-store dogfood          contract pin + layout + live evidence
            │ evidence gate: dogfood notes (readability, latency, friction)
            ▼
Phase 2  aggregation daemon (Option 2)  context-vault-style singleton,
            │                           registry, ONE board over N stores
            │ evidence gate: probe's human-settle rate
            ▼
Phase 3  bridge (Option 3)              spawn supervision, delegated settles,
                                        split-plane control, papai-bot client
```

*Alternative*: commit the full arc in one change — rejected: the settle plane's value is unpriced (the ladder and deadline-waiter already absorb most gates; U13 measured operator discovery <20% of attended wall), and the repo's C-cycle idiom is one evidence-gated deliverable per change.

### D2 — Phase 0 is an analyzer extension, not live instrumentation

A new metric family in `afk-runner-analysis` (`analyze-gates.ts` grows the join): per gate — settle origin × presented→answered latency; aggregated — human-settle rate, median/p90 human wait, waiter-vs-human split. Zero spawns; era-contamination flag respected; `known`/`unknown-with-reason` reporting per the analyzer's contract.

*Alternative*: instrument the waiter live — rejected: observation changes behavior, the corpus already records every fact needed, and the C9/U13 lanes are recent enough to be representative.

### D3 — Store layout: per-project `~/.afk-runner/projects/<slug>/`

Each project (repo) gets one store; each worktree's pointer config targets it. Run ids are timestamp+uuid (collision-free across worktrees); the memo's `repoRoot` distinguishes worktrees inside one store.

*Alternatives*: one flat shared `runs/` namespace (rejected: destroys `analyze` corpus isolation and per-project gc; grouping-by-memo is weaker than grouping-by-directory); per-worktree stores (rejected: recreates the fragmentation this arc ends).

### D4 — The worktree keeps exactly one file: `.afk-runner/config.json`

The pointer is `{"repoRoot": "<abs>", "workDir": "<abs store path>"}` — the ladder's wholesale-authoritative file rung, already implemented. Phase 1 pins absolute-`workDir` as contract (spec + tests over `resolveRunnerConfig`), audits for any code assuming `workDir ⊆ repoRoot` (grep for path joins), and fixes forward what the audit finds.

### D5 — Phase 2 doctrine (follow-up change): aggregator daemon, context-vault transplant

Singleton via lock file `{pid, heartbeatAt}` (TTL-authoritative reclaim); worktrees register over a 0600 unix socket; one board fans SSE across registered stores; fold ownership = **memo-only portfolio, delegated detail** (cards from `state.json` memos; per-run detail folds via the registered worktree's own engine) — the service bundles no engine. Aggregation plugs into the existing `BoardOptions` DI seams; the multi-root sweep is a roster-of-rosters over `sweepRuns`.

### D6 — Phase 3 doctrine (follow-up change): bridge with zero engine logic, split-plane security

The comparison this design exists to settle:

|                     | Option 2 (aggregator)                     | Option 3 (bridge)                                             |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| What crosses       | reads only                                | reads + intents (start/resume/stop/settle)                     |
| Doctrine           | "no write path crosses the service"       | "the service writes nothing itself — it causes the worktree's own code to write, through existing seams" |
| New capability     | single pane                               | ambient runs (terminal-untethered), any-client control, papai-bot as client |
| Security posture   | unchanged (token-gated loopback HTTP)     | split-plane: HTTP board stays read-only forever; control plane is a 0600 unix socket (file perms are the auth — context-vault precedent) |
| Concurrency        | n/a                                       | absorbed by pid-carried gate claims; steer grammar is the wire protocol; settles validate through the delegated settle seam |
| Supervision        | n/a                                       | `holder.json` pids are the process table; daemon restart rediscovers live runs; fold-is-truth crash-resume is the net |
| Failure mode       | dead dashboard, runs untouched            | dead control plane, runs continue; spawned children orphan-but-tracked |
| Version contract   | event schema only                         | event schema **plus** the CLI verb surface (already doc-pinned for `start`) |

Option 3 is the destination; Option 2 is its mandatory prefix (registry, multi-root sweep, one board all survive into it). Which half of Option 3 gets built first is decided by the Phase 0 evidence: high human-settle rate → settle plane early; low → spawn/supervision half first (the robustness win stands alone).

### D7 — Gate answering is unchanged in Phases 0–2

The gate file lives wherever the workDir points; the pointer line already prints the path; the waiter already polls it there. Settle UX rework (CLI client, dashboard write-by-delegation, chat steer) is a Phase 3 decision the probe prices.

### Scope-model, gating, dependencies, TDD (per design rules)

- **Scope model**: no storage/config-context ids, no platform instance, no user rows — the new persisted state is the filesystem store keyed by project slug (absolute path). No chat tool surface → no `tool_prefs` impact.
- **DB**: none. **New dependencies**: none (Bun stdlib + existing in-repo kit; context-vault is precedent, not a dependency).
- **Existing modules first**: the probe extends the `analyze-*` family (`analyze-gates.ts` owns settle-origin attribution); the store contract pins `resolveRunnerConfig` behavior — no new resolution code; Phase 2's daemon names `context-vault-indexer/` as the kit to transplant.
- **TDD hooks**: new files under `afk-runner/src/**` ride the write-hook pipeline — red-first order: (1) `tests/afk-runner/analyze-gate-attendance.test.ts` over corpus fixtures with known settle origins, (2) the absolute-workDir resolution pin over `resolveRunnerConfig`, (3) audit fixes.

## Risks / Trade-offs

- [The probe measures the past, n≈3 cycles, one operator] → report with the era flag and honest unknowns; treat as pricing input, not proof; the metric re-runs cheaply on every future corpus.
- [Absolute workDir was incidental; latent assumptions may surface] → Phase 1 audit greps for naive `repoRoot`+`workDir` joins; every finding fixes forward red-first.
- [Dogfood on live work dirs] → move is copy-then-cutover: the old `.afk-runner/` stays intact until the dogfood closes; rollback = point the config back.
- [Central store is a single point of loss] → rides the user's existing home-dir backup story; building one is out of scope (recorded, not solved).
- [Waiter/steer polls now cross directories] → 1s file polls across dirs on one machine should be a non-issue; the dogfood notes verify latency live rather than assume.

## Migration Plan

1. Phase 0 lands (analyzer metric + fixtures); run over the retained corpus; record attendance numbers in the change's notes.
2. Phase 1: create `~/.afk-runner/projects/<slug>/`; copy each worktree's `runs/` into it; write the pointer config; verify `status`/`runs`/`serve` over the store; dogfood two worktrees; record evidence.
3. Rollback: restore each worktree's relative default (delete the pointer config or set `workDir: ".afk-runner"`); the untouched originals still fold.
4. Phase 2+ proposals consume the evidence artifacts; nothing here blocks them structurally.

## Open Questions

- Slug derivation for project stores (repo dir name vs git remote vs gitdir hash) — Phase 1 can ship dir-name slugs; the Phase 2 registry reuses context-vault's gitdir identity, which supersedes whatever Phase 1 picked.
- Whether `runs`/portfolio grouping-by-project ships during Phase 1 dogfood or rides the Phase 2 board change — dogfood evidence decides; no spec depends on it.
- The human-settle-rate threshold that promotes/demotes the Phase 3 settle plane — recorded in the Phase 0 notes when the numbers land, not guessed here.
