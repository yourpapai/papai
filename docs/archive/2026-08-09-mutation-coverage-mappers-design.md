<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `plugins/task-provider-youtrack/mappers.ts`

## Summary

Raise the Stryker mutation score of `plugins/task-provider-youtrack/mappers.ts`
from the measured baseline **0.7984** (202 killed / 253 total; 42 Survived + 9
NoCoverage) to **>= 0.9** by extending the companion test file
`tests/plugins/task-provider-youtrack/mappers.test.ts` only. No production edit
is permitted (test-only iteration).

The work kills 42 surviving mutants with one focused test per mutant class and
declares the remaining 9 as accepted equivalent residuals. Projected post-fix
score: **244 / 253 = 0.9644**.

## Why this file

`mappers.ts` is the YouTrack → papai normalization layer: every issue, list
item, search result, comment, attachment, watcher, visibility, and relation
flowing out of the YouTrack provider passes through it. A regression in a
guard here silently corrupts task data shown to users. The file is pure
data-mapping (no I/O), so it is an ideal mutation-coverage target — every
branch is reachable from a constructed input.

## Non-goals

- Editing `plugins/`, `src/`, `client/`, or `scripts/` (hard constraint:
  test-only).
- Touching `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring the mappers to eliminate equivalent mutants (e.g. the dead
  `.filter()` calls over non-nullable schema elements, or the `?? 'Relate'`
  default that collapses to `'related'`). Those are documented as residuals.
- Validating Zod schemas at runtime in tests; inputs use `satisfies z.infer<…>`
  exactly like the existing tests.

## Gap analysis

Measured by `bun test:mutate:file plugins/task-provider-youtrack/mappers.ts`
(fresh run, score 0.7984189723320159). The 51 surviving mutants (42 Survived +
9 NoCoverage) group into the following classes. Column "Mutants" lists the
Stryker `id` values verbatim from
`reports/paired/plugins__task-provider-youtrack__mappers.ts.stryker-report.json`.

| # | Class | Loc (line) | Mutants | Why it survives | Killable? |
| --- | --- | --- | --- | --- | --- |
| 1 | `getCustomFieldValue` null-guard, whole cond / `||` / left operand | 34 | 10, 11, 12 | No test passes a custom-field `value: null` (only objects/strings tested) | yes |
| 2 | `getCustomFieldValue` null-guard, right operand `val === undefined` | 34 | 14 | For `undefined` the fall-through also returns `undefined` at line 42; for `null` the left operand already matches | **equivalent** |
| 3 | `getCustomFieldValue` object branch `login` type-check | 39 | 27 | No object value with a non-string `login` (and no `name`) is tested | yes |
| 4 | `getCustomFieldValue` trailing string-check | 42 | 31 | No non-string scalar (number/boolean) value is tested | yes |
| 5 | `mapRelationType` `'depends'` plural arm | 47 | 43, 45 | Only `'Depend'` (singular) is tested, never `'Depends'` | yes |
| 6 | `mapRelationType` depend direction, non-OUTWARD branch | 48 | 47, 52 | Only OUTWARD depend tested; INWARD/BOTH (`'blocked_by'`) untested | yes |
| 7 | `mapRelationType` duplicate direction, non-OUTWARD branch | 51 | 58, 63 | Only OUTWARD duplicate tested; `'duplicate_of'` untested | yes |
| 8 | `getCustomFieldValue` / `getCustomFieldTimestamp` undefined `customFields` (optional chaining) | 31, 65 | 1, 85 | `IssueListSchema.customFields` is optional but no list/search test omits it | yes |
| 9 | `getCustomFieldTimestamp` `.find` predicate | 65 | 87 | Due Date is always the only/exact field in tests; a non-matching field placed first is never exercised | yes |
| 10 | `getCustomFieldTimestamp` `typeof === 'number'` guard | 67 | 93 | No Due Date field with a non-numeric value is tested | yes |
| 11 | `mapUserRef` null operand | 73 | 101 | No `null` user (e.g. `reporter: null`) is tested | yes |
| 12 | `mapParent` empty-`issues` guard | 84 | 115 | `parent: { issues: [] }` is never tested | yes |
| 13 | `mapSubtasks` `resolved === null` operand | 108 | 127 | No subtask with `resolved: null` is tested | yes |
| 14 | `mapVisibilityGroups` empty + undefined guards | 114 | 133, 134, 135, 137 | Visibility tests use a non-empty `permittedGroups`; `[]` and absent are untested | yes |
| 15 | `mapTaskVisibility` `UnlimitedVisibility` branch | 120–121 | 146, 148, 149, 150, 151 | Only `LimitedVisibility` is tested; the public branch is uncovered (NoCoverage) | yes |
| 16 | `mapTaskVisibility` permittedUsers optional chaining | 124 | 153 | `permittedUsers` is always present in tests | yes |
| 17 | `mapTaskVisibility` permittedUsers `.filter` removal / predicate | 124 | 152, 155 | `VisibilityUserSchema` elements always carry `id`, so `mapUserRef` never returns `undefined` and the filter is dead | **equivalent** |
| 18 | `mapTaskVisibility` users empty + undefined guards | 128 | 161, 162, 163, 165 | `permittedUsers: []` and absent are untested | yes |
| 19 | `mapYouTrackWatchers` `issueWatchers` optional chaining | 143 | 171 | `issueWatchers` is always present in tests | yes |
| 20 | `mapYouTrackWatchers` `.filter` removal / predicate | 143, 145 | 170, 175 | `watcher.user` is `UserSchema` (non-nullable), so `mapUserRef` never returns `undefined`; filter is dead | **equivalent** |
| 21 | `mapYouTrackWatchers` empty-mapped guard | 147 | 179, 183 | `issueWatchers: []` (maps to `[]`) is untested | yes |
| 22 | `mapAttachment` `url ?? ''` default literal | 162 | 188 | Every tested attachment has a `url`; the `''` default (NoCoverage) is unreached | yes |
| 23 | `mapAttachments` empty-array guard | 184 | 200 | `attachments: []` is untested | yes |
| 24 | `mapIssueToTask` links `?? []` default | 187 | 204 | The defensive `linkType?.name ?? 'Relate'` and `link.issues ?? []` collapse any non-link element to zero relations | **equivalent** |
| 25 | `mapIssueToTask` link `linkType?.name` optional chaining | 188 | 207 | No link without `linkType` is tested | yes |
| 26 | `mapIssueToTask` link `'Relate'` fallback literal | 188 | 208 | `mapRelationType('Relate')` and `mapRelationType('')` both yield `'related'`; the literal is observably unused | **equivalent** |
| 27 | `mapIssueToTask` link `?? []` for issues | 189 | 210 | No link without `issues` is tested | yes |
| 28 | `mapIssueToTask` link `direction ?? 'BOTH'` default literal | 190 | 214 | `mapRelationType` only tests `=== 'OUTWARD'`; both `'BOTH'` and `''` are non-OUTWARD, so the default is observably unused | **equivalent** |
| 29 | `mapIssueToTask` tags `?? []` default | 206 | 226 | Issues in tests always carry `tags` or leave it absent without asserting `labels` | yes |
| 30 | `mapIssueToTask` tag `color?.background` optional chaining | 206 | 229 | Every tested tag has a `color` | yes |
| 31 | `mapIssueToTask` `issue.project?.id` optional chaining | 204 | 222 | `IssueSchema.project` is required, so `project` can never be `undefined` for `mapIssueToTask` | **equivalent** |
| 32 | `mapIssueToSearchResult` `issue.project?.id` optional chaining | 239 | 246 | `IssueListSchema.project` is optional but no search-result test omits it | yes |

Totals: **42 killable** mutants across classes 1,3–16,18,19,21–23,25,27,29,30,32
and **9 equivalent** residuals across classes 2,17,20,24,26,28,31.

## Design — tests to add

Each new test maps one-to-one onto a killable gap class. Every assertion uses
exact equality (`toBe` / `toEqual`) on fully-knowable values — no
`startsWith`/`endsWith`/`toContain`. The tests are appended to
`tests/plugins/task-provider-youtrack/mappers.test.ts` as new `describe`
blocks; existing tests are not weakened.

| Test (new) | Kills class (#) | Input shape | Exact assertion |
| --- | --- | --- | --- |
| `returns undefined when custom field value is null` | 1 | `State` field, `value: null` | `result.status` toBe `undefined` |
| `returns undefined when custom field object value has non-string login` | 3 | `State` field, `value: { login: 123 }` | `result.status` toBe `undefined` |
| `returns undefined when custom field value is a non-string scalar` | 4 | `SimpleIssueCustomField` `State`, `value: 42` | `result.status` toBe `undefined` |
| `maps depends (plural) relation outward as blocks` | 5 | link `Depends` OUTWARD | `result.relations` toEqual `[{ type: 'blocks', taskId: 'PROJ-2' }]` |
| `maps depend relation inward as blocked_by` | 6 | link `Depend` INWARD | `result.relations` toEqual `[{ type: 'blocked_by', taskId: 'PROJ-2' }]` |
| `maps duplicate relation inward as duplicate_of` | 7 | link `Duplicate` INWARD | `result.relations` toEqual `[{ type: 'duplicate_of', taskId: 'PROJ-2' }]` |
| `omitting customFields on a list item yields undefined state/priority/dueDate` | 8 | `mapIssueToListItem`, no `customFields` | each of status/priority/dueDate toBe `undefined` |
| `finds due date even when a non-matching field precedes it` | 9 | `[State, Due Date]` | `result.dueDate` toBe `'2026-03-25'` |
| `treats a non-numeric due date value as absent` | 10 | `Due Date` field, `value: '2024-01-01'` | `result.dueDate` toBe `null` |
| `maps null reporter to undefined` | 11 | `reporter: null` | `result.reporter` toBe `undefined` |
| `maps parent with empty issues to undefined` | 12 | `parent: { issues: [] }` | `result.parent` toBe `undefined` |
| `maps subtask with null resolved as open` | 13 | subtask `resolved: null` | `result.subtasks?.[0]?.status` toBe `'open'` |
| `collapses empty permittedGroups on limited visibility` | 14 (part) | Limited, `permittedGroups: []` | `result.visibility?.groups` toBe `undefined` |
| `maps unlimited visibility as public` | 15 | `UnlimitedVisibility` | `result.visibility` toEqual `{ kind: 'public' }` |
| `collapses empty permittedUsers on limited visibility` | 18 (part) | Limited, `permittedUsers: []` | `result.visibility?.users` toBe `undefined` |
| `collapses absent permittedUsers and permittedGroups on limited visibility` | 14 (rest), 16, 18 (rest) | Limited, neither permitted set | users/groups each toBe `undefined` |
| `maps watchers object without issueWatchers to undefined` | 19 | `watchers: { hasStar: true }` | `result.watchers` toBe `undefined` |
| `maps empty issueWatchers list to undefined` | 21 | `watchers: { issueWatchers: [] }` | `result.watchers` toBe `undefined` |
| `defaults missing attachment url to empty string` | 22 | attachment without `url` | `result.attachments?.[0]?.url` toBe `''` |
| `collapses empty attachments list to undefined` | 23 | `attachments: []` | `result.attachments` toBe `undefined` |
| `omits relations when a link lacks linkType and issues` | 25, 27 | link `{ id, direction }` only | `result.relations` toBe `undefined` |
| `defaults missing tags to empty labels` | 29 | no `tags` field | `result.labels` toEqual `[]` |
| `defaults missing tag color to undefined` | 30 | tag without `color` | `result.labels?.[0]?.color` toBe `undefined` |
| `omitting project on a search result yields undefined projectId` | 32 | `mapIssueToSearchResult`, no `project` | `result.projectId` toBe `undefined` |

## Verification

1. `bun test tests/plugins/task-provider-youtrack/mappers.test.ts` — all green
   (existing + new).
2. `bun test:mutate:file plugins/task-provider-youtrack/mappers.ts` — re-measure;
   the only remaining survivors must be exactly the 9 residual ids declared in
   the result JSON.
3. Projected score: `202 + 42 = 244` killed of 253 → **0.9644** (>= 0.9).

## Accepted residuals

Nine mutants are equivalent and cannot be killed by any schema-valid test
input. They are enumerated with per-loc reasoning in the result JSON
(`residuals[]`), each carrying the exact Stryker `id` it covers:

- `14` — `val === undefined → false` at line 34: `null` is still caught by the
  left operand; `undefined` falls through to `return … : undefined` at line 42.
- `152`, `155` — `permittedUsers` `.filter` at line 124: `VisibilityUserSchema`
  elements always have `id`, so `mapUserRef` never returns `undefined`.
- `170`, `175` — watchers `.filter` at lines 143/145: `watcher.user` is
  `UserSchema` (non-nullable), so `mapUserRef` never returns `undefined`.
- `204` — `issue.links ?? []` `[] → ["Stryker was here"]` at line 187: a
  non-link element yields no relations because `linkType?.name ?? 'Relate'` and
  `link.issues ?? []` defend every access.
- `208` — `'Relate' → ""` at line 188: `mapRelationType('Relate')` and
  `mapRelationType('')` both return `'related'`.
- `214` — `'BOTH' → ""` at line 190: `mapRelationType` only tests
  `=== 'OUTWARD'`; both `'BOTH'` and `''` are non-OUTWARD.
- `222` — `issue.project?.id` at line 204: `IssueSchema.project` is required,
  so `project` can never be `undefined` for `mapIssueToTask`.
