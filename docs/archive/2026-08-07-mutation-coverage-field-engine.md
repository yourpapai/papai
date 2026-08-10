<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `plugins/task-provider-youtrack/field-engine.ts`

Implements the spec at
`docs/superpowers/specs/2026-08-07-mutation-coverage-field-engine-design.md`.

## Global constraints

- **Test-only.** Edit only `tests/plugins/task-provider-youtrack/field-engine.test.ts`
  (+ the docs + result JSON). No `src/`/`client/`/`plugins/`/`scripts/` edits.
- Do **not** touch `scripts/mutation/baseline.json`.
- Every new assertion uses exact equality (`toBe` / `toEqual`); no `startsWith` /
  `endsWith` / `toContain` where a full value is knowable.
- Keep the existing 9 tests intact; only add.
- Use DI (the `getBundleElements` ctx), no module mocking.
- `bun test tests/plugins/task-provider-youtrack/field-engine.test.ts` must be green
  before finishing.

## Tasks (one per mutant class)

- [ ] **C1** Add a table-driven `classifyFieldType` suite asserting `kind`, `label`,
      `singleType`, `multiType`, `multi`, `bundleSegment` for every `TYPE_TABLE` row
      (enum/state/version/ownedField/build/user/text/string/integer/float/date/
      date-and-time/period, single + multi variants). Covers ids 10-65.
- [ ] **C2** Add `parseFieldTypeId` edge-input tests via `classifyFieldType`: spaced id,
      internally-spaced base, trailing garbage, newline anchor, bracketless field,
      missing `fieldType.id`. Covers ids 67,69,70,71,83,90.
- [ ] **C3** Add `bundleSegment` tests for `VersionBundle` / `OwnedFieldBundle` /
      `BuildBundle`. Covers ids 94,95,96.
- [ ] **C4** Add classifyFieldType tests for missing `field`, missing `fieldType`,
      unknown base, non-bundle-with-bundle, bundle-without-bundle. Covers ids
      102,103,105,116,120.
- [ ] **C5** Add classifyFieldType unknown-branch tests (empty base + non-empty base).
      Covers ids 107-114.
- [ ] **C6** Add `formatAllowed` tests: small, exact-cap (50), overflow (51). Covers
      ids 122-125,127-130.
- [ ] **C7** Add `capAllowedValues` tests: small, exact-cap (50), overflow (51). Covers
      ids 133,134,138.
- [ ] **C8** Add `normalize` test. Covers id 144.
- [ ] **C9** Add multi-resolve tests: empty middle entry (enum), whitespace tokens
      (user). Covers ids 146,149,151,153.
- [ ] **C10** Add ambiguous-bundle (duplicate name) test. Covers ids 172,173.
- [ ] **C11** Add missing-name tests (no `field`; `field` without `name`), asserting
      `appError.field` and exact reason. Covers ids 185,187,189,190.
- [ ] **C12** Add simple-numeric tests: string field keeps string, float field → number,
      non-numeric string field does not throw. Covers ids 199,205,206,207.
- [ ] **C13** Add simple-string return test. Covers ids 216,217.
- [ ] **C14** Add `date` case test. Covers ids 218-221.
- [ ] **C15** Add `period` case test. Covers ids 222-226.
- [ ] **C16** Add `user` case test (single + multi). Covers ids 227-232.
- [ ] **C17** Add bundle-guard tests (no bundle / unknown bundle type / bundle without
      id). Covers ids 236,238,239,240,242,244,245.
- [ ] **C18** Add `unknown` case test asserting the exact interpolated error. Covers
      ids 249-253,255.
- [ ] **Verify** `bun test` green, then `bun test:mutate:file` >= 0.9 and survivors ==
      declared residuals (R1-R6: ids 78,80,99,175,181,183,254,256).
- [ ] **Residuals** Write result JSON with exact `mutantIds` per residual loc.
