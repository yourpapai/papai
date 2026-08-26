<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: In-process AST scanning

## 1. Parity oracle (gate — no production edits before this passes)

- [x] 1.1 Build a throwaway comparison script that runs story scenario extraction over the full `tests/stories/**` corpus with both the current tsgo parser and an oxc-based parse, diffing scenario ids and checkpoint chains; record evidence in this change's directory
- [x] 1.2 Extend the comparison to plugin discovery: run entry-graph discovery over the real `plugins/` with both parsers and diff plugin sets, ordered source graphs, and manifest hashes
- [x] 1.3 Investigate and resolve any diff (scanner predicate fix or explicit recorded divergence) before proceeding; a contract-level divergence stops the change and reopens the design

## 2. Parser seam swap

- [x] 2.1 Rewrite `src/ts-ast/source-parser.ts` as an oxc adapter preserving the `SourceParser` interface (`parse`, `parseAll`, `close` as no-op) with no repository imports and no child process; keep the module async
- [x] 2.2 Rewrite `src/plugins/discovery-import-scan.ts` predicates on the oxc AST, preserving: non-literal dynamic-import and `import.meta.require` specifiers set their flags, aliased `import.meta.require` detection, static/export specifier collection — TDD against `tests/plugins/discovery-imports.test.ts` and `discovery.test.ts` first
- [x] 2.3 Rewrite `scripts/story/scenarios.ts` and `tests/smoke/harness/story-markers.ts` walks on the oxc AST, TDD against the manifest/marker suites
- [x] 2.4 Remove every `typescript/unstable` import from the three scanners and the parser seam; confirm `grep -r 'typescript/unstable' src/ scripts/ tests/` returns only typecheck-irrelevant hits

## 3. Guard restored to zero allowances

- [x] 3.1 Delete the tsgo spawn allowance from `tests/stories/harness/io-guard.ts` (`TSGO_EXECUTABLE`, `spawnExecutable`, `isAllowedTsgoSpawn`, both spawn carve-outs) and the two outside-the-root probe scenarios from `io-guard-probe.ts`; keep all denial probes
- [x] 3.2 Update the guard prose in `tests/CLAUDE.md` back to "no child process, ever"; io-guard suite green (including a probe that a tsgo-shaped path inside the root is now denied)

## 4. Dependencies and image

- [x] 4.1 Add `oxc-parser: 0.143.0` (exact) to dependencies; move `typescript` to devDependencies; refresh `bun.lock` and confirm knip still resolves the same shared binding
- [x] 4.2 Verify `bun install --frozen-lockfile --production` installs no `typescript` and no `@typescript/typescript-*` package; build the alpine image and confirm the musl binding resolves and the image shrank vs master
  - Local: scratch prod-install clean (typescript and @typescript/* absent, oxc binding resolved, node_modules 251M -> 224M vs PR #359 HEAD). Docker alpine build deferred to CI (no local Docker) — same caveat as PR #359.

## 5. Stryker pin and canary

- [x] 5.1 Add the sentinel pin test to `tests/scripts/mutation/stryker-config.test.ts`: assert `tsconfigFile` equals the sentinel, the file does not exist, and the failure message points at the `scripts/mutation/README.md` section
- [x] 5.2 Add the TypeScript canary job to `.github/workflows/nightly.yml`: install `typescript@latest`, run `bun run typecheck` and a discovery smoke; non-gating; document cadence choice in the workflow
- [x] 5.3 Run a mutation spot-check (`bun test:mutate:file src/plugins/discovery-import-scan.ts`) and ratchet the baseline if scores move
  - 84.7% first run; three negative pins added (computed require, non-import metas, rebound alias) lift it to 90.3%. No prior baseline entry exists for this new file, so the floor is seeded by CI's changed-files flow on merge.

## 6. Re-baseline, verification, docs

- [x] 6.1 Land the harness edits on master per the frozen-input protocol; re-record the story manifest `treeHash` and baseline SHA; update `tests/scripts/story-frozen-inputs.helpers.ts` expectations if the frozen set listing changes
  - Stacked-branch reality: the harness edits (scenarios.ts, story-markers.ts, io-guard files, test-helpers docblock) ride this branch to master as one unit; the treeHash re-record and any in-flight qualification rebases happen at merge, per design D7/D8. Frozen-input suites (enforcement-imports, manifest, snapshot) all green on this branch; helpers needed no shape change (FROZEN_PARSER_SUPPORT still lists the one file).
- [x] 6.2 Full verification: `bun check:full`, story lanes (`bun test:stories:contracts`, `bun test:stories`), storybook build, four workspace typechecks, real plugin discovery timing (expect milliseconds, clean exit)
  - check:full 8/8; contracts 458/458; manifest preflight green (259-cenario catalog); storybook builds; 4/4 workspace typechecks; discovery 7 plugins in 0.10s wall (was ~0.44-0.52s with the spawn). `bun test:stories` needs Docker — CI's Hermetic Full-Stack Stories job is the container truth, same caveat as PR #359.
- [x] 6.3 Docs: update the CLAUDE.md TS-7 paragraph (no more child-process parser caveat), `tests/CLAUDE.md`, and note the retired `expectRejection` shim where its call sites no longer involve a child process; file/link the upstream TypeScript standalone-parse API issue and Stryker sandbox issue
  - CLAUDE.md/tests CLAUDE.md/mutation README updated. expectRejection KEPT with a corrected docblock (original trigger gone; retiring it would churn frozen test files for cosmetics). Upstream issues (TS standalone parse API, Stryker sandbox rewrite) remain to be filed by a human — recorded in the change README note.

## Merge-day runbook (baseline handoff)

Verified on the merged `claude/typescript-7-upgrade-iau4py` head (7989c1914):

- `BASE_REF=origin/master bun test:stories:compat --manifest-only` reports
  exactly the intended frozen delta — 33 changed files plus
  `src/ts-ast/source-parser.ts` added. Nothing outside the intended set.
- `plugin-core-separation` shares no merge base with this branch (old root);
  its qualification plan already handles that via
  `git rebase --onto $BASELINE_SHA $OLD_BASE`.

When this PR merges to master:

1. The merge commit becomes the new qualification `BASELINE_SHA`.
2. Rebase `plugin-core-separation` (and any in-flight qualification branch)
   onto it per `hermetic-e2e-core-separation-proof` task 1.1:
   `git diff --exit-code $BASELINE_SHA -- tests/stories` must hold after the
   rebase; fixes confined to `src/` composition only.
3. Re-run `bun test:stories:compat --manifest-only` against the new
   `BASELINE_SHA` from the rebased branch — it must be green (the frozen tree
   is identical again).
