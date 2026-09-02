<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

F-A4, answered live at C8 (`openspec/changes/v2-live-proof/reflection.md` §F-A4): same-process retries — the
watchdog stall retry, the under-budget re-run, and the escalation-approve re-entry — each mint a **fresh**
opencode session; the killed attempt's context is discarded and only endpoint prefix-caching softens the
rebuild. The operator decided **fix**: retries should reuse the killed session's cached context via the
continuation seam the cross-process resume path already proves (C7 incident A; C8 Run A seq 296 — the
killed reviewer's session continued exactly).

## What Changes

- Same-process retries continue the session ledger's latest in-flight `killed` entry for the same
  (label, round) when one exists: the retry spawn rides `buildContinuationPrompt` + the ledger's
  continuation machinery instead of the plain base prompt — the same seam cross-process resume uses.
- No killed entry (first attempt, or the ledger's attempt already settled otherwise) → today's fresh spawn,
  unchanged.
- The session ledger keeps recording one attempt per spawn with honest `killed`/`done` status; the retry's
  continuation is visible in the ledger (same opencode session id across the killed and retrying attempts).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `afk-runner-recovery` — the "Retry budget with immediate re-run" requirement gains the continuation
  contract: an under-budget/escalation re-run continues the killed in-flight session rather than rebuilding
  fresh. Without it every retry pays a fresh-context rebuild (measured at C8: first-step cacheRead 16.4K/18.8K
  vs 64 fresh — the killed context's accumulated reading is lost each time).

## Impact

- Code: `afk-runner/src/agent-layer.ts` (retry paths consult the ledger's in-flight `killed` entry via the
  existing `latestInFlight` seam), possibly `afk-runner/src/session-ledger.ts` (continuation lookup helper).
  TDD red-first under the afk-runner write hooks.
- Docs: `docs/architecture/afk-runner.md` — the F-A4 paragraph closes as fixed with the follow-up citation.
- Instances/scope: none — offline runner.

## Non-goals

- Cross-process resume behavior (already continues the in-flight session; unchanged).
- Any change to the ledger's honesty contract (statuses, attempt numbering) or to `resume` event emission.
- Cost/pricing work (the `opencode-priced-model-route` change owns that) and the operator-surface fixes
  (`afk-runner-operator-surface-robustness` owns those).

## Fresh-session pointers

Red evidence: the C8 scratch run's ledger (`…/v2-live-proof-target-c/.sdd-runner/runs/actualize-the-coding-sessions-architecture-page/sessions.jsonl`
— attempts 1–3 killed with distinct session ids, attempt 4 fresh); narrative in
`openspec/changes/v2-live-proof/notes.md` §Scratch C.
