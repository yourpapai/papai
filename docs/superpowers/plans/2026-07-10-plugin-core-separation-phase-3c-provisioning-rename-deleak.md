<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3c — Provisioning Rename (`kaneoUrl`→`instanceUrl`) + De-leak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task-provider provisioning flow provider-agnostic: rename the `kaneoUrl` outcome field to `instanceUrl` across backend + the frontend JSON contract, and fix two kaneo-specific leaks — the manual provision route reading global `KANEO_CLIENT_URL`/`KANEO_INTERNAL_URL` env vars, and the credentials route gating on `instance.type !== 'kaneo'`.

**Architecture:** Provisioning is never invoked from the kernel — it flows HTTP route → `getTaskProviderProvision(type)`, which is already generic-by-type. So this phase needs **no new port machinery** (decided): the provisioning contract stays in `src/providers/registry.ts` (`TaskProviderProvisionOutcome`/`TaskProviderProvisionContext`/`TaskProviderProvision`), and we simply rename its `kaneoUrl` field so the core type stops naming a provider. The env leak is fixed by sourcing the provision URLs from the bound `taskInstance.config['baseUrl']`/`['internalUrl']` (the sibling auto-provision path already does exactly this). The type hardcode is replaced with the existing `members.provision` capability. Route paths, Svelte-section rewrites, and the `credentials:Record` collapse are explicitly deferred to §9.5.

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions); Zod v4; Svelte; `bun:test` + client/visual tests.

---

## Context for the implementer (read before starting)

