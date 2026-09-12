## Why

The repo's strongest quality gate — the per-file mutation ratchet — never sees the coding-agent workspace: `stryker.config.json`'s `mutate` globs carry no `opencode-agent/**` entry, and the gateable predicate (`isGateableImplFile`, `.hooks/tdd/test-resolver.mjs:22-34`) — the gate's sole scoping authority for `test:mutate:changed` and `test:mutate:plan`/`:shard`/`:gate` — excludes `opencode-agent/src`, so an opencode-agent-only branch selects zero targets and passes unmeasured. Recorded verified-open (S6-5, S6-7) in `opencode-agent/docs/remaining-findings-evaluation.md`; the workspace ships pipeline code held by hand-run, unrepeatable mutation checks.

## What Changes

- **Widen the mutate scope:** add `opencode-agent/src/**/*.ts` to `stryker.config.json` with the existing `!**/index.ts` / `!**/constants.ts` exclusion pattern, so all-files and baseline-seed runs measure the workspace.
- **Route the dispatch:** add `opencode-agent/src/` to `isGateableImplFile` so branch-diff selection (local `test:mutate:changed`, the plan/shard/gate CI pipeline) selects workspace files like `review-loop/src/` and `afk-runner/src/` today.
- **Widen the mappers in step** (the documented rule that gate-scope changes never desync the mappers): `suggestTestPath`/`findTestFile`/`resolveImplPath` and `coverage-map.ts`'s `samePackageTestDir` learn `opencode-agent/src/x.ts ↔ tests/opencode-agent/x.test.ts`, keeping candidate test sets and score fingerprints honest. The predicate is shared with the Write/Edit TDD hook pipeline; share-vs-split is a design decision, with today's agreement as the default.
- **Keep `scripts/check.sh`'s workspace-scoped enumerations routing `opencode-agent/src`** (S6-7's surviving substance; no new per-workspace check entries — superseded by `remove-redundant-workspace-checks`' root-checks-only full mode).
- **Seed the baseline:** record per-file floors for the newly measured files in `scripts/mutation/baseline.json` from a green full run via the documented seed path, so the monotonic ratchet covers them from the first measured change.
- **Measure before committing to scope:** workspace-scoped decisions (seed-run cost, staged-mode membership, shard sizing) land in design.md as named numbers with measurement backing (measured 2026-09-03: 152 product files / 25,205 lines, superseding the stale S6-5 snapshot of ~8,897 lines / 59 files; ~107s per-file gate cost; measured shard-sizing constants). If seeding proves prohibitive, the S6-5 hot-file fallback is decided there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mutation-gate` (`openspec/specs/mutation-gate/spec.md`): the coverage contract — which files the gate evaluates — extends to the coding-agent workspace's product code, floors seeded from fresh measurement before the first gated change; the existing capability owns this contract and is extended, not duplicated. Without the delta, the whole-branch guarantee silently excludes ~25.2k lines of shipped code (152 files; the ~8.9k/59-file S6-5 snapshot is stale).

## Impact

- **Code:** `stryker.config.json`; `.hooks/tdd/test-resolver.mjs`; `scripts/mutation/coverage-map.ts`; `scripts/mutation/paired-run-cli.ts` (gains `--update-baseline`); `scripts/mutation/paired-run.ts` (wires the flag in its `main` — seeds via `runUpdateBaseline` and exits 0 instead of the threshold verdict); `scripts/mutation/baseline.json`. `scripts/check.sh` is **not** edited — the shell-check agreement lands as a pin test in `tests/scripts/check.test.ts` (design D7; non-goals forbid a check.sh behavioral change). `changed-files.ts` delegates to the predicate and should need no change.
- **Docs:** `docs/architecture/commands.md` (gateable-scope statement), `scripts/mutation/README.md` (ungated list and its "zero targets passes" verdict), root `AGENTS.md`/`CLAUDE.md` Testing Notes, `tests/CLAUDE.md`, `opencode-agent/ROADMAP.md` + findings markers.
- **Systems:** no new dependencies; no platform/task instances and no config-context scope impact (per-user, group-shared, thread-isolated all N/A — repo CI tooling only). Steady-state PR cost stays bounded by changed files; the one-off seed run measures the whole new file set first.

## Non-goals

- No widening to other deliberately-ungated trees (`scripts/`, `mutation-improve/`); no repair of pre-existing divergences elsewhere (e.g. `client/` is predicate-gateable but carries no mutate glob).
- No ratchet-semantics or threshold changes; shard-sizing constants are re-derived only from measurement.
- No new tests or score improvements demanded by this change; seeding records measured floors as-is.
- No `opencode-agent` runtime/workflow behavior changes; no per-workspace check entries reintroduced into `check.sh` full mode.
