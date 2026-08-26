# Tasks — exclude-research-poc-tests

## 1. Exclusion + script

- [ ] 1.1 Add `"docs/**"` to `bunfig.toml` `pathIgnorePatterns` with a comment naming the lane (research PoC self-checks; runnable via `bun run test:research`), and add the `test:research` script to `package.json` running the poc tree via explicit path. Sequencing: land on master between story-refactor qualifications — if a qualification branch is active, wait. Verify: `bun run test:research` exits 0 and runs all 16 poc files (53 cases).
- [ ] 1.2 Verify the default lane delta from the persisted report after a full `bun run test`: exactly 16 fewer files, 53 fewer cases, in-test total down ~37.9 s vs the recorded baseline; `tests/analytics/intent/taxonomy.test.ts` still present and green in the run (import unaffected). Record the three before/after numbers in this file.
- [ ] 1.3 Verify no coverage-floor movement: run the coverage lane (`bun test:coverage` + `bun coverage:ratchet`) and confirm measured-vs-floor unchanged within noise (the excluded files imported no production code). Record measured/floor numbers in this file.
- [ ] 1.4 `bun check` green; SPDX untouched files only (no new files expected). Verify: `bun check` exits 0; `git status` shows only `bunfig.toml` + `package.json` modified.
