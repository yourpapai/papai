<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `plugins/task-provider-youtrack/field-engine.ts`

## Summary

Raise the Stryker mutation score of `plugins/task-provider-youtrack/field-engine.ts`
from **0.4747** (122 killed / 257 total; 90 Survived + 45 NoCoverage) to **>= 0.9**
by extending its companion test file `tests/plugins/task-provider-youtrack/field-engine.test.ts`.
This is a **test-only** change: no production file is touched. Every surviving mutant
class is covered by exactly one focused test that asserts exact values (`toBe`).

## Why this file

`field-engine.ts` is the YouTrack custom-field resolver: it classifies a
`ProjectCustomField` by its `fieldType.id`, looks up a `$type` + label from a static
`TYPE_TABLE`, and resolves a raw user string into the wire payload (bundle match, user
login list, date/period/text/simple). It is pure logic with no I/O of its own, so it is
an ideal, high-ROI mutation target. Its current suite (9 tests) only exercises the
state/enum bundle path, the integer numeric guard, and the text shortcut — leaving the
majority of the `TYPE_TABLE`, the `parseFieldTypeId` regex, the cap helpers, the
multi-value splitter, and every `switch` branch of `resolveCustomFieldValue` uncovered.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Editing `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring `field-engine.ts` to remove dead code; equivalent/unreachable mutants are
  declared as accepted residuals instead.
- Changing the public exports (`classifyFieldType`, `formatAllowed`,
  `capAllowedValues`, `normalize`, `resolveCustomFieldValue`).

## Gap analysis

Measured survivors come from `reports/paired/plugins__task-provider-youtrack__field-engine.ts.stryker-report.json`.
Each row is one mutant class (a coherent locus of survivors). The "mutant ids" column
lists the exact Stryker `id` values in that class.

| # | Class | Locus | Mutant ids | Status |
|---|-------|-------|------------|--------|
| C1 | `TYPE_TABLE` literals + entry objects not asserted | L42-63 | 10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,28,29,30,33,34,35,36,37,38,39,40,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65 | Survived |
| C2 | `parseFieldTypeId` whole-id trim, base trim, regex anchors, multi default | L66-75 | 67,69,70,71,83,90 | Survived/NoCov |
| C3 | `BUNDLE_SEGMENTS` value strings | L77-82 | 94,95,96 | Survived |
| C4 | `classifyFieldType` optional-chaining + unknown branching + bundle-kind guard | L88-101 | 102,103,105,116,120 | Survived |
| C5 | `classifyFieldType` unknown-branch return object + literals | L91-93 | 107,108,109,110,111,112,113,114 | NoCov |
| C6 | `formatAllowed` cap boundary + overflow template | L104-107 | 122,123,124,125,127,128,129,130 | Survived/NoCov |
| C7 | `capAllowedValues` cap boundary + slice | L109-112 | 133,134,138 | Survived |
| C8 | `normalize` trim | L117 | 144 | Survived |
| C9 | `splitMulti` filter + per-token trim | L119-125 | 146,149,151,153 | Survived |
| C10 | `matchBundleValue` single-match guard | L133 | 172,173 | Survived |
| C11 | `resolveCustomFieldValue` name guard + missing-name error | L151-152 | 185,187,189,190 | Survived/NoCov |
| C12 | `resolveCustomFieldValue` simple numeric guard (incl. float) | L158 | 199,205,206,207 | Survived/NoCov |
| C13 | `resolveCustomFieldValue` simple (string) return object | L165 | 216,217 | NoCov |
| C14 | `resolveCustomFieldValue` `date` case | L167-168 | 218,219,220,221 | Survived/NoCov |
| C15 | `resolveCustomFieldValue` `period` case | L169-170 | 222,223,224,225,226 | Survived/NoCov |
| C16 | `resolveCustomFieldValue` `user` case | L171-174 | 227,228,229,230,231,232 | Survived/NoCov |
| C17 | `resolveCustomFieldValue` bundle guard + no-resolvable error | L177-180 | 236,238,239,240,242,244,245 | Survived/NoCov |
| C18 | `resolveCustomFieldValue` `unknown` case + error template | L185-189 | 249,250,251,252,253,255 | NoCov |
| R1 | `bundleSegmentFromType` `bundleType === undefined` guard | L86 | 99 | Survived (equivalent) |
| R2 | `matchBundleValue` `matched !== undefined` (redundant given length===1) | L133 | 175 | Survived (equivalent) |
| R3 | `parseFieldTypeId` `match[1] ?? ''` / `match[2] ?? ''` fallbacks | L70-71 | 78,80 | NoCov (unreachable) |
| R4 | `issueType` `resolved === undefined` throw + its message | L142 | 181,183 | Survived/NoCov (unreachable) |
| R5 | unknown error `field.field?.fieldType` 2nd-level optional chaining | L188 | 254 | NoCov (unreachable) |
| R6 | final `throw new Error('Unreachable…')` message | L191 | 256 | NoCov (unreachable) |

## Design — tests to add

One focused test per gap class (C1-C18); residuals R1-R6 are accepted (see below).
All assertions use exact equality (`toBe` / `toEqual`) on fully-knowable values.

- **C1 → `classifyFieldType` table-driven rows.** A data-driven test asserts `kind`,
  `label`, `singleType`, `multiType`, `multi`, and `bundleSegment` for every `TYPE_TABLE`
  key: `enum[1]`, `state[*]`, `version[1]`, `version[*]`, `ownedField[1]`,
  `ownedField[*]`, `build[1]`, `build[*]`, `user[1]`, `user[*]`, `text`, `string`,
  `integer`, `float`, `date`, `date and time`, `period`. Bundle rows carry a matching
  `bundle.$type` so `bundleSegment` is exercised.
- **C2 → parseFieldTypeId edge inputs.** Spaced id (`' state[1] '`), internally-spaced
  base (`'State  [1]'`), trailing garbage (`'state[1]x'`), newline-anchored
  (`'a\n[1]'`), bracketless field (`'text'`), and `fieldType.id === undefined`.
- **C3 → bundleSegment mapping.** `classifyFieldType` on `version`/`ownedField`/`build`
  fields whose `bundle.$type` is `VersionBundle` / `OwnedFieldBundle` / `BuildBundle`.
- **C4 → classifyFieldType optionals.** A field with no `field` (kills `?.fieldType`),
  a field whose `fieldType` is missing (kills `?.id`), an unknown base (kills the
  `entry === undefined` branch), and a non-bundle kind that still carries a `bundle`
  (kills the `entry.kind === 'bundle'` guard), plus a bundle field without a `bundle`
  (kills `field.bundle?.$type`).
- **C5 → unknown-branch literals.** Two classifyFieldType calls: empty base
  (`fieldType.id` absent) asserting `label`/`kind` `'unknown'`; non-empty unknown base
  (`'gizmo[1]'`) asserting `label` equals the base.
- **C6 → formatAllowed boundaries.** `<=` (1 value), exact-cap (50 values), and
  overflow (51 values) asserting the full `…and N more` string.
- **C7 → capAllowedValues boundaries.** Small, exact-cap (50), and overflow (51)
  asserting element count and the trailing summary element.
- **C8 → normalize.** `normalize('  Hello  ')` is `'hello'`.
- **C9 → splitMulti via multi resolve.** Empty middle entry (`'Open,,Fixed'`) on a
  multi-enum, and whitespace around tokens (`' alice , bob '`) on a multi-user field.
- **C10 → matchBundleValue ambiguity.** A bundle with two equally-named elements;
  resolving must throw the teaching error.
- **C11 → missing-name guard.** A field with no `field` (throws), and a field whose
  `field` lacks `name`; asserts `appError.field === 'customFields'` and the exact
  reason.
- **C12 → numeric guard.** String-typed simple field given a numeric string keeps it a
  string (`'5'`); float field `'1.5'` becomes `1.5`; non-numeric string on a string
  field does **not** throw.
- **C13 → simple string return.** String field resolves to
  `{ $type: 'SimpleIssueCustomField', value: rawValue }`.
- **C14 → date case.** Date field resolves with `$type` `'DateIssueCustomField'` and the
  parsed timestamp.
- **C15 → period case.** Period field resolves with `$type` `'PeriodIssueCustomField'`
  and `{ presentation: rawValue }`.
- **C16 → user case.** Single + multi user fields resolve to `{ login }` payloads with
  the right `$type`.
- **C17 → bundle guard.** A bundle field with no `bundle`, with an unknown bundle
  `$type` (segment undefined), and with a `bundle` lacking `id`; each throws the exact
  "no resolvable value set" message.
- **C18 → unknown case.** An unknown-typed field throws the exact teaching error whose
  template interpolates the `fieldType.id` (or `'unknown'` when absent).

## Verification

1. `bun test tests/plugins/task-provider-youtrack/field-engine.test.ts` is green.
2. `bun test:mutate:file plugins/task-provider-youtrack/field-engine.ts` reports a score
   >= 0.9; the only remaining survivors are exactly the declared residuals (R1-R6).

## Accepted residuals

Equivalent or unreachable mutants that survive every possible test and therefore cannot
be killed without editing `src/`/`plugins/`. The runner re-measures; the declared
`mutantIds` must equal the post-test survivor set. Per-loc reasoning is recorded in the
result JSON.

- **R1 (id 99)** — `bundleType === undefined ? undefined : BUNDLE_SEGMENTS[bundleType]`.
  Mutating the guard to `false` always evaluates `BUNDLE_SEGMENTS[bundleType]`; for
  `bundleType === undefined` that lookup is `undefined` too, so both branches are
  observationally identical for every input.
- **R2 (id 175)** — `matched !== undefined` is redundant because `matched = matches[0]`
  and the guard already requires `matches.length === 1`; a filter-produced dense array
  always has a defined element at index 0 when its length is 1.
- **R3 (ids 78, 80)** — `match[1] ?? ''` / `match[2] ?? ''` nullish fallbacks inside the
  matched branch: both capture groups are mandatory in `/^(.*)\[(1|\*)\]$/u`, so on a
  successful match they are always defined strings; the `?? ''` arms are unreachable.
- **R4 (ids 181, 183)** — `issueType`'s `if (resolved === undefined) throw` is dead:
  `issueType` is only reached from the `user`/`bundle` cases, whose `singleType`/
  `multiType` are always populated by `TYPE_TABLE`; `resolved` is never `undefined`, so
  the condition and its message cannot be exercised.
- **R5 (id 254)** — the second `field.field?.fieldType` optional chain in the unknown
  error template: by the time the `unknown` case runs, the missing-name guard has
  already guaranteed `field.field` is defined, so `field.field.fieldType` never throws.
- **R6 (id 256)** — the terminal `throw new Error('Unreachable: unhandled field kind')`
  sits after a switch that exhausts all seven `FieldClassification['kind']` values; no
  value reaches it.
