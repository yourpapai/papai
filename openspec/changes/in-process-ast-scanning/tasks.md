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

- [ ] 6.1 Land the harness edits on master per the frozen-input protocol; re-record the story manifest `treeHash` and baseline SHA; update `tests/scripts/story-frozen-inputs.helpers.ts` expectations if the frozen set listing changes
- [ ] 6.2 Full verification: `bun check:full`, story lanes (`bun test:stories:contracts`, `bun test:stories`), storybook build, four workspace typechecks, real plugin discovery timing (expect milliseconds, clean exit)
- [ ] 6.3 Docs: update the CLAUDE.md TS-7 paragraph (no more child-process parser caveat), `tests/CLAUDE.md`, and note the retired `expectRejection` shim where its call sites no longer involve a child process; file/link the upstream TypeScript standalone-parse API issue and Stryker sandbox issue
