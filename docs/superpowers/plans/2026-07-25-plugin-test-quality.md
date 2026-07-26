<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin resource/operation test-quality improvement — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the paired mutation scores of `plugins/task-provider-youtrack/operations/agiles.ts` (~55% → ~68-72%) and `plugins/task-provider-kaneo/label-resource.ts` (~45% → ~52-55%) by killing their genuinely behavior-testable survivors, and unblock paired mutation measurement for both plugin files.

**Architecture:** Pure test additions + a 2-line `overrides.json` unblock. `agiles.ts`'s module-private `parseSprintTimestamp`/`isLeapYear`/`getDaysInMonth` are tested **indirectly** via the public `createYouTrackSprint`/`updateYouTrackSprint`, asserting either the exact parsed epoch in the request body (`getFetchBodyAt`) or rejection (`YouTrackClassifiedError` + zero fetch calls). `label-resource.ts` gets HTTP method+path contract assertions matching the pattern its `listForTask`/`addToTask`/`removeFromTask` tests already use. No source changes. All log-payload / message-string / JSON-equivalent / validation-backstop survivors are intentionally accepted (Option A behavior-only), mirroring `2026-07-25-update-status-test-quality-design.md`.

**Tech Stack:** Bun test runner (`bun:test`), Zod v4, the youtrack test fetch-mock harness (`mockFetchResponse`/`getFetchBodyAt`/`getFetchMethodAt`/`getFetchUrlAt` from `tests/plugins/task-provider-youtrack/fetch-mock-utils.ts`), the kaneo `setMockFetch` helper, Stryker paired runner (`bun test:mutate:file`).

**Source spec:** `docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md`

## Global Constraints

- Work on branch `mutation-testing-revive` only.
- Runtime: **Bun** (never `npm`/`yarn`).
- Never add lint-disable / type-ignore comments — fix the underlying issue. (One spec-mandated ordinary comment block per new test group is allowed; it is the only non-code text added.)
- `agiles.test.ts` style: top-level `describe`/`test`, `mockFetchResponse(fetchMock, …)` + `getFetchBodyAt(fetchMock.current, N)`, `mockLogger()` in the file-level `beforeEach` (already present), `restoreFetch()` in `afterEach` (already present).
- `label-resource.test.ts` style: `describe('LabelResource')` with nested per-method describes; `setMockFetch((url, options) => …)`; `getRequestMethod(options)` helper already defined at the top of the file.
- **Do not** modify `plugins/task-provider-youtrack/operations/agiles.ts` or `plugins/task-provider-kaneo/label-resource.ts`. **Do not** modify `src/tools/update-status.ts` or its tests.
- **Do not** add log-payload / description-string / message-text assertions (out of scope — see spec).
- Boundary tests use `new Date(iso).getTime()` as the parsing oracle for valid timestamps (the existing `createYouTrackSprint` test at `agiles.test.ts:163-166` already uses this pattern); invalid timestamps assert rejection + zero fetch calls. Never weaken `parseSprintTimestamp`'s validation — if a test disagrees with the code, fix the test data.

## File Structure

- **Modify** `scripts/mutation/overrides.json` — append 2 plugin entries (Task 1).
- **Modify** `tests/plugins/task-provider-youtrack/operations/agiles.test.ts` — append one new `describe` (boundary validation, via two `for…of` test loops) + insert one test into the existing `updateYouTrackSprint` describe (Task 2).
- **Modify** `tests/plugins/task-provider-kaneo/label-resource.test.ts` — insert one new nested `describe` (HTTP method/path contract, 4 tests) inside `describe('LabelResource')` after the `removeFromTask` block (Task 3).

No other files change.

---

### Task 1: Unblock paired mutation measurement for the two plugin files

**Files:**
- Modify: `scripts/mutation/overrides.json`

**Interfaces:**
- Consumes: the paired runner's `loadOverrides` (`scripts/mutation/test-overrides.ts`), which reads this file and uses listed test files when the companion resolver finds none.
- Produces: `bun test:mutate:file plugins/task-provider-kaneo/label-resource.ts plugins/task-provider-youtrack/operations/agiles.ts` no longer reports `skipped=2`; both files get measured.

