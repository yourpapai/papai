<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

# Tasks — sdd-runner-cutover

Sequencing: land after `cross-run-accounting` (R3) so the doc rows reference the
delivered `runs` verb. TDD per design.md — every `afk-runner/src/**` edit lands
behind a failing `tests/afk-runner/` test.

## 1. CLI attach policy and loud miss (test-first)

- [x] 1.1 Failing tests in `tests/afk-runner/cli.test.ts`: (a) a `start` invocation whose run parks gate-pending consumes zero ticks of an injected `gateWait` and returns, with the summary naming the gate file path and `resume <runId>`; (b) a `resume` invocation at a gate-pending park still attaches (tick consumed); (c) the bare-arg miss error names `start <taskFile>` and `resume <runId>`. Verify: `bun test tests/afk-runner/cli.test.ts`
- [x] 1.2 Implement in `afk-runner/src/cli.ts`: `cliMain`'s `start` path passes deps without `gateWait`; `runStartCommand`'s summary gains the gate-park pointer line (gate file at the folded version, resume command); `runCli`'s not-found error names the verbs. Verify: `bun test tests/afk-runner/cli.test.ts && bun run afk-runner:typecheck`

## 2. Cut-over switch and wrappers

- [x] 2.1 Repoint `sdd-runner:start` in `package.json` to `bun afk-runner/src/cli.ts`; leave `sdd-runner:test|typecheck|lint|format:check` untouched (frozen-workspace hygiene until R5). Verify: `bun run sdd-runner:start -- stop definitely-missing-run` prints afk's stop outcome (usage error is acceptable) and `bun run sdd-runner:typecheck` still runs the frozen workspace
- [x] 2.2 Rewrite `.claude/commands/sdd-auto.md` and `.opencode/commands/sdd-auto.md`: invoke `bun run afk-runner:start -- start $ARGUMENTS`; document only `--depth S|M|L`; drop the stale `--wait`/`--verbosity` lines; note that a gate park exits with the pointer line and `resume <runId>` attends. Verify: `diff .claude/commands/sdd-auto.md .opencode/commands/sdd-auto.md` is empty and both reference only the afk family

## 3. Docs

- [x] 3.1 `docs/architecture/sdd-pipeline.md`: historical banner under the title (frozen off-primary as of this change; engine and commands in afk-runner.md); one-line historical markers on `## Commands` and `## Live rendering`. No heading renames (the AGENTS.md `#admission-vs-division` anchor must resolve). Verify: manual read; `grep -c 'admission-vs-division' docs/architecture/sdd-pipeline.md` unchanged
- [x] 3.2 `CLAUDE.md`: SDD-pipeline doc-index row drops "runner commands" from coverage; afk-runner row gains "runner commands" and the cut-over state; the `/sdd:auto` route row repoints to `docs/architecture/afk-runner.md`. Verify: manual read
- [x] 3.3 `docs/architecture/commands.md` TDD-scope row (line 78): add `afk-runner/src/` beside `sdd-runner/src/`. Verify: manual read against `.hooks/tdd/test-resolver.mjs` `isGateableImplFile`
- [x] 3.4 `docs/architecture/afk-runner.md`: update the intro's frozen-beside sentence to the cut-over state; add the R4 row to the delivery table (after R3's row if present); add the retirement-sequence note recording the deliberate `sdd-runner:*` family split for the R4→R5 window. Verify: manual read; `openspec validate sdd-runner-cutover --strict`

## 4. Full gate

- [x] 4.1 Run the full gate: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run knip`, `openspec validate sdd-runner-cutover --strict`. Operator smoke (attended, optional capture): `bun run afk-runner:start -- start <scratch-task.md> --depth S` parks at gate with the pointer line and exits; `bun run afk-runner:start -- stop <that-run>` prints the stop outcome; `bun afk-runner/src/cli.ts .sdd-runner/runs/<historical-id>` still fold-prints an old run. Verify: all green + smoke lines observed
