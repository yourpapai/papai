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
`#4e816232 [high]`, a fix dispatched against `context-vault-indexer/daemon.ts`, a file with
zero non-test callers; six of the run's seventeen fix commits landed in that unreachable
package, and the run was then killed at 297 minutes with issues still open. Risk is hazard ×
exposure, and the loop has no term for exposure.

Dispatch order compounds it: `processPendingIssues` walks `pending` by index with no sort, so
issues are fixed in the order the reviewer happened to emit them.

The obvious fix — a self-reported `exposure` grade that gates dispatch — would be the first
time this design let a self-reported *judgment* control anything.
[ADR-0303](../../../docs/adr/0303-review-loop-parallel-fixes-inspector.md) keeps `confidence`
"logged for observability, not used to gate the verdict", and the fixer's independent
`severity` is tallied but never overrides the reviewer's. Severity itself is the proof that
this class of field inflates.

## What Changes

- **Exposure as an artifact, not a grade.** The reviewer cites the **caller** it found — file,
  line, and quoted line — or explicitly reports none. This is the shape of the existing
  `evidence` rule: falsifiable by going and looking, unlike a self-assigned rating.
- **Advisory only.** Exposure never blocks dispatch and never consumes retry budget. It
  becomes the **dispatch sort key** — the loop's first — plus a summary and `metrics.json`
  line.
- **Second-actor cross-check.** The fixer, which has already read the code, reports exposure
  independently, exactly as it already reports an independent `severity`. Reviewer-vs-fixer
  divergence is recorded per issue.
- Together these make the loop measure its own honesty: divergence is the evidence that decides
  whether a future change may gate on exposure. This change does not gate.

## Capabilities

### New Capabilities

- `review-loop-issue-exposure`: the exposure artifact on a reviewer issue, its independent
  restatement by the fixer, and the advisory ordering and reporting derived from both.

### Modified Capabilities

None. No existing capability under `openspec/specs/` changes.

## Impact

`review-loop/src/`: `issue-schema.ts`, `prompt-templates.ts`, `issue-processor.ts` (dispatch
order), `issue-ledger.ts`, `loop-trace.ts`, `trace-log.ts`, `summary.ts`; tests under
`tests/review-loop/`. Docs: `review-loop/CLAUDE.md`.

**Scope impact: none.** Local developer tooling — no platform instance, no task instance, and
no per-user, group-shared, or thread-isolated state.

## Non-goals

- **Gating admission on exposure.** Deferred until divergence data says the artifact is
  trustworthy; `evidence` is the cautionary precedent — a mandated field that appears only in
  `issue-schema.ts:13` and its prompt, read by nothing.
- **Mechanical caller analysis as the gate.** It is blind to this repo's manifest dispatch
  (`plugin.json` `main`) and string-path spawn (`adapters/opencode.ts:44`), so it would mark
  live plugin entry points dead.
- Fix proportionality — captured in `review-loop-fix-proportionality`.
- The "hazard cannot occur" axis (reachable code, impossible state); `mutation-improve`.
