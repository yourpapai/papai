<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4c — Derived Egress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive the sandbox egress per session (provider host incl. custom base URL + agent-infra host + operator base), narrowing today's broad default and making `openai-compatible`/custom endpoints reachable — bounded by the geofront org-ceiling.

**Architecture:** papai adds `openai-compatible` to the provider picker and a `resolveProviderHost` that derives the model host (from provider + base URL), sent as `projectSpec.providerHost`. magi replaces the wholesale operator egress with `deriveEgress(spec, defaults)` = operator base ∪ providerHost ∪ agent-infra (codex→`chatgpt.com`, opencode→`models.dev`); the per-agent preset stops contributing **provider** hosts (its infra hosts move to a pure `agentInfraEgress`). The **repo host is NOT in the sandbox egress** (the forge token is host-side; the agent can't auth to the forge anyway). geofront's org-ceiling clamps the result (config/doc only — no geofront code).

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-26-phase-4c-derived-egress-design.md`

> **Execute on the current branches** (papai `master`, magi `main`), test-first. **Knip ordering:** A1 (types+route) self-consuming; A2 bundles `deriveProviderHost`+`resolveProviderHost` with the acp consumer; A3 (client) consumes nothing new; B1 (magi) atomic. Explicit `git add` paths (untracked WIP may be present — never add files that aren't yours).

---

## File Structure

**Part A — papai**

- Modify `src/coding-credentials/types.ts` — `openai-compatible` provider + `compatible()`; (`deriveProviderHost` in A2).
- Modify `src/debug/settings/coding-credentials-routes.ts` — base URL required for `openai-compatible`.
- Modify `src/coding-credentials/resolve-agent-secrets.ts` — `resolveProviderHost`.
- Modify `src/plugins/{runtime-types,tool-runtime}.ts` — `resolveProviderHost` on the facade.
- Modify `plugins/acp/session-tools.ts` — carry `projectSpec.providerHost`.
- Modify `client/settings/sections/CodingCredentialsSection.svelte` — `openai-compatible` in the client compat map + base-URL-required hint.
- Modify `CLAUDE.md`.

**Part B — magi**

- Modify `src/project/config.ts` — `ProjectSpec.providerHost`, `agentInfraEgress`, `deriveEgress`, `buildEphemeralProject`.
- Modify `src/runtime/geofront/provisioning/presets.ts` — remove `defaultEgress` from `AgentPreset`.
- Modify `src/runtime/geofront/provisioning/plan.ts` — drop `preset.defaultEgress` from the egress merge.

---

# Part A — papai

## Task A1: `openai-compatible` provider + base-URL-required route validation

**Files:** `src/coding-credentials/types.ts`, `src/debug/settings/coding-credentials-routes.ts`. Tests: `tests/coding-credentials/types.test.ts`, `tests/debug/settings/coding-credentials-routes.test.ts`.

> Read the current `types.ts` (`PROVIDERS`/`AGENTS`/`compatible`, from 4a) and `coding-credentials-routes.ts` (`checkCompatibility` / the agent-provider PATCH validation).

- [ ] **Step 1: Failing tests**

```ts
// types.test.ts
import { PROVIDERS, compatible } from '../../src/coding-credentials/types.js'
test('openai-compatible provider + compatibility', () => {
  expect(PROVIDERS).toContain('openai-compatible')
  expect(compatible('opencode', 'openai-compatible')).toBe(true)
  expect(compatible('codex', 'openai-compatible')).toBe(true)
  expect(compatible('claude', 'openai-compatible')).toBe(false)
})
// routes
test('openai-compatible requires a base URL (422 without)', async () => {
  const bad = await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'agent-provider',
      values: { agent: 'opencode', provider: 'openai-compatible', provider_api_key: 'k' },
    }),
  )
  expect(bad.status).toBe(422)
  const ok = await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'agent-provider',
      values: {
        agent: 'opencode',
        provider: 'openai-compatible',
        provider_api_key: 'k',
        provider_base_url: 'https://llm.corp.com/v1',
      },
    }),
  )
  expect(ok.status).toBe(200)
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `types.ts`** — `PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const`. Update `compatible`:

