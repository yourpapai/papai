## 1. Guard: content-aware manifest comparison

- [x] 1.1 Add the install-relevant field constant beside `MANIFEST_PATHS` in `opencode-agent/src/git-drift.ts` (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, `resolutions`, `overrides`, `workspaces`, `trustedDependencies`, `patchedDependencies`), with the comment naming why each member refuses and why `scripts` / `packageManager` / metadata do not (design D2)
- [x] 1.2 Extend `assertManifestsInSync` (TDD: write the failing tests of task 2.1 first): for each changed non-lock manifest, read both sides via the injected `GitFn` (`git show <ref>:<path>`), `JSON.parse`, and refuse only when an install-relevant field differs by deep equality (`isDeepStrictEqual` from `node:util`); treat a parse failure on either side as drifted for that file, and a one-sided file as compared against `{}` (design D1, D3)
- [x] 1.3 Keep `bun.lock` on the unconditional any-diff refusal, unchanged

## 2. Tests

- [x] 2.1 New `tests/opencode-agent/git-drift.test.ts` driving the `GitFn` seam with canned `diff --name-only` / `git show` outputs: scripts-only edit passes (the issue #360 `check:verbose` shape), each install field family refuses, semantically-identical-but-reformatted `dependencies` passes, lockfile diff refuses, malformed JSON on either side refuses, added workspace with only `name` passes, added workspace with `dependencies` refuses, deleted manifest with install fields refuses
- [x] 2.2 Assert the refusal's persisted bookkeeping is unchanged: an existing test (or an addition beside it) pins that a drift refusal carries `attempts` and parks with the resume point intact, and that `/sync` still passes `allowDependencyDrift`

## 3. Diagnostics and docs

- [x] 3.1 Extend `dependencyDriftError` in `opencode-agent/src/errors.ts` to report drifted fields per file in the opening line, keeping the remedies text and the no-bare-`/retry` rule verbatim; update the `errors.test.ts` expectations that pin the message
- [ ] 3.2 Update the `ensureBranch` drift rule paragraph in `opencode-agent/CLAUDE.md` (content-aware condition, field constant, fail-closed defaults, issue #360 as the false-positive incident) and the operator notes in `opencode-agent/README.md`

## 4. Verification

- [ ] 4.1 `bun run test:affected` during the loop, then one full `bun run test` plus `bun check:full` before finishing; confirm no `max-lines` regression in `git-drift.ts` (split the comparison out if it trips)
