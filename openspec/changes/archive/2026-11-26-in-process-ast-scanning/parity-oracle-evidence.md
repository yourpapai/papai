<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Parity oracle evidence (tasks 1.1–1.3)

Run: 2026-08-26, branch `in-process-ast-scanning` (stacked on
`claude/typescript-7-upgrade-iau4py` @ `8a2f4a3e5`), Bun 1.4.0, macOS arm64,
`oxc-parser@0.143.0` (resolved from the existing lockfile via knip).

Method: a throwaway harness (kept at `reports/parity-oracle/oracle.ts`,
gitignored) ran the real tsgo-based scanners — `extractStoryScenarios` from
`scripts/story/scenarios.ts` and `readPluginSourceGraph` from
`src/plugins/discovery-imports.ts`, both driven through
`withSourceParser` — against exact oxc replicas over the same inputs:

- Part A: all 69 `tests/stories/**/*.story.test.ts` files (~400 KB):
  scenario ids (literal `scenario(...)` and `executeScenario(...)` calls) and
  checkpoint chains compared element-for-element.
- Part B: all 7 real plugins under `plugins/` with entry points: ordered
  source graphs (BFS with identical visit keys, require/import edge rules,
  bare-module rejection, nondeterministic-import flags) and downstream
  manifest hashes.

The oxc replica also asserted zero parse errors on every file.

## Result

**IDENTICAL — 0 diffs.**

- Part A: 197 scenarios extracted by both parsers; every id present in both,
  every checkpoint chain equal.
- Part B: all 7 plugins (`acp`, `audio-transcribe`, `context-vault`,
  `synthetic-web-search`, `task-provider-github`, `task-provider-kaneo`,
  `task-provider-youtrack`) — identical sorted source-graph lists (2–6
  sources each) and identical manifest hashes computed from those graphs.

Task 1.3 (investigate diffs): no diffs to investigate; the gate opens.
Per design D1, semantic areas with no corpus coverage (non-literal dynamic
imports, aliased `import.meta.require`, bare-module rejections) are covered
by the existing suites that tasks 2.2/2.3 run against the new
implementation, not by this corpus run.