- [ ] **Step 1: Read the current end of `overrides.json` to anchor the edit**

Run: `sed -n '43,46p' scripts/mutation/overrides.json`
Expected: see the last three entries ending with the closing `}`:
```
  "src/tools/list-labels.ts": ["tests/tools/label-tools.test.ts"],
  "src/tools/remove-label.ts": ["tests/tools/label-tools.test.ts"],
  "src/tools/update-label.ts": ["tests/tools/label-tools.test.ts"]
}
```

- [ ] **Step 2: Append the two plugin entries**

Replace this exact block:

```json
  "src/tools/update-label.ts": ["tests/tools/label-tools.test.ts"]
}
```

with:

```json
  "src/tools/update-label.ts": ["tests/tools/label-tools.test.ts"],
  "plugins/task-provider-kaneo/label-resource.ts": ["tests/plugins/task-provider-kaneo/label-resource.test.ts"],
  "plugins/task-provider-youtrack/operations/agiles.ts": [
    "tests/plugins/task-provider-youtrack/operations/agiles.test.ts"
  ]
}
```

- [ ] **Step 3: Verify both files are now measured (no skips) and record baselines**

Run: `bun test:mutate:file plugins/task-provider-kaneo/label-resource.ts plugins/task-provider-youtrack/operations/agiles.ts`
Expected: a summary line like `files=2 skipped=0 killed=202 survived=163 pending=0 score=0.523…`, plus per-file lines close to:
- `plugins/task-provider-kaneo/label-resource.ts: killed=46 survived=53 noCoverage=3 … score≈0.451`
- `plugins/task-provider-youtrack/operations/agiles.ts: killed=156 survived=110 noCoverage=18 … score≈0.549`

If the summary shows `skipped=2`, the override paths do not match exactly — re-check the spelling against the source paths and fix before continuing.

- [ ] **Step 4: Lint + typecheck — green (JSON change; sanity)**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 5: Confirm only `overrides.json` changed**

Run: `git status --short`
Expected: only `scripts/mutation/overrides.json` (the `reports/paired/*` artifacts are gitignored and must not appear).

- [ ] **Step 6: Commit**

```bash
git add scripts/mutation/overrides.json
git commit -m "build(mutation): register kaneo/youtrack plugin files for paired mutation

The companion resolver does not handle plugins/ paths, so
bun test:mutate:file skipped label-resource.ts and agiles.ts.
Register their tests in overrides.json so both are measurable.
No test or source changes."
```

---

### Task 2: Cover `parseSprintTimestamp` calendar/timezone/regex boundaries (agiles.ts)

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/operations/agiles.test.ts` — (a) insert one test inside the `updateYouTrackSprint` describe; (b) append one new `describe` at end of file.

**Interfaces:**
- Consumes: `createYouTrackSprint`, `updateYouTrackSprint` from `…/operations/agiles.js`; `YouTrackClassifiedError`; the fetch-mock helpers `mockFetchResponse`, `getFetchBodyAt`; `config`, `fetchMock`, `makeSprintResponse` (all already in the test file).
- Produces: ~23 new passing tests; the `parseSprintTimestamp` survivor cluster (~45 survived + ~15 no-cov) collapses, raising `agiles.ts` from ~55% to ~68-72%.

- [ ] **Step 1: Read the `updateYouTrackSprint` describe tail to anchor insert (a)**

Run: `sed -n '328,347p' tests/plugins/task-provider-youtrack/operations/agiles.test.ts`
Expected: the last `updateYouTrackSprint` test ("rejects impossible ISO datetimes when updating before sending request", ending ~L345) followed by the describe closing `})` at ~L347.

- [ ] **Step 2: Insert the `previousSprintId` non-null test before the `updateYouTrackSprint` describe closes**

Replace this exact block (the last test + the describe close):

```typescript
    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        finish: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)
  })
})
```

with:

```typescript
    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        finish: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock.current?.mock.calls).toHaveLength(0)
  })

  test('links previous sprint when previousSprintId is a non-null id', async () => {
    mockFetchResponse(fetchMock, makeSprintResponse({ id: 'sprint-2' }))

    await updateYouTrackSprint(config, 'agile-1', 'sprint-2', { previousSprintId: 'sprint-1' })

    expect(getFetchBodyAt(fetchMock.current, 0).previousSprint).toEqual({ id: 'sprint-1' })
  })
})
```

- [ ] **Step 3: Read the file tail to anchor append (b)**

Run: `sed -n '425,435p' tests/plugins/task-provider-youtrack/operations/agiles.test.ts`
Expected: the end of the `assignYouTrackTaskToSprint` describe — its last test's final `expect(…).toHaveLength(2)` then the describe closing `})` at the final line (~L435). (Line numbers shift by +9 after Step 2; re-run if needed.)

- [ ] **Step 4: Append the boundary-validation `describe` at the end of the file**

Append this block after the final closing `})` of the file (the `assignYouTrackTaskToSprint` describe):

```typescript

