<!--
SPDX-License: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

Three C8 findings each broke or degraded a pre-registered live drill, all below the escape clause's bar and
all red-evidenced (`openspec/changes/v2-live-proof/reflection.md` §findings; event-line cites in
`notes.md`):

- **F-C1 — steer settles crash the waiter on throws.** A well-formed steer item-veto with a foreign id
  renders an answer whose preflight parse-back throws; `steerTick` handles `{rejected}` results but not
  thrown errors — the attending process dies (full stack in the C8 notes). The containment fix (gate-settle
  robustness) covered the gate-file path only. Killed the drill (b) probe's "waiter survives" assertion.
- **F-C2 — the substituted `POLICY-INTEGRITY` blocker never renders.** The ladder's signals run through
  `guardedReviewResult` but the gate file's digest builds findings from the unguarded reader (unparseable →
  empty-converged): the ladder refuses to decide while the operator sees a clean gate — "check the row to
  acknowledge" is impossible.
- **F-C3 — the deadline waiter is inert in production.** `processExpiry` requires ports
  `now`/`repoRoot`/`autonomy`; `waitSettledGates` passes none — `deadline: 10` arms (event field) and can
  never claim. An implementation gap against the already-spec'd "Deadline expiry is thin and config-gated"
  requirement (no new delta needed — the spec already demands the behavior). Blocked drill (c) entirely.

## What Changes

- **F-C1**: the steer settle path contains thrown settle errors exactly like the file path — feedback
  (sibling response-error artifact + stdout line) instead of waiter death; the steer file stays consumed.
- **F-C2**: the rendered gate's findings/digest use the guarded review result, so a substituted integrity
  blocker renders as an open blocker row the operator can acknowledge or veto.
- **F-C3**: the foreground waiter wiring passes the expiry ports (`now`, `repoRoot`, `autonomy`) so armed
  deadlines claim at expiry and emit their `auto_decision` audit events — implementing the existing
  requirement, fixture-pinned behavior unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `afk-runner-gate-settle-robustness` — "Settle failures become feedback, never waiter death" extends to
  every settle producer including the steer path; without F-C1 any malformed steer directive kills the
  attending process mid-run.
- `afk-runner-gate` — gains the rendering contract for integrity-substituted gates (F-C2); the expiry
  behavior needs no delta (already required; F-C3 is implementation).

## Impact

- Code: `afk-runner/src/work/gate-waiter.ts` (steer containment), `afk-runner/src/work/present-final.ts` +
  `gate-render.ts` (guarded findings), `afk-runner/src/run-resume.ts` (expiry ports). TDD red-first under
  the afk-runner write hooks; each fix has live red evidence (a crash stack, a rendered gate file, an
  armed-but-silent deadline).
- Docs: `docs/architecture/afk-runner.md` findings paragraphs close; the C9 scope seed's first item
  resolves.
- Instances/scope: none — offline runner.

## Non-goals

- Policy changes to the ladder, deadlines, or integrity thresholds (behavior only reaches what the specs
  already promise).
- F-A4's continuation work (`escalation-retry-session-continuation`) and pricing
  (`opencode-priced-model-route`).
- The veto-no-re-review policy question (recorded in the C8 reflection; separate decision).

## Fresh-session pointers

Red evidence per finding: F-C1 — the stack in `openspec/changes/v2-live-proof/notes.md` §Run A drill (b);
F-C2 — Run B pass 4's `gate-1.md` (clean render) beside `auto_decision{rule: none}` seq 420 in its
`events.ndjson`; F-C3 — pass 4's presented seq 419 (`deadlineAt` 05:09:29Z) with no claim through 05:12.
