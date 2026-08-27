<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: In-process AST scanning

## Why

The TypeScript 7 upgrade (PR #359) moved all three AST scanners onto
`typescript/unstable` served by a `tsgo` child process. That single decision
created every remaining weak side: the hermetic story lane's I/O guard had to
admit an unobservable process, `typescript` became a runtime dependency
(+7MB production image, spawn per discovery), the source parser carries four
TS-7.0.2-observed workarounds that every `^7.0.2` bump can invalidate, and the
frozen story inputs now include the most churn-prone file in the tree.
`oxc-parser` (already in the lockfile via knip, same binding family Bun's own
transpiler uses) parses TypeScript in-process and removes all four at once.

## What Changes

- Rewrite the three scanners (plugin entry-graph discovery, story scenario
  extraction, story markers) to parse via `oxc-parser` behind the existing
  `src/ts-ast/source-parser.ts` seam, preserving the async signature.
- **Gate**: a parity oracle must prove output equivalence first — identical
  scenario manifests over the full story corpus and identical plugin graphs
  and manifest hashes over the real plugins, tsc-parser vs oxc-parser.
- Close the hermetic I/O guard's `tsgo` spawn allowance entirely; delete the
  probe scenarios that pin it. The guard returns to "no child process, ever".
- Move `typescript` back to devDependencies; drop the `@typescript/typescript-*`
  platform packages from the production image.
- Delete the `expectRejection` test shim's reason (Bun 1.4 `.rejects` slowness
  only bit because a live child process sat in the rejecting chain); retire the
  shim where its call sites no longer need it.
- Pin the Stryker tsconfig sentinel with a config test asserting the
  `tsconfigFile` value and the file's deliberate absence (independent fix that
  rides this change; documented in `scripts/mutation/README.md`).
- Nightly CI canary that installs the latest `typescript` and runs
  `bun run typecheck` plus a discovery smoke, so `^7.0.2` drift surfaces on a
  schedule rather than mid-PR.

Without it: the guard permanently admits one unobservable binary, the image
carries a compiler it never runs, and each TS/Bun bump re-verifies four
undocumented `unstable` API behaviors by hand.

## Capabilities

### New Capabilities

- `in-process-ast-scanning`: the AST-scanning seam parses source text
  in-process with no child process and no `typescript/unstable` dependency;
  the hermetic story lane denies every spawn again.

No existing spec covers the story harness or the parser seam
(`openspec/specs/` has no story-harness entries; nearest neighbors
`mutation-gate` and `sdd-runner-*` cover unrelated pipelines), so a new
capability is required rather than an extension.

### Modified Capabilities

None.

## Non-goals

- No change to platform/task instances, scope model, or DB — the runtime
  seam's inputs and outputs (import specifiers, scenario ids, checkpoints,
  manifest hashes) are frozen by the parity gate.
- No upstream work in scope: the TypeScript standalone-parse-API issue and the
  Stryker sandbox-patch PR are filed and linked from design.md but tracked
  externally.
- No rewrite of the frozen-inputs freeze rule itself; the re-baseline follows
  the existing harness-change-on-master protocol.
- Not migrating typechecking or any other `tsc` use — only the three scanners.
- Declined: injecting pre-parsed discovery results into hermetic scenarios
  (option D from exploration) — it would stop the lane from proving candidate
  discovery.

## Impact

- **Code**: `src/ts-ast/source-parser.ts` (shrinks to an oxc adapter),
  `src/plugins/discovery-import-scan.ts`, `scripts/story/scenarios.ts`,
  `tests/smoke/harness/story-markers.ts`, `tests/stories/harness/io-guard.ts`
  (allowance deleted), `tests/utils/test-helpers.ts` (shim retirement),
  `stryker.config.json` pin test, nightly workflow.
- **Deps**: add `oxc-parser` (pin at knip's current 0.143.0 to share the
  binding); `typescript` → devDependencies.
- **Docs**: `CLAUDE.md`, `tests/CLAUDE.md` (guard wording), repo CLAUDE.md
  TS-7 notes, `scripts/mutation/README.md` (pin test reference).
- **CI**: story qualification re-baseline commit on master; new nightly canary
  job.