// parseSprintTimestamp is module-private and reached only via createYouTrackSprint.
// Valid timestamps must parse to the same epoch as the JS reference (new Date);
// invalid ones must reject before any fetch. Log/error-message/JSON-equivalent
// survivors are intentionally not chased — see
// docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md.
describe('parseSprintTimestamp boundary validation (via createYouTrackSprint)', () => {
  for (const start of [
    '2024-02-29T00:00:00.000Z', // leap year, %4 rule
    '2000-02-29T00:00:00.000Z', // leap year, %400 rule
    '2024-12-31T23:59:59.999Z', // upper calendar / hms bounds
    '2024-04-30T00:00:00.000Z', // last day of a 30-day month
    '2024-01-15T00:00Z', // seconds omitted -> 0
    '2024-01-15T00:00:00Z', // milliseconds omitted -> 0
    '2024-01-15T00:00:00.5Z', // 1-digit millisecond, zero-padded -> 500
    '2024-01-15T00:00:00+03:00', // positive timezone offset
    '2024-06-15T12:30:00-05:00', // negative timezone offset
  ] as const) {
    test(`accepts and converts ${start}`, async () => {
      mockFetchResponse(fetchMock, makeSprintResponse())

      await createYouTrackSprint(config, 'agile-1', { name: 'Sprint', start })

      expect(getFetchBodyAt(fetchMock.current, 0).start).toBe(new Date(start).getTime())
    })
  }

  for (const [label, start] of [
    ['Feb 29 in a common year', '2023-02-29T00:00:00.000Z'],
    ['Feb 29 in a century non-leap year', '1900-02-29T00:00:00.000Z'],
    ['month 13', '2024-13-01T00:00:00.000Z'],
    ['day 32', '2024-01-32T00:00:00.000Z'],
    ['day 31 in a 30-day month', '2024-04-31T00:00:00.000Z'],
    ['hour 24', '2024-01-01T24:00:00.000Z'],
    ['minute 60', '2024-01-01T00:60:00.000Z'],
    ['second 60', '2024-01-01T00:00:60.000Z'],
    ['timezone hour 24', '2024-01-15T00:00:00+24:00'],
    ['timezone minute 60', '2024-01-15T00:00:00+00:60'],
    ['prefixed garbage', 'x2024-01-15T00:00:00.000Z'],
    ['trailing garbage', '2024-01-15T00:00:00.000Zx'],
    ['space separator', '2024-01-15 00:00:00.000Z'],
  ] as const) {
    test(`rejects ${label} before sending the request`, async () => {
      mockFetchResponse(fetchMock, makeSprintResponse())

      await expect(createYouTrackSprint(config, 'agile-1', { name: 'Sprint', start })).rejects.toBeInstanceOf(
        YouTrackClassifiedError,
      )

      expect(fetchMock.current?.mock.calls).toHaveLength(0)
    })
  }
})
```

- [ ] **Step 5: Run the test file — all must pass**

Run: `bun test tests/plugins/task-provider-youtrack/operations/agiles.test.ts`
Expected: all pass (existing + ~23 new). If any acceptance test throws, the calendar logic is stricter than the listed timestamp — fix the **timestamp string**, never the validation. If any rejection test does not throw, the timestamp accidentally passes the regex+validation — replace it with one that genuinely fails (keep the label honest).

- [ ] **Step 6: Lint + typecheck — green**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 7: Run the paired mutation test to prove the cluster collapses**

Run: `bun test:mutate:file plugins/task-provider-youtrack/operations/agiles.ts`
Expected: `survived` drops by ~40-45 (from 110 toward ~65), `noCoverage` drops by ~15 (from 18 toward ~3), score rises from ~0.549 toward ~0.68-0.72. If `survived` drops by noticeably fewer than ~40, re-read `reports/paired/plugins__task-provider-youtrack__operations__agiles.ts.stryker-report.json` survivors in the L28-91 region and extend the boundary loops before committing.

- [ ] **Step 8: Confirm only the agiles test file changed**

Run: `git status --short`
Expected: only `tests/plugins/task-provider-youtrack/operations/agiles.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add tests/plugins/task-provider-youtrack/operations/agiles.test.ts
git commit -m "test(youtrack-agiles): cover parseSprintTimestamp calendar/timezone/regex

