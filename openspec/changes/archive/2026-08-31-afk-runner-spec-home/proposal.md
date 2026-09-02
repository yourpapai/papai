# afk-runner-spec-home

## Why

`sdd-runner-retirement` carries `REMOVED Requirements` deltas covering **every**
requirement of all four main specs (`sdd-runner-autonomy` 14, `output` 9,
`cli` 5, `pipeline` 4 — 32 of 32). On archive, afk-runner — the sole runner
since R5 — has **zero** spec coverage, and the four queued mirror changes
(`afk-runner-metered-budget`, `-open-vs-raised`, `-run-analysis`,
`-loop-memory`) have no parent capability to delta into.

## What Changes

- Four main-spec capabilities under the `afk-runner-*` name, carrying forward
  the requirements still true of afk-runner, rewritten to afk truth.
- The rewrite **absorbs master's `sdd-spec-repair`** rather than porting it
  (its parents are the specs being removed here): single-mode policy
  evaluation and unconditional previews replace autonomy levels and observe
  mode; the config-`deadline` waiter with claim-file and re-arm semantics
  replaces `--auto-deadline`; the `audit` verb, its reopen overturn path, the
  policy-debt ledger, the removed decision flags, `--verbosity quiet`, and the
  `watch` verb are not carried — afk has none of them, and its pre-settle
  steer override (a queued veto/abort beats a pending auto-decision) is the
  overturn guard that stays.
- Adds requirements for surfaces afk grew after the fork that no spec covers:
  the gate as machine state with four settle producers, the escalation gate
  mode over the per-stage failure budget, the event-sourced `stop` verb, the
  passive `runs` accounting verb, classified `resume` events, and the
  `round_open` owedness invariant.
- **No code changes** — spec-only.

## Capabilities

### New Capabilities

- `afk-runner-pipeline`: stage sequence, review loop, convergence, gate
  protocol. Without it `afk-runner-open-vs-raised` and `-loop-memory` have no
  parent for their convergence and lens-merge deltas.
- `afk-runner-autonomy`: R1–R5 ladder, never-cut invariants, `auto_decision`
  event, deadline waiter. Without it `afk-runner-metered-budget`'s R4 rewrite
  has nothing to modify.
- `afk-runner-cli`: the routing verb, gate discovery, hand-edited gate file,
  `start`/`resume`/`stop`/`report`/`runs`. Without it the operator surface is
  unspecified for the first time since the pipeline existed.
- `afk-runner-output`: renderer contract, report and memo content. Without it
  the memo-parity oracle pins bytes no requirement claims.

The `sdd-runner-*` four are these capabilities' ancestors. They are not
extended because `sdd-runner-retirement` removes them wholesale and the
workspace they name no longer exists.

### Modified Capabilities

_None_ — the ancestors' removal is already carried by `sdd-runner-retirement`.

## Impact

- Specs only: four new `openspec/specs/afk-runner-*/spec.md`. No code, tests,
  dependencies, or DB.
- Docs: `docs/architecture/afk-runner.md`, `docs/architecture/sdd-pipeline.md`
  cross-references.
- Instances/scope: none — afk-runner is offline developer tooling outside the
  papai runtime; its config is per-workdir, not per-user, group-shared, or
  thread-isolated.
- **Ordering hazard:** unarchived changes still delta into `sdd-runner-cli`
  (`stop-dead-runs`, `sdd-create-prompt-stdin-fix`, `sdd-runner-session-*`,
  `sdd-runner-simplify`, `sdd-runner-tui-wiring`). They archive first or get
  re-pointed; design.md owns the resolution.

## Non-goals

- Any behavior change — this is spec relocation plus reconciliation to code
  that already exists.
- Specifying the decomposition/plan branch. Master built it and then measured
  it had **never executed** (0 `plan` and 0 `child_spawned` events across 14
  runs; `oversize` absent from all 11 depth sidecars), so afk-runner declines
  it now and keeps U2 parked, to be explored on afk's own evidence later.
- Reviving `sdd-runner-{config,durability,tui}` (unarchived-only, no main spec).
- Specifying a TUI — afk-runner has no screens (U8 `hold`).
