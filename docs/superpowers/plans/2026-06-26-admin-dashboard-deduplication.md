<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Dashboard Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four duplicated admin **control** sections (Plugin Config, System/LLM creds, Groups, Instances) from the `/admin` operator dashboard — UI plus their exclusively-owned client and server code — leaving `/admin` a read-only dashboard, with all admin controls living solely in the settings admin section.

**Architecture:** Settings (`/settings/api/admin/*`) is already the canonical editable home for all four controls EXCEPT the Instances "apply" action (reconciles the live ChatRouter), which exists only in the operator routes and must be migrated to settings first. Each unit removes one section's UI + its exclusive fetchers/schemas/stories/tests + its exclusive server route/handler/tests, and updates the `/admin` nav/registry so the app keeps compiling after every unit.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Svelte 5 SPA, happy-dom client tests. Server route tests under `tests/debug/`, client under `tests/client/admin/`.

**Spec:** `docs/superpowers/specs/2026-06-26-admin-dashboard-deduplication-design.md`

**Conventions:**

- Run server tests: `bun test tests/<path>.test.ts`. Client: `bun test:client <path>`.
- After every unit: `bun run knip` (must be clean — a deleted-but-still-imported symbol fails here), and the relevant suite stays green.
- Strict TS, `.js` import paths. No lint-disable/ts-ignore (hook policy blocks them).
- A removed component/route's tests and `*.stories.svelte` are deleted **with** it (a test for deleted code is removed, not left dangling).
- Commit on `master`.

---

## Critical file disambiguation (read before starting)

There are TWO plugin-config and TWO system/instance stacks — operator vs settings. **Only the operator ones are removed.** Never touch the settings ones.

| Concern             | OPERATOR (remove)                                    | SETTINGS (keep — canonical)                                                             |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Plugin config route | `src/debug/plugin-config-routes.ts`                  | `src/debug/settings/admin/plugin-config-routes.ts` + `src/debug/admin-plugin-config.ts` |
| LLM creds route     | `/admin/llm` handlers in `src/debug/server.ts`       | `src/debug/settings/admin/system-access-routes.ts`                                      |
| Instance routes     | `src/debug/instance-routes.ts` (the `/api/*` router) | `src/debug/settings/admin/instances-routes.ts`                                          |
| Group delete        | `/auth/groups` in `src/debug/server.ts`              | `src/debug/settings/group-routes.ts`                                                    |

**Preserve always:** `src/instances/*`, `src/debug/instance-config-validation.ts`, and `src/debug/instance-route-support.ts`'s `applyPlatformInstances`/`reconcilePlatformInstances`/`InstanceApiDeps` (reused by the migrated settings apply route). Also preserve `/admin/system` (GET), `/admin/subjects/*`, `/admin/identity/mappings` (kept Overview/Stats/Identities views) — but VERIFY `/admin/system` GET is not used solely by the removed System section (Task 2 step 1).

---

## File Structure (what changes)

- **Deleted (client):** `client/admin/sections/{PluginConfigSection,SystemSection,GroupsSection,InstancesSection}.svelte`, `client/admin/components/{PluginConfigForm,CredentialsForm}.svelte`, `client/admin/{plugin-config-fetchers,plugin-config-fetcher-schemas,instance-fetchers,instance-fetcher-schemas}.ts`, and matching `*.stories.svelte` + tests under `tests/client/admin/`.
- **Modified (client):** `client/admin/AdminApp.svelte` (drop 4 imports+renders), `client/admin/components/AdminSidebarPanel.svelte` (drop 4 nav items), `client/admin/admin.svelte.ts` (drop 4 section ids), `client/admin/fetchers.ts` + `client/admin/fetcher-schemas.ts` (prune LLM-cred + group-delete exports, keep the rest).
- **Deleted (server):** `src/debug/plugin-config-routes.ts`, `src/debug/instance-routes.ts`, and the `/admin/llm`, `/admin/plugin-config`, `/auth/groups` branches + their handlers in `src/debug/server.ts`; matching tests under `tests/debug/`.
- **Modified (server):** `src/debug/server.ts` (remove route branches + handler fns + now-unused imports), `src/debug/settings/admin/instances-routes.ts` (ADD apply route).
- **Added (server+client):** settings apply route + fetcher + Apply button (Unit 4).
- **Docs:** `CLAUDE.md`, deployment docs referencing `/admin#system`/`/admin#instances`.

