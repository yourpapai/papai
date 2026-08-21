<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2 Debug/Settings HTTP Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Tier 0 reachability for the remaining debug/settings HTTP routes and every exported debug schema parser.

**Architecture:** Extend the existing hermetic HTTP stories, keeping each request on `ScenarioWorld`'s production `web.route` override. Group assertions by the dashboard-session trust plane and router family; use direct imports only for `src/debug/schemas.ts`, which no production route loads.

**Tech Stack:** Bun test, TypeScript, Zod v4, ScenarioWorld Tier 0 harness, SQLite in-memory fixtures.

## Global Constraints

- Change only story tests and the story catalog unless a new route story exposes a confirmed production defect.
- Do not change `tests/stories/harness/**`, its `web.route` DI signature, coverage floors, or scenario-world APIs.
- Use `when.request` for anonymous requests and `when.dashboardRequest` for authenticated operator/debug requests.
- Each added route assertion must assert a visible status, response shape, or persisted effect; include a trust-boundary assertion when that route family does not already have one.
- Keep stories hermetic: no live network, sleeps, retries, or process servers.
- Preserve current user changes outside the files named by each task.

---

## File Structure

- Modify `tests/stories/http/dashboard.story.test.ts`: dashboard-session coverage for debug diagnostics, assets, operator data routes, and route gate behavior.
- Modify `tests/stories/http/debug-schemas.story.test.ts`: invoke every exported `parse*` helper and preserve safe-parser rejection checks.
- Modify `tests/stories/catalog/coverage.ts`: catalog the new behavior-oriented HTTP and schema scenarios so the reverse census remains complete.
- Do not modify `src/debug/**` unless a failing route-level story proves a production defect.

### Task 1: Cover Live Diagnostics And Static Assets

**Files:**
- Modify: `tests/stories/http/dashboard.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/http/dashboard.story.test.ts`

**Interfaces:**
- Consumes: `when.dashboardRequest(session, path, init?)`, `when.request(path, init?)`, `then.responseStatus(response, status)`, and `then.responseJson(body)` from `tests/stories/harness/scenario.ts`.
- Produces: cataloged scenarios covering `/events`, `/logs`, `/logs/stats`, `/logs/scopes`, `/turns/:id`, `/recurring`, `/deferred`, `/memos`, `/identity`, `/debug.js`, `/debug.css`, `/admin.js`, and `/admin.css` through `routeRequest`.

- [ ] **Step 1: Add dashboard stories for diagnostics and assets**

  Append two scenarios to `tests/stories/http/dashboard.story.test.ts`. The first uses a debug-enabled dashboard session, seeds one DM's recurring task, scheduled prompt, memo, and identity, then proves the route responses and the missing-turn branch:

  ```typescript
  scenario(
    'SCN-http-debug-route-family: a dashboard session reads every live diagnostic route',
    async ({ given, when, then, world }) => {
      const alice = given.user('debug-routes-alice')
      const dm = given.dm(alice)
      given.identity(alice, { providerUserId: 'provider-alice', login: 'alice', displayName: 'Alice' })
      given.recurringTask(dm, { title: 'Review routes', nextRun: '2099-01-01T00:00:00.000Z' })
      given.scheduledPrompt(dm, { prompt: 'Review routes', fireAt: '2099-01-01T00:00:00.000Z' })
      given.memo({ userId: world.scopedStorageContextId(dm), content: 'Route memo' })
      const session = await given.dashboardSession()
      const userId = encodeURIComponent(world.scopedStorageContextId(dm))

      then.responseStatus(await when.dashboardRequest(session, '/events'), 200)
      then.responseStatus(await when.dashboardRequest(session, '/logs'), 200)
      then.responseStatus(await when.dashboardRequest(session, '/logs/stats'), 200)
      then.responseStatus(await when.dashboardRequest(session, '/logs/scopes'), 200)
      then.responseStatus(await when.dashboardRequest(session, '/turns/not-found'), 404)
      then.responseStatus(await when.dashboardRequest(session, `/recurring?userId=${userId}`), 200)
      then.responseStatus(await when.dashboardRequest(session, `/deferred?userId=${userId}`), 200)
      then.responseStatus(await when.dashboardRequest(session, `/memos?userId=${userId}`), 200)
      then.responseStatus(await when.dashboardRequest(session, `/identity?userId=${encodeURIComponent(alice.id)}`), 200)
    },
    { debugEnabled: true },
  )
  ```

  Add the asset scenario immediately after it:

  ```typescript
  import { expect } from 'bun:test'

  scenario('SCN-http-dashboard-assets: dashboard assets are session-protected and non-empty', async ({ given, when, then }) => {
    const session = await given.dashboardSession()
    const assets = ['/debug.js', '/debug.css', '/admin.js', '/admin.css'] as const
    for (const path of assets) {
      const response = await when.dashboardRequest(session, path)
      then.responseStatus(response, 200)
      expect((await response.text()).length).toBeGreaterThan(0)
    }
  })
  ```

