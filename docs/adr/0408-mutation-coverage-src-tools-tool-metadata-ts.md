<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0408: Mutation Coverage for `src/tools/tool-metadata.ts` — Test-Only Companion Tests, Shipped

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-08-mutation-coverage-tool-metadata.md` (paired spec `docs/archive/2026-08-08-mutation-coverage-tool-metadata-design.md`) planned
a test-only mutation-coverage companion for `src/tools/tool-metadata.ts`, whose paired
mutation score was 0 — the production code was correct but had no
characterization tests. The fix adds `tests/tools/tool-metadata.test.ts` exercising the
module through its public surface, with the measured mutation score (not test
redness) as the quality gate; production code stays unmodified and the
baseline ratchets via CI.

## Decision Drivers

- **Test-only.** `src/tools/tool-metadata.ts` and every other source file stay unmodified —
  no refactoring-for-testability.
- **Conventional companion path.** The paired mutation runner auto-discovers
  `tests/tools/tool-metadata.test.ts`; no `scripts/mutation/overrides.json` edit is needed.
- **Quality gate is the measured mutation score**, not test redness —
  characterization tests pass immediately against correct code.
- **Baseline ratchets via CI** (`seedMerge`), not by hand.

## Decision

Archive the plan and spec as shipped. The companion test file landed on
master and the mutation baseline for `src/tools/tool-metadata.ts` was ratcheted to
`1` in commit `440c01e8b`
(`chore(mutation): ratchet src/tools/tool-metadata.ts baseline to 1`), proving
the work shipped. Production code is unmodified.

## Consequences

### Positive

- `src/tools/tool-metadata.ts` gains characterization coverage at paired score `1`.
- Production code unmodified; the tests double as executable documentation of
  the module's contract.

### Negative
- Characterization tests pin current behavior; a deliberate semantic change
  requires updating the tests in the same change.

## Implementation Status

Implemented. Ratchet commit `440c01e8b` bumped `src/tools/tool-metadata.ts` baseline to
`1` on master; the companion test file is present.

## References

- Plan: `docs/archive/2026-08-08-mutation-coverage-tool-metadata.md`
- Spec: `docs/archive/2026-08-08-mutation-coverage-tool-metadata-design.md`
- Source: `src/tools/tool-metadata.ts`; tests: `tests/tools/tool-metadata.test.ts`
- Ratchet: commit `440c01e8b`