```ts
export function compatible(agent: string, provider: string): boolean {
  if (agent === 'claude') return provider === 'anthropic'
  if (agent === 'codex') return provider === 'openai' || provider === 'openai-compatible'
  if (agent === 'opencode') return provider === 'anthropic' || provider === 'openai' || provider === 'openai-compatible'
  return false
}
```

- [ ] **Step 4: route** — in the agent-provider PATCH validation (`checkCompatibility` or alongside it), after the existing compat check: if the merged `provider === 'openai-compatible'` and the merged `provider_base_url` is empty/absent → `settingsJson(422, { error: 'openai-compatible requires a base URL' })`. Use the merged (existing ∪ patched) values, same as the compat check.

- [ ] **Step 5: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 6: Commit**

```bash
git add src/coding-credentials/types.ts src/debug/settings/coding-credentials-routes.ts tests/coding-credentials/types.test.ts tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(coding-credentials): openai-compatible provider + base-url-required validation"
```

---

## Task A2: `resolveProviderHost` facade + acp carries `projectSpec.providerHost`

**Bundled** so `deriveProviderHost`/`resolveProviderHost` have a consumer.

**Files:** `src/coding-credentials/types.ts` (`deriveProviderHost`), `src/coding-credentials/resolve-agent-secrets.ts`, `src/plugins/{runtime-types,tool-runtime}.ts`, `plugins/acp/session-tools.ts`. Tests: facade + acp.

- [ ] **Step 1: Failing tests** — `resolveProviderHost`: `anthropic`→`api.anthropic.com`, `openai`→`api.openai.com`, base-URL→its host (e.g. `openai-compatible` + `https://llm.corp.com/v1` → `llm.corp.com`), null when unset. acp: `start_session`/`review_pr` include `projectSpec.providerHost` when set.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `types.ts` — `deriveProviderHost`**

```ts
export function deriveProviderHost(provider: string, baseUrl: string | undefined): string | null {
  const base = baseUrl?.trim()
  if (base !== undefined && base.length > 0) {
    try {
      return new URL(base).host
    } catch {
      return null
    }
  }
  if (provider === 'anthropic') return 'api.anthropic.com'
  if (provider === 'openai') return 'api.openai.com'
  return null // openai-compatible without a base URL
}
```

- [ ] **Step 4: `resolve-agent-secrets.ts` — `resolveProviderHost`**

```ts
export function resolveProviderHost(storageContextId: string): string | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'agent-provider')
  if (creds === null) return null
  const provider = creds.provider?.trim() ?? 'anthropic'
  return deriveProviderHost(provider, creds.provider_base_url)
}
```

- [ ] **Step 5: facade** — `runtime-types.ts` add `resolveProviderHost(): string | null` to `codingSecrets`; `tool-runtime.ts` add to `buildCodingSecretsFacade` (permission-gated like `resolveForgeToken`).

- [ ] **Step 6: acp** — `session-tools.ts`: include `providerHost: runtimeContext.codingSecrets.resolveProviderHost() ?? undefined` in `projectSpec` (omit when null). Update tests.

- [ ] **Step 7: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 8: Commit**

```bash
git add src/coding-credentials/types.ts src/coding-credentials/resolve-agent-secrets.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts plugins/acp/session-tools.ts tests/coding-credentials/ tests/plugins/coding-secrets-facade.test.ts tests/plugins/acp/
git commit -m "feat(acp): resolveProviderHost; carry projectSpec.providerHost"
```

---

## Task A3: settings section — `openai-compatible` option + base-URL hint

**Files:** `client/settings/sections/CodingCredentialsSection.svelte`, `CLAUDE.md`. Tests: `tests/client/settings/coding-credentials-section.test.ts`.

