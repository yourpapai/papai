<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `plugins/task-provider-youtrack/dedicated-fields.ts`

Spec: `docs/superpowers/specs/2026-08-07-mutation-coverage-dedicated-fields-design.md`.
Target: raise Stryker score from **0.6699** to **>= 0.9** (test-only).

## Global constraints

- Test-only. Touch only `tests/plugins/task-provider-youtrack/dedicated-fields.test.ts`
  (and these docs). Never edit `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Every new assertion uses exact equality (`toBe` / `toEqual`) on fully-knowable values —
  never `startsWith` / `endsWith` / `toContain` / regex substrings where a full string is
  knowable. For thrown errors, `try/catch` and assert `.message` (and `.appError`) exactly.
- Reuse the existing `field(name, typeId, bundleType?)` helper; extend it with an optional
  `localizedName` parameter (existing 3-arg calls are unaffected).
- One focused test per gap class C1-C13 (13 tests). Residuals R1-R8 are declared, not
  tested.

## Tasks

- [ ] **C1** — state canonical disambiguation (`State` + `Статус`); kills 1,2,3.
- [ ] **C2** — user Russian canonical (`Ответственный`); kills 6.
- [ ] **C3** — priority Russian canonical (`Приоритет`); kills 9.
- [ ] **C4/C9** — priority with no enum field: exact "No priority-type field exists…"
  message + `appError` equals `providerError.validationFailed('customFields', …)`; kills
  26, 68, 72.
- [ ] **C5/C6** — date sole-field shortcut (with a non-date companion); kills 30,38,39,
  40,41.
- [ ] **C7** — localized-name disambiguation (`localizedName: 'Assignee'`); kills 44,53,
  60.
- [ ] **C8** — multiple-candidate exact message incl. `Name; Name` join; kills 66.
- [ ] **C10** — candidate-filter optional-chaining over `[fieldless, named state]`;
  kills 81. (id 79 is equivalent under schema-valid data → residual R9.)
- [ ] **C11** — single non-canonical enum as `priority` is not auto-resolved (exact
  "Multiple candidate fields…" message); kills 85,87.
- [ ] **C12** — two fields both named `Assignee` throw; kills 98,99.
- [ ] **C13** — date canonical disambiguation (`Due Date` + `Дедлайн`); kills 10,11,12.
- [ ] Run `bun test tests/plugins/task-provider-youtrack/dedicated-fields.test.ts` green.
- [ ] Re-run `bun test:mutate:file plugins/task-provider-youtrack/dedicated-fields.ts`;
  confirm survivors are exactly R1-R9 (ids 43,45,51,59,63,64,79,91,101) and score >= 0.9.
- [ ] Write `result.json` with residuals = measured survivors.

## Risks / notes

- The teaching-error strings use straight ASCII double quotes around the kind
  (`for "priority"`); assertions must match byte-for-byte.
- `id 59` (`localized !== null`) stays NoCoverage-equivalent even after the C7 test
  because `?? undefined` on L34 structurally forbids `localized === null`; it is declared
  residual R4.
- If a planned kill unexpectedly survives the re-measure, either tighten that test or move
  the id into residuals with honest reasoning — the declared `mutantIds` UNION must equal
  the measured survivor set exactly.
