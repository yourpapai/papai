<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — mutation coverage for `src/tools/permission-gate.ts`

Target: `0.7380952380952381` → `>= 0.9`. Test-only; companion file
`tests/tools/permission-gate.test.ts`. Spec:
`docs/superpowers/specs/2026-08-07-mutation-coverage-permission-gate-design.md`.

## Global constraints

- Touch ONLY `tests/tools/permission-gate.test.ts` (plus the spec/plan/result docs).
  Never edit `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Every new assertion is exact equality: `toBe(...)` on a primitive, or
  `JSON.stringify(...) + toBe(...)` for arrays/objects. No `startsWith` /
  `endsWith` / `toContain` / `toMatchObject` / `arrayContaining` on new
  assertions.
- One test per mutant class (a test may incidentally kill mutants from other
  classes; that is fine and noted).
- Re-measure with `bun test:mutate:file` and declare residuals as the *exact*
  measured survivor set.

## Tasks (one checkbox per mutant class)

- [x] **G1 — `isPermissionDeniedResult` guards (ids 23, 27).** Add two `toBe(false)`
      cases: `{status:'other_status', message:'hi'}` (discriminates the status
      clause) and `{status:'permission_denied', message:7}` (discriminates the
      `typeof message === 'string'` clause).
- [x] **G2 — `isRecord` type guard (ids 36, 38, 39, 40, 41, 44).** Drive
      `extendSchemaForAsk` with `null` (kills 36/38/39/40/44 via the throw when the
      mutated guard dereferences a non-record) and `'not-a-schema'` (kills 41, which
      only flips for a non-null non-object). Assert the fallback `safeParse`
      succeeds for `_permission_reason:'rr'`.
- [x] **G3 — `getJsonFromSchema` returns (ids 50, 52).** `extendSchemaForAsk(null)`
      kills 50 (early-return removed → `null['jsonSchema']` throws);
      `extendSchemaForAsk({ jsonSchema: 'nope' })` kills 52 (second `isRecord` →
      `true` returns the non-record raw, yielding a non-Zod wrapper with no
      `safeParse`). Assert fallback `safeParse` success.
- [x] **G4 — `extractRequired` missing/non-array (ids 59, 61).**
      `extendSchemaForAsk(jsonSchema({ type:'object' }))` (no `required`): assert
      `JSON.stringify(required) === '["_permission_reason"]'`. Kills 59 (throw on
      `undefined.filter`) and 61 (`return ["Stryker was here"]`).
- [x] **G5 — non-string `required` filtering (ids 62, 65).**
      `extendSchemaForAsk(jsonSchema({ type:'object', required:['id',9,true] }))`:
      assert `JSON.stringify(required) === '["id","_permission_reason"]'`. Kills 62
      (filter removed) and 65 (`typeof item === 'string'` → `true`).
- [x] **G6 — forced `type:'object'` (id 71).** Assert `extended.jsonSchema.type`
      `toBe('object')`.
- [x] **G7 — missing-JSON-shape fallback branch (ids 82, 84, 87, 88, 89).**
      `extendSchemaForAsk(null)` enters the branch; assert
      `safeParse({_permission_reason:'rr'}).success` `toBe(true)` (`'rr'` length 2
      passes real `min(1).max(280)` but fails mutated `min(280)` (88) and
      `max(1)` (89)) plus empty parse `toBe(false)`. 82/84/87 killed because
      removing the branch / fallback object makes the call throw or return a
      non-schema.
- [x] **G8 — `PERMISSION_REASON_DESCRIPTION` segments (ids 30, 31, 32).** Assert
      the merged `_permission_reason` property `description` equals the full
      concatenated string verbatim.
- [x] **G9 — `extractReason` non-string fallback (ids 91, 95).** `gatedExecute`
      with input missing `_permission_reason`; assert the captured `reason`
      `toBe('')`.
- [x] **G10 — `gatedExecute` non-object input (ids 109, 111, 112, 115).**
      `gatedExecute('not-an-object')` (kills 109/111/112 — string chars would leak
      into `args`) and `gatedExecute(null)` (kills 115 — `Object.entries(null)`
      throws). Assert `JSON.stringify(capturedArgs) === '{}'`.
- [x] **Residuals — logger scope/metadata/message (ids 0, 1, 85, 86).** Declare as
      accepted residuals; `log` binds to the real pino child at import time, before
      the test's logger mock is installed, so `logger.child` (12) and `log.warn`
      (96) are not interceptable.

## Verification

- [x] `bun test tests/tools/permission-gate.test.ts` → 27 pass / 0 fail.
- [x] `bun test:mutate:file src/tools/permission-gate.ts` → killed=122 survived=4
      score=`0.9682539682539683` (≥ 0.9 → improved).
- [x] Survivors measured as `["0","1","85","86"]` == declared residual union.
