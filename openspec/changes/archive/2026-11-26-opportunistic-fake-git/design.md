# Design — opportunistic-fake-git

## Context

The seam already exists: `opencode-agent/src/git.ts` re-exports a typed `Git` interface
(`git-types.ts`) and `createGit(): Git`. `tests/opencode-agent/orchestrator.test.ts:630-660` injects a
hand-written fake implementing it; `adapters.test.ts` (~4 sites) and `diff-guard.test.ts` build real
repos via `createGit()` at some spots. The survey's Method 3 verdict: campaign-style fake-git is
dominated by `git-fixture-template` in review-loop (no seam; git is the subject there), but the
opportunistic residue in opencode-agent is real and cheap. `git.test.ts` (42.4 s in-test) is the
subject-side file and stays real.

## Goals / Non-Goals

**Goals:** one shared, compile-time-checked, scriptable, recording fake; orchestrator adopts it;
adapters/diff-guard convert ambience-only spots; subject-side spots stay real and are named.

**Non-Goals:** any review-loop change; converting `git.test.ts`; runtime code changes; mock.module.

## Decisions

### D1 — Fake lives at `tests/opencode-agent/fake-git.ts`, DI-shaped

Constructor-injection double, no module mocking: tests build `fakeGit(script)` and pass it where
production code takes a `Git`. Exported shape: a factory returning `{ git, calls, script }` —
`calls: string[]` mirrors orchestrator's existing `io.gitCalls` idiom (`method:arg` lines) so adopting
files keep their assertion style; `script` sets per-method queues of outcomes.

### D2 — Compile-time fidelity via a satisfies-style anchor

`const git: Git = { … }` as the implementation's own binding (the same anchor orchestrator uses
today). Interface drift then breaks `fake-git.ts`'s compile, satisfying the spec's build-not-run
scenario. A unit test additionally pins behavior: scripting a rejection rejects; unscripted calls
resolve a sensible default (clean success) rather than undefined.

### D3 — Conversion filter stated as a checklist, per spot

A spot converts only when: (a) the assertion is about orchestration logic (ordering, retry, ledger
effects), not git's answer; (b) the test doesn't read repository state (files, refs, worktrees) through
the filesystem afterward. `diff-guard.test.ts`'s guard logic reads diffs — spots doing so keep real
git; spots only checking call sequencing convert. The task list records each decision by file+spot.

### D4 — Why this is worth doing despite small seconds

The runtime win is single-digit seconds; the standing win is removing the N-places-to-update tax the
hand-written fake imposes every time the `Git` interface grows (three copies exist today). This is the
repo's DI-first testing rule made cheap in the one area that already paid for the seam.

## Risks / Trade-offs

- [Fake drift from real git semantics misleads a converted test] → mitigated by D3's filter (only
  ambience spots), the compile-time anchor, and `git.test.ts` remaining the semantics oracle.
- [Scripting API grows into a mini-framework] → capped by need: exactly the outcome shapes the three
  consuming files use today (resolve, reject, scripted return). Anything more exotic stays local to
  the test that needs it.

## Migration Plan

1. TDD the fake (`tests/opencode-agent/fake-git.test.ts`: fidelity anchor, scripting, defaults, log).
2. Switch `orchestrator.test.ts` to it; assertions unchanged in meaning (`gitCalls` → `calls`).
3. Convert qualifying spots in `adapters.test.ts` / `diff-guard.test.ts` per D3; record decisions.
4. Full `bun run test`; `bun check`; numbers (small as they are) recorded in `tasks.md`.

Rollback: revert to the hand-written fakes; delete the double. No production coupling.

## Open Questions

- None blocking.
