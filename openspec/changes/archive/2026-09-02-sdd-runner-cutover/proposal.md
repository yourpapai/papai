<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Why

U9's retirement sequence reached R4: R1 (`gate-settle-robustness`) and R2 (`log-fidelity`) closed the live-proof holes, R3 (`cross-run-accounting`) adds the `runs` verb — but every operator entry point (`sdd-runner:start`, the `/sdd:auto` wrappers, the doc rows) still routes to the frozen sdd-runner workspace. The engine is proven (parity oracle, live proof, memo oracle); only the entry surface is unflipped. Cut over now, while sdd-runner/ stays frozen as a one-line-revert fallback, so R5 deletes green, off-primary code.

## What Changes

- `sdd-runner:start` repoints to `bun afk-runner/src/cli.ts` — the cut-over switch. `stop <id>` keeps parsing (an afk verb); the sdd bare-arg routing grammar (`sdd <task-file>`, `sdd <run-id>`) dies — **BREAKING**, made loud: afk's bare-arg miss error names the replacement verbs.
- The `/sdd:auto` wrappers (`.claude` + `.opencode`) switch to `bun run afk-runner:start -- start $ARGUMENTS`; the stale `--wait`/`--verbosity` flag docs (flags `sdd-runner-simplify` removed) are corrected to `--depth S|M|L`.
- afk CLI attach policy: `start` parks-and-exits at a gate park, printing the gate-file pointer and the resume command; `resume` attaches the foreground waiter. Without this, every `/sdd:auto` gate park blocks the invoking agent's shell until its bash timeout kills the holder — a recoverable-but-noisy pseudo-crash per gate.
- Docs: `sdd-pipeline.md` gains a historical banner plus markers on runner-only sections (process sections and the Admission-vs-division anchor stay canonical); CLAUDE.md doc-index/route rows move runner commands to `afk-runner.md`; `commands.md`'s TDD-scope row gains the missing `afk-runner/src/` (drift fix — the hook has covered it since C1); `afk-runner.md` records the cut-over, the retirement-sequence ledger rows (R1–R4), and the deliberate `sdd-runner:*` family split for the R4→R5 window.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `afk-runner-gate`: the "Foreground waiter" requirement's attach condition re-keys from "when a deadline is armed or the operator ran the run interactively" to the verb model — `start` SHALL park and exit with the gate pointer; `resume` (and a deadline-armed wait) attaches the waiter. Without the modification the CLI either blocks machine-invoked starts (today's behavior, `/sdd:auto`-breaking) or silently violates the conditional SHALL. The requirement currently lives in the unarchived `gate-as-state` delta; this delta stacks on it and applies against the resulting main spec once `gate-as-state` archives (`sdd-runner-tui-wiring` precedent).

## Impact

- Code: `package.json` (one alias line), `afk-runner/src/cli.ts` (start no-wait, park pointer line, usage-naming miss error), `.claude/commands/sdd-auto.md`, `.opencode/commands/sdd-auto.md`.
- Tests: `tests/afk-runner/cli.test.ts` extensions, test-first.
- Docs: `docs/architecture/sdd-pipeline.md`, `docs/architecture/afk-runner.md`, `docs/architecture/commands.md`, `CLAUDE.md`.
- No platform or task instances affected; no config-context scope impact — dev tooling, workdir-local, no DB, no chat surface.
- Sequencing: lands after `cross-run-accounting` so the doc rows reference the delivered `runs` verb.
- The package.json edit drifts in-flight agent branches' manifests (the #323 pattern); `reconcile-agent-branch-push` covers it.

## Non-goals

- TUI re-host (U8 holds).
- `--reopen` port to the C4 stack — nothing depends on it at cut-over; recorded as U8-adjacent.
- Five-key config surface / deadline arming via CLI — C8's explore (the consumer-forcing change); `AFK_RUNNER_MODEL` stays the only model knob.
- Legacy `.sdd-runner` workdir import (R3's stance: separate work dirs; fold-print by direct path still reads old runs).
- Everything R5 owns: deleting `sdd-runner/` + `tests/sdd-runner/`, the workspaces entry, Dockerfile COPY lines, TDD-hook branches, mutation coverage-map branches, jscpd ignores, `sdd-runner-*` main-spec retirement, and the transitional `sdd-runner:*` alias family itself.
- Reviving the bare-run-id state router (`resume`/`status` replace it).
