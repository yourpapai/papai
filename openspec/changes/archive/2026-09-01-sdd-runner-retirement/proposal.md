<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Why

U9's retirement sequence reached R5 with the gate green: R1–R4 are delivered (settle holes closed, log honest, the `runs` verb landed, every operator entry point on afk-runner), the parity oracle is self-contained inside `afk-runner/` (its `legacy-fold.ts` + fixtures never read `sdd-runner/`), and C7's live proof removed the last "unproven engine" reason to keep the fallback. Keeping the frozen workspace past this point preserves only the jscpd relaxation it justifies and blocks C8 from exercising the surviving engine exclusively. Exploration fired exactly one U9 re-opening trigger — the deletion surface depends on sdd-runner code `opencode-agent` still imports (`pricing.ts`) — so retirement ships with that dependency re-homed, not broken.

## What Changes

- `sdd-runner/src/pricing.ts` + `tests/sdd-runner/pricing.test.ts` move into `opencode-agent/` (sole consumer; the cross-workspace import dies). No behavior change.
- **BREAKING**: `sdd-runner/` + `tests/sdd-runner/` deleted (154 TS files) together with the whole transitional `sdd-runner:*` alias family (including the R4 cut-over alias `sdd-runner:start`) and the workspaces entry. Operators use `afk-runner:*`; recovery is `git revert` of the deletion commit — the R4 "one-line revert" story retires here.
- Config/build sweep: two Dockerfile COPY lines, the `knip.config.ts` ignore entry, the `scripts/mutation/coverage-map.ts` mapping branch + its one `baseline.json` key, the `check.sh` workspace comment; `bun.lock` regenerated.
- Re-tighten: the `detect-duplicates.ts` jscpd ignore block dies with the parity pairing it documents; duplication it was masking incidentally is fixed honestly (the C7 no-performed-re-tighten precedent).
- `sdd-runner-*` main-spec retirement (R4's explicit hand-off): all four capabilities removed via removal-only deltas, with a coverage mapping — live behavior stays governed by the unarchived afk delta stack plus the process-canon sections of `sdd-pipeline.md`.
- Naming honesty: `materialize.ts` GENERATED headers reworded (no hash covers `decisions.md`; two test pins updated), `auto-sdd` schema + template "sdd-runner materializes" strings, CLAUDE.md doc rows, `afk-runner.md` (U9 ledger row delivered, relaxation window closed, retirement paragraph past tense), `sdd-pipeline.md` banner, `commands.md` TDD-scope line, CHANGELOG entry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-runner-cli`: all five requirements removed. The interactive gate session and routing surface die with the workspace; hand-edit settlement is already carried by the `afk-runner-gate` and `afk-runner-gate-settle-robustness` deltas. Without removal, the main spec pins a terminal front-end nothing implements.
- `sdd-runner-output`: all nine requirements removed — the TUI rendering contract (sparkline, slot lines, watch verb) has no successor; U8's to re-earn.
- `sdd-runner-pipeline`: all four requirements removed — stage composition, convergence disclosure, and post-review resume are carried by the `afk-runner-think-half`/`afk-runner-tail`/`afk-runner-gate` deltas and the process canon.
- `sdd-runner-autonomy`: all fourteen requirements removed — ladder, deadlines, and queued steering are carried by the `afk-runner-gate`/`afk-runner-recovery` deltas; observe mode and the audit verb are deliberately unported (U8-adjacent re-earn, recorded as declined).

## Impact

- Code: `opencode-agent/src/model-metadata.ts` + two test-side importers; `package.json`; `Dockerfile`; `knip.config.ts`; `scripts/mutation/{coverage-map.ts,baseline.json}`; `scripts/check.sh`; `scripts/detect-duplicates.ts`; `afk-runner/src/work/materialize.ts`.
- Tests: `tests/opencode-agent/` (pricing suite moves, helper import), `tests/scripts/mutation/coverage-map.test.ts`, `tests/afk-runner/work/materialize.test.ts`.
- Docs: `CLAUDE.md`, `docs/architecture/{afk-runner,sdd-pipeline,commands}.md`, `openspec/schemas/auto-sdd/{schema.yaml,templates/*}`, `CHANGELOG.md`, `opencode-agent/{CLAUDE.md,README.md,ROADMAP.md}`.
- No platform or task instances affected; no config-context scope impact — developer tooling, workdir-local, no DB, no chat surface.
- Sequencing: after `sdd-runner-cutover` (landed); before C8, which exercises the surviving engine exclusively.

## Non-goals

- TUI re-host, watch verb, observe mode, audit verb resurrection — U8's re-earn, not retirement's.
- Spec consolidation under afk-runner capability names — happens when the afk delta stack archives; this change only removes the sdd-named specs.
- `.sdd-runner` workdir rename — would orphan every existing run dir and the run-index; the name is a directory, not a workspace reference.
- afk-runner provenance comments ("copied from sdd-runner") — parity-lineage documentation; git history holds the source.
- C8 second live cycle — lands after retirement by design; re-scores U4/U8.
- Portfolio enforcement — stays parked with U5.