> The provider `<select>` options come from the route's `options` (now incl. `openai-compatible` via A1), so the option auto-renders. A3 updates the **client-side** compat filter + a base-URL hint.

- [ ] **Step 1: Failing test** — when the agent is `codex` or `opencode`, the provider select includes `openai-compatible`; when `claude`, it does not. When `openai-compatible` is selected, the base-URL field is shown/labelled as required.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: section** — update the client-side `compatibleProviders(agent, ...)` map to mirror the A1 `compatible` rule (`codex → [openai, openai-compatible]`, `opencode → [anthropic, openai, openai-compatible]`, `claude → [anthropic]`). When the selected provider is `openai-compatible`, surface the base-URL field as required (label/placeholder); the route enforces the 422.

- [ ] **Step 4: doc** — `CLAUDE.md`: `openai-compatible` provider; egress is now derived per session from the provider host (+ agent-infra), narrowing the default; custom endpoints reachable within the operator ceiling.

- [ ] **Step 5: Run → pass (`bun test:client …`); `bun run knip` exit 0.**

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodingCredentialsSection.svelte CLAUDE.md tests/client/settings/coding-credentials-section.test.ts
git commit -m "feat(settings-ui): openai-compatible provider option + base-url hint"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: derived egress (one atomic commit)

**Files:** `src/project/config.ts`, `src/runtime/geofront/provisioning/presets.ts`, `src/runtime/geofront/provisioning/plan.ts`. Tests: `tests/project/*`, `tests/runtime/geofront/provisioning/{presets,plan}.test.ts`.

> Read the current `config.ts` (`ProjectSpec`, `buildEphemeralProject`, `ProvisioningAgent`), `presets.ts` (`AgentPreset.defaultEgress` + the 3 presets), and `plan.ts` (`resolvePlan` — how it merges egress from `project.egressAllowlistDomains` + `config?.egressAllowlistDomains` + `preset.defaultEgress`).

- [ ] **Step 1: Failing tests**

```ts
// config tests
const DEFAULTS = {
  workspaceImage: 'img',
  agentEntrypoint: ['x'],
  egressAllowlistDomains: ['registry.npmjs.org'],
  forge: { kind: 'github' as const, apiBaseUrl: 'https://api.github.com' },
}
test('deriveEgress: base + providerHost + agent-infra, no repo host', () => {
  const spec = {
    name: 'd',
    repoUrl: 'https://github.com/a/b.git',
    baseBranch: 'main',
    permissionPreset: 'cautious' as const,
    agent: 'opencode' as const,
    providerHost: 'api.openai.com',
  }
  expect(deriveEgress(spec, DEFAULTS).sort()).toEqual(['api.openai.com', 'models.dev', 'registry.npmjs.org'])
  // repo host 'github.com' is NOT present
})
test('deriveEgress: codex gets chatgpt.com; custom provider host', () => {
  const spec = {
    name: 'd',
    repoUrl: 'https://github.com/a/b.git',
    baseBranch: 'main',
    permissionPreset: 'cautious' as const,
    agent: 'codex' as const,
    providerHost: 'llm.corp.com',
  }
  expect(deriveEgress(spec, DEFAULTS).sort()).toEqual(['chatgpt.com', 'llm.corp.com', 'registry.npmjs.org'])
})
test('deriveEgress ignores a malformed providerHost', () => {
  const spec = {
    name: 'd',
    repoUrl: 'https://github.com/a/b.git',
    baseBranch: 'main',
    permissionPreset: 'cautious' as const,
    agent: 'claude' as const,
    providerHost: 'https://x/y',
  }
  expect(deriveEgress(spec, DEFAULTS)).toEqual(['registry.npmjs.org'])
})
```

Plus: `presets.test.ts` — `AgentPreset` no longer has `defaultEgress`; `plan.test.ts` — the resolved plan's egress equals the project's derived `egressAllowlistDomains` (no preset provider hosts mixed in).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `config.ts`**

