<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2 — Per-User Forge Identity (token + git transport) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user store their own code-host token in the settings UI and have ACP coding sessions clone, push, and open the PR/MR under that identity — with no forge token on the magi host.

**Architecture:** Reuse Phase 1's encrypted `coding_session_credentials` vault (add a `forge` namespace — the store is already namespace-generic), the `codingSecrets` capability (add `resolveForgeToken`), and the per-session request channel. The one new mechanism is magi git-transport auth: `runGit` injects the token via a `GIT_ASKPASS` helper through the **child environment only** (never argv/URL/`.git/config`); the forge API drops its `process.env[tokenEnv]` read for a per-session token. geofront is untouched (git runs on the magi host).

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-25-phase-2-forge-identity-design.md`

> **Execute on the current branch** (per user direction), both repos. Each task is test-first (papai + magi both enforce TDD write-hooks + a pre-commit gate). **Knip lesson from Phase 1:** producers are bundled with their consumers so every commit stays green — do not split a task expecting an intermediate red.

---

## File Structure

**Part A — papai**

- Modify `src/coding-credentials/types.ts` — add the `forge` namespace + fields.
- Modify `src/debug/settings/coding-credentials-routes.ts` — generalize over `namespace` (default `agent-provider` for backward compat).
- Modify `src/coding-credentials/resolve-agent-secrets.ts` — extract `configContextOf` + add forge resolution.
- Modify `src/plugins/tool-runtime.ts` + `src/plugins/runtime-types.ts` — `resolveForgeToken` on the `codingSecrets` facade.
- Modify `plugins/acp/tools.ts` — forge-token pre-flight + inject (start/finish/review).
- Modify `client/settings/{fetchers,fetcher-schemas}.ts` — `namespace` arg.
- Add `client/settings/sections/CodeHostSection.svelte` + wire into `SettingsApp.svelte`.
- Modify `CLAUDE.md`.

**Part B — magi**

- Add `src/git/assets/git-askpass.sh` — askpass helper.
- Modify `src/git/git.ts` — `runGit` token/askpass injection.
- Modify `src/forge/provider.ts` — `forProject(project, token)`, drop env read.
- Modify `src/workspace/git-workspace.ts` — thread auth to clone/fetch/push.
- Modify `src/session/state.ts`, `src/session/manager.ts`, `src/review/manager.ts`, `src/server/router.ts`, `src/main.ts`.

---

# Part A — papai

## Task A1: `forge` namespace + namespace-generalized settings route

**Files:**

- Modify: `src/coding-credentials/types.ts`
- Modify: `src/debug/settings/coding-credentials-routes.ts`
- Test: `tests/coding-credentials/store.test.ts` (extend), `tests/debug/settings/coding-credentials-routes.test.ts` (extend)

> First **read** the current `src/coding-credentials/types.ts`, `src/coding-credentials/store.ts`, and `src/debug/settings/coding-credentials-routes.ts` — A1 extends them. The store is already namespace-parameterized (`FIELDS_BY_NAMESPACE`/`REQUIRED_BY_NAMESPACE`); **do not change `store.ts`**.

- [ ] **Step 1: Write failing tests**

Add to `tests/coding-credentials/store.test.ts` — a `forge` namespace round-trip proving isolation from `agent-provider`:

```ts
test('forge namespace round-trips independently of agent-provider', () => {
  updateCodingCredentials(CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'u')
  updateCodingCredentials(CTX, 'forge', { forge_token: 'ghp_xyz' }, 'u')
  expect(getCodingCredentials(CTX, 'forge')).toEqual({ forge_token: 'ghp_xyz' })
  expect(getCodingCredentials(CTX, 'agent-provider')).toEqual({ provider_api_key: 'sk-1' })
  expect(getCodingCredentialState(CTX, 'forge').complete).toBe(true)
})
```

Add to `tests/debug/settings/coding-credentials-routes.test.ts` — namespace routing (use the file's existing harness helpers):

```ts
test('GET ?namespace=forge returns the forge field; default stays agent-provider', async () => {
  const forge = await handleCodingCredentialsRoutes(
    ...authedGet(`/settings/api/coding-credentials?contextId=${CTX}&namespace=forge`),
  )
  expect((await forge.json()).fields.map((f: { key: string }) => f.key)).toEqual(['forge_token'])
  const dflt = await handleCodingCredentialsRoutes(...authedGet(`/settings/api/coding-credentials?contextId=${CTX}`))
  expect((await dflt.json()).fields.map((f: { key: string }) => f.key)).toEqual([
    'provider_api_key',
    'provider_base_url',
  ])
})