parseSprintTimestamp/isLeapYear/getDaysInMonth were reached only by
happy-path Z-timestamps, leaving ~45 survivors and ~15 no-coverage
mutants in the date-validation cluster. Add boundary tests driven via
createYouTrackSprint (valid timestamps assert the parsed epoch matches
new Date; invalid ones assert rejection + zero fetch), plus the
updateSprint previousSprintId non-null branch.

Raises the paired mutation score from ~55% to ~68-72%. Log/error-message
/JSON-equivalent survivors remain accepted — see
docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md"
```

---

### Task 3: Assert the HTTP method/path contract (label-resource.ts)

**Files:**
- Modify: `tests/plugins/task-provider-kaneo/label-resource.test.ts` — insert one nested `describe` inside `describe('LabelResource')`, after the `removeFromTask` block.

**Interfaces:**
- Consumes: `LabelResource`; `mockConfig` (in scope inside `describe('LabelResource')`); `setMockFetch`; the file-top helpers `getRequestMethod(options)`.
- Produces: 4 new passing tests; ~8 method/path survivors die, raising `label-resource.ts` from ~45% to ~52-55%.

- [ ] **Step 1: Read the `removeFromTask` describe tail + `LabelResource` close to anchor the insert**

Run: `sed -n '451,459p' tests/plugins/task-provider-kaneo/label-resource.test.ts`
Expected: the last `removeFromTask` test ("throws when label is not found") ending ~L457, then the `removeFromTask` describe close `})` ~L458, then the `LabelResource` describe close `})` ~L459.

- [ ] **Step 2: Insert the method/path contract `describe` before the `LabelResource` describe closes**

Replace this exact block (the last `removeFromTask` assertion + the `removeFromTask` describe close + the `LabelResource` describe close — these are the final lines of the file):

```typescript
      const promise = resource.removeFromTask('task-1', 'invalid-label')
      await expect(promise).rejects.toHaveProperty('appError.code', 'label-not-found')
    })
  })
})
```

with:

```typescript
      const promise = resource.removeFromTask('task-1', 'invalid-label')
      await expect(promise).rejects.toHaveProperty('appError.code', 'label-not-found')
    })
  })

  // Endpoint contract for the four methods whose existing tests asserted only
  // body/result. listForTask/addToTask/removeFromTask already assert URL+method.
  // Log-payload / message-string survivors are intentionally not chased — see
  // docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md.
  describe('HTTP method and path contract', () => {
    test('create POSTs to /api/label', async () => {
      const requests: Array<{ url: string; method: string }> = []
      setMockFetch((url, options) => {
        requests.push({ url, method: getRequestMethod(options) })
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'n', color: '#6b7280' }), { status: 200 }),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.create({ workspaceId: 'ws-1', name: 'n' })

      expect(requests).toEqual([{ url: 'https://api.test.com/api/label', method: 'POST' }])
    })

    test('list GETs /api/label/workspace/:id', async () => {
      const requests: Array<{ url: string; method: string }> = []
      setMockFetch((url, options) => {
        requests.push({ url, method: getRequestMethod(options) })
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      })

      const resource = new LabelResource(mockConfig)
      await resource.list('ws-1')

      expect(requests).toEqual([{ url: 'https://api.test.com/api/label/workspace/ws-1', method: 'GET' }])
    })

    test('update GETs then PUTs /api/label/:id', async () => {
      const requests: Array<{ url: string; method: string }> = []
      setMockFetch((url, options) => {
        requests.push({ url, method: getRequestMethod(options) })
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'label-1', name: 'n', color: '#ff0000' }), { status: 200 }),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.update('label-1', { name: 'n' })

      expect(requests).toEqual([
        { url: 'https://api.test.com/api/label/label-1', method: 'GET' },
        { url: 'https://api.test.com/api/label/label-1', method: 'PUT' },
      ])
    })

    test('remove GETs then DELETEs /api/label/:id', async () => {
      const requests: Array<{ url: string; method: string }> = []
      setMockFetch((url, options) => {
        requests.push({ url, method: getRequestMethod(options) })
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'label-1', name: 'b', color: '#ff0000', taskId: 'task-1' }),
            { status: 200 },
          ),
        )
      })

      const resource = new LabelResource(mockConfig)
      await resource.remove('label-1')

      expect(requests).toEqual([
        { url: 'https://api.test.com/api/label/label-1', method: 'GET' },
        { url: 'https://api.test.com/api/label/label-1', method: 'DELETE' },
      ])
    })
  })
})
```

The new `describe` is nested at 2-space indent (inside `describe('LabelResource')`), so `mockConfig` and the file-top `getRequestMethod` helper are in scope.

- [ ] **Step 3: Run the test file — all must pass**

Run: `bun test tests/plugins/task-provider-kaneo/label-resource.test.ts`
Expected: all pass (existing + 4 new). If a URL assertion fails, the captured `requests` differ from the expected endpoint — compare the actual `requests` value printed in the failure to the source's `kaneoFetch` path/method and correct the **expected** value to match the real contract (do not change the source).

- [ ] **Step 4: Lint + typecheck — green**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 5: Run the paired mutation test to prove the method/path mutants die**

Run: `bun test:mutate:file plugins/task-provider-kaneo/label-resource.ts`
Expected: `survived` drops by ~8 (from 53 toward ~45), score rises from ~0.451 toward ~0.52-0.55. If `survived` drops by noticeably fewer than ~8, re-read `reports/paired/plugins__task-provider-kaneo__label-resource.ts.stryker-report.json` StringLiteral survivors on the method/path lines and extend the assertions.

- [ ] **Step 6: Confirm only the label-resource test file changed**

Run: `git status --short`
Expected: only `tests/plugins/task-provider-kaneo/label-resource.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add tests/plugins/task-provider-kaneo/label-resource.test.ts
git commit -m "test(kaneo-label-resource): assert HTTP method/path contract

