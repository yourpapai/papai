# Tasks: Stryker 10 migration

Implements the decisions in `design.md`. CI-tooling only — no runtime code. TDD where a
behavior is verifiable locally (patch presence, Node pin); the rest is verifiable by
running the tooling itself.

## 1. Runner compat patch

- [x] 1.1 Generate the Bun patch for `@hughescr/stryker-bun-runner@1.3.8` applying
  upstream PR hughescr/stryker-bun-runner#1's `package.json` edits only (peer
  `@stryker-mutator/core` → `^9.0.0 || ^10.0.0`; dependency `@stryker-mutator/api` →
  `^9.0.0 || ^10.0.0`), with a header comment naming the upstream PR and the deletion
  condition. Verify: `bun install` succeeds with no peer warnings for the runner.
- [x] 1.2 Bump `@stryker-mutator/core` to `^10.0.0` in `package.json` devDependencies,
  add the `patchedDependencies` entry (exact version `@hughescr/stryker-bun-runner@1.3.8`),
  run `bun install`. Verify: `bun pm ls @stryker-mutator/core` resolves 10.0.0 and
  `bun install` emits no unmet-peer warnings.

## 2. Smoke the gate under v10

- [x] 2.1 Run a paired measurement on a small stable target (e.g.
  `bun test:mutate:file src/tools/update-status.ts` — pick one already in
  `baseline.json`) and confirm: dry run completes, mutants run, a report lands in
  `reports/paired/`, and the score is comparable to the v9 baseline entry (within a few
  points; the empty-expression mutator may shift it). Record any `errored` outcome and
  diagnose before proceeding — Babel 8 instrumentation problems surface here first.
- [x] 2.2 If task 2.1 errored: fix or scope the failing file shapes out via
  `stryker.config.json` `mutate` globs, and re-run until a clean paired run completes.
  (Skip if 2.1 was clean.)

## 3. CI Node 22 pin

- [x] 3.1 Add `actions/setup-node@<sha> # v22` (SHA-pinned per workflow convention,
  node-version: 22) to the `mutation-testing` and `mutation-baseline` jobs in
  `.github/workflows/ci.yml`, after `setup-bun`, before the run steps. Verify:
  `bun workflows:lint` passes and the YAML diff shows exactly the two jobs touched.
- [ ] 3.2 Confirm the CLI host resolution: run `node --version` and
  `bun test:mutate:file <same file as 2.1>` inside the pinned-Node job on the branch
  push (CI run), verifying the gate job is green under Node 22 with the v10 CLI.

## 4. Baseline reseed under v10

- [x] 4.1 Add a one-shot `workflow_dispatch` job (`mutation-reseed`) to
  `.github/workflows/ci.yml` that runs `bun test:mutate --update-baseline`
  (`--no-score-cache` implied) with an extended timeout, and commits the regenerated
  `scripts/mutation/baseline.json` back to the branch. Marked `if: github.event_name ==
  'workflow_dispatch'` so it never runs on ordinary pushes. Verify: job YAML passes
  `bun workflows:lint`.
- [ ] 4.2 Kick the reseed on this branch; review the `baseline.json` diff — expect
  near-total churn across the 625 entries, some floors down (new mutator), none up
  beyond noise. Spot-check three files' new floors against their task-2.1-style paired
  scores. If the run exceeds timeouts, fall back to the path-batched
  `test:mutate:file` + `test:mutate:seed` merge path from design.md Risks.
- [ ] 4.3 Remove the `mutation-reseed` dispatch job after the reseeded baseline is
  committed (it is one-shot by design; keeping it invites accidental full reseed).
  Verify: `bun workflows:lint` passes; `ci.yml` diff no longer contains the job.

## 5. Docs and cleanup

- [ ] 5.1 Update `scripts/mutation/README.md`: note the Stryker 10 toolchain, the
  runner patch (existence, upstream PR #1, deletion condition), and the Node 22 host
  requirement. Update `docs/architecture/commands.md` mutation mentions if they name
  versions. Verify: docs read current; no stale v9 references.
- [ ] 5.2 When a `@hughescr/stryker-bun-runner` release accepting core 10 ships
  (watch upstream PR #1): delete `patches/` and the `patchedDependencies` entry,
  `bun install`, re-run `bun test:mutate:file <canary>`. If no release exists at merge
  time, leave the patch and this unchecked task rides as a reminder on the branch.
- [ ] 5.3 Final: full `bun test`, `bun run typecheck`, `bun run lint`,
  `bun workflows:lint`, and confirm the branch's CI `mutation-testing` job is green
  against the reseeded baseline.
