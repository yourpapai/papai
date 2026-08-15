<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Give review-loop issues an exposure artifact, and earn the right to gate on it

## Why

The reviewer's severity ladder grades only *consequence if reached* — "critical: data loss /
security / crash". Nothing asks whether the code is reached at all. In PR #272 that produced
`#4e816232 [high]`, dispatched at `context-vault-indexer/daemon.ts` — zero non-test callers —
and six of seventeen fix commits landed in that unreachable package before the run was killed
at 297 minutes with issues still open. Risk is hazard × exposure; the loop has no exposure term.

Dispatch order compounds it: `processPendingIssues` walks `pending` by index with no sort —
issues are fixed in reviewer-emission order.

The obvious fix — a self-reported `exposure` grade that gates dispatch — would be the first
time this design let a self-reported *judgment* control anything.
[ADR-0303](../../../docs/adr/0303-review-loop-parallel-fixes-inspector.md) keeps `confidence`
"logged for observability, not used to gate the verdict", and the fixer's independent
`severity` is tallied but never overrides. Severity is itself the proof that this class of
field inflates.

The stronger posture exists next door: `mutation-improve` never trusts an agent's declared
score — it re-measures with Stryker and requires declared residual `mutantIds` to equal the
measured survivors exactly. That works because mutation score has an **oracle**. Reachability
has none: caller analysis is blind to this repo's `plugin.json` `main` dispatch and its
string-path `bun run <daemonEntry>` spawn. So this change measures divergence instead.

## What Changes

- **Exposure as an artifact, not a grade.** The reviewer cites the **caller** it found — file,
  line, and quoted line — or explicitly reports none. Same shape as the existing `evidence`
  rule: falsifiable, unlike a self-assigned rating.
- **Advisory only.** Exposure never blocks dispatch and never consumes retry budget. It
  becomes the **dispatch sort key** — the loop's first — plus a summary and `metrics.json`
  line.
- **Second-actor cross-check.** The fixer, which has already read the code, reports exposure
  independently — as it already does for `severity`. Divergence is recorded per issue.
- Together these measure the loop's own honesty: divergence is what would justify gating in a
  later change. This change does not gate.

## Capabilities

### New Capabilities

- `review-loop-issue-exposure`: the exposure artifact, its independent restatement by the
  fixer, and the advisory ordering and reporting derived from both.

### Modified Capabilities

None.

## Impact

`review-loop/src/`: `issue-schema.ts`, `prompt-templates.ts`, `issue-processor.ts` (dispatch
order), `issue-ledger.ts`, `loop-trace.ts`, `trace-log.ts`, `summary.ts`; tests under
`tests/review-loop/`. Docs: `review-loop/CLAUDE.md`.

**Scope impact: none.** Local developer tooling — no platform instance, no task instance, and
no per-user, group-shared, or thread-isolated state.

## Non-goals

- **Gating admission on exposure.** Deferred until divergence data says the artifact is
  trustworthy. `evidence` is the cautionary precedent: mandated by schema and prompt, read by
  nothing.
- **Mechanical caller analysis as the gate** — no oracle, per above; it would mark live plugin
  entry points dead.
- Fix proportionality — captured in `review-loop-fix-proportionality`.
- The "hazard cannot occur" axis (reachable code, impossible state); `mutation-improve`.
