<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Per-dimension proving tiers

## 1. Contract test first (red)

- [x] 1.1 In `tests/stories/harness/behavior-coverage.test.ts`, assert a
      dimension whose cited scenario runs at a different catalog tier is
      rejected, naming the dimension, the declared tier, and the actual tier.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts` — fails.
- [x] 1.2 Assert a behavior proving one dimension at T2 and another at T0 is
      accepted, and that each dimension validates against its own tier.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts` — fails.
- [x] 1.3 Assert the two runtime rejection cases the spec adds: a proven
      dimension with no scenario, and a `partial` record whose open set is
      empty. The spec's other three cases are structural — the dimension-keyed
      model cannot express them — so they carry no test.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts` — fails.
- [x] 1.4 Assert `unqualifiedBehaviors()` still returns a `partial` record that
      declares a planned tier for every open dimension.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts` — fails.

## 2. Record type and validators

- [x] 2.1 Add `DimensionProof` (`provingTier` + non-empty `scenarioIds`) and
      rewrite the `BehaviorCoverage` union per design D1: `proven` and `missing`
      as dimension-keyed maps, `required` / `provingTier` / `scenarioIds`
      removed. Verify: `bun run typecheck`.
- [x] 2.2 Derive `required` as `keys(proven) ∪ keys(missing)` and port
      `coverageGaps()` to check `primary` membership and the blank-rationale
      case against the derived set. Verify: `bun run typecheck`.
- [x] 2.3 Port `scenarioReferenceGaps()` to validate each `proven` entry against
      that entry's own declared tier, keeping the executable-scenario check.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts` — 1.1–1.4 pass.

## 3. Port the thirteen records

- [x] 3.1 Port the eleven single-tier records mechanically: each previously
      required dimension gets its declared tier, and each cited scenario is
      attributed to the dimension it proves. Meaning is unchanged.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts`.
- [x] 3.2 Re-declare `live-status` per design D3: `primary` and
      `external-boundary` proven at T2 by `SCN-chat-turn-tool-loop`,
      `failure-recovery` open with planned tier T0.
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts`.
- [x] 3.3 Re-declare `reply-to-bot-routing` per design D3: `proven` empty,
      `primary` open at planned T0, `authorization-routing` open at planned T3.
      Move the `SCN-chat-message-normalization` substrate relationship into the
      rationale prose (design D2).
      Verify: `bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts tests/stories/harness/behavior-coverage.test.ts`.
- [x] 3.4 Apply the same D2 treatment to `chat-participant-resolution`: `proven`
      empty, both dimensions open at planned T0, and the
      `SCN-context-group-identity` roster relationship stated in rationale.
      Verify: `bun run test:stories:contracts`.
- [x] 3.5 Confirm the ledger still reports the same eight behaviors as
      unqualified — this change closes no dimension.
      Verify: `bun run test:stories:contracts` and `bun run test:stories:manifest`.

## 4. Re-record the qualification baseline

- [x] 4.1 Land tasks 1–3 on master, then record the new baseline SHA and its
      manifest tree hash, retiring `2e1630c06`.
      Verify: `BASE_REF=<new-sha> bun run test:stories:compat --manifest-only`.
- [x] 4.2 Prove the recorded baseline executes.
      Verify: `BASE_REF=<new-sha> bun run test:stories:compat`.
- [x] 4.3 Update the Foundation baseline section of
      `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
      with the new SHA, tree hash, frozen-input count, and manifest scenario
      count. Verify: `bun run format:check`.

## 5. Full verification

- [x] 5.1 Run `bun run test`, `bun run typecheck`, and `bun run lint`; read
      failures from `reports/test/` rather than re-running the suite.
- [x] 5.2 Confirm no `docs/architecture/*.md` page needs an edit — this change
      alters no documented behavior and moves no `<!-- behavior: -->` anchor —
      or update the affected page. Verify: `bun run test:stories:contracts`.
