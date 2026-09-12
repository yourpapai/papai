<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See `proposal.md` for motivation (F-A4, the operator's fix decision, the C8 cost evidence). The mechanics
that shape the approach:

- The continuation machinery already exists and is live-proven: `runStageAgent`'s `continueSessionId` path
  (afk-runner/src/agent-layer.ts:247) spawns with `buildContinuationPrompt` + `--session`, fails fast
  (`noRetry`), and falls back to the fresh prompt-rebuild spawn on any continuation failure (D2 of the
  C7 resume work).
- **Review already continues same-process re-entries.** `buildReviewScope` recomputes
  `reviewResumeEntry(context, ledger, depth)` on every work pass (afk-runner/src/work/review.ts:196), so
  under-budget and escalation-approve re-entries of an unrecorded round already flow `resumeSession` →
  `continueSessionId`. The F-A4 evidence was draft-stage: the gaps are the non-review spawns
  (`estimator`, `drafter-*`, `decomposer`, `atomicity`, `veto-updater`) and the watchdog stall retry.
- The watchdog stall retry lives **outside afk-runner**: `runAgent` (review-loop/src/agent-runner.ts:279)
  re-spawns from the same options with no session flag, minting a fresh opencode session. The captured id
  sits on the line handler's `ctx.sessionId` — only `runAgent` can reach it. Consumers of `runAgent`:
  review-loop's own four roles, mutation-improve, afk-runner.
- `findInFlightSession` (afk-runner/src/session-ledger.ts:153) is exported and currently **unused** — the
  live resume path uses the private `latestInFlight` in `drive/resume.ts`. It is the natural host for the
  seam's lookup.
- Ledger statuses are the honest process boundary: in-process failures settle `killed`; a true crash
  dangles `spawned` (the settle never ran). Two validation loops settle differently — the agent-layer
  schema-validation retry settles `killed` (recursion: fresh spawn + error text), while stage-level
  validation (e.g. draft's missing-files/strict check) runs on a spawn that **succeeded** schema-wise and
  settles `done`.

## Goals / Non-Goals

**Goals:**

- Every stage re-entry through the spawn seam — under-budget re-run, escalation-approve re-entry (same
  process or resume), and the in-`runAgent` watchdog stall retry — continues the killed session's cached
  context instead of minting fresh, for all stages, not just review.
- The continuation stays visible and honest in the session ledger (same opencode session id across the
  killed and retrying attempts; statuses and attempt numbering unchanged).

**Non-Goals** (design-level, beyond the proposal's):

- Simplifying review's `resumeSession` plumbing onto the new seam — review's predicate is strictly broader
  (see D5); both coexist.
- Relaxing `noRetry` on continuation spawns. Defensible once D4 lands (the retry would hold the id it just
  captured), but the D2 fallback already provides the second chance fresh — no value in changing it now.
- An error-carrying continuation prompt variant for validation-exhaustion re-entries (accepted risk, R1).
- Tightening `resumeEventOf`'s `stage-rebuild` classification for the narrow crash window (accepted, R2).
- Continuing dangling-`spawned` entries for non-review stages after a true crash — stays fresh (that is
  review's existing, deliberately broader resume behavior).

## Decisions

### D1 — One killed-only continuation seam at `runStageAgent` entry

When `options.continueSessionId` is undefined, `runStageAgent` consults the session ledger for the latest
id-bearing entry with status `killed` for the spawn's `(label, round)`; if found, the spawn rides the
existing continuation path (continuation prompt, `--session`, D2 catch-fallback to fresh, the existing
`retrying` event on fallback). Precedence: explicit `continueSessionId` > seam lookup > fresh.

One seam covers all five non-review work modules (they all flow through `runStageAgent` with no
continuation plumbing today) and is inert for review (explicit id wins; review's fresh lens spawns settle
`done`, so the lookup finds nothing). Alternatives considered: plumbing a resume entry through each work
module (review-shaped) — more code, five copies of the same derivation; doing nothing per-stage and only
fixing the stall retry — leaves the F-A4 draft evidence (under-budget and approve re-runs minting fresh)
unfixed.

### D2 — `killed`-only is the process-agnostic boundary; the seam cannot and should not know the process

The agent layer cannot distinguish a same-process re-entry from a cross-process resume — the ledger looks
identical — and it must not: the escalation-approve re-entry usually arrives as a resume hours after the
gate parked, and the spec's scenario demands continuation there. `killed`-only scopes the mechanism without
process identity: in-process failures settle `killed` (continue), true crashes dangle `spawned` (non-review
stays fresh, review's existing `spawned|killed` plumbing continues as today). The lookup helper gains the
status filter rather than reusing `findInFlightSession`'s `spawned|killed` predicate verbatim.

Side effect accepted: a run that died in the seconds-wide window *after* a settled kill but *before*
re-entry resumes into a continuation while `resumeEventOf` classifies the path `stage-rebuild`. The common
cross-process case does not hit this — gate-parked resumes classify `artifact-skip, gate` and the re-entry
continuation happens post-settle, described by no resume event.

### D3 — The intra-bracket validation retry stays fresh; the spec wording pins "stage re-entry"

The agent-layer schema-validation recursion (`attemptStageAgent`, attempt 2 = fresh spawn + validator
error) is excluded: it calls `attemptStageAgent` directly and bypasses the `runStageAgent` entry seam, so
exclusion is the zero-code shape. It is also semantically right — that session *finished* its turn wrongly;
the fresh-plus-error path carries the diagnostic the continuation prompt doesn't, and "you were mid-run
when the process died" would be false for it. Stage-level validation failures (draft's missing-files /
strict check) settle `done` and re-run fresh by status — honest, untouched. The delta spec's requirement
text is amended from "a same-process re-run" to "a stage re-entry through the spawn seam" so requirement
and scenarios say the same thing.

### D4 — The stall retry continues the captured session, unconditionally, backend-mapped

In `runAgent`, the stall retry re-spawns continuing `handler.ctx.sessionId` when one was captured; with no
captured id the retry is exactly today's fresh re-spawn, so the behavior degrades safely for every consumer
(review-loop's roles, mutation-improve, afk-runner). The operator chose unconditional over an opt-in flag:
the failure mode is the status quo, the honesty argument is the same for all consumers, and a flag with one
setter is knob proliferation. The id → CLI flag mapping is backend-aware at the command-builder seam
(`--session` opencode / `--resume` claude) — both decoders capture ids (opencode event lines; claude
`session_id`), so the mapping must not be hardcoded to one backend's flag. The retry re-sends the same
prompt into the continued session (instructions arrive twice — history + new message); C7/C8 evidence says
the session id is what matters; keep the re-send. afk-runner's existing `extraArgs: ['--session', …]`
continuation path is unchanged (pre-existing shape, opencode-only runner). Side benefit: today the stall
retry's second minted session id is never recorded (`captureSessionId` is idempotent per handler) — with
continuation the ledger line stays accurate for free.

### D5 — Review's explicit plumbing stays

Review's `resumeSession` predicate is `spawned|killed` and round-scoped — strictly broader than the seam's
`killed`-only: it additionally covers the dangling-`spawned` cross-process crash, which the seam
deliberately excludes. Folding review onto the seam would lose that coverage or widen the seam past its
honest boundary. Keep both; the seam is a backstop that is normally inert for review.

### D6 — Ledger helper and ledger honesty

The killed-only lookup lives in `session-ledger.ts` (the currently-unused `findInFlightSession` gains the
status filter — or a killed-only sibling beside it; either way one exported seam, tests first). The
continuation spawn's id capture emerges from `recordSessionId` as today: a new attempt line carrying the
same opencode session id — the continuation is visible in the ledger exactly as the proposal requires.
No schema, status, or numbering changes.

## Risks / Trade-offs

- **[R1] A stage re-entry after validation exhaustion continues a session with the plain continuation
  prompt** — no validator error text, and "the process died" is not strictly what happened. → Accepted:
  rare in the corpus (F-A4 evidence was kill-shaped; C8 retry taxonomy clean across seven runs). Falsifiable
  trigger: corpus shows validation-exhaustion re-runs repeatedly producing invalid output → then add the
  error-carrying continuation prompt variant (held as a Non-goal until measured).
- **[R2] Crash-window resume classified `stage-rebuild` while the rebuild continues the session.** →
  Accepted: seconds-wide window; precise classification needs a label→position mapping the ledger doesn't
  carry. Falsifiable trigger: `analyze` corpus shows misclassified crash-window resumes mattering.
- **[R3] D4 changes stall-retry spawn semantics for review-loop and mutation-improve, not just afk-runner.**
  → Deliberate (operator decision, unconditional): same context-preservation win at cache prices; degrades
  to today exactly when no id was captured; red-first tests under tests/review-loop pin the behavior for
  all consumers.
- **[R4] A continued session may be in a mid-tool-call state when resumed.** → Same shape as the live-proven
  cross-process continuation (C7 incident A; C8 Run A seq 296); the D2 fallback bounds any continuation
  failure to "no worse than today".
- **[R5] Double session flag if `noRetry` is ever relaxed while `extraArgs` still carries `--session`.** →
  Moot while `noRetry` stays (Non-goal); note recorded so the relaxation change must unify the flag path
  first.

## Migration Plan

No persisted state, schema, or event changes — the ledger format and the event taxonomy are untouched, so
old runs resume under the same shapes and there is nothing to backfill. Delivery order is the TDD order
below; rollback is `git revert` of the change's commits. `docs/architecture/afk-runner.md`'s F-A4 paragraph
closes as fixed with this change cited (proposal Impact already pins that).

## Hook / TDD interactions

No new tool surface (capability/tool-prefs gating unaffected); no scope-model or DB impact — the ledger
lines stay keyed by `(runDir, label, round)` as today; no new dependencies or modules (the helper lives in
`session-ledger.ts`, the seam in `agent-layer.ts`, the stall-retry continuation in review-loop's
`agent-runner.ts`). Write-hook gateable paths and red-first order: 1) `session-ledger.ts` killed-only lookup
→ tests/afk-runner; 2) `agent-layer.ts` seam → tests/afk-runner (killed continues, spawned dangling and
done settle fresh, explicit id precedence, fallback-to-fresh); 3) review-loop `agent-runner.ts` +
command-builder mapping → tests/review-loop (captured id continues with the backend-correct flag, no id
stays fresh); 4) docs closure.
