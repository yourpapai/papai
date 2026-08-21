<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug/settings HTTP story coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise hermetic Tier 0 line and function coverage of `src/debug` by adding behavior-focused HTTP stories through the existing `web.route` seam.

**Architecture:** Extend the existing HTTP and settings scenario files where they already own a workflow, and add focused files only for the debug/settings API and unloaded schema contracts. Requests must cross the real `routeRequest` dispatcher using `when.request`, `when.dashboardRequest`, or `when.settingsRequest`; no new production or harness seam is introduced.

**Tech Stack:** Bun test runner, TypeScript, Zod v4, hermetic Tier 0 scenario harness, SQLite scenario fixtures, existing coverage ratchet.

## Global Constraints

- Change story tests and the story coverage floor only; do not modify `src/**`, `client/**`, or `tests/stories/harness/**` unless a separately reviewed product defect makes it necessary.
- Preserve the current `web.route` DI signature and all story-runner hermeticity guarantees: no live network, no retries, no process-env leakage, no new scenario helper.
- Use `.js` import extensions and existing `scenario`, `given`, `when`, and `then` APIs.
- Model routes by trust plane and user workflow; do not create one story per source module or duplicate unit-level branches.
- For rejected writes, read the affected resource afterwards and prove it remains unchanged.
- `src/debug/schemas.ts` is the only direct-import exception because no runtime route imports it.
- Do not lower `scripts/story/coverage-floor.json`; update it only from a green complete coverage run.

---

## File structure

