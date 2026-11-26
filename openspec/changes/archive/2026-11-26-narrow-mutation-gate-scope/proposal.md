# Narrow the gateable roots to product code

## Why

`isGateableImplFile` (`.hooks/tdd/test-resolver.mjs:22`) admits five roots: `src/`, `client/`,
`plugins/`, `review-loop/src/`, `sdd-runner/src/`. The last two are internal infrastructure —
they ship nothing to a user, and paying the mutation gate's per-file cost for them is overhead.

The bill is measurable. Across the last 32 first-parent commits on master the gate selected 141
targets and **118 of them (84%) were `sdd-runner/src/` or `review-loop/src/`**; only 23 were
product code. Whole merges were infrastructure-only: #380 selected 38 targets, all
`sdd-runner/src/`; #381 selected 25, all `sdd-runner/src/`; #383 selected 3, all `sdd-runner/src/`.
At the repo's own measured ~107s/file that is roughly 3.5 hours of CI spent mutating
infrastructure. `sdd-runner` PRs are what drove the 73m21s run
([33292465702](https://github.com/yourpapai/papai/actions/runs/33292465702)) that
`shard-mutation-gate` was built to survive.

The same five-root list has drifted from any stated rule, which is what makes it look broken:
`scripts/` (203 impl files, 118 test files), `opencode-agent/` (148/68) and `mutation-improve/`
(21/20) are equally internal and are *out*, so PRs #384, #386 and #389 each reported zero targets
while changing real tested TypeScript. Two infrastructure workspaces in and three out is not a
policy. This change picks the coherent line: **the gate measures product code.**

## What Changes

- Narrow `isGateableImplFile` to `src/`, `client/`, `plugins/`. `review-loop/src/` and
  `sdd-runner/src/` stop being gateable.
- Drop the 100 now-unreachable floors from `scripts/mutation/baseline.json` (81
  `sdd-runner/src/`, 19 `review-loop/src/`; 429 entries → 329).
- Record the rule in the `mutation-gate` spec so the root list has a stated reason rather than an
  accreted one.

## Capabilities

### Modified Capabilities

- `mutation-gate`: its "whole branch diff" requirement leans on the word *gateable* without ever
  defining it. Adds one requirement fixing the file scope to product code and pinning the
  consequence the evidence above shows is load-bearing — a branch touching only non-gateable roots
  is a legitimate zero-target run, not a failure. Without it the root list stays undocumented and
  drifts again. Existing requirements are unchanged in substance.

## Non-goals

- **Failing a run that selects no targets.** Explicitly declined: after this change a zero-target
  run is the *expected* outcome for an infrastructure-only PR, so failing on it would red every
  such PR.
- **Adding `scripts/`, `opencode-agent/src/` or `mutation-improve/src/`.** Considered and declined
  — same internal-infrastructure rationale that removes the other two.
- **Any change to the shard plan/gate topology, the score cache, or the master seed job.**
- **Reintroducing mutation coverage for the dropped roots by another route** (a separate
  infrastructure lane, a nightly run). Nothing needs it today; declined rather than deferred.

## Impact

- `.hooks/tdd/test-resolver.mjs` (`isGateableImplFile` only), `scripts/mutation/baseline.json`.
- Tests: `.hooks/tests/tdd/test-resolver.test.ts`, `tests/sdd-runner/test-resolver.test.ts`.
- **Also narrows the Write/Edit TDD hook** — five checks share this predicate. See design.md D1.
- Docs: `openspec/specs/mutation-gate/spec.md`, `scripts/mutation/README.md`,
  `docs/architecture/commands.md`, `docs/guides/tdd-PIPELINES.md`.
- **Scope impact: none** — CI and local-hook tooling. No platform instance, task instance, or
  config context is involved.
