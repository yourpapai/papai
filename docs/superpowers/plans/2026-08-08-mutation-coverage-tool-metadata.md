<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: Mutation Coverage for `src/tools/tool-metadata.ts`

Implements `docs/superpowers/specs/2026-08-08-mutation-coverage-tool-metadata-design.md`.
Goal: raise mutation score from **0.2944** to **≥ 0.9** via test-only changes to
`tests/tools/tool-metadata.test.ts`.

## Global constraints

- **Test-only.** No edits under `src/`, `client/`, `plugins/`, `scripts/`, and never
  `scripts/mutation/baseline.json`.
- **New files only** under `tests/` and `docs/superpowers/`, plus the single
  `.review-loop/result.json`. No copies of `result.json` elsewhere.
- **Exact equality only.** Every new assertion uses `toBe` (scalars) or `toEqual` (whole
  classification objects). No `startsWith` / `endsWith` / `toContain` where a full value is
  knowable.
- **One test per mutant class** (4 classes A–D), grounded in the measured report
  `reports/paired/src__tools__tool-metadata.ts.stryker-report.json`.
- **SPDX header** preserved on every new/changed file; emoji copied verbatim from source
  (none introduced here).
- Companion test must stay green: `bun test tests/tools/tool-metadata.test.ts`.

## Tasks (one per mutant class)

- [ ] **A — `isToolDomain` discriminator (mutant `0`).**
  Add an `isToolDomain` import and a test asserting `isToolDomain('task')` is `true` and
  `isToolDomain('nope')` is `false`.

- [ ] **B — Static `TOOL_METADATA` entry literals (122 mutants: `15–149` set).**
  Add one test that defines a complete `EXPECTED: Record<string, ToolClassification>` for
  every table entry and loops `expect(getToolMetadata(name)).toEqual(EXPECTED[name])`.
  Transcribe each entry's domain/operation/risk exactly from the source table.

- [ ] **C — `mcp_` dynamic branch exactness (mutants `168`, `169`).**
  Add a test asserting `getToolMetadata('mcp_my-server__do_thing')` deep-equals
  `{ domain: 'mcp', operation: 'read', risk: 'open-world' }`.

- [ ] **D — Unknown-name fallback to `undefined` (mutants `171`, `174`).**
  Add a test asserting `getToolMetadata('totally_unknown_tool')` is `undefined`.

## Verification tasks

- [ ] `bun test tests/tools/tool-metadata.test.ts` is green.
- [ ] `bun test:mutate:file src/tools/tool-metadata.ts` re-measured; record new score.
- [ ] Declare residuals (`[]` if none survive) with exact Stryker ids in `result.json`.
- [ ] Confirm the diff touches only `tests/tools/tool-metadata.test.ts`, the two docs, and
  `.review-loop/result.json`.