- [ ] **Step 2: Run the focused story file against the production router**

  Run: `bun test:stories --fixture tests/stories/http/dashboard.story.test.ts`

  Expected: the command passes when the existing route contract is correct. If it fails, use the failure to distinguish bad fixture setup from a production defect; do not add a harness seam to make the test pass.

- [ ] **Step 3: Correct only story setup or assertions using existing public scenario APIs**

  Use the following response assertions to keep each route's observable contract explicit:

  ```typescript
  const logs = await when.dashboardRequest(session, '/logs')
  then.responseStatus(logs, 200)
  then.responseJson(await logs.json()).contains('[')

  const stats = await when.dashboardRequest(session, '/logs/stats')
  then.responseStatus(stats, 200)
  then.responseJson(await stats.json()).contains('count')

  const scopes = await when.dashboardRequest(session, '/logs/scopes')
  then.responseStatus(scopes, 200)
  then.responseJson(await scopes.json()).contains('[')
  ```

  If the valid, production-routed request demonstrates a server bug rather than a bad expectation, add the smallest source fix and a focused unit regression only for that demonstrated bug.

- [ ] **Step 4: Catalog the new scenarios**

  Add literal scenario IDs to `CATALOG_SCENARIO_IDS` and `EXECUTABLE_STORY_MAPPINGS` in `tests/stories/catalog/coverage.ts`, using Tier 0 and these exact story identifiers. The mapping shape is:

  ```typescript
  'SCN-http-debug-route-family': {
    verifiedAt: '2026-08-01',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-debug-route-family: a dashboard session reads every live diagnostic route',
    ],
  },
  ```

  Add this exact asset mapping. Do not add a supporting-story exemption because both scenarios prove catalogable HTTP behavior.

  ```typescript
  'SCN-http-dashboard-assets': {
    verifiedAt: '2026-08-01',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-dashboard-assets: dashboard assets are session-protected and non-empty',
    ],
  },
  ```

- [ ] **Step 5: Run focused verification**

  Run: `bun test:stories:contracts && bun test:stories --fixture tests/stories/http/dashboard.story.test.ts`

  Expected: catalog census passes and every dashboard HTTP story passes.

- [ ] **Step 6: Commit the diagnostics and assets coverage**

  ```bash
  git add tests/stories/http/dashboard.story.test.ts tests/stories/catalog/coverage.ts
  git commit -m "test(stories): cover debug route families"
  ```

### Task 2: Cover Billing, Stats, And Recent-Requests Routing

**Files:**
- Modify: `tests/stories/http/dashboard.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/http/dashboard.story.test.ts`

**Interfaces:**
- Consumes: authenticated dashboard-session requests from Task 1 and the router contracts in `src/debug/billing-routes.ts`, `src/debug/stats-routes.ts`, and `src/debug/admin-system.ts`.
- Produces: cataloged route coverage for `/billing/subjects`, `/billing/subject/:id`, `/stats/global`, `/stats/subject/:id`, and `/admin/subjects/:id/recent-requests`.

- [ ] **Step 1: Add an operator-data route story**

  Add one scenario that proves anonymous operator data is rejected, then requests each remaining route through a dashboard session. Use existing empty-world behavior for list endpoints and the documented missing-subject contracts for detail endpoints:

  ```typescript
  scenario('SCN-http-operator-data-routes: dashboard data routes preserve authentication and missing-subject contracts', async ({ given, when, then }) => {
    then.responseStatus(await when.request('/billing/subjects'), 401)
    then.responseStatus(await when.request('/admin/subjects/unknown/recent-requests'), 401)

    const session = await given.dashboardSession()
    const subjects = await when.dashboardRequest(session, '/billing/subjects?window=all')
    then.responseStatus(subjects, 200)
    then.responseJson(await subjects.json()).contains('subjects')
    then.responseStatus(await when.dashboardRequest(session, '/billing/subject/unknown?window=all'), 404)

    const global = await when.dashboardRequest(session, '/stats/global?window=30d')
    then.responseStatus(global, 200)
    then.responseJson(await global.json()).contains('window')
    then.responseStatus(await when.dashboardRequest(session, '/stats/subject/unknown'), 404)

    const recent = await when.dashboardRequest(session, '/admin/subjects/unknown/recent-requests?limit=2')
    then.responseStatus(recent, 200)
    then.responseJson(await recent.json()).contains('requests')
  })
  ```

- [ ] **Step 2: Run the focused story against the production router**

  Run: `bun test:stories --fixture tests/stories/http/dashboard.story.test.ts`

  Expected: the command passes when the existing route contracts are correct. If it fails, determine whether the scenario needs supported fixture setup or whether the production route is defective.

- [ ] **Step 3: Make the minimal correction**

  Prefer changing only the response assertion if its expected field is not part of the public response. Preserve these source-owned error contracts:

  ```typescript
  // src/debug/billing-routes.ts
  { error: 'subject not found' } // 404

  // src/debug/stats-routes.ts
  { error: 'subject not found' } // 404

  // src/debug/admin-system.ts
  { subjectId, limit, requests } // 200
  ```

  Only change `src/debug/**` if the route does not honor its existing source contract when called through the production router.