test('unknown namespace is rejected', async () => {
  const res = await handleCodingCredentialsRoutes(
    ...authedGet(`/settings/api/coding-credentials?contextId=${CTX}&namespace=bogus`),
  )
  expect(res.status).toBe(400)
})

test('PATCH ?namespace=forge saves the forge token masked on GET', async () => {
  await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'forge',
      values: { forge_token: 'ghp_secret' },
    }),
  )
  const res = await handleCodingCredentialsRoutes(
    ...authedGet(`/settings/api/coding-credentials?contextId=${CTX}&namespace=forge`),
  )
  const field = (await res.json()).fields.find((f: { key: string }) => f.key === 'forge_token')
  expect(field.value).not.toContain('ghp_secret')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/coding-credentials/store.test.ts tests/debug/settings/coding-credentials-routes.test.ts`
Expected: FAIL (forge namespace unknown; route ignores `namespace`).

- [ ] **Step 3: Add the `forge` namespace to `types.ts`**

```ts
export const CODING_NAMESPACES = ['agent-provider', 'forge'] as const
// ... existing agent-provider field consts ...
export const FORGE_FIELDS = ['forge_token'] as const
export const REQUIRED_FORGE_FIELDS = ['forge_token'] as const
export type ForgeField = (typeof FORGE_FIELDS)[number]
```

Register both in the existing maps:

```ts
export const FIELDS_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': AGENT_PROVIDER_FIELDS,
  forge: FORGE_FIELDS,
}
export const REQUIRED_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': REQUIRED_AGENT_PROVIDER_FIELDS,
  forge: REQUIRED_FORGE_FIELDS,
}
```

- [ ] **Step 4: Generalize the route over `namespace`**

In `src/debug/settings/coding-credentials-routes.ts`, replace the hardcoded `NAMESPACE`/`CODING_FIELDS` with a per-namespace field-metadata registry and a `namespace` param (query for GET, body for PATCH), defaulting to `agent-provider`:

```ts
import { CODING_NAMESPACES, type CodingNamespace } from '../../coding-credentials/types.js'

type FieldMeta = { key: string; label: string; required: boolean; sensitive: boolean }
const FIELDS_META: Record<CodingNamespace, readonly FieldMeta[]> = {
  'agent-provider': [
    { key: 'provider_api_key', label: 'Anthropic API Key', required: true, sensitive: true },
    { key: 'provider_base_url', label: 'Anthropic Base URL (optional)', required: false, sensitive: false },
  ],
  forge: [{ key: 'forge_token', label: 'Code-host token', required: true, sensitive: true }],
}

