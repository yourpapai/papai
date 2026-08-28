# Tasks — opportunistic-fake-git

## 1. Shared fake (TDD)

- [x] 1.1 Write failing `tests/opencode-agent/fake-git.test.ts`: the double implements the full `Git` interface (compile-time anchor inside the module asserted via a type-level test); scripted rejections reject and scripted returns resolve; unscripted calls resolve a clean-success default; every call lands in the `calls` log as `method:arg` lines. SPDX header. Verify: `bun test tests/opencode-agent/fake-git.test.ts` red on the missing module.
- [x] 1.2 Implement `tests/opencode-agent/fake-git.ts` (`fakeGit(script)` factory returning `{ git, calls, script }`; internal `const git: Git` anchor for compile-time fidelity). Verify: the fake test green; `bun run typecheck`/`lint` clean.

## 2. Adoption + evidence

- [x] 2.1 Switch `tests/opencode-agent/orchestrator.test.ts` to the shared fake (delete the local ~40-line object; `io.gitCalls` assertions map to `calls` 1:1 — no assertion semantics change). Verify: `bun test tests/opencode-agent/orchestrator.test.ts` green, case count unchanged.
- [x] 2.2 Apply the design-D3 checklist to `adapters.test.ts` and `diff-guard.test.ts`: convert only ambience spots (assertion about orchestration, no filesystem reads of repo state); keep real-git spots. Record each spot's decision (converted / kept-real + reason) in this file. Verify: both files green, case counts unchanged.

### D3 spot decisions

- `adapters.test.ts` → `createGit` describe (11 cases): **kept**. Asserts the git argv `createGit` itself issues (`checkout -B`, exactly one `status` per commit, identity stamped on the commit argv, `push -u`, symbolic-ref→ls-remote fallback) through the `GitOptions.run` runner seam. Git argv orchestration is the subject; the `Git`-level double would replace the code under test with the code's caller.
- `adapters.test.ts` → `createGit · the reconciling push` (7 cases): **kept**. Pins the fetch/merge-base/merge/abort argv sequence of the reconciling push — the incident behaviour (run 32374999214) the describe exists for.
- `diff-guard.test.ts` → every git-touching describe (`commitAll runs the guard`, `salvageAll`, protected/stray drops, `credentialEnv` — 61 of 77 cases): **kept**. Asserts the guard's staging/unstage/restore argv ordering, numstat parsing and refusal reasons through the runner seam — `createGit`'s guard logic is the subject.
- Premise correction recorded against the proposal/design: neither file builds real repositories (no `git init`/`mkdtemp` anywhere in either; every git interaction goes through the injected `CommandRunner`). The "~4 real-git sites" were runner-seam captures, already fake one level below `Git` — and subject-side, so outside D3's ambience filter. The only `Git`-interface consumer in the area was `orchestrator.test.ts` (converted in 2.1).
- `git.test.ts` — named **unconverted by design**: it is the real-git semantics oracle for this workspace.

- [x] 2.3 Full `bun run test`; record the (small) in-test deltas for the three files in this file, naming `git.test.ts` as deliberately unconverted. `bun check` green; SPDX on new files. Verify: `rg --files-without-match "SPDX-License-Identifier" tests/opencode-agent/fake-git.ts tests/opencode-agent/fake-git.test.ts` prints nothing; `bun check` exits 0.

### In-test deltas (persisted junit, before = 2026-08-27 morning run, after = this change's full run)

| file | before | after | note |
| --- | --- | --- | --- |
| `orchestrator.test.ts` | 309 cases · 0.735 s | 309 cases · 0.948 s | case count identical; delta is parallel-run noise — the swap is behaviour-identical by construction |
| `adapters.test.ts` | 347 cases · 0.723 s | 347 cases · 0.757 s* | untouched (all spots kept, see D3 decisions); noise |
| `diff-guard.test.ts` | 77 cases · 0.753 s | 77 cases · 1.072 s | untouched; noise |
| `fake-git.test.ts` | — | 6 cases · 0.798 s | new, the double's own suite |
| `git.test.ts` | 11 cases · 14.38 s | 11 cases | **deliberately unconverted** — real-git semantics oracle |

\* adapters after-case count verified by the standalone run (347) — the parallel junit row recorded the same.

As the proposal predicted ("single-digit seconds, honest"), the runtime effect here is ~zero: the only conversion was a fake-for-fake swap; adapters/diff-guard turned out to have no real-git construction to remove (premise correction recorded above). The change's value is structural: one compile-time-checked double instead of the per-file ~55-line object.

Run hygiene: 4 failures in the full run — `tests/git-init-hint.test.ts` and `tests/plugins/context.test.ts` (pre-existing, present in the before run), `tests/sdd-runner/gate-resume-tail.test.ts` (known load flake; green standalone), and `tests/opencode-agent/git.test.ts` `mergeBase > reports a clean merge…` (load flake; green standalone at 12.4 s, untouched by this change and shares no import with it).