```ts
export interface ProjectSpec {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: PermissionPreset
  agent: Exclude<ProvisioningAgent, 'custom'>
  forge?: { kind: ForgeKind; apiBaseUrl: string }
  providerHost?: string
}
export function agentInfraEgress(agent: string): string[] {
  if (agent === 'opencode') return ['models.dev']
  if (agent === 'codex') return ['chatgpt.com']
  return []
}
const isBareHost = (h: string): boolean => /^[a-z0-9.-]+(:[0-9]+)?$/iu.test(h)
export function deriveEgress(spec: ProjectSpec, defaults: ProjectDefaults): string[] {
  const provider = typeof spec.providerHost === 'string' && isBareHost(spec.providerHost) ? [spec.providerHost] : []
  return [...new Set([...defaults.egressAllowlistDomains, ...provider, ...agentInfraEgress(spec.agent)])]
}
```

In `validateRepoSpec`, parse an optional `providerHost` string onto the returned `ProjectSpec` (no host-allowlist check — egress is bounded by the geofront ceiling, not the repo allowlist). In `buildEphemeralProject`, set `egressAllowlistDomains: deriveEgress(spec, defaults)` (replacing the `defaults.egressAllowlistDomains` passthrough).

- [ ] **Step 4: `presets.ts`** — remove `defaultEgress` from `AgentPreset` and from `claudePreset`/`codexPreset`/`opencodePreset` (the agent-infra hosts now live in `agentInfraEgress`). Keep `install`/`defaultEntrypoint`/`secretTargets`.

- [ ] **Step 5: `plan.ts`** — in `resolvePlan`, drop `preset.defaultEgress` from the egress assembly; the egress is now `project.egressAllowlistDomains` (the derived set) plus any `config?.egressAllowlistDomains` provisioning override. Verify the geofront.toml egress emission reflects only that.

- [ ] **Step 6: Run → pass; `bun run typecheck && bun run lint` clean.**

- [ ] **Step 7: Commit**

```bash
git add src/project/config.ts src/runtime/geofront/provisioning/presets.ts src/runtime/geofront/provisioning/plan.ts tests/
git commit -m "feat(provisioning): derive per-session egress (provider host + agent-infra); drop preset provider egress"
```

---

## Final verification

- [ ] **papai:** `bun run check:full` — green.
- [ ] **magi:** `bun run check:full` — green.
- [ ] **Cross-repo:** papai sends `projectSpec.providerHost`; magi `deriveEgress` unions it with the operator base + agent-infra. A final reviewer confirms: an opencode+openai session reaches `api.openai.com` + `models.dev` + base (not `api.anthropic.com`); a custom `openai-compatible` host appears in the derived egress; the repo host does NOT; codex keeps `chatgpt.com`.
- [ ] **Operator doc:** add/update `docs/deployment/*` (magi) on setting the geofront egress org-ceiling wide enough for the providers users use, and that a custom-provider session failing to reach its host means the ceiling needs widening.
- [ ] **Manual smoke (live):** an opencode session with a custom `openai-compatible` endpoint (operator ceiling admits its host) reaches the model; the same with the host NOT in the ceiling fails to reach it (geofront clamp).

---

## Spec-coverage self-check

| Spec item                                                        | Task                             |
| ---------------------------------------------------------------- | -------------------------------- |
| `openai-compatible` provider + compatibility                     | A1                               |
| base URL required for openai-compatible (422)                    | A1                               |
| `deriveProviderHost` + `resolveProviderHost` facade              | A2                               |
| acp `projectSpec.providerHost`                                   | A2                               |
| section openai-compatible option + base-url hint                 | A3                               |
| `deriveEgress` (base + providerHost + agent-infra; no repo host) | B1                               |
| preset egress split (drop provider hosts, keep agent-infra)      | B1                               |
| geofront ceiling clamps (config/doc only)                        | (no code; operator doc in Final) |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-phase-4c-derived-egress.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Suggested order A1 → A2 → A3, then B1. **Which approach?**
