<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4b — Typed Forge Connections + Self-Hosted GitLab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect a typed code host (GitHub / GHE / GitLab SaaS / GitLab self-hosted) with an instance URL, so clone/push/MR work against their own host — gated by the operator host allowlist.

**Architecture:** The `forge` vault gains `kind` + `instance_url` (JSON blob — no migration); papai derives `apiBaseUrl` per kind and exposes `resolveForge`; the acp plugin sends `projectSpec.forge = { kind, apiBaseUrl }`; magi uses it in `buildEphemeralProject` and **tightens `validateRepoSpec`** so both the repo host and the forge API host are operator-allowlisted (SSRF gate) — except the two fixed SaaS API hosts. magi's `GitLabForge` already supports a self-hosted `apiBaseUrl` and the Phase-2 askpass transport already works against any HTTPS host, so there's no forge-layer or transport change. geofront unchanged; sandbox egress is 4c.

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-26-phase-4b-typed-forge-design.md`

> **Execute on the current branches** (papai `master`, magi `main`), test-first. **Knip ordering:** A1 (types+route) self-consuming; A2 bundles `resolveForge`+`forgeMagiKind` with the acp consumer; A3 (client) consumes the route; B1 (magi) atomic. Use explicit `git add` paths (untracked parallel WIP may be present — never add files that aren't yours).

---

## File Structure

**Part A — papai**

- Modify `src/coding-credentials/types.ts` — forge fields, `FORGE_KINDS`, `deriveApiBaseUrl`, `forgeMagiKind`.
- Modify `src/debug/settings/coding-credentials-routes.ts` — forge `kind` select + `instance_url` validation.
- Modify `src/coding-credentials/resolve-agent-secrets.ts` — `resolveForge`.
- Modify `src/plugins/{runtime-types,tool-runtime}.ts` — `resolveForge` on the facade.
- Modify `plugins/acp/session-tools.ts` — carry `projectSpec.forge`.
- Modify `client/settings/sections/CodeHostSection.svelte` — kind select + conditional instance-URL.
- Modify `CLAUDE.md`.

**Part B — magi**

- Modify `src/project/config.ts` — `ProjectSpec.forge`, `validateRepoSpec` host checks, `buildEphemeralProject`.
- Modify `src/server/router.test.ts` coverage (router passes the spec through unchanged).

---

# Part A — papai

## Task A1: forge vault typed fields + kind→apiBaseUrl + route validation

**Files:** `src/coding-credentials/types.ts`, `src/debug/settings/coding-credentials-routes.ts`. Tests: `tests/coding-credentials/types.test.ts`, `tests/debug/settings/coding-credentials-routes.test.ts`.

> Read the current `types.ts` (`FORGE_FIELDS`/`REQUIRED_FORGE_FIELDS` from Phase 2, and the 4a `PROVIDERS`/`AGENTS`/select pattern) and `coding-credentials-routes.ts` (`FIELDS_META`, the 4a `control:'select'` metadata, `checkCompatibility`/validation in PATCH).

- [ ] **Step 1: Failing tests**

```ts
// types.test.ts
import { deriveApiBaseUrl, forgeMagiKind, FORGE_KINDS } from '../../src/coding-credentials/types.js'
test('forge kind → apiBaseUrl', () => {
  expect(deriveApiBaseUrl('github', undefined)).toBe('https://api.github.com')
  expect(deriveApiBaseUrl('gitlab', undefined)).toBe('https://gitlab.com/api/v4')
  expect(deriveApiBaseUrl('github-enterprise', 'https://ghe.corp.com')).toBe('https://ghe.corp.com/api/v3')
  expect(deriveApiBaseUrl('gitlab-self-hosted', 'https://gitlab.corp.com/')).toBe('https://gitlab.corp.com/api/v4')
})
test('forgeMagiKind', () => {
  expect(forgeMagiKind('github')).toBe('github')
  expect(forgeMagiKind('github-enterprise')).toBe('github')
  expect(forgeMagiKind('gitlab-self-hosted')).toBe('gitlab')
})
// routes
test('forge PATCH requires instance_url for self-hosted', async () => {
  const bad = await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'forge',
      values: { kind: 'gitlab-self-hosted', forge_token: 't' },
    }),
  )
  expect(bad.status).toBe(422)
  const ok = await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'forge',
      values: { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 't' },
    }),
  )
  expect(ok.status).toBe(200)
})
test('forge PATCH rejects unknown kind', async () => {
  const res = await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'forge',
      values: { kind: 'bitbucket', forge_token: 't' },
    }),
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `types.ts`**