create/list/update/remove tests asserted body and result but not the
endpoint, so ~8 method and path mutants survived. Add URL+method
assertions matching the pattern already used by listForTask/addToTask/
removeFromTask.

Raises the paired mutation score from ~45% to ~52-55%. Log/message-string
survivors remain accepted — see
docs/superpowers/specs/2026-07-25-plugin-test-quality-design.md"
```

---

## Done criteria

- `overrides.json` carries both plugin entries; `bun test:mutate:file …` reports `skipped=0` for them.
- `agiles.test.ts` and `label-resource.test.ts` green (existing + new).
- `bun run lint` / `bun run typecheck` green.
- `bun test:mutate:file plugins/task-provider-youtrack/operations/agiles.ts` ≈ 0.68-0.72 (survivors −~40-45, no-cov −~15).
- `bun test:mutate:file plugins/task-provider-kaneo/label-resource.ts` ≈ 0.52-0.55 (survivors −~8).
- `bun test:mutate:file src/tools/update-status.ts` unchanged at ~0.49 (no change to it).
- Only the three files listed in *File Structure* changed.

## Out of scope

- Any change to `src/tools/update-status.ts` or its tests.
- Log-payload assertions (Option B), description/message-string assertions.
- Generalizing `findTestFile` for all `plugins/` (deferred — tracked in the spec).
- Source changes to `agiles.ts` / `label-resource.ts` (e.g. exporting `parseSprintTimestamp`).
