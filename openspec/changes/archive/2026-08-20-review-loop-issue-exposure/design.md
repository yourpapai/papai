<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: review-loop issue exposure

## Context

See proposal.md — Why. Two existing shapes decide most of this design.

The loop already carries a second-actor field: the fixer's independently-assessed `severity`.
It is **not** stored on `LedgerIssueRecord` — `recordVerification` persists only
`{verdict, fixability, reasoning, targetFiles}`, and the fixer's severity travels to the
`verify_complete` trace event instead (`issue-ledger.ts:181`, `:209`), with round totals tallied
into `RoundMetric.fixerSeverity`. Divergence is therefore already a trace-and-metrics concern,
not a ledger concern.

`processPendingIssues` walks `pending` by index with no sort, so there is no existing ordering
to preserve or negotiate with — this change introduces the loop's first.

## Goals / Non-Goals

**Goals:**

- Make exposure falsifiable by requiring a citation rather than a rating.
- Accumulate the divergence evidence a future gating decision needs.
- Leave every existing outcome — verdicts, budgets, statuses — unchanged.

**Non-Goals:**

- Gating, deferring, or dropping any issue on exposure.
- Deciding now what the future gating rule will be.
- Verifying the citation mechanically (see Decisions).

## Decisions

**The fixer's exposure follows the fixer's severity, not the ledger.** `VerifierDecision` is
persisted and drives `mapVerifierDecisionToLedgerStatus`; widening it would put a field that
must never affect status into the type that determines status. *Alternative considered:*
widening `VerifierDecision`, or adding a parallel field to `LedgerIssueRecord`. Rejected — the
codebase already answered this question for `severity`, and following that answer costs nothing
while keeping the ledger's meaning intact.

**A citation, not a grade.** ADR-0303 keeps `confidence` "logged for observability, not used to
gate the verdict", and the fixer's `severity` never overrides the reviewer's. Exposure is
reported as an artifact — file, line, quoted line — because an artifact can be checked later and
a rating cannot. *Alternative considered:* an `exposure: reachable | unreferenced` enum.
Rejected: severity is the proof that a self-assigned grade inflates.

**Advisory, so inflation is harmless.** With no gate, a dishonest citation costs at most a
slightly wrong dispatch order. That is what makes it safe to collect the evidence before
deciding whether to trust it.

**No mechanical verification of the citation.** Caller analysis cannot see this repo's manifest
dispatch (`plugin.json` `main`) or its string-path spawn (`adapters/opencode.ts:44`), so it
would report live plugin entry points as unreachable. Mutation score can be verified because
Stryker is an oracle; reachability has none, so this change measures divergence instead.

**Stable ordering.** Sorting must be stable so that issues exposure cannot separate keep the
order the ledger produced; an unstable sort would make runs non-reproducible for no gain.

## Risks / Trade-offs

- **The reviewer may cite a caller that does not exist, and nothing checks it.** → Accepted, and
  it is the reason for the fixer's independent restatement: a fabricated citation shows up as
  divergence. This is precisely the evidence the future gating decision needs.
- **Both actors may be wrong the same way, hiding divergence.** → Real and unmitigated. A
  correlated error rate cannot be detected from agreement alone; if divergence is near zero the
  gating decision should be validated against a hand-checked sample before trusting it.
- **`evidence` is the cautionary precedent: a mandated field read by nothing.** → Exposure is
  read from the moment it lands — it orders dispatch — so it cannot sit inert the way `evidence`
  has.
- **Reviewers spend effort finding callers for issues that would be deduped anyway.** → The cost
  is a search over code the reviewer already opened to satisfy the evidence rule; matching runs
  after review either way.

## Migration Plan

No data migration and no config change. Exposure is optional on read: run state written before
this change resumes with exposure absent, treated as unknown and excluded from divergence
counts. Rolling back is reverting the commits; older `metrics.json` files stay readable because
every added field is additive.

## Hook / TDD interactions

`review-loop/src/**` is gateable implementation code mapped to `tests/review-loop/**`, so each
source edit is test-first. Tests land in `prompt-templates.test.ts` (both prompt contracts),
`issue-schema.test.ts` (optional-on-read), a new ordering suite for `issue-processor.ts`, and
`trace-log.test.ts` / `summary.test.ts` for divergence reporting. Prompt tests should pin the
obligation, not the wording.

## Open Questions

- What divergence rate should justify gating, and over how many runs? Deferrable: it changes
  neither these specs nor the task breakdown, and cannot be answered before the data exists.
