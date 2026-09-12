<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: afk-runner U13 — post-plan e2e weak-point audit

Research change (see proposal.md): the deliverables are measurements,
adjudications, and two follow-up proposals. This design fixes the corpus, the
instruments, the adjudication thresholds, and the three structural decisions —
so the audit's claims are evidence, not inspection dressed as evidence.

## Context

- The corpus (verified this cycle): **5 retained live lanes**
  (`tests/afk-runner/fixtures/live/`, all `completed`, events+memo only) and
  **9 workdir-resident runs with sidecars** — 7 C8 runs
  (`papai/.worktrees/v2-live-proof-target-{a,b,c}/.sdd-runner`) and 2 C9 runs
  (`~/Projects/yourpapai/u3-live-proof-target-{p,u}/.sdd-runner`), the C9 pair
  duplicating the two C9 lanes but carrying the sidecars/gate files the lanes
  drop at harvest. Legacy: 10 `fixtures/real/` runs (4 stale `running`, 2
  `aborted`, 4 `completed`), 17 synthetic-marked scenarios (excluded from
  clustering adjudication by their marking vocabulary). The ledger's "7-lane"
  figure matches C8's 7 runs, not the 5 retained lanes — corrected in the
  re-score.
- `analyze` is read-only by construction (`analyze-io.ts`'s `AnalyzeFs`
  read-seam + `readOnlyGit`); the probe instrument is the unchanged CLI over
  the five workdirs, plus one read-only bun script (quoted in notes.md) that
  imports `fingerprintOf` from its one home
  (`afk-runner/src/work/concern-model.ts`) for the clustering join — the
  analyzer's own `concernPersistence` metric cross-checks it.
- The C9 baseline (`archive/2026-09-07-execution-half-on-graph/corpus-report.json`)
  covers exactly the two C9 workdirs; byte-stable comparison validates the
  instrument before any drift is read.
