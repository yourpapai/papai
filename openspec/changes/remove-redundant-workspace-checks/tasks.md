# Tasks: remove-redundant-workspace-checks

## 1. Red-test the new composition

- [x] 1.1 In `tests/scripts/check.test.ts`, update the full-mode and `--skip-tests` assertions: every `review-loop:*` invocation expectation flips to `not.toContain`, and add a guard that no invoked command starts with any of `review-loop:`, `mutation-improve:`, `sdd-runner:`, `opencode-agent:`. Run `bun test tests/scripts/check.test.ts` and confirm the new assertions fail against current `check.sh`.
- [x] 1.2 (verification) `bun test tests/scripts/check.test.ts` — fails red exactly on the workspace-entry assertions.

## 2. Strip check.sh

- [x] 2.1 Remove `review-loop:lint`, `review-loop:typecheck`, `review-loop:format:check`, `review-loop:test` from the full-mode `checks` array (scripts/check.sh:332), leaving exactly eight root checks.
- [x] 2.2 Remove the dead special-casing: the `--skip-tests` filter case (line 337), the `review-loop:test` `elif` runner (lines 422–423), and its failure-hint `case` arm (line 461).
- [x] 2.3 Run `bash -n scripts/check.sh` and `bun test tests/scripts/check.test.ts` — suite goes green.

## 3. Strip check:verbose

- [x] 3.1 In root `package.json`, remove the eight `review-loop:*` and `mutation-improve:*` entries from `check:verbose`, leaving `lint typecheck format:check knip test duplicates`.
- [x] 3.2 Verify: `bun run --print 'Object.keys(require("./package.json").scripts["check:verbose"]).length' || python3 -c "import json; s=json.load(open('package.json'))['scripts']['check:verbose']; assert 'review-loop:' not in s and 'mutation-improve:' not in s; print(s)"` — prints the six root checks.

## 4. Full verification

- [x] 4.1 Run `bun run test:affected` for the touched files, then one full `bun run test` before finishing; `bun run typecheck`, `bun run lint`, `bun run format:check`.
- [x] 4.2 Run `./scripts/check.sh --skip-tests` end-to-end and confirm the summary lists exactly: lint, typecheck, format:check, license-headers, knip, duplicates — all passing.
