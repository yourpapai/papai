<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Why

Since the R4/R5 cut-over afk-runner is the sole runner, but its launch surface is still the prototype: `defaultCliDeps` hardcodes `budget: 5`, arms no deadline, and reads a single `AFK_RUNNER_MODEL` entry — while `loadRunnerConfig`, the five-key loader in `afk-runner/src/config.ts`, has zero production callers. No run can express an unmetered null budget, a numeric cost ceiling, or a wait deadline without ad-hoc wrapper scripts; the C8 live-proof matrix (calibrated ceilings, `budget: null`, deadlines) is unreachable from the front door.

## What Changes

- Every verb resolves its run configuration from a config file at the work dir when present, with a recorded precedence: config file over the `AFK_RUNNER_MODEL` environment entry over the compiled defaults; an absent file keeps today's env+defaults behavior.
- The five-key file contract is unchanged: strict unknown-key rejection and the metered derivation (`budget: null` ⇒ unmetered) stay intact.
- The default work-dir split is aligned with ignore-file reality — the schema defaults `.sdd-runner` (ignored) while the CLI stands up an unignored `.afk-runner`, so the runner's bookkeeping shows as tree dirt and trips the agent write guard; one default stands and the missing ignore entry covers it.
- The front-door command reference (`.claude/commands/sdd-auto.md` and its `.opencode` twin) documents the configuration surface; the doc-flag pin in `tests/afk-runner/cli.test.ts` stays total over both twins.
- CLI suites cover resolution, precedence, and rejection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `afk-runner-cli`: adds launch-configuration resolution (file/env/defaults ladder instead of the hardcoded shape); adds the standing-default-work-dir guarantee (ignore-covered, no tree dirt); extends the command-doc pin to the configuration surface. Without it the front door can launch only the hardcoded run, every run dirties the tree into a write-guard trip, and the pinned `--depth` inventory rots as the doc grows.
- `sdd-runner-config`: adds the resolution-precedence requirement beside the five-key schema it already owns — the config file at the work dir is the authoritative launch surface over the environment entry and the compiled defaults. Without it `loadRunnerConfig` stays a dead contract with zero callers and the spec's "no per-run spend override outside the config file" guarantee has no launch path.

## Impact

- Code: `afk-runner/src/cli.ts` (`defaultCliDeps`), `afk-runner/src/config.ts` (default alignment), `.gitignore`, `.claude/commands/sdd-auto.md`, `.opencode/commands/sdd-auto.md`.
- Tests: `tests/afk-runner/cli.test.ts`, `config.test.ts`, `agent-seam.test.ts` — resolution, precedence, rejection, pin total (detail in design.md).
- Specs: deltas against `openspec/specs/afk-runner-cli/` and `openspec/specs/sdd-runner-config/`; `afk-runner-autonomy` unchanged.
- Docs: `docs/architecture/afk-runner.md` (CLI/config rows); `docs/architecture/commands.md` needs no edit (reasoning in design.md).
- No platform or task instances affected; no config-context scope impact (per-user vs group-shared vs thread-isolated) — dev tooling over the repo workdir, no DB, no chat surface.

## Non-goals

- No new CLI flags (`--budget`, `--deadline`, `--model`): the ladder covers every recorded need; flag-level overrides are anticipated-only.
- No change to autonomy or metered semantics (`afk-runner-autonomy`).
- No per-role model map — the removed `models` key stays removed; one `model`.
- No legacy `.sdd-runner` workdir import or migration (the R3 separate-workdirs stance holds).
- No renaming of the surviving `sdd-runner-*` spec family despite the R5 workspace deletion.
- U3 execution-half states untouched.
