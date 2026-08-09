<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `plugins/task-provider-youtrack/mappers.ts`

Spec: `docs/superpowers/specs/2026-08-09-mutation-coverage-mappers-design.md`.
Target: raise Stryker score from **0.7984** to **>= 0.9** (projected **0.9644**).
Test-only: edits confined to `tests/plugins/task-provider-youtrack/mappers.test.ts`.

## Global constraints

- Touch ONLY `tests/**` and `docs/superpowers/**` (plus the single result JSON).
  Never edit `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Every new assertion uses exact equality (`toBe` / `toEqual`) on fully
  knowable values — no `startsWith`/`endsWith`/toContain` for strings.
- Inputs use `satisfies z.infer<typeof import('…').IssueSchema>` (or
  `IssueListSchema` / `CommentSchema`) exactly like the existing tests — no
  runtime `parse`, no `as any`.
- New tests are appended as additional `describe` blocks; existing tests stay
  intact (they already lock in the happy paths).
- SPDX header on the test file is already present; do not alter it.
- One test per mutant class; a single test may cover several ids when they
  share the exact same kill condition (documented per row).

## Tasks (per mutant class)

- [x] MEASURE — `bun test:mutate:file plugins/task-provider-youtrack/mappers.ts`
      confirmed 202 killed / 42 Survived / 9 NoCoverage, score 0.7984.
- [ ] **C1** line 34 null-value guard — add test with `State` field
      `value: null`; kills `10, 11, 12`. (id `14` stays as residual.)
- [ ] **C3** line 39 object-login type-check — add test with `value: { login: 123 }`.
- [ ] **C4** line 42 trailing string-check — add test with `SimpleIssueCustomField`
      `value: 42`.
- [ ] **C5** line 47 `'depends'` plural — add test with link `Depends` OUTWARD.
- [ ] **C6** line 48 depend INWARD — add test with link `Depend` INWARD.
- [ ] **C7** line 51 duplicate INWARD — add test with link `Duplicate` INWARD.
- [ ] **C8** lines 31 & 65 undefined `customFields` — add `mapIssueToListItem`
      test with no `customFields`; kills `1, 85`.
- [ ] **C9** line 65 `.find` predicate — add test with `[State, Due Date]` order;
      kills `87`.
- [ ] **C10** line 67 `typeof === 'number'` — add test with `Due Date` field
      `value: '2024-01-01'`; kills `93`.
- [ ] **C11** line 73 `mapUserRef` null — add test with `reporter: null`; kills `101`.
- [ ] **C12** line 84 empty-issues parent — add test with `parent: { issues: [] }`;
      kills `115`.
- [ ] **C13** line 108 subtask `resolved: null` — add test; kills `127`.
- [ ] **C14** line 114 visibility-groups guards — add `permittedGroups: []` test
      (kills `133, 134, 137`) and a `permittedGroups`-absent test (kills `135`).
- [ ] **C15** lines 120–121 `UnlimitedVisibility` — add public-visibility test;
      kills `146, 148, 149, 150, 151`.
- [ ] **C16** line 124 permittedUsers optional chaining — covered by the
      `permittedGroups`-absent test from C14; kills `153`.
- [ ] **C18** line 128 users guards — add `permittedUsers: []` test
      (kills `161, 162, 165`) and the absent-users test from C14 (kills `162, 163`).
- [ ] **C19** line 143 watchers optional chaining — add `watchers: { hasStar: true }`
      test; kills `171`.
- [ ] **C21** line 147 empty-mapped guard — add `watchers: { issueWatchers: [] }`
      test; kills `179, 183`.
- [ ] **C22** line 162 attachment url default — add attachment without `url`;
      kills `188`.
- [ ] **C23** line 184 empty attachments — add `attachments: []` test; kills `200`.
- [ ] **C25/C27** lines 188 & 189 link optionals — add link `{ id, direction }`
      only; kills `207, 210`.
- [ ] **C29** line 206 tags default — add test with no `tags`; kills `226`.
- [ ] **C30** line 206 tag color optional — add tag without `color`; kills `229`.
- [ ] **C32** line 239 search-result project optional — add `mapIssueToSearchResult`
      test with no `project`; kills `246`.
- [ ] VERIFY — `bun test tests/plugins/task-provider-youtrack/mappers.test.ts`
      green.
- [ ] RE-MEASURE — `bun test:mutate:file plugins/task-provider-youtrack/mappers.ts`;
      confirm survivors are exactly the 9 residual ids.
- [ ] RESULT — write `.review-loop/result.json` with spec/plan/test paths and the
      9 residual entries.

## Residuals (accepted equivalents — no test can kill)

- `14` — line 34 right operand; null is caught by the left operand, undefined
  falls through to line 42.
- `152`, `155` — line 124 `permittedUsers` filter; `VisibilityUserSchema`
  always has `id` ⇒ `mapUserRef` never returns `undefined`.
- `170`, `175` — lines 143/145 watchers filter; `watcher.user` is non-nullable
  `UserSchema`.
- `204` — line 187 `issue.links ?? []`; downstream `??` defaults collapse any
  non-link element to zero relations.
- `208` — line 188 `'Relate'` fallback; `mapRelationType('Relate')` ≡
  `mapRelationType('')` ≡ `'related'`.
- `214` — line 190 `'BOTH'` fallback; `mapRelationType` only checks
  `=== 'OUTWARD'`, so `'BOTH'` ≡ `''`.
- `222` — line 204 `issue.project?.id`; `IssueSchema.project` is required.