- The F-P2 seams: `work/run-check.ts:15-18` states the walk's premise
  (between slice commits the tree is exactly the current item's work);
  `work/decompose.ts:37-50` (`buildDecomposerPrompt`) carries zero granularity
  guidance; `work/atomicity.ts:26-28` ("Every task must end with its
  verification command") licenses the red-first split.
- The robustness seams: `work/implement.ts:118-124` (read-catch wraps as plain
  `Error`), `work/run-check.ts:22-29` (`bunRunCheck` — `Bun.spawnSync` with no
  timeout), `.hooks/git/checks/block-git-{stash,checkout-discard}.mjs` (the
  two-check blocklist; textual `\bgit\s+stash\b` matching — observed blocking a
  probe command that merely quoted the string).

## Goals / Non-Goals

**Goals:**

- Both zero-spawn probes answered from the retained corpus with numbers, each
  adjudicated against its ledger trigger's exact wording.
- The F-P2 decision argued from the measured failure mechanism with the
  rejected alternative's mechanism recorded — a decision the follow-up change
  can cite as settled.
- F-P3/F-P4/F-U3 dispositioned as changes with seam anchors and test homes.
- Every hold/park ledger row re-scored from a measurement taken this cycle or
  an explicit carry-forward citation, each with a falsifiable re-open trigger.

**Non-Goals:**

- No live drills — the pre-loaded agenda is answerable zero-spawn; the F-P2
  verification drill belongs to the follow-up change's next armed cycle, not
  this one.
- No analyzer changes — the probes are answered by the existing metrics plus a
  throwaway script; new analyzer metrics are follow-up material only if a
  future probe needs them (none did).
- No implementation of the two follow-up changes.
- Re-opening F-U2 (closed by PR #423) or re-litigating delivered rows (U3, U9).

## Decisions

**D1 — Corpus definition: five lanes + nine workdir runs, marked-shape
excluded.** The clustering probe runs only over sidecar-carrying runs (the
workdir corpus; the lanes drop sidecars at harvest); the sunk-spend probe runs
over every corpus run with a memo. Synthetic scenarios are excluded from both
adjudications — their findings are seeded shapes, not agent behavior.
Alternative considered: lanes-only — rejected, sidecar-less lanes cannot
answer the clustering question at all.

**D2 — Instrument: the unchanged `analyze` CLI + one read-only probe script.**
Baseline validation first: the fresh `analyze` over the two C9 workdirs must
reproduce the C9 report byte-identically (modulo `generatedAt`/usage wall) —
only then is any drift read as environment, not instrument. The clustering join
re-uses `fingerprintOf` by import; the lexical "research-shape" classifier is
recorded in notes.md with its regex and its known generosity (a high lexical
share is not evidence by itself — the adjudication reads what *happened* to
each finding: its resolution action and the run's convergence).

**D3 — F-P2: decompose/atomicity guidance forbids red-first pairs at walk
granularity (Option A); check tolerance rejected (Option B).** The measured
mechanism: both C9 decomposers (flash and 5.3, independently) split test/impl
items following repo TDD conventions — the cause is prompt-shaped (no
granularity guidance exists, and atomicity's verification-command line actively
licenses the split), not model-shaped. The operator's C9 hand merges were
exactly pair-merges — the measured correct granularity is "one item = one
complete red→green cycle". Option B is rejected on mechanism, not preference:
exit codes cannot attribute red to a declared pre-impl test vs a real
regression (per-file suite attribution is new machinery); a red slice commit
breaks the between-commits-green invariant that verify routing and fix-target
mapping rest on; and tolerance does not contain the poison cascade (the
uncommitted red test makes every later item's affected check red — Run U's
0/24). Mutating engine truth to fix a prompt deficiency inverts the measured
cause. Follow-up: `walk-item-green-decomposition` (both prompts + pinned
tests; the drill — an armed red-first-prone task asserting zero operator
re-targets — rides its verification).

**D4 — F-P3/F-P4/F-U3: one robustness change, three seams, one class.** All
three are "guards the fixtures cannot see" (C9's own grouping): the
precondition taxonomy miss (implement.ts read-catch → `StageHaltError{
precondition}`, mirroring `atomicity.ts:70-75`), the uncapped check seam
(`bunRunCheck` gains a wall cap with the spawn-side 30-minute precedent sizing
it), and the git-verb blocklist widening (`.hooks/git/checks/` siblings for
`reset`/`rm`/branch creation — repo-hook surface, tested through the
`tests/opencode-tdd-enforcement.test.ts` home, flagged in the change as a
different test surface than the TDD-hook-governed `afk-runner/src/**`).
Alternative considered: three changes — rejected, none is individually
controversial and they share one motivation (C9's unguarded-seam class) and one
review context; splitting adds ceremony without decision value.

**D5 — U10 and U11 fall; the re-score vocabulary stays the C9 shape.** U10:
the probe measured absence (1 persisting cluster of ~68, resolved by edits;
`assumed` resolutions 0 corpus-wide; veto/extend do not track novelty — the
one extend sits on the most-explored domain, the brand-new-surface run had
zero think-half gate friction). U11: zero terminal aborts in the live era; the
one legacy run with stranded convergence value (3 converged rounds + draft,
`sdd-runner`-era, n=1) does not meet "resumable value stranded by terminal
aborts" as a live-engine deficiency. Both keep falsifiable re-open triggers —
"fallen" in this ledger means decided-on-evidence, not never.

**D6 — Zero `next` remains.** The audit closes U13; the queue's head is the
two proposed follow-up changes, which OpenSpec tracks directly — a `next`
ledger row would duplicate that tracking. A `next` returns only when a
wake condition fires again.

**D7 — The reflection's preamble is probe-based, not drill-based.** U13 ran
no attended live cycle; its reflection cites the three live cycles' corpus as
the substrate and this cycle's zero-spawn measurements as the instrument —
verdicts stay provisional exactly like the n=1..3 cycles', each with its
falsifiable trigger.