| File                                                      | Responsibility                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/stories/http/dashboard.story.test.ts`              | Dashboard/debug/operator session boundary, debug gate, redirect, and representative protected route contracts.                       |
| `tests/stories/http/auth-claim.story.test.ts`             | Public settings exchange/logout method, validation, replay, and session-rotation workflow.                                           |
| `tests/stories/http/notify.story.test.ts`                 | Notify validation and rejected-delivery non-side-effect behavior.                                                                    |
| `tests/stories/http/debug-schemas.story.test.ts`          | Direct story-lane loading of `src/debug/schemas.ts` with representative parse and safe-parse contracts.                              |
| `tests/stories/settings/debug-settings-api.story.test.ts` | User/group settings API families that lack end-to-end route coverage: tools, BYOK, memory, plugins, MCP, group and release settings. |
| `tests/stories/settings/admin-surfaces.story.test.ts`     | Representative untested admin API workflows and role/CSRF boundaries, reusing existing admin session setup.                          |
| `scripts/story/coverage-floor.json`                       | Ratchet Tier 0 line/function floors upward after all new stories are green.                                                          |

## Task 1: Expand dashboard, debug, and public HTTP route stories

**Files:**

- Modify: `tests/stories/http/dashboard.story.test.ts`
- Modify: `tests/stories/http/auth-claim.story.test.ts`
- Modify: `tests/stories/http/notify.story.test.ts`

**Interfaces:**

- Consumes: `when.request(path, init?)`, `when.dashboardRequest(session, path, init?)`, `given.dashboardSession()`, `given.settingsSession(user)`.
- Produces: scenario coverage of `routeRequest`, `routeProtectedPaths`, `routeAdminPaths`, `routeDebugClientPath`, `routePublicAuthPaths`, `handleSettingsExchange`, `handleSettingsBootstrap`, `handleSettingsLogout`, and `handleNotifyRoute` branches.

- [ ] **Step 1: Write failing dashboard/debug route scenarios**

  In `dashboard.story.test.ts`, add behavior-named scenarios that prove the distinction between debug-gated and dashboard-authorized surfaces, then cover a representative operator route and the legacy redirect. Keep debug-enabled worlds explicit.

  ```ts
  scenario(
    'SCN-http-dashboard-debug-gate: debug paths are hidden when disabled but admin reads remain session-gated',
    async ({ given, when, then }) => {
      then.responseStatus(await when.request('/debug'), 404)
      const session = await given.dashboardSession()
      then.responseStatus(await when.dashboardRequest(session, '/admin'), 200)
      then.responseStatus(await when.dashboardRequest(session, '/dashboard'), 301)
    },
  )
  ```

  Add a second scenario with `{ debugEnabled: true }` that verifies anonymous `/logs` and `/mcp/status` are `401`, authorized `GET /mcp/status` is `200`, and non-GET `/mcp/status` is `405`. Seed only data required for a stable response; do not assert implementation-only fields.

- [ ] **Step 2: Run the dashboard story file and verify the new scenarios fail**

  Run: `bun test:stories --fixture tests/stories/http/dashboard.story.test.ts`

  Expected: the new scenario names fail before their assertions are implemented; existing dashboard scenarios remain green.

- [ ] **Step 3: Implement the minimal story assertions and fixtures**

  Use `given.dashboardSession()` for protected calls and raw `when.request()` for anonymous calls. For each route that returns JSON, assert status plus one stable response-shape field using a small local Zod schema or `then.responseJson`, rather than snapshotting whole operational payloads.

- [ ] **Step 4: Extend auth-claim and notify workflows with validation and no-side-effect checks**

  Add cases to `auth-claim.story.test.ts` for invalid JSON/body, wrong method, one-time-code replay, and logout with/without a valid settings CSRF session. Use a post-logout bootstrap read to establish that the session has been removed.

  ```ts
  const logout = await when.settingsRequest(session, '/settings/auth/logout', { method: 'POST' })
  then.responseStatus(logout, 200)
  then.responseStatus(await when.settingsRequest(session, '/settings/api/bootstrap'), 401)
  ```

  Add invalid notify payload/method cases to `notify.story.test.ts`; after each rejected request, assert the scenario chat has no new proactive reply. Retain the existing successful delivery assertion.

- [ ] **Step 5: Run the affected story files**

  Run each fixture independently: `bun test:stories --fixture tests/stories/http/dashboard.story.test.ts`, then `bun test:stories --fixture tests/stories/http/auth-claim.story.test.ts`, then `bun test:stories --fixture tests/stories/http/notify.story.test.ts`.

  Expected: PASS; each added rejection proves its status and leaves no successful action behind.

- [ ] **Step 6: Commit the public/debug HTTP story increment**

  ```bash
  git add tests/stories/http/dashboard.story.test.ts tests/stories/http/auth-claim.story.test.ts tests/stories/http/notify.story.test.ts
  git commit -m "test(story): cover debug HTTP route boundaries"
  ```

## Task 2: Add a focused user/group settings API story family

**Files:**

- Create: `tests/stories/settings/debug-settings-api.story.test.ts`

**Interfaces:**

- Consumes: settings sessions from `given.settingsSession`, scoped IDs from `world.scopedStorageContextId`, and existing settings endpoint contracts.
- Produces: route-level coverage across `routeSettingsApi` and user/group handler families without new fixtures or production code.

- [ ] **Step 1: Write failing workflows for tools, BYOK, memory, plugins, MCP, group, and release settings**

  Create a licensed story file. Split into coherent scenarios, each combining the authorization boundary, rejected-write invariant, successful write/readback, and one observable downstream effect where the domain has one. Do not place unrelated domains in a single mega-scenario.

  Minimum route coverage is:

  ```ts
  // tools: anonymous 401; missing CSRF 403; PATCH a valid domain permission; GET readback shows it.
  // byok: cross-context update 403; own-context update succeeds; response never contains the submitted secret.
  // memory: invalid action/body is 400 or 422; authorized mutation changes the subsequent GET view.
  // plugins/MCP: invalid configured server or plugin operation is rejected; valid authorized selection/configuration persists.
  // group/release: a member without scope is 403; authorized group administrator updates and reads the group-scoped value.
  ```

  Use exact endpoint names from `src/debug/settings-api-router.ts`. Before coding each workflow, read the corresponding existing unit route test to preserve its public status/body contract. Do not invent endpoint payloads.

- [ ] **Step 2: Run the new file and verify it fails for the intended missing scenarios**

  Run: `bun test:stories --fixture tests/stories/settings/debug-settings-api.story.test.ts`

  Expected: FAIL until every scenario is complete; failures must be request/assertion failures, not undeclared HTTP or resource-leak errors.

- [ ] **Step 3: Complete minimal setup and assertions for each workflow**

  Use existing `given.*` facilities only. For secret-bearing requests, assert that serialized response/event data does not contain the original secret.

  ```ts
  const rejected = await when.settingsRequest(session, endpoint, writeInit, { csrf: false })
  then.responseStatus(rejected, 403)
  const afterRejected = await when.settingsRequest(session, readEndpoint)
  then.responseStatus(afterRejected, 200)
  expect(await afterRejected.json()).toEqual(beforeValue)
  ```

  Adapt `beforeValue` to the route's public response schema; do not compare encrypted database representations.

- [ ] **Step 4: Run the new settings API story file**

  Run: `bun test:stories --fixture tests/stories/settings/debug-settings-api.story.test.ts`

  Expected: PASS with no forbidden network, environment, timer, or resource-leak diagnostics.

- [ ] **Step 5: Commit the user/group settings API stories**

  ```bash
  git add tests/stories/settings/debug-settings-api.story.test.ts
  git commit -m "test(story): cover settings API workflows"
  ```

## Task 3: Extend admin settings coverage through real settings sessions

**Files:**

- Modify: `tests/stories/settings/admin-surfaces.story.test.ts`

**Interfaces:**

- Consumes: `given.settingsAdminSession(user, { superAdmin? })`, ordinary settings sessions, and the admin API routes dispatched by `routeAdminApi`.
- Produces: coverage of representative admin-only handler dispatch, role and CSRF checks, and persisted admin configuration readback.

- [ ] **Step 1: Write failing representative admin workflow scenarios**

  Add one scenario for configuration that is bot-admin scoped and one for a super-admin-only system/instance operation. Each must first exercise anonymous `401`, ordinary-session `403`, and CSRF `403` before its successful write/readback.

  ```ts
  const forbidden = await when.settingsRequest(memberSession, '/settings/api/admin/tool-defaults', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  then.responseStatus(forbidden, 403)
  ```

  Select the exact successful payloads from the matching `tests/debug/settings/**` unit tests. Assert a stable response field and verify the change through the corresponding GET endpoint.

- [ ] **Step 2: Run the admin story file and verify the new scenarios fail**

  Run: `bun test:stories --fixture tests/stories/settings/admin-surfaces.story.test.ts`

  Expected: new scenarios fail only until their setup/assertions are finished; existing coding and roster workflows remain green.

- [ ] **Step 3: Complete the settings-session workflows without exposing secrets**

  Use normal `when.settingsRequest` writes so the real session and CSRF guard run. For an instance/provider path, assert an invalid type/config returns its documented `422`, then assert the valid object is visible in the list/read route. Do not place plaintext credentials in expected response values.

- [ ] **Step 4: Run the admin story file**

  Run: `bun test:stories --fixture tests/stories/settings/admin-surfaces.story.test.ts`

  Expected: PASS; role and CSRF rejection paths do not mutate the eventual readback value.

- [ ] **Step 5: Commit the admin coverage increment**

  ```bash
  git add tests/stories/settings/admin-surfaces.story.test.ts
  git commit -m "test(story): cover admin settings HTTP workflows"
  ```

## Task 4: Load and contract-test debug schemas in the story lane

**Files:**

- Create: `tests/stories/http/debug-schemas.story.test.ts`

**Interfaces:**

- Consumes: `parseWizard`, `parseLlmTrace`, `parseLogEntry`, `safeParseSession`, `safeParseWizard`, `safeParseLlmTrace`, `safeParseTurn`, `safeParseNotification`, and `safeParseToolFailure` from `src/debug/schemas.js`.
- Produces: Tier 0 coverage for `src/debug/schemas.ts` while preserving the direct-import exception's narrow scope.

- [ ] **Step 1: Write a failing schema contract scenario**

  Create a licensed story using `scenario(...)`. Import only the representative public parsers listed above. Parse one valid complete value for each shape family (state/session, trace/log, and turn-related payload) and assert selected stable fields. For invalid inputs, assert `safeParse*` returns `null` and strict `parse*` throws.

  ```ts
  scenario(
    'SCN-http-debug-schemas: debug payload parsers accept valid events and reject malformed payloads',
    async () => {
      expect(parseWizard({ userId: 'alice', currentStep: 1, totalSteps: 3 })).toMatchObject({ userId: 'alice' })
      expect(safeParseWizard({ userId: 42 })).toBeNull()
      expect(() => parseLogEntry({ level: 'info' })).toThrow()
    },
  )
  ```

- [ ] **Step 2: Run the schema story file and verify the direct import is loaded**

  Run: `bun test:stories --fixture tests/stories/http/debug-schemas.story.test.ts`

  Expected: PASS once the contract is complete. Confirm its failure mode is an assertion failure if it is deliberately made invalid, not a route/harness dependency failure.

- [ ] **Step 3: Keep the test compact and independent**

  Remove any duplicate cases that merely restate `tests/debug/schemas.test.ts`. Retain only representative valid parser coverage and explicit safe/strict invalid behavior needed to load all important schema/export paths.

- [ ] **Step 4: Commit the schema story**

  ```bash
  git add tests/stories/http/debug-schemas.story.test.ts
  git commit -m "test(story): load debug schema contracts"
  ```

## Task 5: Verify the complete frozen lane and ratchet coverage

**Files:**

- Modify: `scripts/story/coverage-floor.json`

**Interfaces:**

- Consumes: all frozen story files and `reports/stories/coverage/lcov.info` produced by `bun test:stories:coverage`.
- Produces: a monotonic story coverage floor matching the measured full-lane line/function coverage.

- [ ] **Step 1: Run harness contracts and all stories**

  Run: `bun test:stories:contracts && bun test:stories`

  Expected: PASS. Do not modify frozen harness files in response to failures; diagnose scenario setup or a separately reviewed product defect.

- [ ] **Step 2: Run full story coverage**

  Run: `bun test:stories:coverage`

  Expected: PASS and write `reports/stories/coverage/lcov.info`. Record the measured line/function results for `src/` plus `plugins/`; ensure the `src/debug` gain is approximately four to five percentage points and `schemas.ts` appears as loaded.

- [ ] **Step 3: Raise, never lower, the story coverage floor from the green measurement**

  Run: `bun coverage:ratchet:stories`

  Expected: updates `scripts/story/coverage-floor.json` to measured green values that are greater than or equal to the existing `lines: 0.55` and `functions: 0.53` floors. Inspect the diff and reject any decrease.

- [ ] **Step 4: Re-run coverage against the committed floor**

  Run: `bun test:stories:coverage`

  Expected: PASS with the updated ratchet; the generated `reports/stories/**` files remain ignored.

- [ ] **Step 5: Stage all Phase 2 files, run the repository staged check, and commit the ratchet**

  Run:

  ```bash
  git add tests/stories/http/dashboard.story.test.ts tests/stories/http/auth-claim.story.test.ts tests/stories/http/notify.story.test.ts tests/stories/http/debug-schemas.story.test.ts tests/stories/settings/debug-settings-api.story.test.ts tests/stories/settings/admin-surfaces.story.test.ts scripts/story/coverage-floor.json
  bun check
  ```

  Expected: PASS. Inspect `git diff --staged` to ensure only Phase 2 story files and the monotonic floor change are staged. Then commit the remaining ratchet:

  ```bash
  git add scripts/story/coverage-floor.json
  git commit -m "test(coverage): ratchet debug story coverage"
  ```
