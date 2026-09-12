<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner U13 — post-plan e2e weak-point audit

## Goal

The ledger's single `next` (U13) woken by U3's delivery: a deliberate post-plan
deep-research cycle over the now-complete pipeline — **zero-spawn corpus probes,
deliberate-delta stress, the F-P2 design decision, and a full U-ledger re-score
from measurements** — with every weak point found becoming a concrete OpenSpec
change and every measured absence staying fallen. Deliverables: this change's
notes + reflection (the measurements and adjudication), the re-scored ledger in
`docs/architecture/afk-runner.md`, and two follow-up proposals the audit spawns
(`walk-item-green-decomposition` for F-P2, `afk-runner-walk-robustness` for
F-P3/F-P4/F-U3). Direct precedent: the C7–C9 live-proof cycles' evidence
discipline (`openspec/changes/archive/*-live-proof/`,
`2026-09-07-execution-half-on-graph/`); this cycle adds no live drills — the
pre-loaded agenda is answerable from the corpus.

Assumption (stated, veto-able): the audit is research-shaped — no runtime
changes land here; the two follow-up changes carry the code work and are
proposed, not implemented, by U13.

## Current state (verified anchors)

- The live corpus: 5 retained lanes under `tests/afk-runner/fixtures/live/`
  (all `completed`) plus 9 workdir-resident runs with sidecars intact (7 C8 runs
  under `papai/.worktrees/v2-live-proof-target-{a,b,c}/.sdd-runner`, 2 C9 runs
  under `~/Projects/yourpapai/u3-live-proof-target-{p,u}/.sdd-runner`); the C9
  baseline report survives at
  `openspec/changes/archive/2026-09-07-execution-half-on-graph/corpus-report.json`.
- `analyze` is read-only by construction (`afk-runner/src/analyze-io.ts` —
  read-only fs seam + `readOnlyGit` admitting only `log`/`ls-tree`); the probe
  instrument re-ran it over all five workdirs (task 1.1).
- The pre-loaded agenda (C9 reflection §Findings): F-P2 the
  walk-vs-red-first-decomposition weak point (the measured dominant operator
  load), F-P3 the implement precondition crash, F-P4 the narrow agent git-verb
  blocklist, F-U3 the uncapped verify check seam; F-U2 closed by PR #423.
- The U-ledger (afk-runner.md §Living follow-ups): U1–U13 with U13 `next`;
  U10's re-open trigger is the gap-fingerprint clustering probe, U11's the
  aborted sunk-spend probe; the hold-queue preamble names eight deliberate
  deltas to stress against live evidence.

## Files to touch

- `docs/architecture/afk-runner.md` — the U-ledger re-score (task 3.2) + one
  delivery-table row.
- This change folder: `notes.md` (probe evidence), `reflection.md`
  (adjudication + re-score), `corpus-report.json` (the full-corpus instrument
  output).
- `openspec/changes/walk-item-green-decomposition/` and
  `openspec/changes/afk-runner-walk-robustness/` — the two follow-up proposals.
- No changes to `afk-runner/src/**`, tests, workflows, or runtime config.

## Required content

1. **Probe 1 — gap-fingerprint clustering (U10's trigger).** Over the
   sidecar-carrying corpus: do fingerprint clusters persist across rounds; are
   persisting concerns assumption-class/unknown-shaped; do veto/extend rates
   track unexplored-domain tasks. Adjudication: clustering a `research` state
   would own re-opens U10; measured absence stays fallen with a falsifiable
   trigger.
2. **Probe 2 — aborted sunk-spend (U11's trigger).** Over every terminal-aborted
   corpus run (plus the abort-at-escalation live run): how much pipeline
   progress was stranded and is a restart-from-scratch the only recovery.
   Adjudication: resumable value stranded by terminal aborts re-opens U11.
3. **Baseline re-inspection.** The C9 `corpus-report.json` compared against a
   fresh `analyze` over the same workdirs — instrument validity, then drift
   explained.
4. **Deliberate-delta stress.** Each of the eight named deltas checked against
   corpus + cycle evidence; no evidence of hurt = stays as-is.
5. **F-P2 design decision** argued from evidence (the measured failure
   mechanism, both options, the rejection reasoning), with the follow-up change
   proposed.
6. **F-P3/F-P4/F-U3 disposition** — one robustness change or separate; proposed.
7. **U-ledger re-score** — every hold/park row updated from measurements taken
   this cycle, each with a falsifiable re-open trigger; exactly zero or one
   `next` remains.

## Intended behaviour change

None — research/docs-only. The two follow-up changes own all runtime behavior;
U13 records the decisions that justify them.

## Verification

- Every quantitative claim in notes.md re-derivable from the retained corpus by
  the read-only `analyze` verb or the pinned probe script (quoted in notes.md).
- `openspec validate --specs --strict` green; the two follow-up changes
  validate `--strict` green.
- Full serial suite green (`bun run test --serial`).
