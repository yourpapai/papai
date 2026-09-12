# Design: Stryker 10 migration

## Context

The mutation gate runs Stryker via the paired runner (`scripts/mutation/`, see
`scripts/mutation/README.md` and
[ADR-0424](../../docs/adr/0424-incremental-mutation-measurement-with-whole-branch-gate.md)).
Three structural facts shape this migration:

1. **The Stryker CLI host is Node, not Bun.** `scripts/mutation/paired-run.ts:90`
   spawns `node_modules/.bin/stryker` (`#!/usr/bin/env node`) via `execFileSync`; only
   the test children run on Bun. Stryker 10 requires Node ≥ 22. The mutation CI jobs
   currently pin only Bun (`setup-bun`), inheriting whatever Node the runner image
   ships — currently Node 20, which v10 refuses.
2. **The bun runner is the only plugin bridging Stryker to `bun test`**, and its
   published 1.3.8 pins `peerDependencies: { "@stryker-mutator/core": "^9.0.0" }` and a
   `@stryker-mutator/api` dependency on 9.6.1. Upstream PR hughescr/stryker-bun-runner#1
   (open since 2026-08-17) widens both ranges after verifying the api 9↔10
   plugin-facing surfaces are byte-identical and e2e-running Stryker 10; no plugin
   source changes. The maintainer's last activity predates the PR.
3. **Scores are instrumenter-relative.** Stryker 10 swaps Babel 7→8 and adds an
   empty-expression mutator, so per-file mutant counts change. The score fingerprint
   hashes `bun.lock` + `package.json`, so the bump alone invalidates every carried-over
   score — but `baseline.json` floors persist regardless, and `seedMerge` (master seed)
   can only take the per-key **max**. A v10-measured score below a v9 floor would fail
   innocent PRs with no path to repair except a fresh full seed.

## Goals / Non-Goals

**Goals:**

- Installable, warning-free toolchain: core 10 + runner 1.3.8 side by side.
- The gate measures and judges under the same instrumenter as the floors it enforces.
- A migration path that cannot wedge master's baseline-seed job.

**Non-Goals** (design-level, beyond the proposal's):

- No changes to fingerprint inputs, cache keys, or gate logic in `scripts/mutation/`.
- No local-disk assumptions in the reseed — it must run where CI runs it.

## Decisions

### D1: Bun `patchedDependencies` for runner compat (not fork, not wait)

Bun supports `package.json` `patchedDependencies: { "pkg@version": "./patches/x.patch" }`.
The patch applies exactly upstream PR #1's `package.json` edits (peer
`"@stryker-mutator/core": "^9.0.0 || ^10.0.0"`, dependency
`"@stryker-mutator/api": "^9.0.0 || ^10.0.0"`) to the **installed** 1.3.8 package.

- *Fork*: rejected — an org repo to maintain for a two-line metadata delta.
- *Wait for upstream*: rejected — open PR with no maintainer activity for 8+ days;
  blocks the migration and dependabot keeps regenerating the conflict.
- *`overrides`/`resolutions`: rejected — they cannot widen a peer range; Bun still
  resolves the runner's own api dependency separately.

Patch hygiene: the patch file carries a header comment naming upstream PR #1 and the
condition for deletion (any runner release accepting core 10). Pin the patched version
exactly (`"patchedDependencies"` requires an exact version match).

### D2: Reseed `baseline.json` from a full fresh run, inside this change

The only transition that keeps floors and measurements instrumenter-consistent is a full
`bun test:mutate --update-baseline` (ratchetMerge rebuild) under v10, committed in this
branch. Partial alternatives are worse:

- *Seed-on-master-only*: the first post-merge PR touching any of 625 files measures
  under v10 against a v9 floor — random red gates, unfixable by `seedMerge`'s max-merge.
- *Floor-lowering pass*: nothing in the tooling lowers floors; inventing that mechanism
  is more code than the migration itself.

Mechanics: a one-shot `workflow_dispatch` job on this branch (not a laptop — the worst
observed changed-files run is 39m; a full 625-file run is a CI-scale campaign) runs the
reseed and commits `baseline.json` back to the branch. The PR merges only with the
reseeded baseline in it.

### D3: Pin Node 22 only in the two mutation jobs

Add `actions/setup-node@v22` to `mutation-testing` and `mutation-baseline` in
`.github/workflows/ci.yml`, before the run steps. Every other job runs Bun-only and is
unaffected. Pinned-by-SHA per repo workflow convention (`bun workflows:lint` governs).

Alternatives: relying on runner-image Node drift (implicit, untestable) or a repo-wide
Node pin (unnecessary churn).

### D4: No `scripts/mutation/` code changes

`execFileSync` inherits PATH; the pinned Node satisfies the CLI shebang; the runner
plugin surface is api-compatible per D1. The score-fingerprint invalidation on
`bun.lock` change is already-specified behavior
(`openspec/specs/mutation-gate/spec.md`, "A toolchain change invalidates every carried-over
score") — every open PR's carried-over cache misses once post-merge and re-measures.
That is correct-by-design, not a defect to engineer around.

## Risks / Trade-offs

- [Upstream merges #1 differently than our patch (e.g. api pinned exact)] → patch keeps
  working until the runner version changes; the exact-version pin in
  `patchedDependencies` makes any drift a loud install-time error, not silent breakage.
  Swap patch for the released version then.
- [Babel 8 instrumentation fails on some file shape] → surfaced as `errored` files in
  the reseed run, which the paired runner isolates per-file; fix or scope out via
  `mutate` globs before commit.
- [v10 scores drop broadly, weakening the ratchet] → the reseed records reality; the
  gate stays regression-only so nothing blocks. Lower floors are the honest cost of a
  more thorough instrumenter.
- [Reseed job exceeds CI timeouts] → split the full run into path-batched
  `test:mutate:file` invocations writing `scores.json`, then `test:mutate:seed` merges
  them; same mechanism the master job uses.
- [Two Stryker majors in flight (this branch vs. dependabot #352)] → this change
  supersedes #352's Stryker delta; if #352 merges first, rebase drops the conflict
  because ours pins the same `^10.0.0` plus the patch.

## Migration Plan

1. Land compat + Node pin + docs (tasks 1–4). Gate still runs v9 floors against v9
   measurements — no behavior change yet.
2. Kick the `workflow_dispatch` reseed on this branch; review the `baseline.json` diff
   (expect near-total churn of 625 entries).
3. Merge. Open PRs' score caches miss once (lockfile fingerprint) and re-measure under
   v10 against v10 floors.
4. Delete the patch when a runner release accepts core 10 (tracked as a task here, not
   a follow-up memory).

Rollback: revert the merge commit; `baseline.json` returns to v9 floors and the
lockfile to v9, restoring instrumenter/floor consistency — no cached state outlives the
revert because the lockfile is a fingerprint input.

## Open Questions

None — the upstream PR body already verified the api 9↔10 compatibility this design
leans on, and the reseed mechanics reuse shipped tooling.
