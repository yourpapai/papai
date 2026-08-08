<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage — `src/tools/permission-gate.ts`

## Summary

Raise the Stryker mutation score of `src/tools/permission-gate.ts` from
`0.7380952380952381` (93/126 killed) to **`0.9682539682539683`** (122/126 killed),
clearing the `0.9` target, by extending the companion test file
`tests/tools/permission-gate.test.ts` only. No production code is touched. Four
surviving mutants are accepted as residuals (logging metadata/message bound to the
real logger at import time — see *Accepted residuals*).

## Why this file

`permission-gate.ts` is the ask-permission gate: it extends an ask-gated tool's
input schema with a `_permission_reason` field (Zod and JSON-Schema/MCP shapes),
extracts/strips that reason, and either denies or forwards execution. It is small
(145 lines) but high-leverage: every `ask`-gated tool call flows through
`gatedExecute`, and `isPermissionDeniedResult` is the shape the analytics layer
classifies as its own `permission_denied` outcome. Its 0.738 baseline left large
branches of the schema-coercion and input-handling code effectively untested.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Editing `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring the companion test file to a delayed-import layout (the residuals
  below are accepted instead).
- Killing the four accepted-residual mutants (they require a `src/` edit or an
  unreliable module-reload harness).

## Gap analysis

Measured before this change via `bun test:mutate:file src/tools/permission-gate.ts`:
`killed=93 survived=25 noCoverage=8` → score `0.7380952380952381`. The 33 surviving
mutants group into the following classes.

| # | Gap class | Location (line:col) | Mutant ids | Why it survived |
|---|-----------|---------------------|------------|-----------------|
| G1 | `isPermissionDeniedResult` status/message discriminating checks | 29, 31 | 23, 27 | Existing negative cases are caught by *other* clauses (`'message' in value`, missing message), so flipping `status === 'permission_denied'` or `typeof message === 'string'` to `true` never changed the result. |
| G2 | `isRecord` type guard (`typeof`/`!==null`/`!Array.isArray`) | 54 | 36, 38, 39, 40, 41, 44 | Internal helper never fed a non-record through the public API, so every boolean operand flip was equivalent. |
| G3 | `getJsonFromSchema` early-return + second `isRecord` | 58, 61 | 50, 52 | The null-`jsonSchema` paths were unreachable; the guards' short-circuits masked the mutants. |
| G4 | `extractRequired` missing/non-array `required` | 71 | 59, 61 | All JSON inputs in tests carried a valid string `required` array, so the `return []` arm and its array literal were never exercised. |
| G5 | `extractRequired` non-string filtering | 72 | 62, 65 | `required` only ever held strings, so `.filter` was a no-op and `typeof item === 'string'` was always true. |
| G6 | `mergeJsonSchemaWithPermissionReason` forced `type: 'object'` | 80 | 71 | The merged `type` literal was never asserted. |
| G7 | `extendSchemaForAsk` missing-JSON-shape fallback branch | 95–99 | 82, 84, 87, 88, 89 | NoCoverage — the `wrappedJson === null` branch (warn + fallback `z.object`) was never entered, so the whole block and the fallback field's `min`/`max` boundaries were dead to tests. |
| G8 | `PERMISSION_REASON_DESCRIPTION` literal segments | 36, 37, 38 | 30, 31, 32 | The concatenated description was never asserted, so blanking any segment was invisible. |
| G9 | `extractReason` non-string fallback (`: ''`) | 114 | 91, 95 | Tests only passed a string `_permission_reason`, so the `typeof raw === 'string'` check and the `''` fallback were never discriminated. |
| G10 | `gatedExecute` non-object input coercion | 132 | 109, 111, 112, 115 | Tests only passed object input, so the `typeof input === 'object' && input !== null` guard and its operands were never exercised. |
| R | **Residual — logger scope/metadata/message** | 12, 96 | 0, 1, 85, 86 | `log = logger.child(...)` binds to the **real** pino child at module-import time; the companion test imports the module eagerly, before any `mockLogger()` runs, so `logger.child` and `log.warn` are not interceptable by the bun:test logger mock. See *Accepted residuals*. |

## Design — tests to add

All new assertions use exact equality (`toBe` on a primitive, or `JSON.stringify(...)`
+ `toBe` for arrays/objects). Each class maps to one or more added tests in
`tests/tools/permission-gate.test.ts`.

| Class | Added test(s) | Exact assertion |
|-------|---------------|-----------------|
| G1 | `isPermissionDeniedResult` rejects `{status:'other_status',message:'hi'}`; rejects `{status:'permission_denied',message:7}` | `toBe(false)` |
| G2 | `extendSchemaForAsk(null)` and `extendSchemaForAsk('not-a-schema')` return a usable fallback | `safeParse({_permission_reason:'rr'}).success` `toBe(true)` |
| G3 | `extendSchemaForAsk(null)` (kills 50 via throw) and `extendSchemaForAsk({jsonSchema:'nope'})` (kills 52) return the fallback | `safeParse(...).success` `toBe(true)` |
| G4 | `extendSchemaForAsk(jsonSchema({type:'object'}))` (no `required`) | `JSON.stringify(extended.jsonSchema.required)` `toBe(JSON.stringify([PERMISSION_REASON_FIELD]))` |
| G5 | `extendSchemaForAsk(jsonSchema({type:'object',required:['id',9,true]}))` | `JSON.stringify(...required)` `toBe(JSON.stringify(['id',PERMISSION_REASON_FIELD]))` |
| G6 | merged schema type | `extended.jsonSchema.type` `toBe('object')` |
| G7 | `extendSchemaForAsk(null)` exercises the fallback; `'rr'` (len 2) is inside `1..280` but outside mutated `min(280)` / `max(1)` | `safeParse({_permission_reason:'rr'}).success` `toBe(true)`; empty parse `toBe(false)` |
| G8 | `_permission_reason` description carried verbatim into the merged JSON schema | `reasonProp.description` `toBe(<full concatenated string>)` |
| G9 | `gatedExecute` with input missing `_permission_reason` | captured `reason` `toBe('')` |
| G10 | `gatedExecute('not-an-object')` and `gatedExecute(null)` | `JSON.stringify(capturedArgs)` `toBe('{}')` |

## Verification

1. `bun test tests/tools/permission-gate.test.ts` → **27 pass, 0 fail**.
2. `bun test:mutate:file src/tools/permission-gate.ts` →
   `killed=122 survived=4 noCoverage=0 score=0.9682539682539683`.
3. The four survivors are exactly `["0","1","85","86"]` — the accepted residuals below.

## Accepted residuals

Four mutants survive and genuinely cannot be killed by a test-only change to the
companion file. `const log = logger.child({ scope: 'tools:permission-gate' })`
runs once at module-evaluation time and binds `log` to the **real** pino child
logger. The companion test imports `permission-gate.js` eagerly at the top of the
file, which resolves before any per-test `mockLogger()` installs the bun:test
logger mock. Consequently `logger.child` (line 12) and `log.warn` (line 96) are
real pino calls writing to stdout and are not observable via the mock. Killing any
of them would require restructuring the entire companion suite to a
mock-before-delayed-import + forced module re-evaluation harness, which is
unreliable under Bun's ES module cache and out of scope for a test-only edit.

| loc | mutantIds | why equivalent/untestable |
|-----|-----------|---------------------------|
| `src/tools/permission-gate.ts:12` (`logger.child({ scope: 'tools:permission-gate' })`) | `["0","1"]` | Logger scope binding metadata set at import time on the real pino logger; not reachable by the test's logger mock (which is installed after the eager import). Pure logging metadata, no behavioral contract. |
| `src/tools/permission-gate.ts:96` (`log.warn({ schemaType: typeof schema }, 'Cannot extend schema for ask; missing JSON shape')`) | `["85","86"]` | Runtime log call on the import-time-bound real pino child logger; the warn metadata object and message string are logging output only and are not interceptable via the mock. |

The runner's measured surviving-id set after the new tests is `{"0","1","85","86"}`,
which is exactly the union of the residual `mutantIds` declared in `result.json`.