```ts
export const FORGE_FIELDS = ['kind', 'instance_url', 'forge_token'] as const
export const REQUIRED_FORGE_FIELDS = ['kind', 'forge_token'] as const
export const FORGE_KINDS = ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'] as const
export type ForgeKindUi = (typeof FORGE_KINDS)[number]
export function isForgeKind(v: string): v is ForgeKindUi {
  return (FORGE_KINDS as readonly string[]).includes(v)
}
export function forgeMagiKind(kind: string): 'github' | 'gitlab' {
  return kind.startsWith('gitlab') ? 'gitlab' : 'github'
}
const stripSlash = (u: string): string => u.replace(/\/+$/u, '')
export function deriveApiBaseUrl(kind: string, instanceUrl: string | undefined): string {
  if (kind === 'github') return 'https://api.github.com'
  if (kind === 'gitlab') return 'https://gitlab.com/api/v4'
  if (kind === 'github-enterprise') return `${stripSlash(instanceUrl ?? '')}/api/v3`
  if (kind === 'gitlab-self-hosted') return `${stripSlash(instanceUrl ?? '')}/api/v4`
  throw new Error(`unknown forge kind: ${kind}`)
}
export function needsInstanceUrl(kind: string): boolean {
  return kind === 'github-enterprise' || kind === 'gitlab-self-hosted'
}
```

- [ ] **Step 4: route** — in `FIELDS_META`, the `forge` namespace becomes:

```ts
forge: [
  { key: 'kind', label: 'Code host', required: true, sensitive: false, control: 'select', options: FORGE_KINDS },
  { key: 'instance_url', label: 'Instance URL (enterprise / self-hosted)', required: false, sensitive: false },
  { key: 'forge_token', label: 'Access token', required: true, sensitive: true },
],
```

In the PATCH handler, for the `forge` namespace validate the merged (existing ∪ patched) values: `kind` must satisfy `isForgeKind` (→ 422); when `needsInstanceUrl(kind)`, `instance_url` must be present + `https://` (→ 422). Reuse the 4a validation helper structure.

- [ ] **Step 5: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 6: Commit**

```bash
git add src/coding-credentials/types.ts src/debug/settings/coding-credentials-routes.ts tests/coding-credentials/types.test.ts tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(coding-credentials): typed forge connection fields + kind→apiBaseUrl"
```

---

## Task A2: `resolveForge` facade + acp carries `projectSpec.forge`

**Bundled** so `resolveForge`/`forgeMagiKind` have a consumer.

**Files:** `src/coding-credentials/resolve-agent-secrets.ts`, `src/plugins/{runtime-types,tool-runtime}.ts`, `plugins/acp/session-tools.ts`. Tests: facade + acp.

- [ ] **Step 1: Failing tests** — `resolveForge` returns `{kind:'gitlab', apiBaseUrl:'https://gl.corp.com/api/v4'}` for a `gitlab-self-hosted` vault; legacy token-only vault → `{kind:'github', apiBaseUrl:'https://api.github.com'}`; null when no forge vault. acp: `start_session`/`review_pr` include `projectSpec.forge` when configured.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `resolve-agent-secrets.ts`**

```ts
export function resolveForge(storageContextId: string): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'forge')
  if (creds === null) return null
  const kind = creds.kind?.trim()
  const uiKind = kind === undefined || kind.length === 0 ? 'github' : kind // legacy default
  try {
    return { kind: forgeMagiKind(uiKind), apiBaseUrl: deriveApiBaseUrl(uiKind, creds.instance_url?.trim()) }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: facade** — `runtime-types.ts` add `resolveForge(): { kind: 'github'|'gitlab'; apiBaseUrl: string } | null` to `codingSecrets`; `tool-runtime.ts` add to `buildCodingSecretsFacade`, permission-gated like `resolveForgeToken`.

- [ ] **Step 5: acp** — `session-tools.ts`: include `forge: runtimeContext.codingSecrets.resolveForge() ?? undefined` in the `projectSpec` (omit the key when null). `forgeToken` is still sent separately. Update tests asserting the body.

- [ ] **Step 6: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 7: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts plugins/acp/session-tools.ts tests/plugins/coding-secrets-facade.test.ts tests/plugins/acp/
git commit -m "feat(acp): resolveForge capability; carry projectSpec.forge"
```

---

## Task A3: Code host section — kind select + conditional instance URL

**Files:** `client/settings/sections/CodeHostSection.svelte`, `CLAUDE.md`. Tests: `tests/client/settings/code-host-section.test.ts`.

> Read the current `CodeHostSection.svelte` and the 4a select-rendering in `CodingCredentialsSection.svelte` (the `control === 'select'` branch) to mirror it.

- [ ] **Step 1: Failing tests** — section renders a `kind` `<select>` (4 options); the `instance_url` field is **shown only** when the selected kind is `github-enterprise`/`gitlab-self-hosted` and hidden for SaaS; the token still renders masked.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: section** — render the `kind` select (mirror the 4a select branch); compute `showInstanceUrl = needsInstanceUrl(currentKind)` (mirror the rule client-side) and conditionally render the `instance_url` text field. The token field renders as today. Saving a select issues the per-field PATCH; when the kind changes to a SaaS kind, optionally clear/blank `instance_url`.

- [ ] **Step 4: doc** — update `CLAUDE.md` (typed forge connections; self-hosted needs an operator allowlist entry).

- [ ] **Step 5: Run → pass (`bun test:client …`); `bun run knip` exit 0.**

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte CLAUDE.md tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings-ui): typed Code host connection (kind + instance URL)"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: `projectSpec.forge` + SSRF host validation (one atomic commit)

