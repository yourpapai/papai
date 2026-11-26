# Separate raised findings from open findings in the review loop

## Why

`evaluateConvergence` counts every resolution by `class` and never by
`resolution`, so a finding the resolver **fixed** still counts as open
(`review-loop.ts:250-252`, `gate-digest.ts:255-257`). One number answers two
different questions, and is wrong for both:

- No round can converge if anything above a nitpick was raised, however
  completely it was resolved. At depth S (`ROUND_CAPS.S = 1`) one fixed MATERIAL
  therefore cap-hits into an early gate, and R2 cannot rescue it — its trajectory
  window needs two rounds. S, the documented "expected path for small changes",
  costs two human gates for work nobody objected to.
- R1 auto-approve requires zero findings of any severity, so it fires only when
  reviewers found literally nothing.
- The early gate lists already-fixed items as "Open MATERIAL findings", each row
  rendering the finding **id** where its gap belongs (`findingsOf` sets
  `gap: entry.id`).

The fix is not to redefine "open" everywhere. The loop needs **two** numbers:
*raised* (what reviewers said — the trajectory) and *open* (what only a human can
settle — the gate). R2 needs both at once: its trajectory asks "is the loop
converging?", its eligibility "is anything left worth extending for?". This
mirrors the existing `depth`/`roundCap` split. Census in `design.md`.

## What Changes

- `evaluateConvergence` returns both count sets and a three-valued verdict:
  `converged`, `needs-review` (the round produced edits nothing has reviewed),
  `open`. Open = `dismissed`, plus `assumed` with no matching assumption record,
  plus `edited` that changed no bytes.
- `needs-review` at the cap buys **exactly one** verification round when budget
  allows, then converges regardless — one decision binds one round of spend, the
  shape already used by the extend directive and `PLAN_REPLAN_PASSES`.
- Per-round artifact hashes make an `edited` claim checkable; `AssumptionRecord`
  gains an optional `findingId` so an `assumed` resolution is traceable.
- `ConvergenceEvent` gains an additive `open` count set; the `finding` action
  enum is untouched and pre-change logs replay unchanged.
- Gate finding rows carry the verbatim gap, joined from the findings sidecars.

## Impact

- Specs: `openspec/specs/sdd-runner-{pipeline,autonomy}`
- Code: `sdd-runner/src/{review-model,review-loop,review-round,post-review-tail,auto-policy,gate-prelude,gate-integrity,gate-digest,gate-sidecars,materialize,agent-layer,event-schemas,replay,resume-point,planning-stages,pipeline-env}.ts`
- Docs: `docs/architecture/sdd-pipeline.md` (Stages, Gate protocol, Event model)
- No chat platform instance, task instance, or config-context scope is involved:
  `sdd-runner/` is a developer workspace with no runtime chat surface.

## Capabilities

### New Capabilities

None. Both affected behaviors already have owners.

### Modified Capabilities

- `sdd-runner-pipeline` — owns "Severity-based convergence", the requirement that
  is wrong today, and what a gate presents. Without it, cap-hit routing keeps
  treating resolved findings as open and gates keep rendering ids as evidence.
- `sdd-runner-autonomy` — owns R1 and R2. Without it the ladder keeps reading the
  raised number, so R1 stays practically unfireable and R2's eligibility is
  blocked by findings already fixed.

## Non-goals

- **Resolver independence.** The resolver still classifies, resolves, and writes
  the ledger constraining the next reviewer. Declined to its own change: this one
  makes the numbers honest, not the judgment independent.
- **Showing `open` in the live burndown.** Burndown and sparkline keep raised.
- **Per-finding open-ness in the event log.** Stays sidecar-side.
- **Budget checks at round boundaries** and the per-role cheap-model tier.