---

## Unit 1 — Remove Plugin Config (clean removal)

**Files:**

- Delete: `client/admin/sections/PluginConfigSection.svelte`, `client/admin/components/PluginConfigForm.svelte`, `client/admin/plugin-config-fetchers.ts`, `client/admin/plugin-config-fetcher-schemas.ts`, plus any `*.stories.svelte` for those, and tests `tests/client/admin/plugin-config-fetchers.test.ts`, `tests/client/admin/plugin-config-fetcher-schemas.test.ts`.
- Delete: `src/debug/plugin-config-routes.ts` (OPERATOR) + `tests/debug/plugin-config-routes.test.ts`.
- Modify: `src/debug/server.ts`, `client/admin/AdminApp.svelte`, `client/admin/components/AdminSidebarPanel.svelte`, `client/admin/admin.svelte.ts`.

- [ ] **Step 1: Confirm exclusivity**

Run: `grep -rn "plugin-config-routes\|handleAdminPluginConfigGet\|handleAdminPluginConfigPost" src/ --include=*.ts | grep -v "settings/admin/plugin-config-routes\|admin-plugin-config"`
Expected: references only in `src/debug/server.ts` and the operator `plugin-config-routes.ts`. (If anything else imports them, stop and report.)

- [ ] **Step 2: Remove the server route + handlers**

In `src/debug/server.ts`, delete the branch:

```ts
if (url.pathname === '/admin/plugin-config') {
  if (req.method === 'GET') return handleAdminPluginConfigGet()
  if (req.method === 'POST') return handleAdminPluginConfigPost(req)
  return new Response('Method not allowed', { status: 405 })
}
```

Then remove the now-unused `import { handleAdminPluginConfigGet, handleAdminPluginConfigPost } from './plugin-config-routes.js'` line and delete `src/debug/plugin-config-routes.ts` + its test.

- [ ] **Step 3: Delete the client section + form + fetchers + tests**

```bash
git rm client/admin/sections/PluginConfigSection.svelte \
       client/admin/components/PluginConfigForm.svelte \
       client/admin/plugin-config-fetchers.ts \
       client/admin/plugin-config-fetcher-schemas.ts \
       tests/client/admin/plugin-config-fetchers.test.ts \
       tests/client/admin/plugin-config-fetcher-schemas.test.ts
# also remove any matching *.stories.svelte if present:
git rm -f client/admin/sections/PluginConfigSection.stories.svelte client/admin/components/PluginConfigForm.stories.svelte 2>/dev/null || true
```

- [ ] **Step 4: De-register from the `/admin` app**

In `client/admin/admin.svelte.ts` remove `{ id: 'plugin-config', label: 'Plugin Config' },` from `adminSections`.
In `client/admin/components/AdminSidebarPanel.svelte` remove the `{ id: 'plugin-config', label: 'Plugin Config' }` nav item.
In `client/admin/AdminApp.svelte` remove `import PluginConfigSection from './sections/PluginConfigSection.svelte'` and the `<PluginConfigSection />` render line.

- [ ] **Step 5: Verify build/lint/knip + tests**