- **Scope discipline.** This phase is a **field rename + two de-leaks**. Do NOT: rename route PATHS (`/settings/api/provision/kaneo`, `/kaneo/credentials`), rewrite the Svelte sections into descriptors, collapse `email`/`password`/`apiKey`/`workspaceId` into a `credentials` record, relocate the route files into `src/modules/task-tracker/`, or touch `src/instances/kaneo-legacy-repair.ts` — all are later phases (§9.5 / §9.6).
- **Behavior change (intended, isolated to Task 2):** fixing the env leak makes the manual "Provision" button use the _bound instance's_ URL instead of the global env var. Behavior-identical for the common single-default-instance deployment; a **bug fix** for multi-instance deployments (previously the button silently used the wrong global URL). Call this out in Task 2's commit message.
- **The easy-to-miss rename site:** `plugins/task-provider-kaneo/index.ts:~25` has an inline _structural_ type mirror `TaskProviderProvisionLike` with `kaneoUrl` — it is NOT imported from core and NO compile error will catch it if missed (it's checked via a loose runtime guard). Rename it in lockstep in Task 1.
- **Coupling:** `plugins/task-provider-kaneo/auto-provision.ts:~12` assigns the plugin's `ProvisionOutcome` to core's `TaskProviderProvision` type — so the core type rename (`registry.ts`) and the plugin rename (`provision.ts`) MUST land in the same commit (Task 1), or typecheck breaks.
- **Architecture guard** scans only `src/ports/**` — none of these files are scanned, so the rename won't trip it (run it anyway to confirm green). The file names `provision-routes.ts`/`kaneo-credentials-routes.ts` and the `handleProvisionKaneo` identifier legitimately keep "kaneo" for now (route-layer rename is §9.5).
- **Config access is plaintext-readable:** the working `getKaneoPublicUrl` already reads `instance.config['baseUrl']` directly (no decryption) — mirror that exactly.

### Verified snippets

`src/providers/registry.ts:33-41` (the rename target):

```ts
export type TaskProviderProvisionOutcome =
  | { status: 'provisioned'; email: string; password: string; kaneoUrl: string; apiKey: string; workspaceId: string }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }
```

`getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability>` (`registry.ts:140-144`) — **throws** `Unknown provider` if the type isn't registered.
`src/debug/settings/provision-routes.ts:28-45` `outcomeToResponse` emits `kaneoUrl: outcome.kaneoUrl` (line 36); `:80-81` reads the env vars; `:82-87` calls `provision({ contextId, username, publicUrl, internalUrl })`.
`plugins/task-provider-kaneo/provision-messages.ts:6` `formatKaneoProvisionedMessage(outcome: { kaneoUrl: string; email; password })` interpolates `${outcome.kaneoUrl}`.

---

## File Structure

No new files. Modify: `src/providers/registry.ts`, `src/debug/settings/provision-routes.ts`, `src/debug/settings/kaneo-credentials-routes.ts`, `plugins/task-provider-kaneo/{provision.ts,provision-messages.ts,index.ts}`, the client (`client/settings/fetcher-schemas.ts`, `fetcher-schemas-kaneo.ts`, `sections/TaskProviderSection.svelte`, `sections/KaneoAccessSection.svelte`, `client/stories/msw/settings-handlers.ts`), the docs (`README.md`, `docs/architecture/environment.md`, `.env.example`), and their tests.

---

## Task 1: Rename the provisioning-outcome field `kaneoUrl` → `instanceUrl` (backend)

Renames the core type + all backend producers of the `/provision/kaneo` response. Behavior-preserving (internal + response field name only). The frontend for this contract is renamed in Task 4.

**Files:**

- Modify: `src/providers/registry.ts`, `src/debug/settings/provision-routes.ts`, `plugins/task-provider-kaneo/provision.ts`, `plugins/task-provider-kaneo/provision-messages.ts`, `plugins/task-provider-kaneo/index.ts`
- Modify (tests): `tests/plugins/task-provider-kaneo/provision.test.ts`, `tests/debug/settings/provision-routes.test.ts`

- [ ] **Step 1: Rename in `src/providers/registry.ts`**

In `TaskProviderProvisionOutcome` (the `status: 'provisioned'` variant), rename `kaneoUrl: string` → `instanceUrl: string`. Nothing else in registry.ts references the field.

- [ ] **Step 2: Rename in `src/debug/settings/provision-routes.ts`**

In `outcomeToResponse` (line ~36): `kaneoUrl: outcome.kaneoUrl` → `instanceUrl: outcome.instanceUrl`. (Do NOT touch lines 80-81 yet — that's Task 2.)

- [ ] **Step 3: Rename in the kaneo plugin (three files — the coupled producer)**

- `plugins/task-provider-kaneo/provision.ts`: in the internal `ProvisionOutcome` type (~line 190) rename `kaneoUrl: string` → `instanceUrl: string`; at the build site (~line 224) `const kaneoUrl = normalizedConfig.publicUrl` → `const instanceUrl = normalizedConfig.publicUrl`; at the return (~line 238) `kaneoUrl,` → `instanceUrl,`. Update any other in-file reference to the local `kaneoUrl` variable (e.g. the `formatKaneoProvisionedMessage(outcome)` call passes the whole `outcome` object — no change needed there beyond the field rename, but verify).
- `plugins/task-provider-kaneo/provision-messages.ts`: `formatKaneoProvisionedMessage(outcome: { kaneoUrl: string; ... })` → `{ instanceUrl: string; ... }`, and the template `${outcome.kaneoUrl}` → `${outcome.instanceUrl}`. (Keep the user-facing "Kaneo account" wording — that's a chat message, not a core contract; §9.5 territory.)
- `plugins/task-provider-kaneo/index.ts` (~line 25): the inline structural mirror `TaskProviderProvisionLike` — rename its `kaneoUrl: string` → `instanceUrl: string`. **This is the easy-to-miss one** (no compile error catches it). After editing, `rg -n "kaneoUrl" plugins/task-provider-kaneo/` → ZERO hits.

- [ ] **Step 4: Update the backend tests**

- `tests/plugins/task-provider-kaneo/provision.test.ts` (~line 681): `expect(outcome.kaneoUrl).toBe(...)` → `expect(outcome.instanceUrl).toBe(...)`.
- `tests/debug/settings/provision-routes.test.ts` (~line 117): the mock provisioned outcome `kaneoUrl: 'https://k.example.com'` → `instanceUrl: 'https://k.example.com'`. Also check whether the test asserts the RESPONSE body's `kaneoUrl` field — if so, rename that assertion to `instanceUrl`. Do NOT change assertion values.

- [ ] **Step 5: Verify**

Run: `rg -n "kaneoUrl" src plugins` → the ONLY remaining hits should be in `src/debug/settings/kaneo-credentials-routes.ts` (the separate credentials route — that's Task 3) and possibly `src/providers/builtin-descriptors.ts`/comments (prose). ZERO in registry.ts, provision-routes.ts, or the kaneo plugin.
Run: `bun run typecheck` (clean — proves the plugin/core type coupling still matches), `bun test tests/plugins/task-provider-kaneo/ tests/debug/settings/provision-routes.test.ts` → PASS, `bun test tests/architecture-guard.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/registry.ts src/debug/settings/provision-routes.ts \
  plugins/task-provider-kaneo/provision.ts plugins/task-provider-kaneo/provision-messages.ts plugins/task-provider-kaneo/index.ts \
  tests/plugins/task-provider-kaneo/provision.test.ts tests/debug/settings/provision-routes.test.ts
git commit -m "refactor(providers): rename provisioning outcome kaneoUrl -> instanceUrl (backend)"
```

---

## Task 2: De-leak the manual provision route (env vars → bound instance config)

The one intended behavior change (bug fix for multi-instance).

**Files:**

- Modify: `src/debug/settings/provision-routes.ts`, `tests/debug/settings/provision-routes.test.ts`, `README.md`, `docs/architecture/environment.md`, `.env.example`

- [ ] **Step 1: Write the failing characterization test**

In `tests/debug/settings/provision-routes.test.ts`, add a test that pins the NEW behavior (the existing "dispatches to the registry provision hook" test uses `config: {}` and asserts `publicUrl`/`internalUrl` are `undefined`, which passes either way — it does not pin config-sourcing). Add:

```ts
test('sources publicUrl/internalUrl from the bound instance config (not env vars)', async () => {
  // KANEO_CLIENT_URL / KANEO_INTERNAL_URL are intentionally NOT set here.
  delete process.env['KANEO_CLIENT_URL']
  delete process.env['KANEO_INTERNAL_URL']
  const provisionCalls: Array<{ publicUrl: string | undefined; internalUrl: string | undefined }> = []
  // register a fake provider whose provision() records the args (mirror the existing test's harness)
  // ...bind an active task instance with config { baseUrl: 'https://pub.example', internalUrl: 'https://int.example' }...
  // ...POST /settings/api/provision/kaneo...
  expect(provisionCalls[0]?.publicUrl).toBe('https://pub.example')
  expect(provisionCalls[0]?.internalUrl).toBe('https://int.example')
})
```

Fill in the harness by mirroring the EXISTING test in that file that registers a fake provision hook + binds a task instance (read it and reuse its helpers: how it registers the provider type, inserts the task instance with a `config`, sets context settings, and posts the request). Run it → it should FAIL against the current code (which reads env, so `publicUrl` would be `undefined` since env is unset).

- [ ] **Step 2: Fix the leak in `src/debug/settings/provision-routes.ts`**

Replace lines ~80-81:

```ts
const publicUrl = process.env['KANEO_CLIENT_URL']
const internalUrl = process.env['KANEO_INTERNAL_URL']
```

with sourcing from the bound instance config (mirroring `getKaneoPublicUrl` in `kaneo-credentials-routes.ts` and the auto-provision path):

```ts
const publicUrl = taskInstance.config['baseUrl']
const internalUrl = taskInstance.config['internalUrl']
```

(`taskInstance` is already resolved above at line ~67. `taskInstance.config['baseUrl']` is `string | undefined`, matching the `provision()` context's `publicUrl: string | undefined`.) Confirm no other line in the file references the env vars afterward.

- [ ] **Step 3: Run tests**

Run: `bun test tests/debug/settings/provision-routes.test.ts` → PASS (the new test now passes; the pre-existing tests still pass). If the pre-existing test had vestigial env scaffolding (`const originalUrl = process.env['KANEO_CLIENT_URL']` / `delete` / restore in `afterEach`) that only existed because the route read env, remove it — the route no longer touches env. Do NOT remove env scaffolding that other tests in the file legitimately need.
Run: `bun run typecheck` → clean.

- [ ] **Step 4: Update the env docs (they currently document the leak as expected)**

- `docs/architecture/environment.md:~32`: reword the note that says `KANEO_CLIENT_URL`/`KANEO_INTERNAL_URL` are "still read at runtime by the Kaneo provisioning route" — they are now bootstrap-only (read solely by `src/instances/kaneo-legacy-repair.ts` when creating the default instance); the provisioning route sources from the bound instance config.
- `README.md:~289,603` and `.env.example:~56-61`: update any prose/comment stating the provisioning route reads these env vars at runtime, to reflect they are bootstrap-only. Keep the vars documented (legacy-repair still uses them); only correct the "read at runtime by the provision route" claim. Verify with `rg -n "KANEO_CLIENT_URL|KANEO_INTERNAL_URL" README.md docs/architecture/environment.md .env.example` and reword each stale runtime claim.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/provision-routes.ts tests/debug/settings/provision-routes.test.ts \
  README.md docs/architecture/environment.md .env.example
git commit -m "fix(provisioning): source provision URLs from bound instance config, not global env (multi-instance fix)"
```

---

## Task 3: De-kaneo the credentials-URL route (capability gate + field rename)

**Files:**

- Modify: `src/debug/settings/kaneo-credentials-routes.ts`, `tests/debug/settings/kaneo-credentials-routes.test.ts`

- [ ] **Step 1: Update the tests first**

In `tests/debug/settings/kaneo-credentials-routes.test.ts`: the local `GetResponseSchema` mirror (~line 28) `kaneoUrl: z.string().nullable().optional()` → `instanceUrl: ...`; any assertion reading `.kaneoUrl` → `.instanceUrl`. Also check whether a test binds a NON-kaneo instance or relies on `type === 'kaneo'` gating — if so, it should now assert the gate is by capability (a `members.provision`-capable instance returns the URL; a non-capable one returns null). Add a focused test if the file lacks one: an instance whose provider lacks `members.provision` yields `instanceUrl: null`. Run → the ones referencing the renamed field FAIL against current code.

- [ ] **Step 2: Fix `getKaneoPublicUrl` in `src/debug/settings/kaneo-credentials-routes.ts`**

Replace the `instance.type !== 'kaneo'` gate with a capability check, and rename the function + response field. Import `getCapabilitiesForTaskInstance` from `../../providers/registry.js` and `type TaskCapability` if needed:

```ts
function getInstancePublicUrl(groupContextId: string): string | null {
  const settings = getContextSettings(groupContextId)
  if (settings === null) return null
  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null) return null
  let capabilities: ReadonlySet<TaskCapability>
  try {
    capabilities = getCapabilitiesForTaskInstance(instance)
  } catch {
    return null // provider type not registered
  }
  if (!capabilities.has('members.provision')) return null
  return instance.config['baseUrl'] ?? null
}
```

Then at the GET response (~line 47-52): `const instanceUrl = getInstancePublicUrl(contextId)` and `instanceUrl,` in the JSON body (replacing `const kaneoUrl = getKaneoPublicUrl(...)` / `kaneoUrl,`). Leave the rest of the file (route logic, function `handleKaneoCredentialsRoutes`, reveal-once POST) unchanged — the file name + route path stay (§9.5).

- [ ] **Step 3: Verify**

Run: `rg -n "kaneoUrl|getKaneoPublicUrl|type !== 'kaneo'" src/debug/settings/kaneo-credentials-routes.ts` → ZERO hits.
Run: `bun test tests/debug/settings/kaneo-credentials-routes.test.ts` → PASS. `bun run typecheck` → clean. `bun test tests/architecture-guard.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/debug/settings/kaneo-credentials-routes.ts tests/debug/settings/kaneo-credentials-routes.test.ts
git commit -m "refactor(provisioning): gate credentials-URL by members.provision capability; rename kaneoUrl -> instanceUrl"
```

---

## Task 4: Rename the frontend contract (`kaneoUrl` → `instanceUrl`)

Consumer-side rename for BOTH JSON contracts (provision result + credentials). No logic change.

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`, `client/settings/fetcher-schemas-kaneo.ts`, `client/settings/sections/TaskProviderSection.svelte`, `client/settings/sections/KaneoAccessSection.svelte`, `client/stories/msw/settings-handlers.ts`
- Modify (tests): `tests/client/settings/fetcher-schemas-kaneo.test.ts`, `tests/client/settings/sections/TaskProviderSection.test.ts`, `tests/client/settings/sections/KaneoAccessSection.test.ts`

- [ ] **Step 1: Rename the client Zod schemas**

- `client/settings/fetcher-schemas.ts:~174`: `ProvisionResultSchema` field `kaneoUrl: z.string()` → `instanceUrl: z.string()`.
- `client/settings/fetcher-schemas-kaneo.ts:~14`: `KaneoCredentialsSchema` field `kaneoUrl: z.string().nullable()` → `instanceUrl: z.string().nullable()`.

- [ ] **Step 2: Rename the Svelte bindings (+ the one label freebie)**

- `client/settings/sections/TaskProviderSection.svelte:~173`: `{ k: 'Kaneo URL', v: provisioned.kaneoUrl }` → `{ k: 'Instance URL', v: provisioned.instanceUrl }`. (Binding rename is mandatory; the label `'Kaneo URL'`→`'Instance URL'` is the approved one-line freebie. Leave the surrounding hardcoded "Kaneo auto-provision"/"Provision Kaneo" block alone — §9.5.)
- `client/settings/sections/KaneoAccessSection.svelte:~103,109,111`: `credentials.kaneoUrl` → `credentials.instanceUrl` at all three sites (`{#if credentials.instanceUrl !== null}`, `href={credentials.instanceUrl}`, `>{credentials.instanceUrl}</a>`). Leave the `KV k="Workspace URL"` label as-is (accurate + generic already).

- [ ] **Step 3: Rename the MSW mock**

- `client/stories/msw/settings-handlers.ts:~118`: in `kaneoHandlers.populated`, `kaneoUrl: 'https://workspace.kaneo.app'` → `instanceUrl: 'https://workspace.kaneo.app'`.

- [ ] **Step 4: Update the client tests**

- `tests/client/settings/fetcher-schemas-kaneo.test.ts` (~lines 16,22,27,29,34): the parse inputs' `kaneoUrl` keys → `instanceUrl`, and the `.kaneoUrl` assertion → `.instanceUrl`.
- `tests/client/settings/sections/TaskProviderSection.test.ts` (~line 53): mock `provisionPayload.kaneoUrl` → `instanceUrl`.
- `tests/client/settings/sections/KaneoAccessSection.test.ts` (~lines 33,70,89,92): mock payloads' `kaneoUrl` → `instanceUrl`; the test title `'shows workspace URL when kaneoUrl is present'` → `'... when instanceUrl is present'`. Do NOT change assertion values.

- [ ] **Step 5: Verify**

Run: `rg -n "kaneoUrl" client tests/client tests/visual` → ZERO hits.
Run: `bun test:client` → PASS. Then check the visual spec: `bun shoot tests/visual/settings/sections/KaneoAccessSection.spec.ts` (or the repo's visual-test command) — the KaneoAccessSection screenshot should be UNCHANGED (the mock now sends `instanceUrl`, the Svelte reads `instanceUrl`, so the rendered "Workspace URL" link is identical). If the visual test infra requires regenerating a spec/baseline, follow the repo's `bun shoot:gen`/`bun shoot` flow; the rendered output must not visually change (pure field rename). If a baseline mismatch appears, confirm it's ONLY due to the mock/binding rename being out of sync (fix the sync), not an actual visual change.

- [ ] **Step 6: Full gate**

Run: `bun check:full` → 12/12 green (includes `test`, `test:client`). Run `bun run typecheck` + `bun run knip` + `bun run lint` + `bun run format:check` if not all covered.

- [ ] **Step 7: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetcher-schemas-kaneo.ts \
  client/settings/sections/TaskProviderSection.svelte client/settings/sections/KaneoAccessSection.svelte \
  client/stories/msw/settings-handlers.ts tests/client/settings/fetcher-schemas-kaneo.test.ts \
  tests/client/settings/sections/TaskProviderSection.test.ts tests/client/settings/sections/KaneoAccessSection.test.ts
git commit -m "refactor(settings-ui): rename provisioning kaneoUrl -> instanceUrl in the frontend contract"
```

(If the visual test required a regenerated baseline, add it to this commit and note it.)

---

## Self-Review notes (author)

- **Spec coverage (§9.4 `ProvisioningPort` = `kaneoUrl`→`instanceUrl`):** the core provisioning type no longer names kaneo; the two latent leaks (env-var read, `type !== 'kaneo'` gate) are fixed. No new port file (decided — provisioning isn't kernel-invoked, so there's nothing for a runtime port to sever; the existing generic `registry.ts` contract IS the provisioning port).
- **Always-green decomposition:** Task 1 (backend rename, behavior-preserving), Task 2 (env de-leak, the isolated behavior change), Task 3 (capability gate + credentials rename), Task 4 (frontend contract rename). Backend and frontend field renames are separate commits; on a feature branch this is test-green at each step (backend/client tests are independent layers), and the full contract is consistent after Task 4.
- **The behavior change** (Task 2) is isolated, characterization-tested, and flagged in its commit message; it mirrors the already-shipped auto-provision fix.
- **Scope discipline:** route PATHS, Svelte-section descriptor-ization, `credentials:Record` collapse, route-file relocation, and `kaneo-legacy-repair` are all explicitly deferred (§9.5/§9.6).
- **The easy-to-miss `index.ts:25` structural mirror** is called out in Task 1 (no compiler safety net).
- **Guard:** unchanged/green — nothing added under `src/ports/**`; the remaining "kaneo" names (route file names, `handleProvisionKaneo`, chat message wording) live in non-scanned paths and are §9.5's concern.
