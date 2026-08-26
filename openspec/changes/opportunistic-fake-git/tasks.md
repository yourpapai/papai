# Tasks — opportunistic-fake-git

## 1. Shared fake (TDD)

- [ ] 1.1 Write failing `tests/opencode-agent/fake-git.test.ts`: the double implements the full `Git` interface (compile-time anchor inside the module asserted via a type-level test); scripted rejections reject and scripted returns resolve; unscripted calls resolve a clean-success default; every call lands in the `calls` log as `method:arg` lines. SPDX header. Verify: `bun test tests/opencode-agent/fake-git.test.ts` red on the missing module.
- [ ] 1.2 Implement `tests/opencode-agent/fake-git.ts` (`fakeGit(script)` factory returning `{ git, calls, script }`; internal `const git: Git` anchor for compile-time fidelity). Verify: the fake test green; `bun run typecheck`/`lint` clean.

## 2. Adoption + evidence

- [ ] 2.1 Switch `tests/opencode-agent/orchestrator.test.ts` to the shared fake (delete the local ~40-line object; `io.gitCalls` assertions map to `calls` 1:1 — no assertion semantics change). Verify: `bun test tests/opencode-agent/orchestrator.test.ts` green, case count unchanged.
- [ ] 2.2 Apply the design-D3 checklist to `adapters.test.ts` and `diff-guard.test.ts`: convert only ambience spots (assertion about orchestration, no filesystem reads of repo state); keep real-git spots. Record each spot's decision (converted / kept-real + reason) in this file. Verify: both files green, case counts unchanged.
- [ ] 2.3 Full `bun run test`; record the (small) in-test deltas for the three files in this file, naming `git.test.ts` as deliberately unconverted. `bun check` green; SPDX on new files. Verify: `rg --files-without-match "SPDX-License-Identifier" tests/opencode-agent/fake-git.ts tests/opencode-agent/fake-git.test.ts` prints nothing; `bun check` exits 0.
