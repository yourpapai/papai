<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Paired mutation runner

Fast, accurate mutation testing per file. Built around the observation that
`@hughescr/stryker-bun-runner`'s eager-import preload puts ~77% of mutants into
the `static` bucket, which `ignoreStatic: true` then discards (see
`docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`).

This tool pairs each source file with **only its companion test file** (via
`bun.testFiles`) and runs Stryker with `ignoreStatic: false`. Because the test
set is tiny, the accurate mode is cheap.

## Commands

```bash
# Measure the full configured Stryker mutate scope:
bun test:mutate

# Measure specific files on demand:
bun test:mutate:file src/providers/kaneo/label-resource.ts src/tools/update-status.ts

# Measure everything changed vs origin/master (also used by CI):
bun test:mutate:changed

# Optional threshold (exit 1 below it):
bun test:mutate --threshold=0.6
bun test:mutate:file src/foo.ts --threshold=0.6
bun test:mutate:changed --base=origin/master --threshold=0.6

# Show raw Stryker output while still writing paired JSON reports:
bun test:mutate:file src/foo.ts --verbose
```

Default output is concise: paired runs hide raw Stryker reporter chatter and
print per-file plus aggregate summaries from JSON. Add `--verbose` to stream raw
Stryker output. Per-file Stryker JSON reports land in `reports/paired/`.

## Companion-test resolution

The companion is resolved by `.hooks/tdd/test-resolver.mjs`:

- `src/foo/bar.ts` -> `tests/foo/bar.test.ts`
- `client/debug/x.ts` -> `tests/client/debug/x.test.ts`

## When a file's coverage lives elsewhere (cross-cutting)

If a source file is mostly exercised by integration or other suites rather than
its companion, register the extra tests in `scripts/mutation/overrides.json`.
The override list is **added to** the companion (or used alone if no companion
exists), e.g.:

```json
{
  "src/providers/factory.ts": ["tests/llm-orchestrator.test.ts", "tests/commands/context.test.ts"]
}
```

A file with no companion **and** no override is skipped with a warning — fix it
by either adding a companion test or registering the cross-cutting tests above.

## Command mapping

- `bun test:mutate` — accurate full paired run over the configured
  `stryker.config.json` `mutate` scope.
- `bun test:mutate:changed` — accurate paired run over files changed vs the
  selected base branch. The CI gate uses this command.
- `bun test:mutate:file` — accurate paired run for explicitly listed files.
- `bun test:mutate:changed-paired` — descriptive alias for
  `bun test:mutate:changed`.
