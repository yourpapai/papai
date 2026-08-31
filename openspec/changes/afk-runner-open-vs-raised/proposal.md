# afk-runner-open-vs-raised

## Why

`evaluateConvergence` in `afk-runner/src/work/review-model.ts` counts
resolutions by `class` and never by `resolution`, and `work/review-loop.ts`
filters the same way — so a finding the resolver **fixed** still counts as
open. One number answers two different questions, and is wrong for both:

- No round converges if anything above a nitpick was raised, however completely
  it was resolved. At depth S (`ROUND_CAPS.S = 1`) one fixed MATERIAL cap-hits
  into an early gate that R2 cannot rescue — its trajectory window needs two
  rounds. S, the documented expected path for small changes, costs two human
  gates for work nobody objected to.
- R1 auto-approve requires zero findings of any severity, so it fires only when
  reviewers found literally nothing.
- The early gate lists already-fixed items as "Open MATERIAL findings", each row
  rendering the finding **id** where its verbatim gap belongs.

The fix is not to redefine "open" everywhere: the loop needs **two** numbers —
*raised* (the trajectory) and *open* (what only a human can settle) — mirroring
the existing `depth`/`roundCap` split.

## What Changes

- `evaluateConvergence` returns both count sets and a three-valued verdict:
  `converged`, `needs-review` (the round produced edits nothing has reviewed),
  `open`. Open = `dismissed`, plus `assumed` with no matching assumption record,
  plus `edited` that changed no bytes.
- `needs-review` at the cap buys **exactly one** verification round when budget
  allows, then converges regardless — one decision binds one round of spend.
- Per-round artifact hashes written at round close make an `edited` claim
  checkable; the assumption record gains an optional `findingId`.
- The `convergence` event gains an additive `open` count set; the finding action
  enum is untouched and pre-change logs replay unchanged.
- The integrity cross-check recomputes **both** count sets from the sidecars
  against the convergence event (master `558898d92` §6.3): a drift in the open
  set — the number R1 and R2's eligibility actually read — is as much a defect
  as one in the raised set.
- Gate finding rows carry the verbatim gap, joined from the findings sidecars,
  sanitized at the writer (master `2efb39c4a`): collapsed to one line, leading
  redirect marker stripped, truncated at a fixed width — the checkbox grammar
  anchors on line starts, so raw agent prose must not parse back as a decision.
  The gate-file writer flattens every free-text field it writes so the
  write-then-parse contract holds whatever prose arrives, pinned by a
  round-trip test over multi-line text carrying the decision directives.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `afk-runner-pipeline`: the convergence requirement splits raised from open,
  gains the `needs-review` verdict with its single verification round, and gains
  the per-round hashes that make an `edited` claim checkable. Without it depth S
  keeps paying two human gates for fully-resolved work and gate rows keep
  showing ids where gaps belong.
- `afk-runner-autonomy`: R1's zero-findings predicate and R2's eligibility read
  the **open** counts while R2's trajectory reads **raised**. Without it the
  ladder keeps asking one number two questions.

## Impact

- Code: `afk-runner/src/work/{review-model,review-loop,review,gate-model,
  gate-render,gate-prelude,gate-signals,materialize}.ts`, `event-schemas.ts`,
  the fold where counts are projected, + tests under `tests/afk-runner/`.
- Event grammar: `open` is additive and an absent `open` reads as `raised`, so
  the 26-fixture parity harness, frozen corpus, and memo oracle stay green.
  New persisted state: per-round hash sidecars keyed by run id.
- Docs: `afk-runner.md`, `sdd-pipeline.md` (review loop, convergence, gates).
- Instances/scope: none — offline runner workspace; no DB, no chat surfaces, no
  per-user / group-shared / thread-isolated state.
- Depends on `afk-runner-spec-home`; independent of `afk-runner-metered-budget`
  (that unplugs R4, this fixes R1/R2's inputs).

## Non-goals

- Redefining "open" globally — raised stays the trajectory number.
- Per-round artifact **snapshots**: hashes only, for the unbounded-disk reason
  snapshotting was declined on the ancestor.
- Reviewer/resolver prompt or model redesign; ledger memory belongs to
  `afk-runner-loop-memory`.
- The decomposition/plan branch — measured never-executed on master (0 `plan`
  events in 14 runs); U2 stays parked pending afk's own evidence.
