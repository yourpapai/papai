# opportunistic-fake-git

## Why

The 2026-08-26 speedup survey (Method 3) found the fake-at-the-seam idea already half-true: `opencode-agent/src/git.ts` exposes a typed `Git` interface, and `tests/opencode-agent/orchestrator.test.ts:630` already injects a full hand-written fake — but each file rebuilds its own ~40-line fake object, and two lighter files (`adapters.test.ts`, `diff-guard.test.ts`) still construct real `createGit()` repos for logic that does not need real git. Meanwhile the survey **demoted the campaign version** of this idea: in `review-loop`, git is the *subject* (conflict lists, rebase-abort cleanliness), it has no seam, and `git-fixture-template` (separate change) takes ~half the same subprocess cost while keeping git real everywhere. What survives is the opportunistic residue: a shared fake + converting the files where git is ambience, worth a few seconds and — more importantly — removing the per-file fake-building tax that currently *discourages* the DI-first pattern the repo asks for.

## What Changes

- A shared test double `tests/opencode-agent/fake-git.ts`: the recording fake `Git` implementation `orchestrator.test.ts` hand-writes today (scriptable per-call outcomes, call log), unit-tested for fidelity to the `Git` interface.
- `orchestrator.test.ts` adopts the shared fake (its local ~40-line object is deleted, call-log assertions preserved).
- `adapters.test.ts` and `diff-guard.test.ts` convert their real-git spots **only where git is ambience** (asserting orchestration behavior, not git behavior); spots asserting real git semantics keep `createGit()`.
- No `review-loop/` changes of any kind — recorded here as the explicit declination of the campaign version, with the survey as evidence.

## Capabilities

### New Capabilities

- `fake-git-test-double`: governs the shared `Git` test double — interface fidelity (every `Git` member implemented, types checked at compile time), scriptable outcomes (per-call success/failure/return values), call recording (assertable log of every invocation), and the conversion rule (fake where git is ambience; real git where git is the subject).

### Modified Capabilities

- None.

## Impact

- Code: new `tests/opencode-agent/fake-git.ts` + its test; edits to three test files. No `src/`, no `opencode-agent/src/` changes (the `Git` interface is untouched; the fake implements it from the outside).
- Expected runtime effect is small and honest: the two converting files shed their real-repo construction (single-digit seconds in-test); `git.test.ts` (42.4 s — git is the subject there) is explicitly not converted.
- The bigger value is structural: one audited fake instead of N hand-written ones, and the DI-first pattern gets cheaper to follow in the area that already has the seam.
- `tests/opencode-agent/` is not byte-frozen; no sequencing constraints.

## Non-goals

- No new seam in `review-loop/` — declined with evidence (survey Method 3: no seam exists, git is the subject in its heaviest files, `git-fixture-template` dominates for cost).
- No conversion of `git.test.ts` or any test asserting git's own semantics (merge outcomes, conflict files, rebase cleanliness).
- No runtime/production code changes; no mock.module() (the seam is constructor injection, which already exists).
- Not a vehicle for the git-fixture template or any other speedup method.
