# Proposal: remove-redundant-workspace-checks

## Why

`check.sh` (the `check:full` CI gate) runs four `review-loop:*` entries that re-execute root checks over files the root checks already sweep, and `check:verbose` does the same for `review-loop:*` and `mutation-improve:*`. In full mode, `review-loop:test` re-runs the 45 `tests/review-loop` files **concurrently** with the root `test` job that just ran them — on the exact 4-vCPU CI budget `check.sh`'s own comments warn is scarce. Every new workspace has re-raised "should we add `ws:*` entries?" with no recorded answer; the drift (review-loop → everywhere, mutation-improve → `check:verbose` only, sdd-runner/opencode-agent → nowhere) shows the entries were never load-bearing.

Dev-tooling only: no platform/task instances, no runtime behavior, no config-context scope impact.

## What Changes

- **Remove** the four `review-loop:lint`, `review-loop:typecheck`, `review-loop:format:check`, `review-loop:test` entries from `scripts/check.sh` full mode (line 332), plus their now-dead special-casing: the `--skip-tests` filter case (line 337), the dedicated `elif` runner (lines 422–423), and the failure-hint `case` arm (line 461). Full mode goes from 12 to 8 checks.
- **Remove** all eight `review-loop:*` and `mutation-improve:*` entries from the `check:verbose` script in `package.json`.
- **Keep** the per-workspace proxy scripts (`review-loop:test`, `mutation-improve:lint`, …) in `package.json` as local DX conveniences.
- **Update** `tests/scripts/check.test.ts` assertions to the new composition (test-first).

## Capabilities

### New Capabilities

- `check-pipeline` — the contract that the aggregate check surface (`check.sh`, `check:verbose`) enforces workspace code exclusively through root checks. Without it, nothing records that per-workspace entries are redundant-by-design: the next workspace author re-derives the question, and the concurrent-duplicate-test destabilizer can be reintroduced unnoticed.

### Modified Capabilities

None. No existing spec under `openspec/specs/` governs check composition; `mutation-gate` and `mutation-improve-artifact-scope` cover Stryker/build-gate behavior and are untouched.

## Non-goals

- Fixing the `mutation-improve/src` and `sdd-runner/src` gaps in `check.sh`'s `is_license_header_file` / `is_oxlint_scoped_file` enumerations (a real, separate hole; its fix is orthogonal and should not ride along).
- Removing or restructuring the per-workspace proxy scripts in `package.json`.
- Deriving workspace lists dynamically (e.g. from `package.json` `workspaces`) anywhere — the removed lists stay removed, not regenerated.
- Restructuring toward per-workspace self-gated checks.
- Touching staged-mode (`--staged`) behavior beyond the dead `--skip-tests` filter case.
- Changing the mutation-testing ratchet, `test:client`, coverage ratchet, or CI workflow composition.
