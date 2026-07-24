<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage A evidence log

**Opened:** 2026-07-24
**Plan:** [`06-implementation-plan.md`](./06-implementation-plan.md) (Tasks 1–18)
**Execution wrapper:** [`../../superpowers/plans/2026-07-24-analytics-stage-a.md`](../../superpowers/plans/2026-07-24-analytics-stage-a.md)
**Execution design:** [`../../superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md`](../../superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md)
**Branch:** `claude/analytics-metrics-research-plan-0q1fqk` (one commit per task)

This log is the durable evidence of record for the Stage A exit gate: the
17-control privacy-contract matrix, per-task gate results and commit hashes,
the Stage A exit checklist, and (post-merge) the Stage B window log.

## Privacy-contract control matrix (03 §12)

Failure of a relevant control blocks pseudonymous collection/egress;
controls 1–9, 14–17 and the aggregate-specific parts of 15 also block
aggregate publication.

| # | Control | Status | Evidence (task / test / date) |
|---|---|---|---|
| 1 | Registry closure | pending | |
| 2 | Strict schema fuzz | pending | |
| 3 | C3 canaries | pending | |
| 4 | Identity matrix | pending | |
| 5 | Raw-ID absence | pending | |
| 6 | Semantic outcome | pending | |
| 7 | Consent matrix | pending | |
| 8 | Withdrawal race | pending | |
| 9 | Outbox/sink | pending | |
| 10 | Session fixtures | pending | |
| 11 | Cohort/censor fixtures | pending | |
| 12 | Rephrase persistence audit | pending | |
| 13 | Classifier contract | pending | |
| 14 | Backfill/provenance/reconciliation | pending | |
| 15 | External thresholding | pending | |
| 16 | DSAR/delete/rekey/snapshot | pending | |
| 17 | Performance/expiry clocks | pending | |

## Per-task evidence log

| Task | Named gate result | typecheck/lint | Commit | Date |
|---|---|---|---|---|
| 1 — contracts/registry | | | | |
| 2 — storage + mig 069 | | | | |
| 3 — identity keys | | | | |
| 4 — governance/eligibility | | | | |
| 5 — normalizer/runtime | | | | |
| 6 — turn lifecycle instrumentation | | | | |
| 7 — llm/tool/perf instrumentation | | | | |
| 8 — provider/feature boundaries | | | | |
| 9 — delivery ledger | | | | |
| 10 — intent + rephrase | | | | |
| 11 — materializations | | | | |
| 12 — backfill/reconcile | | | | |
| 13 — lifecycle/subject rights | | | | |
| 14 — snapshot/metabase | | | | |
| 15 — aggregate delivery | | | | |
| 16 — settings surfaces | | | | |
| 17 — job registration | | | | |
| 18 — docs/release gates | | | | |

## Milestone rebases onto origin/master

| After task | Rebase commit | Date | Conflicts / resolution |
|---|---|---|---|
| 2 | | | |
| 8 | | | |
| 13 | | | |

## Stage A exit checklist

- [ ] All 18 task commits recorded above with hashes
- [ ] Control matrix all green
- [ ] Synthetic complete process epoch reconciles to zero (attach output)
- [ ] Snapshot byte verification result recorded
- [ ] Deletion drill output recorded
- [ ] Rekey drill output recorded
- [ ] Task 18 binding commands all pass, outputs attached:
  `bun build:client`, `bun test tests/analytics tests/settings`,
  `bun test:client`, `bun run typecheck`, `bun run lint`, `bun security`,
  `bun run test`, `bun test:stories:contracts`, `bun test:stories`,
  `bun run format:check`, `bun security:ci`, `bun run knip`,
  `bun run duplicates`
- [ ] Privacy/security owner signature on this evidence

**Privacy/security owner signature:** ____________________  date: ________

## Stage B window log (post-merge, operational)

- Deploy date / version:
- Window start (UTC):
- Window end (UTC):
- Restart/suppressed days (`unreconciled_restart_gap`):

| Week | Freshness | Reconciliation delta | Rejects | Overflow | Expiry check | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |

**Stage B exit review:** ____________________  date: ________

## Follow-ups parked during the build

(None yet — mid-build ideas are parked here, not implemented.)
