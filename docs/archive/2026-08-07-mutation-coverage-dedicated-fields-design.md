<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `plugins/task-provider-youtrack/dedicated-fields.ts`

## Summary

Raise the Stryker mutation score of `plugins/task-provider-youtrack/dedicated-fields.ts`
from **0.6699** (69 killed / 103 total; 27 Survived + 7 NoCoverage) to **>= 0.9** by
extending its companion test file `tests/plugins/task-provider-youtrack/dedicated-fields.test.ts`.
This is a **test-only** change: no production file is touched. Every killable surviving
mutant class is covered by exactly one focused test that asserts exact values (`toBe` /
`toEqual`); the remaining equivalent / unreachable mutants are declared as accepted
residuals.

## Why this file

`dedicated-fields.ts` resolves a dedicated param (`state` / `user` / `priority` /
`date`) to the project's real `ProjectCustomField`: it filters fields by type, takes the
sole candidate as a shortcut (except `priority`, which is always ambiguous because enum
fields are non-unique), and otherwise disambiguates by a canonical English/Russian name
before raising a teaching error. It is pure logic with no I/O, so it is an ideal
mutation target. Its current suite (7 tests) only exercises the state/user sole-field
shortcuts and the English `priority` / `assignee` canonical names — leaving the entire
`date` kind, every Russian canonical name, the localized-name branch, the candidate-filter
guards, the sole/ambiguous return guards, and the exact teaching-error text uncovered.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Editing `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring `dedicated-fields.ts` to remove dead code; equivalent / unreachable mutants
  are declared as accepted residuals instead.
- Changing the public export (`resolveDedicatedField`) or the `DedicatedKind` type.

## Gap analysis

Measured survivors come from
`reports/paired/plugins__task-provider-youtrack__dedicated-fields.ts.stryker-report.json`.
Each row is one mutant class (a coherent locus of survivors). The "mutant ids" column
lists the exact Stryker `id` values in that class.

| # | Class | Locus | Mutant ids | Status |
|---|-------|-------|------------|--------|
| C1 | `CANONICAL_NAMES.state` array + literal strings | L18 | 1,2,3 | Survived |
| C2 | `CANONICAL_NAMES.user` Russian literal | L19 | 6 | Survived |
| C3 | `CANONICAL_NAMES.priority` Russian literal | L20 | 9 | Survived |
| C4 | `matchesType` priority `c.label === 'enum'` (forced true) | L27 | 26 | Survived |
| C5 | `matchesType` user `kind === 'user'` (forced true) | L28 | 30 | Survived |
| C6 | `matchesType` date branch (whole expression) | L29 | 38,39,40,41 | NoCoverage |
| C7 | `matchesCanonicalName` localized-name branch (`??`, right operand) | L34,L37 | 44,53,60 | Survived/NoCov |
| C8 | `dedicatedError` join separator `'; '` | L44 | 66 | Survived |
| C9 | `dedicatedError` empty-candidates guard + `appError.field` | L46,L49 | 68,72 | Survived |
| C10 | candidate-filter: drop `?.` on `f.field` (fieldless entry) | L61 | 81 | Survived |
| C11 | sole-candidate shortcut condition + `'priority'` literal | L62 | 85,87 | Survived |
| C12 | ambiguous named-match return: `&&`→`\|\|` + `named.length === 1` guard | L68 | 98,99 | Survived |
| C13 | `CANONICAL_NAMES.date` array + literal strings | L21 | 10,11,12 | Survived |
| R1 | `matchesCanonicalName` `field.field?.name` optional chaining | L33 | 43 | Survived (equivalent) |
| R2 | `matchesCanonicalName` `field.field?.localizedName` optional chaining | L34 | 45 | Survived (equivalent) |
| R3 | `matchesCanonicalName` `name !== undefined` (always true for candidates) | L36 | 51 | Survived (equivalent) |
| R4 | `matchesCanonicalName` `localized !== null` (dead: `?? undefined` forbids null) | L37 | 59 | NoCoverage (equivalent) |
| R5 | `fieldName` `field.field?.name` optional chaining | L41 | 63 | Survived (equivalent) |
| R6 | `fieldName` `?? '(unnamed)'` fallback (dead for candidates) | L41 | 64 | NoCoverage (unreachable) |
| R7 | sole-candidate `only !== undefined` (redundant given `length === 1`) | L64 | 91 | Survived (equivalent) |
| R8 | ambiguous return `pick !== undefined` (redundant given `length === 1`) | L68 | 101 | Survived (equivalent) |
| R9 | candidate-filter name guard `f.field?.name !== undefined` (redundant under valid data) | L61 | 79 | Survived (equivalent) |

## Design — tests to add

One focused test per killable gap class (C1-C13); residuals R1-R9 are accepted (see
below). All assertions use exact equality (`toBe` / `toEqual`) on fully-knowable values.

- **C1 → state canonical disambiguation.** Two state-typed fields where one is named
  `State` (English) and a second scenario where one is named `Статус` (Russian); each
  resolves the canonically-named field. Kills the `state` array, the `state` literal, and
  the `статус` literal.
- **C2 → user Russian canonical.** Two user-typed fields where one is named
  `Ответственный`; it resolves. Kills the `ответственный` literal.
- **C3 → priority Russian canonical.** Two enum fields where one is named `Приоритет`; it
  resolves. Kills the `приоритет` literal.
- **C4 → priority type-match forced true.** `resolveDedicatedField('priority', …)` with
  only non-enum fields asserts the exact "No priority-type field exists…" message; under
  the mutant those fields wrongly become candidates and the message flips. Also covers C9.
- **C5+C6 → date kind.** A sole date field (alongside a non-date field) resolves via the
  sole-candidate shortcut, exercising `matchesType` for both `date` (killing the whole
  date expression) and the `user` short-circuit (the mutant diverts `date` into the
  `c.kind === 'user'` return and the field stops matching).
- **C7 → localized-name disambiguation.** A user field whose `name` is non-canonical but
  whose `localizedName` is `Assignee` resolves; kills the `??` → `&&`, the localized
  right-operand forced false, and the `localized !== null` → `=== null` mutants.
- **C8 → multiple-candidate join separator.** Two user fields with no canonical name
  throw, and the exact message — including the `Name; Name` join — is asserted.
- **C9 → empty-candidates branch + appError tag.** The C4 priority-no-enum case also
  asserts `err.appError` equals `providerError.validationFailed('customFields', …)`,
  pinning the `candidates.length === 0` ternary and the `'customFields'` field literal.
- **C10 → candidate-filter optional chaining.** A `state` resolve over `[fieldless,
  named state]` resolves the named field: a field with no `field` object kills the
  `f.field?.name` optional-chaining mutant (it would throw on `undefined.name`). (The
  sibling "drop the name guard" mutant id 79 is equivalent under schema-valid data — see
  R9 — because a typed `ProjectCustomField` always carries a `name`, so the guard never
  excludes a type-matching field; it cannot be killed without zod-invalid input.)
- **C11 → sole-candidate shortcut.** A single non-canonical enum field passed as
  `priority` is *not* auto-resolved; it throws the exact "Multiple candidate fields…"
  message. The mutant that forces the shortcut condition true (or blanks the `'priority'`
  literal) would return the field instead.
- **C12 → ambiguous named match is not silently resolved.** Two user fields both named
  `Assignee` throw; the `&&`→`||` and `named.length === 1`-forced-true mutants would
  return the first match.
- **C13 → date canonical disambiguation.** Two date fields where one is named `Due Date`
  and a second scenario where one is named `Дедлайн`; each resolves. Kills the `date`
  array and both literals.

## Verification

1. `bun test tests/plugins/task-provider-youtrack/dedicated-fields.test.ts` is green.
2. `bun test:mutate:file plugins/task-provider-youtrack/dedicated-fields.ts` reports a
   score >= 0.9; the only remaining survivors are exactly the declared residuals (R1-R9).

## Accepted residuals

Equivalent or unreachable mutants that survive every possible test and therefore cannot
be killed without editing `src/`/`plugins/`. The runner re-measures; the declared
`mutantIds` must equal the post-test survivor set. Per-loc reasoning is recorded in the
result JSON.

- **R1 (id 43)** — `matchesCanonicalName` is only ever called on candidates, and the
  candidate filter guarantees `f.field?.name !== undefined`, so `field.field` is always
  defined; `field.field?.name` and `field.field.name` are observationally identical.
- **R2 (id 45)** — same reasoning on `field.field?.localizedName`; `field.field` is always
  present for candidates.
- **R3 (id 51)** — `name !== undefined` is always true for candidates (the filter already
  required it), so forcing it `true` changes nothing.
- **R4 (id 59)** — `localized` can never be `null`: L34 `field.field?.localizedName ??
  undefined` maps `null` to `undefined`, so `localized !== null` is perpetually `true` and
  forcing it `true` is a no-op.
- **R5 (id 63)** — `fieldName` is only called via `candidates.map(fieldName)`; candidates
  always have `field.field` defined, so `field.field?.name` vs `field.field.name` coincide.
- **R6 (id 64)** — the `?? '(unnamed)'` fallback is dead: `fieldName` only runs on
  candidates whose name is a defined string, so the nullish arm never fires.
- **R7 (id 91)** — `only !== undefined` is redundant: it sits inside `if
  (candidates.length === 1)`, and a dense filter result always has a defined element at
  index 0 when its length is 1.
- **R8 (id 101)** — `pick !== undefined` is redundant for the same reason: `pick =
  named[0]` and the enclosing guard requires `named.length === 1`, so `pick` is always
  defined.
- **R9 (id 79)** — the candidate-filter name guard `f.field?.name !== undefined` is
  redundant under schema-valid data: `ProjectCustomFieldSchema` makes `field.name` a
  required `string` whenever `field` is present, and a field with no `field` is already
  rejected by `matchesType` (it classifies as `unknown`). So no schema-valid input has a
  type-matching field whose name is `undefined`, and dropping the guard changes nothing.
  Killing it would require zod-invalid test data, which the lint policy
  (`no-unsafe-type-assertion`) blocks constructing.