**Files:** `src/project/config.ts`. Tests: `tests/project/*`, `tests/server/router.test.ts`.

> Read the current `project/config.ts` (`ProjectSpec`, `validateRepoSpec`, `buildEphemeralProject`, `ForgeKind`, `RepoPolicy`).

- [ ] **Step 1: Failing tests**

```ts
// project tests
const FORGE = { kind: 'gitlab' as const, apiBaseUrl: 'https://gl.corp.com/api/v4' }
test('buildEphemeralProject uses spec.forge', () => {
  const p = buildEphemeralProject(
    {
      name: 'd',
      repoUrl: 'https://gl.corp.com/grp/sub/p.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      agent: 'claude',
      forge: FORGE,
    },
    DEFAULTS,
  )
  expect(p.forge.kind).toBe('gitlab')
  expect(p.forge.apiBaseUrl).toBe('https://gl.corp.com/api/v4')
  expect(p.forge.repo).toBe('grp/sub/p') // subgroup path
})
test('validateRepoSpec rejects a non-allowlisted forge api host', () => {
  // POLICY.allowedHosts = ['github.com'] — gl.corp.com not allowed
  expect(() =>
    validateRepoSpec(
      {
        name: 'd',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'claude',
        forge: { kind: 'gitlab', apiBaseUrl: 'https://gl.corp.com/api/v4' },
      },
      POLICY,
    ),
  ).toThrow()
})
test('validateRepoSpec admits the fixed SaaS api host', () => {
  expect(
    validateRepoSpec(
      {
        name: 'd',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'claude',
        forge: { kind: 'github', apiBaseUrl: 'https://api.github.com' },
      },
      { allowedHosts: ['github.com'] },
    ).forge?.apiBaseUrl,
  ).toBe('https://api.github.com')
})
test('validateRepoSpec falls back to defaults.forge when spec.forge absent', () => {
  expect(
    validateRepoSpec(
      {
        name: 'd',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'claude',
      },
      { allowedHosts: ['github.com'] },
    ).forge,
  ).toBeUndefined()
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `project/config.ts`**

```ts
export interface ProjectSpec {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: PermissionPreset
  agent: Exclude<ProvisioningAgent, 'custom'>
  forge?: { kind: ForgeKind; apiBaseUrl: string }
}
const SAAS_API_HOSTS: readonly string[] = ['api.github.com', 'gitlab.com']

function parseForge(value: unknown): { kind: ForgeKind; apiBaseUrl: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const o = value as Record<string, unknown>
  const kind = o['kind']
  const apiBaseUrl = o['apiBaseUrl']
  if ((kind !== 'github' && kind !== 'gitlab') || typeof apiBaseUrl !== 'string') return undefined
  return { kind, apiBaseUrl }
}
```

In `validateRepoSpec` (after the repoUrl-host check), parse `o['forge']`; if present, validate its `apiBaseUrl` is https and its host ∈ `policy.allowedHosts ∪ SAAS_API_HOSTS` → else throw (router → 400). Include `forge` on the returned `ProjectSpec`. In `buildEphemeralProject`, use `spec.forge ?? defaults.forge` for `forge.kind`/`apiBaseUrl`, and `deriveForgeRepo(spec.repoUrl, <that kind>)` for `forge.repo`.

> Note the existing `deriveForgeRepo` already returns the full path (handles GitLab subgroups) — do not change it.

- [ ] **Step 4: Run → pass; `bun run typecheck && bun run lint` clean.**

- [ ] **Step 5: Commit**

```bash
git add src/project/config.ts tests/
git commit -m "feat(project): per-session typed forge from projectSpec + SSRF host validation"
```

---

## Final verification

- [ ] **papai:** `bun run check:full` — green.
- [ ] **magi:** `bun run check:full` — green.
- [ ] **Cross-repo:** papai sends `projectSpec.forge = { kind: github|gitlab, apiBaseUrl }`; magi parses the same shape and validates the apiBaseUrl host. A final reviewer confirms a self-hosted instance host is rejected unless operator-allowlisted (SSRF), the SaaS API hosts are admitted, and a GitLab subgroup repo path derives correctly.
- [ ] **Manual smoke (live):** connect a self-hosted GitLab in settings (operator has allowlisted its host); a session clones/pushes/opens an MR against it; a connection to a non-allowlisted host is rejected at session start.

---

## Spec-coverage self-check

| Spec item                                                               | Task   |
| ----------------------------------------------------------------------- | ------ |
| Forge typed fields + `FORGE_KINDS` + `deriveApiBaseUrl`/`forgeMagiKind` | A1     |
| Route: kind select + instance_url validation                            | A1     |
| `resolveForge` facade                                                   | A2     |
| acp `projectSpec.forge`                                                 | A2     |
| Code host section kind select + conditional instance URL                | A3     |
| `ProjectSpec.forge` + `buildEphemeralProject` (+ subgroup repo)         | B1     |
| SSRF host validation (forge api host allowlist ∪ SaaS)                  | B1     |
| geofront untouched; sandbox egress unchanged (4c)                       | (none) |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-phase-4b-typed-forge.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Suggested order A1 → A2 → A3, then B1. **Which approach?**