const parseNamespace = (raw: string | null | undefined): CodingNamespace | null => {
  const ns = raw ?? 'agent-provider'
  return (CODING_NAMESPACES as readonly string[]).includes(ns) ? (ns as CodingNamespace) : null
}
```

- `fieldResponse(contextId, namespace)` reads `FIELDS_META[namespace]` and `getCodingCredentialState/getCodingCredentials(contextId, namespace)`.
- `valuesToPersist(contextId, namespace, values)` filters against `FIELDS_META[namespace]`.
- GET: `const namespace = parseNamespace(url.searchParams.get('namespace'))`; if `null` → `settingsJson(400, { error: 'unknown namespace' })`.
- PATCH: read `namespace` from the validated body (add `namespace: z.string().optional()` to the schemas); `parseNamespace` → 400 on unknown; thread to `updateCodingCredentials`/`clearCodingCredentials`.

Keep the masking, `resolveContextScope`, and CSRF logic unchanged.

- [ ] **Step 5: Run to verify they pass**

Run: `bun test tests/coding-credentials/store.test.ts tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS (incl. the Phase-1 agent-provider tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/coding-credentials/types.ts src/debug/settings/coding-credentials-routes.ts \
  tests/coding-credentials/store.test.ts tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(coding-credentials): forge namespace + namespace-generalized settings route"
```

---

## Task A2: `resolveForgeToken` capability + acp plugin forge injection

**Bundled** so `resolveForgeToken` has a consumer (the plugin) in the same commit — keeps knip green.

**Files:**

- Modify: `src/coding-credentials/resolve-agent-secrets.ts`
- Modify: `src/plugins/tool-runtime.ts`, `src/plugins/runtime-types.ts`
- Modify: `plugins/acp/tools.ts`
- Test: `tests/coding-credentials/resolve-agent-secrets.test.ts`, `tests/plugins/coding-secrets-facade.test.ts`, `tests/plugins/acp/*`

> Read the current `resolve-agent-secrets.ts`, the `buildCodingSecretsFacade` in `tool-runtime.ts`, the `codingSecrets` field in `runtime-types.ts`, and the `finishSessionTool`/`reviewPrTool`/`startSessionTool` in `plugins/acp/tools.ts`.

- [ ] **Step 1: Write failing tests**

`tests/coding-credentials/resolve-agent-secrets.test.ts` — add forge resolution:

```ts
test('resolveForgeToken returns the stored forge token, or null when absent', () => {
  expect(resolveForgeToken(STORAGE_CTX)).toBeNull()
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_1' }, 'u')
  expect(resolveForgeToken(STORAGE_CTX)).toBe('ghp_1')
})
```

`tests/plugins/coding-secrets-facade.test.ts` — facade method + permission gate:

```ts
test('resolveForgeToken via facade; denied without permission', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_1' }, 'u')
  expect(buildCodingSecretsFacade('acp', STORAGE_CTX, true).resolveForgeToken()).toBe('ghp_1')
  expect(() => buildCodingSecretsFacade('acp', STORAGE_CTX, false).resolveForgeToken()).toThrow("'coding.secrets'")
})
```

`tests/plugins/acp/coding-secrets-injection.test.ts` (extend) — finish/review refuse + inject (mirror the Phase-1 start_session tests; fake `codingSecrets` now also has `resolveForgeToken`):

```ts
test('finish_session refuses when no forge token; includes forgeToken when present', async () => {
  // resolveForgeToken: () => null  → refuses, fetch not called, error not_configured
  // resolveForgeToken: () => 'ghp_1' → POST /sessions/<id>/finish body includes forgeToken: 'ghp_1'
})
// same shape for review_pr → POST /reviews body includes forgeToken
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/coding-credentials/resolve-agent-secrets.test.ts tests/plugins/coding-secrets-facade.test.ts tests/plugins/acp/`
Expected: FAIL.

- [ ] **Step 3: Add forge resolution (`resolve-agent-secrets.ts`)**

Extract the shared config-context resolution and add a forge resolver:

```ts
export function configContextOf(storageContextId: string): string {
  return getConfigContextIdFromStorageContextId(storageContextId)
}

export function resolveForgeToken(storageContextId: string): string | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'forge')
  const token = creds?.forge_token?.trim()
  return token === undefined || token.length === 0 ? null : token
}
```

(Refactor `resolveAgentSecrets` to call `configContextOf` too.)

- [ ] **Step 4: Extend the facade**

`src/plugins/runtime-types.ts`:

```ts
codingSecrets: { resolve(): Record<string, string> | null; resolveForgeToken(): string | null }
```

`src/plugins/tool-runtime.ts` — in `buildCodingSecretsFacade`, add (permission-gated like `resolve`):

```ts
import { resolveAgentSecrets, resolveForgeToken } from '../coding-credentials/resolve-agent-secrets.js'
// inside the frozen object:
resolveForgeToken(): string | null {
  if (!hasPermission) deny(pluginId, 'coding.secrets')
  return resolveForgeToken(storageContextId)
},
```

- [ ] **Step 5: acp plugin forge pre-flight + inject (`plugins/acp/tools.ts`)**

- Extend the local `RuntimeContext` `codingSecrets` type with `resolveForgeToken(): string | null`.
- `startSessionTool`: after the existing agent-key resolution, also `const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()` and include `...(forgeToken ? { forgeToken } : {})` in the `/sessions` body (optional — no refusal).
- `finishSessionTool`: pre-flight `const forgeToken = runtimeContext.codingSecrets.resolveForgeToken(); if (forgeToken === null) return { error: 'not_configured', message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.' }`; include `forgeToken` in the `/sessions/<id>/finish` body.
- `reviewPrTool`: same pre-flight + include `forgeToken` in the `/reviews` body.

- [ ] **Step 6: Run to verify they pass**

Run: `bun test tests/coding-credentials/ tests/plugins/coding-secrets-facade.test.ts tests/plugins/acp/`
Expected: PASS. Then `bun run knip` → exit 0 (resolveForgeToken is consumed by the plugin).

- [ ] **Step 7: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts src/plugins/tool-runtime.ts src/plugins/runtime-types.ts \
  plugins/acp/tools.ts tests/coding-credentials/resolve-agent-secrets.test.ts \
  tests/plugins/coding-secrets-facade.test.ts tests/plugins/acp/coding-secrets-injection.test.ts
git commit -m "feat(acp): per-context forge token — resolveForgeToken + finish/review injection"
```

---

## Task A3: "Code host" settings section + namespace-aware fetchers

**Files:**

- Modify: `client/settings/fetchers.ts`, `client/settings/fetcher-schemas.ts`
- Add: `client/settings/sections/CodeHostSection.svelte`
- Modify: `client/settings/SettingsApp.svelte`
- Modify: `CLAUDE.md`
- Test: `tests/client/settings/coding-credentials-fetchers.test.ts` (extend), `tests/client/settings/code-host-section.test.ts` (new)

> Read the current `client/settings/fetchers.ts` (`fetchCodingCredentials`/`patchCodingCredentials`), `fetcher-schemas.ts` (`CodingCredentialsResponseSchema`), `sections/CodingCredentialsSection.svelte`, and the coding-credentials wiring in `SettingsApp.svelte`.

- [ ] **Step 1: Write failing tests**

`tests/client/settings/coding-credentials-fetchers.test.ts` — fetchers send `namespace`:

```ts
test('fetchCodingCredentials sends namespace; patch includes it', async () => {
  installFetchStub({
    namespace: 'forge',
    configured: false,
    complete: false,
    missing: ['forge_token'],
    fields: [
      { key: 'forge_token', label: 'Code-host token', required: true, sensitive: true, hasValue: false, value: '' },
    ],
  })
  await fetchCodingCredentials('pi:telegram:ctx:u1', 'forge')
  expect(lastRequest().url).toContain('namespace=forge')
  await patchCodingCredentials({
    contextId: 'pi:telegram:ctx:u1',
    namespace: 'forge',
    values: { forge_token: 'ghp_1' },
  })
  expect(JSON.parse(lastRequest().body as string).namespace).toBe('forge')
})
```

`tests/client/settings/code-host-section.test.ts` — renders the forge token field (mirror the Phase-1 section test).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts tests/client/settings/code-host-section.test.ts`
Expected: FAIL.

- [ ] **Step 3: Make fetchers namespace-aware**

`fetchers.ts` (default `agent-provider` for the existing AI-provider section caller):

```ts
export const fetchCodingCredentials = (
  contextId: string,
  namespace = 'agent-provider',
): Promise<CodingCredentialsResponse> =>
  getJson(`/settings/api/coding-credentials?${ctxQuery(contextId)}&namespace=${encodeURIComponent(namespace)}`, (b) =>
    CodingCredentialsResponseSchema.parse(b),
  )

export const patchCodingCredentials = (input: {
  contextId: string
  namespace?: string
  values: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/coding-credentials', 'PATCH', input, (b) => b)
```

- [ ] **Step 4: Add the Code host section**

`client/settings/sections/CodeHostSection.svelte` — copy `CodingCredentialsSection.svelte`, change: `PageHeader` title "Code host"; section id `code-host`; call `fetchCodingCredentials(contextId, 'forge')` and `patchCodingCredentials({ contextId, namespace: 'forge', values })`; one masked **Code-host token** field. No enable toggle. (If you prefer, parameterize `CodingCredentialsSection` with a `namespace` + `title` prop instead of copying — either is acceptable; copying is simplest.)

- [ ] **Step 5: Wire into `SettingsApp.svelte`**

Import + render `<CodeHostSection contextId={ctx} />` after `<CodingCredentialsSection>`; add `'code-host'` to `ADVANCED_IDS`; add sidebar item `{ id: 'code-host', label: 'Code host' }` after `coding-credentials`.

- [ ] **Step 6: Run to verify they pass**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts tests/client/settings/code-host-section.test.ts`
Expected: PASS.

- [ ] **Step 7: Update `CLAUDE.md`** — note the `forge` namespace in the coding-credentials vault and that the acp plugin supplies the user's forge token per session (finish/review refuse when unconfigured).

- [ ] **Step 8: Commit**

```bash
git add client/settings/fetchers.ts client/settings/fetcher-schemas.ts \
  client/settings/sections/CodeHostSection.svelte client/settings/SettingsApp.svelte CLAUDE.md \
  tests/client/settings/coding-credentials-fetchers.test.ts tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings-ui): Code host token section"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: Per-session forge token — git transport + forge API, end-to-end

One atomic commit: the `forProject(project, token)` and `git-workspace` signature changes ripple through the managers, so they land together (magi's pre-commit runs typecheck).

**Files:**

- Add: `src/git/assets/git-askpass.sh`
- Modify: `src/git/git.ts`, `src/forge/provider.ts`, `src/workspace/git-workspace.ts`
- Modify: `src/session/state.ts`, `src/session/manager.ts`, `src/review/manager.ts`, `src/server/router.ts`, `src/main.ts`
- Test: `tests/git/git.test.ts`, `tests/forge/provider.test.ts`, `tests/workspace/git-workspace.test.ts`, `tests/session/manager.test.ts`, `tests/review/manager.test.ts`, `tests/server/router.test.ts`

> Read the current `src/git/git.ts`, `src/forge/provider.ts`, `src/workspace/git-workspace.ts`, and the managers/router (B1+B2+B3 from Phase 1 just modified these).

- [ ] **Step 1: Write failing tests**

`tests/git/git.test.ts`:

```ts
test('runGit with auth sets askpass env, token only in env not argv', async () => {
  const spawned: { args: string[]; env?: Record<string, string> } = { args: [] }
  // inject a fake spawn (or assert via a wrapper) capturing args + env
  await runGit(['ls-remote', 'https://github.com/o/r.git'], '/tmp', { token: 'ghp_x', forgeKind: 'github' })
  expect(spawned.args.join(' ')).not.toContain('ghp_x') // never in argv
  expect(spawned.env?.MAGI_GIT_TOKEN).toBe('ghp_x')
  expect(spawned.env?.MAGI_GIT_USERNAME).toBe('x-access-token')
  expect(spawned.env?.GIT_ASKPASS).toContain('git-askpass')
})
```

> `runGit` currently calls `Bun.spawn` directly. To make it testable, either inject the spawn fn (preferred) or assert the askpass script + `usernameFor` behavior via exported helpers. Match magi's existing test conventions in `tests/git/`.

`tests/forge/provider.test.ts`: `forProject(project, 'tok')` builds a forge bound to `'tok'`; `forProject(project, '')` throws; no `process.env` read.

`tests/workspace/git-workspace.test.ts`: clone/fetch/push pass `{ token, forgeKind }` to `runGit`; local ops (`worktree add`, `config`, `commit`) pass no auth; the remote URL argument never contains the token. (Use the suite's existing runGit injection/fake.)

`tests/session/manager.test.ts` / `review/manager.test.ts` / `server/router.test.ts`: `forgeToken` from the request reaches `workspace.prepare`/`finish`/`prepareReview` and `forges.forProject`; `POST /sessions`, `/sessions/:id/finish`, `/reviews` parse `forgeToken`; the token is not persisted to the store and not logged.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/git/ tests/forge/ tests/workspace/ tests/session/ tests/review/ tests/server/`
Expected: FAIL.

- [ ] **Step 3: Add the askpass asset** `src/git/assets/git-askpass.sh` (commit with mode 0755)

```sh
#!/bin/sh
# git invokes GIT_ASKPASS with the prompt text as $1. Echo the credential from
# the environment (never argv). Token-free at rest.
case "$1" in
  Username*) printf '%s' "${MAGI_GIT_USERNAME}" ;;
  Password*) printf '%s' "${MAGI_GIT_TOKEN}" ;;
esac
```

- [ ] **Step 4: `runGit` auth injection (`src/git/git.ts`)**

```ts
import { chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { ForgeKind } from '../project/config.js'

export interface GitAuth {
  token: string
  forgeKind: ForgeKind
}

const ASKPASS_PATH = fileURLToPath(new URL('./assets/git-askpass.sh', import.meta.url))
// Defensive: ensure the asset is executable even if the exec bit was lost on checkout.
try {
  chmodSync(ASKPASS_PATH, 0o755)
} catch {
  // best-effort; a committed 0755 asset works without this
}

function usernameFor(kind: ForgeKind): string {
  return kind === 'gitlab' ? 'oauth2' : 'x-access-token'
}

export async function runGit(args: string[], cwd: string, auth?: GitAuth): Promise<GitResult> {
  const env =
    auth === undefined
      ? undefined
      : {
          ...process.env,
          GIT_ASKPASS: ASKPASS_PATH,
          GIT_TERMINAL_PROMPT: '0',
          MAGI_GIT_USERNAME: usernameFor(auth.forgeKind),
          MAGI_GIT_TOKEN: auth.token,
        }
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', ...(env ? { env } : {}) })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`)
  }
  return { stdout, stderr, exitCode }
}
```

> If the existing `tests/git` suite needs an injectable spawn, add an internal seam (e.g. an exported `runGitWith(spawnFn, ...)` the default `runGit` delegates to) rather than spying on `Bun.spawn`. Keep the public `runGit` signature as above.

- [ ] **Step 5: Per-session forge provider (`src/forge/provider.ts`)**

Replace `EnvForgeProvider`:

```ts
export interface ForgeProvider {
  forProject(project: ProjectConfig, token: string): Forge
}

export class RequestForgeProvider implements ForgeProvider {
  forProject(project: ProjectConfig, token: string): Forge {
    if (token.length === 0) {
      throw new Error(`Missing forge token for project ${project.name} (user has not connected a code host)`)
    }
    return createForge(project.forge, token)
  }
}
```

Update `src/main.ts` to construct `new RequestForgeProvider()` instead of `EnvForgeProvider`.

- [ ] **Step 6: Thread auth through `git-workspace.ts`**

Add an optional `auth?: GitAuth` to `prepare`, `prepareReview`, `finish` (and the private `ensureMirror`), built from `{ token, forgeKind: project.forge.kind }`. Pass `auth` ONLY to the **network** `runGit` calls — `clone --mirror`, `remote update`, `fetch`, `push`. Leave local ops (`worktree add`, `config user.*`, `add`, `commit`, `status`) unauthenticated. The remote URL argument stays `project.repoUrl` (no token embedded). Example for `finish`:

```ts
async finish(prepared: PreparedWorkspace, message: string, auth?: GitAuth): Promise<void> {
  await runGit(['add', '-A'], prepared.worktreePath)
  const status = await runGit(['status', '--porcelain'], prepared.worktreePath)
  if (status.stdout.trim().length > 0) {
    await runGit(['commit', '-m', message], prepared.worktreePath)
  }
  await runGit(['push', prepared.repoUrl, `HEAD:refs/heads/${prepared.branch}`], prepared.worktreePath, auth)
}
```

- [ ] **Step 7: Thread `forgeToken` through inputs, managers, router**

- `src/session/state.ts`: `StartSessionInput.forgeToken?: string`; add `FinishSessionInput.forgeToken?: string` (wherever `FinishSessionInput` is defined).
- `src/session/manager.ts`: `runLifecycle` → `workspace.prepare(id, project, authFrom(project, input.forgeToken))`; `finishSession` → `workspace.finish(prepared, input.message, authFrom(project, input.forgeToken))` and `this.forges.forProject(project, input.forgeToken ?? '')`. Add a small `authFrom(project, token)` helper returning `token ? { token, forgeKind: project.forge.kind } : undefined`.
- `src/review/manager.ts`: `StartReviewInput.forgeToken?`; `this.forges.forProject(project, input.forgeToken ?? '')`; `workspace.prepareReview(id, project, pr.fetchRef, authFrom(project, input.forgeToken))`.
- `src/server/router.ts`: parse `asString(body['forgeToken'])` (→ `?? undefined`) in `handleStart`, the finish branch of `handleSessionScoped`, and `handleReview`; forward into the inputs. Never log it.

- [ ] **Step 8: Run to verify they pass**

Run: `bun test` (magi). Then `bun run typecheck && bun run lint`.
Expected: all green; secrets/token absent from store + logs.

- [ ] **Step 9: Commit**

```bash
git add src/git/ src/forge/provider.ts src/workspace/git-workspace.ts src/session/ src/review/manager.ts \
  src/server/router.ts src/main.ts tests/
git commit -m "feat(forge): per-session forge token for git transport + forge API (no host token)"
```

---

## Final verification (both repos)

- [ ] **papai:** `bun run check:full` — all green.
- [ ] **magi:** `bun run check:full` — all green.
- [ ] **Cross-repo contract:** papai sends `forgeToken` (a raw string) on start/finish/review; magi parses `body['forgeToken']` on the same three endpoints. Confirm the field name matches (`forgeToken` ↔ `forgeToken`) — a final reviewer should verify this, exactly like Phase 1's `ANTHROPIC_API_KEY` check.
- [ ] **Manual smoke (needs live magi+geofront):** set a code-host token in settings → Code host; run a session on a private repo; confirm clone + push + PR all succeed under the user's identity with **no `GITHUB_TOKEN`/git creds on the magi host**. Clear the token; confirm `finish_session` refuses with `not_configured`.

---

## Spec-coverage self-check

| Spec item                                                       | Task                               |
| --------------------------------------------------------------- | ---------------------------------- |
| `forge` namespace in the vault                                  | A1                                 |
| Namespace-generalized route (default agent-provider)            | A1                                 |
| `resolveForgeToken` capability                                  | A2                                 |
| acp finish/review pre-flight refuse + inject; start optional    | A2                                 |
| Code host settings section + namespace fetchers                 | A3                                 |
| Per-session forge API token, no env                             | B1 (forge provider + main)         |
| Git transport token via askpass (env only, not argv/URL)        | B1 (git + askpass + git-workspace) |
| Per-kind git username                                           | B1 (`usernameFor`)                 |
| `forgeToken` threaded start/finish/review; not persisted/logged | B1                                 |
| geofront untouched                                              | (no geofront changes anywhere)     |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-phase-2-forge-identity.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
**2. Inline Execution** — execute in this session with checkpoints.

Suggested order: A1 → A2 → A3, then B1. Part A is independently testable before B1; the end-to-end smoke needs both. **Watch the knip ordering** (A2 bundles `resolveForgeToken` with its plugin consumer; B1 is one atomic magi commit) — these are deliberate to keep every commit green.

**Which approach?**