- [ ] **Step 4: Catalog the operator-data scenario**

  Add `SCN-http-operator-data-routes` to `CATALOG_SCENARIO_IDS` and map it to its exact literal scenario string in `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-08-01'`.

- [ ] **Step 5: Run focused verification**

  Run: `bun test:stories:contracts && bun test:stories --fixture tests/stories/http/dashboard.story.test.ts`

  Expected: the catalog census and all dashboard HTTP stories pass.

- [ ] **Step 6: Commit the operator route coverage**

  ```bash
  git add tests/stories/http/dashboard.story.test.ts tests/stories/catalog/coverage.ts
  git commit -m "test(stories): cover operator data routes"
  ```

### Task 3: Invoke Every Exported Debug Parser

**Files:**
- Modify: `tests/stories/http/debug-schemas.story.test.ts`
- Test: `tests/stories/http/debug-schemas.story.test.ts`

**Interfaces:**
- Consumes: `parseStateInitEvent`, `parseStateStatsEvent`, `parseCacheEvent`, `parseUserIdEvent`, `parseSchedulerTickEvent`, and `parsePollerEvent` exported by `src/debug/schemas.ts`.
- Produces: function coverage for all exported `parse*` and `safeParse*` helpers without duplicating the unit test matrix.

- [ ] **Step 1: Add imports and valid parser assertions**

  Extend the import list and append the following contract checks to the existing `SCN-http-debug-schemas` callback:

  ```typescript
  expect(parseStateInitEvent({ sessions: [], wizards: [], recentLlm: [], recentTurns: [] })).toMatchObject({ sessions: [] })
  expect(parseStateStatsEvent({ startedAt: 1, totalMessages: 2, totalLlmCalls: 3, totalToolCalls: 4 })).toMatchObject({
    totalToolCalls: 4,
  })
  expect(parseCacheEvent({ userId: 'alice', field: 'history' })).toMatchObject({ field: 'history' })
  expect(parseUserIdEvent({ userId: 'alice' })).toMatchObject({ userId: 'alice' })
  expect(parseSchedulerTickEvent({ running: true, tickCount: 2 })).toMatchObject({ tickCount: 2 })
  expect(parsePollerEvent({ scheduledRunning: true, alertsRunning: false })).toMatchObject({ alertsRunning: false })
  ```

  Import exactly these names from `../../../src/debug/schemas.js`. Keep the existing invalid-input assertions; do not add tests for internal Zod schema details already covered by `tests/debug/schemas.test.ts`.

- [ ] **Step 2: Run the focused parser story**

  Run: `bun test:stories --fixture tests/stories/http/debug-schemas.story.test.ts`

  Expected: the story passes after every new parser is imported and invoked, proving the existing parser contracts remain compatible with their public schemas.

- [ ] **Step 3: Correct payloads or source only from observed failures**

  If a payload is rejected, align it with the schema in `src/debug/schemas.ts`. For example, `StateInitEventSchema` accepts optional arrays, while `StateStatsEventSchema` accepts optional numeric totals. Do not widen schemas merely to make a synthetic test payload pass.

- [ ] **Step 4: Run focused verification**

  Run: `bun test:stories --fixture tests/stories/http/debug-schemas.story.test.ts && bun test tests/debug/schemas.test.ts`

  Expected: both the end-to-end coverage contract and the existing unit schema suite pass.

- [ ] **Step 5: Commit the parser coverage**

  ```bash
  git add tests/stories/http/debug-schemas.story.test.ts
  git commit -m "test(stories): invoke debug schema parsers"
  ```

### Task 4: Verify Phase Completion And Coverage Gain

**Files:**
- Modify: none unless verification exposes a confirmed defect or catalog omission.
- Test: `tests/stories/http/dashboard.story.test.ts`
- Test: `tests/stories/http/debug-schemas.story.test.ts`

**Interfaces:**
- Consumes: all new stories and catalog mappings from Tasks 1-3.
- Produces: fresh Tier 0 proof that the debug/settings surface remains hermetic, catalog-complete, and above its committed line/function floors.

- [ ] **Step 1: Run story contracts**

  Run: `bun test:stories:contracts`

  Expected: `0 fail`, including the forward and reverse story catalog census.

- [ ] **Step 2: Run the full hermetic story suite**

  Run: `bun test:stories`

  Expected: `0 fail`; verify the new HTTP and schema scenario names appear in the output.

- [ ] **Step 3: Run the T0 coverage gate**

  Run: `bun test:stories:coverage`

  Expected: `T0 story coverage` reports both lines and functions above their committed floors. Inspect `reports/stories/coverage/lcov.info` to confirm `src/debug/schemas.ts` has all exported parser functions hit and that the completed router families are no longer absent from the story coverage report.

- [ ] **Step 4: Run debug unit regression coverage when source changed**

  Run: `bun test tests/debug`

  Expected: `0 fail`. Skip this step only if no production source file changed during Tasks 1-3.

  Do not create a verification-only commit. If any task exposed and fixed a confirmed production defect, it must already have its focused regression test and task-level commit.
