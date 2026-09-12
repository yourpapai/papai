## Why

C1–C6 are proven against history only: 26 fixtures, memo-parity over the surviving originals, kill -9 drills in-process with stubbed agents. No live run of the graph exists — `opencode` spawns, real wall clock, real budget burn, a human answering real gates are all unexercised. The U-ledger re-score that "decides next" has no evidence input, and the prototype relaxation window (C1–C7) closes here carrying a re-tighten promise made before C5/C6 grew the ported surface — it must be honestly split, not performed. C7 is the plan's reserved row for exactly this.

## What Changes

- **Two-run live proof, honestly classified**: an S calibration run (actualizing README/project docs for the GitHub task-tracker plugin — shipped on master, invisible in its README; the classifier's honest-S space, and a plumbing proof: config, spawn, gates, waiter) and an M proof run (the plugin tool-gate port — contained, cross-module, honestly M; no `--depth` override — misclassification is a finding, not a failure). Runner executes from this branch; target is a fresh master worktree via `repoRoot` (copies, not imports — target needs nothing from the branch; both targets' ground exists on master).
- **Three induced incidents**: kill -9 mid-review round (D6 window — same-round resume via session continuation; process-group kill, orphaned-child behavior observed), final-gate veto on a converged round 1 (outcome-ordered settle, veto-updater revision, deliberate over-cap round), and a bogus-model scratch run (real `AgentValidationError` → `stage_failed{kind: exhausted}` → escalation → abort → `failed` memo — infra stays transport-only, pre-registered).
- **Pass criteria**: zero operator hacks (no manual appends, no file surgery outside gates/steer); recovery through documented verbs only; the produced change passes `openspec validate --strict` and its tests; memo/report honesty spot-checked against the log; ≥3 named frictions.
- **Live-log harvest**: the M run's `events.ndjson` joins the corpus as a live-marked fixture lane (oracle: fold ≡ memo + invariants — the first log the graph itself authored).
- **Reflection + ledger re-score**: verdict/evidence/trigger per U-item (exactly one `next`; n=1 preamble; evidence cites `events.ndjson` lines, `done`-event usage, gate stamps); the living U-table moves to `docs/architecture/afk-runner.md`.
- **Pre-registered findings** (decided before the run, so the reflection cannot retrofit): prescreen substring over-match (`authorization` → L — a faithful copy of sdd-runner's frozen regex, fix deferred); honest-S ≈ docs-only; gate-wait calendar dominance (already visible: 2.7–3.8-day historical spans on 10–12 spawns); cache economics of session continuation (53.8M cached vs 4.85M fresh tokens across five M fixtures).
- **Re-tighten split**: the oxlint quartet re-tightens now (4 over-limit files split — run.ts 603, gate-waiter.ts 351, agent-layer.ts 314, event-schemas.ts 303; 4 StageId assertions → zod-parse; taxonomy classes extracted to satisfy `max-classes-per-file` without undoing C6's co-location); the jscpd oracle ignores and the tests `no-unsafe-*` block re-time to U9 with recorded justification (ported tests mirror sdd-runner by design — the duplication is the parity oracle and dies only with retirement).

## Capabilities

### New Capabilities

- `afk-runner-live-proof`: the live conformance protocol — proof definition, incident drills, live-corpus harvest, reflection form, and the relaxation-window close-out for afk-runner V1. Sibling of `afk-runner-kernel`/`think-half`/`gate`/`tail`/`recovery` (complete-but-unarchived). Without it: V1's claim rests on historical replay alone, the U-ledger re-score stays vibes, and the window closes with a performed re-tighten that would immediately need re-loosening.

### Modified Capabilities

- None in `openspec/specs/` — afk capabilities are not yet archived; engine requirements hold and are exercised, not weakened.

## Impact

- Code: `afk-runner/src/**` (behavior-preserving splits/refactors only), `.oxlintrc.json` (override removal), `scripts/detect-duplicates.ts` (ignore re-annotation); `tests/afk-runner/fixtures/` (live lane) — no `sdd-runner/` changes.
- Docs: `docs/architecture/afk-runner.md` (C7 row, living U-table, relaxation-window close-out).
- No platform/task-instance or config-context surface; repo-local run dirs (compliance inherited).

## Non-goals

- M/L depth claims beyond the one run — the re-scored ledger owns them.
- Prescreen keyword fix (word boundaries) — post-C7 decision; the proof runs the engine as-is.
- sdd-runner retirement (U9), TUI re-host (U8), snapshot memo (U7) — ledger items, not C7 scope.
- Deadline-expiry live drill — fixture-proven, a boring wait; declined.
- Escalation inside the real M run — incident C lives in a scratch run; the real run stays clean.
- Re-litigating the chosen targets — decided in design (D2): README/docs actualization for S, the toolgate port for M with the existing change folder as rubric; the spec itself stays target-agnostic.
- W4 and the sub-second W3/D7 windows live — unaimable; fixture-proven, recorded as accepted.
