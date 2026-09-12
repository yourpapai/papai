<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks — afk-runner U13 audit (research; all zero-spawn)

- [x] 1.1 Re-run `analyze` over all five surviving live workdirs; assert the
      C9 baseline reproduces byte-identically for the two C9 runs; record
      corpus-shape reality (5 lanes / 9 workdir runs) and any ground-truth
      drift with its cause. → `bun run afk-runner:start -- analyze <workdirs…> --json`
      (output copied to `corpus-report.json`; evidence in notes.md §1)
- [x] 1.2 Probe 1 — gap-fingerprint clustering: join findings+skeptic
      sidecars by `fingerprintOf`, measure cluster persistence, resolution
      mixes, and the lexical research share; cross-check against the
      analyzer's `concernPersistence`/`classChurn`. → probe script quoted in
      notes.md §2; verdict in reflection.md
- [x] 1.3 Probe 1b — gate outcomes by mode/outcome per run (logs), read
      against each run's task-domain novelty. → notes.md §3
- [x] 1.4 Probe 2 — aborted sunk-spend: fold every terminal-aborted corpus run
      (+ the abort-at-escalation live run + the stale-running controls) into
      sunk-progress rows. → notes.md §4
- [x] 2.1 Stress the eight deliberate deltas against corpus + cycle evidence;
      record verdict per delta. → notes.md §5
- [x] 2.2 C<n> corpus sweep (zero findings expected across all runs'
      sidecars). → notes.md §5
- [x] 3.1 F-P2 design decision: ground the mechanism in the seams
      (run-check/decompose/atomicity), argue Option A vs B, decide. →
      design.md D3
- [x] 3.2 Re-score the U-ledger in `docs/architecture/afk-runner.md` — every
      hold/park row from measurements, falsifiable triggers, zero `next`;
      add the audit's delivery-table row. → reflection.md §Ledger re-score +
      the doc edit
- [x] 4.1 Propose `walk-item-green-decomposition` (F-P2 follow-up) with
      specs delta + tasks. → `openspec validate walk-item-green-decomposition --strict`
- [x] 4.2 Propose `afk-runner-walk-robustness` (F-P3/F-P4/F-U3) with specs
      delta + tasks. → `openspec validate afk-runner-walk-robustness --strict`
- [x] 5.1 Final gates: `openspec validate --specs --strict`; full serial
      suite `bun run test --serial` green. → commands as listed