Run: `bun run knip` → clean. `bun test:client` → green. `bun test tests/debug/` → green (operator plugin-config route test is gone; settings `tests/debug/admin-plugin-config.test.ts` and `tests/debug/settings/...` still pass).
Expected: no references to deleted symbols; no orphaned exports.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(admin): remove duplicate Plugin Config section from operator dashboard"
```

---

## Unit 2 — Remove System / LLM creds (parity already satisfied)

Parity check 1 is **already satisfied**: settings `AdminSystemSection` edits every key the server returns, and `src/debug/settings/admin/system-access-routes.ts` accepts exactly `['llm_apikey','llm_baseurl','main_model','small_model','embedding_model']` with `llm_apikey` masked. No migration needed.

**Files:**

- Delete: `client/admin/sections/SystemSection.svelte`, `client/admin/components/CredentialsForm.svelte`, their `*.stories.svelte`, and any client tests for them under `tests/client/admin/`.
- Modify: `client/admin/fetchers.ts` (remove only the LLM-cred fetchers, e.g. `fetchLlmConfig`/`saveLlmConfig` — keep the rest), `client/admin/fetcher-schemas.ts` (remove the LLM-cred schemas if exclusive).
- Modify: `src/debug/server.ts` (remove `/admin/llm` branch + `handleAdminLlmGet`/`handleAdminLlmPost`).
- Delete: `tests/debug/admin-llm-route.test.ts`, `tests/debug/admin-llm.test.ts`.
- Modify nav/registry/app as in Unit 1.

- [ ] **Step 1: VERIFY `/admin/system` GET is not used only by the removed System section**

Run: `grep -rn "/admin/system\b\|handleAdminSystem\b\|fetchAdminSystemOverview\|/admin/system'" client/admin src/debug | grep -v "settings"`
Decide:

- If `/admin/system` GET is consumed by a KEPT view (e.g. Overview/Stats), KEEP the `/admin/system` branch + `handleAdminSystem`.
- If it is consumed ONLY by the removed `SystemSection`/`CredentialsForm`, ALSO remove the `/admin/system` GET branch + `handleAdminSystem` + any exclusive test.
  Record which case applies in the commit message.

- [ ] **Step 2: Remove the `/admin/llm` server route + handlers**

In `src/debug/server.ts` delete:

```ts
if (url.pathname === '/admin/llm') {
  if (req.method === 'GET') return handleAdminLlmGet()
  if (req.method === 'POST') return handleAdminLlmPost(req)
  return new Response('Method not allowed', { status: 405 })
}
```

Remove `handleAdminLlmGet`/`handleAdminLlmPost` (and `handleAdminSystem` only if Step 1 said so) and their now-unused imports. Delete `tests/debug/admin-llm-route.test.ts` and `tests/debug/admin-llm.test.ts`.

- [ ] **Step 3: Delete client section + form + prune fetchers**

```bash
git rm client/admin/sections/SystemSection.svelte client/admin/components/CredentialsForm.svelte
git rm -f client/admin/sections/SystemSection.stories.svelte client/admin/components/CredentialsForm.stories.svelte 2>/dev/null || true
```

In `client/admin/fetchers.ts` remove the LLM-cred functions (identify with `grep -n "llm\|Llm\|/admin/llm" client/admin/fetchers.ts`) and any now-unused imports. In `client/admin/fetcher-schemas.ts` remove the LLM-cred schemas if they are no longer imported anywhere (`grep -rn "<SchemaName>" client/admin`).

- [ ] **Step 4: De-register from the `/admin` app**

Remove `{ id: 'system', label: 'System' }` from `client/admin/admin.svelte.ts` `adminSections`; remove the System nav item from `AdminSidebarPanel.svelte`; remove the `SystemSection` import + `<SystemSection />` render from `AdminApp.svelte`.

- [ ] **Step 5: Verify**

Run: `bun run knip` → clean; `bun test:client` → green; `bun test tests/debug/` → green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(admin): remove duplicate System (LLM creds) section from operator dashboard"
```

---

## Unit 3 — Remove Groups (clean removal)

Settings `AdminGroupsSection` is a superset (authorize + remove) of the operator group-delete. No migration needed.

**Files:**

- Delete: `client/admin/sections/GroupsSection.svelte` + its `*.stories.svelte` + any client test.
- Modify: `client/admin/fetchers.ts` (remove the group-delete fetcher hitting `/auth/groups/{id}`).
- Modify: `src/debug/server.ts` (remove `/auth/groups` + `/auth/groups/{id}` branches + `handleAuthGroups`).
- Delete: `tests/debug/auth-groups-route.test.ts`.
- Nav/registry/app updates.

- [ ] **Step 1: VERIFY `handleAuthGroups` / `removeAuthorizedGroup` ownership**

Run: `grep -rn "handleAuthGroups\|removeAuthorizedGroup\|/auth/groups" src/ --include=*.ts | grep -v test`

- `handleAuthGroups` should be referenced only in `src/debug/server.ts` → safe to remove.
- `removeAuthorizedGroup` is a store function (`src/...`) that the SETTINGS group route (`src/debug/settings/group-routes.ts`) likely also calls — **do NOT delete the store function**, only the `/auth/groups` HTTP branch and `handleAuthGroups`. Confirm `removeAuthorizedGroup` has a remaining caller (settings) before finishing.

- [ ] **Step 2: Remove the server branches**

In `src/debug/server.ts` delete:

```ts
if (url.pathname === '/auth/groups') return handleAuthGroups()
if (url.pathname.startsWith('/auth/groups/')) {
  const groupId = decodeURIComponent(url.pathname.slice('/auth/groups/'.length))
  if (req.method === 'DELETE') return jsonResponse({ removed: removeAuthorizedGroup(groupId) })
  return new Response('Method not allowed', { status: 405 })
}
```

Remove `handleAuthGroups` and its now-unused import; keep `removeAuthorizedGroup` if Step 1 confirmed a settings caller (else also drop its import here only). Delete `tests/debug/auth-groups-route.test.ts`.

- [ ] **Step 3: Delete client section + prune fetcher**

```bash
git rm client/admin/sections/GroupsSection.svelte
git rm -f client/admin/sections/GroupsSection.stories.svelte 2>/dev/null || true
```

In `client/admin/fetchers.ts` remove the group-delete function (`grep -n "/auth/groups\|deleteGroup\|removeGroup" client/admin/fetchers.ts`).

- [ ] **Step 4: De-register from the `/admin` app**

Remove `{ id: 'groups', label: 'Groups' }` from `adminSections`; remove the Groups nav item from `AdminSidebarPanel.svelte`; remove the `GroupsSection` import + render from `AdminApp.svelte`.

- [ ] **Step 5: Verify**

Run: `bun run knip` → clean; `bun test:client` → green; `bun test tests/debug/` → green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(admin): remove duplicate Groups section from operator dashboard"
```

---

## Unit 4 — Migrate Instances "apply" into settings (build-up, BEFORE removal)

The operator Instances UI has an apply action (`POST /api/platform-instances/apply`) that reconciles the live ChatRouter; settings has no equivalent. Add it to settings so removing the operator route loses nothing. This unit ADDS only — it does not delete anything yet.

**Files:**

- Modify: `src/debug/settings/admin/instances-routes.ts` (add an apply route).
- Modify: `client/settings/admin-fetchers.ts` (add `applyAdminPlatformInstances` fetcher) + its response schema in `client/settings/fetcher-schemas*.ts`.
- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte` (add an Apply button).
- Test: `tests/debug/settings/admin/instances-routes.test.ts` (confirm path with `ls`), `tests/client/settings/...AdminInstancesSection...`.

- [ ] **Step 1: Locate the runtime-router source the operator apply uses**

Run: `sed -n '50,60p' src/debug/instance-routes.ts` and `grep -n "getRuntimeChatRouter\|defaultDeps\|InstanceApiDeps" src/debug/instance-routes.ts src/debug/instance-route-support.ts`.
You will reuse `applyPlatformInstances(deps)` from `src/debug/instance-route-support.ts` with a `deps` whose `getRuntimeChatRouter` is the SAME source `defaultDeps` uses. Note that exact symbol (e.g. a `getRuntimeChatRouter()` exported from a runtime module). If `defaultDeps` is defined inline in `instance-routes.ts` (which is being removed in Unit 5), extract its `getRuntimeChatRouter` wiring into `instance-route-support.ts` as an exported `defaultInstanceApiDeps` so both the (temporary) operator route and the new settings route share it.

- [ ] **Step 2: Write the failing settings-route test**

In `tests/debug/settings/admin/instances-routes.test.ts` add a test that POSTs to the new apply path with an admin session + CSRF and asserts a 200 with the apply-result shape. Mirror the existing admin instance-route tests' session/CSRF setup. Inject a fake `getRuntimeChatRouter` via the route's deps (mirror how the operator `instance-routes.test.ts` injects `InstanceApiDeps`).

```ts
test('POST /settings/api/admin/platform-instances/apply reconciles and returns a result', async () => {
  // establish admin session (see sibling tests), then:
  const res = await handleAdminInstancesRoutes(
    new Request('https://x/settings/api/admin/platform-instances/apply', {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
    }),
    new URL('https://x/settings/api/admin/platform-instances/apply'),
    /* deps with a fake getRuntimeChatRouter returning a stub router */,
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toHaveProperty('applied')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/debug/settings/admin/instances-routes.test.ts`
Expected: FAIL (route/path not handled yet).

- [ ] **Step 4: Implement the settings apply route**

