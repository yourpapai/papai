<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Context

See proposal.md — Why. Facts the decisions rest on: `package.json:47` `sdd-runner:start` → `bun sdd-runner/src/index.ts` is the only operator alias that drives the old engine; the two `/sdd:auto` wrappers shell `bun run sdd-runner:start -- $ARGUMENTS` with stale flag docs; afk's CLI (`afk-runner/src/cli.ts`) parses `start <taskFile>` / `status` / `resume` / `stop` / `report <runId> [--pr]` plus a bare-`<runDir>` fold print, and wires `gateWait` unconditionally (`cli.ts:106`) so every gate park blocks the process; the foreground-waiter requirement (`gate-as-state` delta, `afk-runner-gate`) is already conditional — "when a deadline is armed or the operator ran the run interactively"; `run.ts:42`/`run-resume.ts:40` make `gateWait` an optional DI seam — absent means park-and-return. The retired grammar's forms: `sdd <task-file>` (start), `sdd <run-id>` (state router), `sdd stop <id>`, `--depth`, `--pr`, `--reopen`, `--config`.

## Goals / Non-Goals

**Goals:**

- The default operator path (`/sdd:auto`, muscle memory) drives afk-runner, revertible by one alias line.
- `/sdd:auto` gate parks never block an agent shell.
- Docs name exactly one live runner; the retirement ledger records the cut-over.

**Non-Goals** (design-level, beyond proposal Non-goals): no engine changes outside `cli.ts`; no parity-oracle surface touched (`sdd-runner/`, `tests/afk-runner/fixtures/**`, `legacy-fold.ts` stay frozen); no new capabilities beyond the waiter delta.

## Decisions

**D1 — B-plus wedge (wrapper translates; alias is the switch).** Repoint `sdd-runner:start` to `bun afk-runner/src/cli.ts`; wrappers invoke `bun run afk-runner:start -- start $ARGUMENTS`. Alternatives: **A** — grammar shim (afk gains the bare-path state router): preserves `sdd <run-id>` but is engine work R4 forbids, and re-implements a router `resume`/`status` already cover; **C** — hard rename now: largest doc diff, rewrites every alias mention twice (R4 renames, R5 deletes). B-plus costs the bare-run-id form, made loud by D4. Wrappers move to the `afk-runner:*` family **now** so R5 deletes the transitional alias family without re-touching wrappers. `stop <id>` survives natively (afk verb). `--depth` survives (afk start flag); `--pr` moves to `report --pr`; `--reopen`/`--config` die (proposal Non-goals).

**D2 — Attach policy: never-on-start.** `cliMain` builds deps once; the `start` path passes them **without** `gateWait` (resume/report/status unchanged — resume keeps the waiter: the human typed it to attend). Rationale: the status quo blocks any machine-invoked start at every gate until the invoking shell's timeout kills the holder — recoverable (the kill-drill shape) but a pseudo-crash per gate; deadline-conditional attach (sdd parity) needs the config surface that is C8's, and still blocks agent shells when armed. The park must not strand the operator: `runStartCommand`'s summary gains, when `halted === 'gate-pending'`, one line naming the gate file (`<workDir>/runs/<id>/gate-<v>.md`, version from the fold) and `resume <runId>` as the attending command. Spec: the MODIFIED `afk-runner-gate` "Foreground waiter" delta.

**D3 — Bare-arg miss is loud.** `runCli`'s `events.ndjson not found` error gains usage naming: pass `start <taskFile>` to drive a run, `resume <runId>` to attend, `status`/`report` to inspect. Rejected: porting `resolveRunId`/state routing (D1's A). Pinned by a cli test; below spec altitude (error text).

**D4 — sdd-pipeline.md stays half-live.** Historical banner under the title (workspace frozen off-primary as of this change; engine and commands in `afk-runner.md`); `## Commands` and `## Live rendering` get one-line historical markers (sdd-runner-only surfaces). Process sections (stages, event model, depth profiles, gate protocol, Admission vs division) stay canonical — afk implements the same pipeline, and AGENTS.md deep-links `sdd-pipeline.md#admission-vs-division`; no heading renames.

**D5 — Ledger and rows.** CLAUDE.md: SDD-pipeline row drops "runner commands" from coverage; afk-runner row gains them; the `/sdd:auto` route row repoints to `afk-runner.md`. `commands.md` TDD-scope row adds `afk-runner/src/` (the hook has covered it since C1 — drift fix). `afk-runner.md`: intro's "stays frozen until a retirement change" becomes the cut-over state; the delivery table gains the R4 row beside R1/R2 (R3's row lands with that change); a retirement-sequence note records the deliberate family split — `sdd-runner:start` is the cut-over alias pointing at afk; `sdd-runner:test|typecheck|lint|format:check` remain frozen-workspace hygiene until R5 deletes the family.

**TDD / hooks.** `afk-runner/src/**` edits are gated by the Write/Edit hook against `tests/afk-runner/**` — failing cli tests first: (1) start with a gate-parking run consumes zero ticks of an injected `gateWait` and its summary names the gate path + resume command; (2) resume at a gate-pending park still attaches (tick consumed / does not return while unsettled); (3) bare-arg miss error names the verbs. `package.json`, wrappers, and docs are unhooked paths. No DB, no scope-model state, no new dependencies (rules: none needed — the change moves entry points).

## Risks / Trade-offs

- **Operators lose two conveniences at once** (bare-run-id router, TUI attendance). Mitigation: loud errors (D3), park pointer (D2), docs (D4/D5); U8 holds the TUI re-host.
- **Interactive start no longer waits** — a human at a terminal must `resume` to attend. Deliberate verb clarity: start = drive, resume = drive + attend; C7's attendance friction was surface-shaped (U8), not attach-shaped.
- **Stacked delta**: MODIFIED applies to a requirement still inside the unarchived `gate-as-state` delta — `gate-as-state` archives first (sdd-runner-tui-wiring precedent); recorded in the proposal.
- **Deadline blind window**: until C8 gives the CLI a config surface, no invocation arms a deadline — the waiter's expiry face is unreachable from the CLI. Recorded; C8 is the consumer-forcing change.
- **Manifest drift**: the package.json edit trips the #323 pattern for in-flight agent branches; `reconcile-agent-branch-push` handles it (proposal Impact).