In `src/debug/settings/admin/instances-routes.ts`, add (after the existing auth/CSRF/admin guards used by sibling write routes) a branch handling `POST /settings/api/admin/platform-instances/apply` that calls `applyPlatformInstances(deps)` from `../../instance-route-support.js` and returns its `Response`. Use the same `requireAdmin(authed,'write')` + `requireCsrf` gate the other write routes in this file use. Wire `deps` from the shared `defaultInstanceApiDeps` (Step 1).

```ts
import { applyPlatformInstances, defaultInstanceApiDeps } from '../../instance-route-support.js'
// ...inside the router, after auth+csrf+requireAdmin('write'):
if (pathname === '/settings/api/admin/platform-instances/apply' && req.method === 'POST') {
  return applyPlatformInstances(defaultInstanceApiDeps)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/debug/settings/admin/instances-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the settings fetcher + Apply button (+ client test)**

In `client/settings/admin-fetchers.ts`:

```ts
export const applyAdminPlatformInstances = (): Promise<ApplyInstancesResult> =>
  writeJson('/settings/api/admin/platform-instances/apply', 'POST', {}, (b) => ApplyInstancesResultSchema.parse(b))
```

Add/port `ApplyInstancesResult`/`ApplyInstancesResultSchema` into the settings fetcher-schemas (copy the shape from `client/admin/instance-fetcher-schemas.ts` — it is being deleted in Unit 5, so the settings copy becomes canonical). In `client/settings/sections/admin/AdminInstancesSection.svelte` add an "Apply platform changes" button (testid `admin-instances-apply`) that calls `applyAdminPlatformInstances()` then refreshes the list, mirroring the operator section's apply UX (read `client/admin/sections/InstancesSection.svelte` `applyPlatforms()` for the result/error handling pattern). Add a client test (module-level mock fn, no inline `if` in tests) asserting the button POSTs to the apply endpoint.

- [ ] **Step 7: Verify + commit**

Run: `bun run knip` → clean; `bun test tests/debug/settings/admin/instances-routes.test.ts` + the client test → green.

```bash
git add -A
git commit -m "feat(settings): migrate platform-instance apply (live router reconcile) into settings admin"
```

---

## Unit 5 — Remove operator Instances UI + `/api/*` routes (teardown)

Now that settings has create/update/delete (pre-existing) **and** apply (Unit 4), remove the operator Instances surface.

**Files:**

- Delete: `client/admin/sections/InstancesSection.svelte`, `client/admin/instance-fetchers.ts`, `client/admin/instance-fetcher-schemas.ts`, `*.stories.svelte`, and tests `tests/client/admin/instance-fetcher-schemas.test.ts` (+ any `instance-fetchers` test).
- Delete: `src/debug/instance-routes.ts` (the `/api/*` HTTP router) + `tests/debug/instance-routes.test.ts`.
- Modify: `src/debug/server.ts` (remove the `handleInstanceApiRoute` import + the `instanceApiResponse` dispatch at lines ~243-244).
- Modify: `src/debug/instance-route-support.ts` — keep `applyPlatformInstances`/`reconcilePlatformInstances`/`InstanceApiDeps`/`defaultInstanceApiDeps`; remove only helpers that become unused after `instance-routes.ts` is gone (let `knip` identify them). KEEP `tests/debug/instance-route-support.test.ts` for the retained apply/reconcile logic; delete only assertions covering removed helpers.
- Nav/registry/app updates.

- [ ] **Step 1: Remove the operator `/api/*` dispatch from server.ts**

In `src/debug/server.ts` delete:

```ts
const instanceApiResponse = await handleInstanceApiRoute(req, url)
if (instanceApiResponse !== null) return instanceApiResponse
```

and the `import { handleInstanceApiRoute } from './instance-routes.js'`. Then `git rm src/debug/instance-routes.ts tests/debug/instance-routes.test.ts`.

- [ ] **Step 2: Delete the operator client Instances surface**

```bash
git rm client/admin/sections/InstancesSection.svelte \
       client/admin/instance-fetchers.ts \
       client/admin/instance-fetcher-schemas.ts \
       tests/client/admin/instance-fetcher-schemas.test.ts
git rm -f client/admin/sections/InstancesSection.stories.svelte 2>/dev/null || true
```

- [ ] **Step 3: De-register from the `/admin` app**

Remove `{ id: 'instances', label: 'Instances' }` from `adminSections`; remove the Instances nav item from `AdminSidebarPanel.svelte`; remove the `InstancesSection` import + render from `AdminApp.svelte`.

- [ ] **Step 4: Prune now-unused support helpers**

Run: `bun run knip`. For each unused export it reports in `src/debug/instance-route-support.ts` that belonged to the removed CRUD routes (NOT the apply/reconcile path), remove it and its dead branch in `tests/debug/instance-route-support.test.ts`. Re-run until knip is clean. **Stop if knip flags `applyPlatformInstances`/`reconcilePlatformInstances`/`defaultInstanceApiDeps` as unused** — that means the settings apply wiring from Unit 4 is broken; fix the wiring instead of deleting.

- [ ] **Step 5: Verify**

Run: `bun run knip` → clean; `bun test:client` → green; `bun test tests/debug/` → green; `bun test tests/debug/settings/admin/instances-routes.test.ts` → green (settings apply still works).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(admin): remove operator Instances UI and /api/* instance routes"
```

---

## Unit 6 — Docs + final sweep

**Files:** `CLAUDE.md`, deployment docs, plus a final whole-repo verification.

- [ ] **Step 1: Update CLAUDE.md**

Search `CLAUDE.md` for the operator-surface references and update them so admin cred/instance/group/plugin-config management points at the **settings** admin section, and state `/admin` is now a read-only dashboard. Specifically revise the lines mentioning:

- `/admin#system` (LLM creds via `GET`/`POST /admin/llm`, `llm_apikey` masked) → now settings AdminSystemSection (`/settings/api/admin/system`).
- `/admin#instances` (`/api/platform-instances`, `/api/task-instances`, `/api/admins`) → now settings AdminInstancesSection; apply is `/settings/api/admin/platform-instances/apply`.
- Any mention of the operator group-delete (`/auth/groups`) and operator plugin-config.
  Keep the descriptions of the kept read-only views (Overview/Billing/Stats/Memos/Reminders/Identities).

Run: `grep -rn "/admin#system\|/admin/llm\|/admin#instances\|/api/platform-instances\|/api/task-instances\|/auth/groups\|/admin/plugin-config" CLAUDE.md docs/` and update or remove each stale reference (do NOT touch the spec/plan files under `docs/superpowers/`).

- [ ] **Step 2: Final full verification**

Run, in order:

- `bun run knip` → clean.
- `bun run test` → all server suites green.
- `bun test:client` → green.
- `bun check:full` → 12/12.
  Report totals. Fix any failure caused by this work (e.g. a missed import); do not chase unrelated pre-existing failures (report them).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Note in the PR/commit that the `/admin` dashboard now shows only Overview/Billing/Stats/Memos/Reminders/Identities, and that System/Instances/Groups/Plugin-Config are managed exclusively in the settings admin section.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(admin): point admin controls at settings; /admin is now read-only dashboard"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Plugin Config (U1), System (U2), Groups (U3), Instances apply-migration (U4) + removal (U5), nav/registry pruning folded into each unit, docs (U6). The spec's two parity checks: System parity confirmed already-satisfied (U2 preamble); Instances "apply" gap is real and migrated in U4 before removal in U5. Preserve-list (instances/\*, instance-config-validation, instance-route-support apply path, /admin/system|subjects|identity) is enforced via explicit verify steps + knip.
- **Ordering:** removals keep the app compiling because each unit drops the section's import/render/registry id in the same commit. Instances migration (U4) strictly precedes Instances teardown (U5).
- **Runtime-dependent decisions** are written as explicit verify-then-branch steps with concrete rules (U2S1 `/admin/system` GET ownership; U3S1 `removeAuthorizedGroup` reuse; U5S4 knip-driven helper pruning), not placeholders.
- **Type consistency:** `applyPlatformInstances`/`reconcilePlatformInstances`/`InstanceApiDeps`/`defaultInstanceApiDeps` (shared, in instance-route-support.ts); settings fetcher `applyAdminPlatformInstances` + `ApplyInstancesResult`/`ApplyInstancesResultSchema` (ported to settings); testids `admin-instances-apply`.
- **Paths to confirm at execution time:** the exact `tests/client/admin/` files for SystemSection/GroupsSection/InstancesSection (delete only those that exist), `*.stories.svelte` presence per component, and the settings instances test path — each step uses `ls`/`grep` first.
