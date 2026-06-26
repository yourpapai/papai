<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4a — Multi-Provider + Agent Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick their coding agent (claude/codex/opencode) and model provider (Anthropic/OpenAI) in settings, and have sessions authenticate accordingly — making codex and opencode work for the first time.

**Architecture:** Extend the existing `agent-provider` vault (a JSON blob — no migration) with `provider` + `agent` fields and a `compatible(agent, provider)` rule; the `codingSecrets` facade maps `provider → {ANTHROPIC,OPENAI}_API_KEY` and exposes `resolveAgent`; the acp plugin carries `agent` in the projectSpec; magi makes the codex + opencode presets request-sourced and derives `provisioning.agent` from the spec. Anthropic/OpenAI with default hosts only — custom base URLs / openai-compatible / derived egress are Phase 4c. geofront unchanged.

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-26-phase-4a-multi-provider-design.md`

> **Execute on the current branches** (papai `master`, magi `main`), test-first. **Knip ordering:** A1 (vault types + route) is self-consuming; A2 bundles `resolveAgent` with its acp consumer; A3 (client) consumes the route; B1 (magi) is one atomic commit. Use explicit `git add` paths (parallel WIP may be present — never add files that aren't yours).

---

## File Structure

**Part A — papai**

- Modify `src/coding-credentials/types.ts` — `provider`/`agent` fields, `PROVIDERS`/`AGENTS`, `compatible()`.
- Modify `src/coding-credentials/resolve-agent-secrets.ts` — provider-aware mapping + `resolveAgent`.
- Modify `src/debug/settings/coding-credentials-routes.ts` — select-field metadata + compatibility validation.
- Modify `src/plugins/{runtime-types,tool-runtime}.ts` — `resolveAgent` on the facade.
- Modify `plugins/acp/session-tools.ts` — carry `agent` in the projectSpec.
- Modify `client/settings/fetcher-schemas.ts` + `sections/CodingCredentialsSection.svelte` — select rendering.
- Modify `CLAUDE.md`.

**Part B — magi**

- Modify `src/runtime/geofront/provisioning/presets.ts` — codex + opencode request-sourced.
- Modify `src/project/config.ts` — `ProjectSpec.agent`, `validateRepoSpec`, `buildEphemeralProject`.

---

# Part A — papai

## Task A1: vault provider/agent fields + compatibility + provider-aware mapping + route

**Files:** `src/coding-credentials/types.ts`, `src/coding-credentials/resolve-agent-secrets.ts`, `src/debug/settings/coding-credentials-routes.ts`. Tests: `tests/coding-credentials/store.test.ts`, `tests/coding-credentials/resolve-agent-secrets.test.ts`, `tests/debug/settings/coding-credentials-routes.test.ts`.

> Read the current `types.ts` (`AGENT_PROVIDER_FIELDS`, `FIELDS_BY_NAMESPACE`), `resolve-agent-secrets.ts` (`resolveAgentSecrets`, `configContextOf`), and `coding-credentials-routes.ts` (`FIELDS_META`, `fieldResponse`, `valuesToPersist`, the PATCH schema).

- [ ] **Step 1: Write failing tests**

```ts
// resolve-agent-secrets.test.ts — provider-aware mapping
test('maps provider to the right env', () => {
  updateCodingCredentials(CTX, 'agent-provider', { provider: 'openai', agent: 'codex', provider_api_key: 'sk-o' }, 'u')
  expect(resolveAgentSecrets(CTX)).toEqual({ OPENAI_API_KEY: 'sk-o' })
  updateCodingCredentials(
    CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-a' },
    'u',
  )
  expect(resolveAgentSecrets(CTX)).toEqual({ ANTHROPIC_API_KEY: 'sk-a' })
})
// types/compat
import { compatible } from '../../src/coding-credentials/types.js'
test('compatibility rules', () => {
  expect(compatible('claude', 'anthropic')).toBe(true)
  expect(compatible('claude', 'openai')).toBe(false)
  expect(compatible('codex', 'openai')).toBe(true)
  expect(compatible('opencode', 'anthropic')).toBe(true)
  expect(compatible('opencode', 'openai')).toBe(true)
})
// routes — invalid pair rejected
test('PATCH rejects incompatible agent/provider', async () => {
  const res = await handleCodingCredentialsRoutes(
    ...authedPatch('/settings/api/coding-credentials', {
      contextId: CTX,
      namespace: 'agent-provider',
      values: { agent: 'claude', provider: 'openai', provider_api_key: 'x' },
    }),
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `types.ts`** — extend the field set + add enums + predicate:

```ts
export const AGENT_PROVIDER_FIELDS = ['provider', 'agent', 'provider_api_key', 'provider_base_url'] as const
export const REQUIRED_AGENT_PROVIDER_FIELDS = ['provider', 'agent', 'provider_api_key'] as const
export const PROVIDERS = ['anthropic', 'openai'] as const
export const AGENTS = ['claude', 'codex', 'opencode'] as const
export type Provider = (typeof PROVIDERS)[number]
export type Agent = (typeof AGENTS)[number]
export function compatible(agent: string, provider: string): boolean {
  if (agent === 'claude') return provider === 'anthropic'
  if (agent === 'codex') return provider === 'openai'
  if (agent === 'opencode') return provider === 'anthropic' || provider === 'openai'
  return false
}
```

(The store needs no logic change — it stores the JSON blob and uses `FIELDS_BY_NAMESPACE['agent-provider']`, which now includes the new keys.)

- [ ] **Step 4: `resolve-agent-secrets.ts`** — provider-aware mapping:

```ts
const PROVIDER_ENV: Record<string, { key: string; base: string }> = {
  anthropic: { key: 'ANTHROPIC_API_KEY', base: 'ANTHROPIC_BASE_URL' },
  openai: { key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
}
export function resolveAgentSecrets(storageContextId: string): Record<string, string> | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'agent-provider')
  const apiKey = creds?.provider_api_key?.trim()
  const provider = creds?.provider?.trim() ?? 'anthropic'
  const env = PROVIDER_ENV[provider]
  if (apiKey === undefined || apiKey.length === 0 || env === undefined) return null
  const out: Record<string, string> = { [env.key]: apiKey }
  const base = creds?.provider_base_url?.trim()
  if (base !== undefined && base.length > 0) out[env.base] = base
  return out
}
```

- [ ] **Step 5: route** — add select-field metadata + compatibility check. Extend the `FieldMeta` type with `control?: 'select'` + `options?: readonly string[]`; for the `agent-provider` namespace, `FIELDS_META` becomes:

```ts
'agent-provider': [
  { key: 'agent', label: 'Coding agent', required: true, sensitive: false, control: 'select', options: AGENTS },
  { key: 'provider', label: 'Model provider', required: true, sensitive: false, control: 'select', options: PROVIDERS },
  { key: 'provider_api_key', label: 'API key', required: true, sensitive: true },
  { key: 'provider_base_url', label: 'Base URL (optional)', required: false, sensitive: false },
],
```

`fieldResponse` includes `control`/`options` in each field. In the PATCH handler, after merging the to-persist values, if both `agent` and `provider` resolve (from the patch or existing stored config) and `!compatible(agent, provider)` → `settingsJson(422, { error: 'incompatible agent/provider' })`.

- [ ] **Step 6: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 7: Commit**

```bash
git add src/coding-credentials/types.ts src/coding-credentials/resolve-agent-secrets.ts \
  src/debug/settings/coding-credentials-routes.ts tests/coding-credentials/ tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(coding-credentials): provider+agent fields, provider→env mapping, compatibility"
```

---

## Task A2: `resolveAgent` facade + acp carries the agent

**Bundled** so `resolveAgent` has a consumer (the acp plugin) in one commit.

**Files:** `src/plugins/runtime-types.ts`, `src/plugins/tool-runtime.ts`, `src/coding-credentials/resolve-agent-secrets.ts` (add `resolveAgent`), `plugins/acp/session-tools.ts`. Tests: `tests/plugins/coding-secrets-facade.test.ts`, `tests/plugins/acp/*`.

- [ ] **Step 1: Failing tests** — facade `resolveAgent()` returns the stored agent (permission-gated); `start_session`/`review_pr` include `agent` in the `projectSpec` body (defaulting to `claude` when unset).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `resolve-agent-secrets.ts`** — add:

```ts
export function resolveAgent(storageContextId: string): string | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'agent-provider')
  const agent = creds?.agent?.trim()
  return agent === undefined || agent.length === 0 ? null : agent
}
```

- [ ] **Step 4: facade** — `runtime-types.ts` add `resolveAgent(): string | null` to `codingSecrets`; `tool-runtime.ts` add it to `buildCodingSecretsFacade` (permission-gated like `resolve`/`resolveForgeToken`).

- [ ] **Step 5: acp plugin** (`plugins/acp/session-tools.ts`) — `buildProjectSpec(repo, agent)` adds `agent`; `start_session`/`review_pr` compute `const agent = runtimeContext.codingSecrets.resolveAgent() ?? 'claude'` and pass it. Update tests asserting the `/sessions`/`/reviews` body to expect `projectSpec.agent`.

- [ ] **Step 6: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 7: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts \
  plugins/acp/session-tools.ts tests/plugins/coding-secrets-facade.test.ts tests/plugins/acp/
git commit -m "feat(acp): resolveAgent capability; carry agent in projectSpec"
```

---

## Task A3: settings section renders agent/provider selects

**Files:** `client/settings/fetcher-schemas.ts` (the stored-field schema gains `control`/`options`), `client/settings/sections/CodingCredentialsSection.svelte`, `CLAUDE.md`. Tests: `tests/client/settings/coding-credentials-section.test.ts`.

> Read the current `CodingCredentialsSection.svelte` and the `StoredConfigValueSchema`/`CodingCredentialsResponseSchema` in `fetcher-schemas.ts`.

- [ ] **Step 1: Failing test** — section renders a `<select>` for `agent` and `provider` (with the option lists), and the provider options are constrained to those compatible with the selected agent; the masked key + base-url still render.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: schema** — add `control: z.enum(['text','select']).optional()` and `options: z.array(z.string()).optional()` to `StoredConfigValueSchema`.

- [ ] **Step 4: section** — when `field.control === 'select'`, render a `<select>` of `field.options`; the `provider` select filters to options compatible with the currently-selected `agent` value (mirror the `compatible` rule client-side, or derive from a small map). Text/secret fields render as today. Saving a select issues the same per-field PATCH.

- [ ] **Step 5: wire/doc** — no SettingsApp change (section id unchanged). Update `CLAUDE.md` (agent/provider picker; codex/opencode now functional).

- [ ] **Step 6: Run → pass (`bun test:client …`); `bun run knip` exit 0.**

- [ ] **Step 7: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/sections/CodingCredentialsSection.svelte CLAUDE.md \
  tests/client/settings/coding-credentials-section.test.ts
git commit -m "feat(settings-ui): agent + provider selects in the AI provider section"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: request-sourced codex/opencode presets + `projectSpec.agent`

One atomic commit (the `ProjectSpec.agent` change touches `validateRepoSpec`/`buildEphemeralProject`/the router-validated shape together).

**Files:** `src/runtime/geofront/provisioning/presets.ts`, `src/project/config.ts`. Tests: `tests/runtime/geofront/provisioning/presets.test.ts`, `tests/runtime/geofront/provisioning/secret-stager.test.ts`, `tests/project/*`.

> Read the current `presets.ts` and `project/config.ts` (`ProjectSpec`, `validateRepoSpec`, `buildEphemeralProject`, `ProvisioningAgent`).

- [ ] **Step 1: Failing tests**

```ts
// presets.test.ts
test('codex is request-sourced (no host path)', () => {
  expect(getPreset('codex', 'linux')?.secretTargets).toEqual([
    { request: 'OPENAI_API_KEY', targetEnv: 'OPENAI_API_KEY', required: true },
    { request: 'OPENAI_BASE_URL', targetEnv: 'OPENAI_BASE_URL', required: false },
  ])
})
test('opencode stages whichever provider key is present', () => {
  const t = getPreset('opencode', 'linux')?.secretTargets ?? []
  expect(t.every((s) => 'request' in s)).toBe(true) // no host/keychain sources
})
// project — agent flows into provisioning
test('buildEphemeralProject sets provisioning.agent from the spec', () => {
  const p = buildEphemeralProject(
    {
      name: 'd',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      agent: 'codex',
    },
    DEFAULTS,
  )
  expect(p.provisioning?.agent).toBe('codex')
})
test('validateRepoSpec accepts the agent enum, defaults claude', () => {
  expect(
    validateRepoSpec(
      { name: 'd', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      POLICY,
    ).agent,
  ).toBe('claude')
  expect(() =>
    validateRepoSpec(
      {
        name: 'd',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'bogus',
      },
      POLICY,
    ),
  ).toThrow()
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `presets.ts`**

```ts
function codexPreset(): AgentPreset {
  return {
    install: ['RUN npm install -g @zed-industries/codex-acp'],
    defaultEntrypoint: ['codex-acp'],
    secretTargets: [
      { request: 'OPENAI_API_KEY', targetEnv: 'OPENAI_API_KEY', required: true },
      { request: 'OPENAI_BASE_URL', targetEnv: 'OPENAI_BASE_URL', required: false },
    ],
    defaultEgress: ['api.openai.com', 'chatgpt.com'],
  }
}
function opencodePreset(): AgentPreset {
  return {
    install: ['RUN npm install -g opencode-ai'],
    defaultEntrypoint: ['opencode', 'acp'],
    secretTargets: [
      { request: 'ANTHROPIC_API_KEY', targetEnv: 'ANTHROPIC_API_KEY', required: false },
      { request: 'ANTHROPIC_BASE_URL', targetEnv: 'ANTHROPIC_BASE_URL', required: false },
      { request: 'OPENAI_API_KEY', targetEnv: 'OPENAI_API_KEY', required: false },
      { request: 'OPENAI_BASE_URL', targetEnv: 'OPENAI_BASE_URL', required: false },
    ],
    defaultEgress: ['models.dev', 'api.anthropic.com', 'api.openai.com'],
  }
}
```

- [ ] **Step 4: `project/config.ts`** — `ProjectSpec` gains `agent: ProvisioningAgent`; in `validateRepoSpec`, read `o['agent']`, default `'claude'` when absent, reject if not in the `ProvisioningAgent` set (claude/codex/opencode — `custom` is out of 4a scope; reject it or allow per your preference); `buildEphemeralProject` sets `provisioning: { ...defaults.provisioning, agent: spec.agent }`.

- [ ] **Step 5: Run → pass; `bun run typecheck && bun run lint` clean.**

- [ ] **Step 6: Commit**

```bash
git add src/runtime/geofront/provisioning/presets.ts src/project/config.ts tests/
git commit -m "feat(provisioning): request-sourced codex/opencode; agent from projectSpec"
```

---

## Final verification

- [ ] **papai:** `bun run check:full` — green.
- [ ] **magi:** `bun run check:full` — green.
- [ ] **Cross-repo:** papai sends `projectSpec.agent` + `secrets` keyed per provider (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); magi's per-agent preset requests the matching env. A final reviewer confirms the env names line up per agent (claude→ANTHROPIC, codex→OPENAI, opencode→either) and codex/opencode no longer use host credentials.

---

## Spec-coverage self-check

| Spec item                                        | Task   |
| ------------------------------------------------ | ------ |
| `provider`/`agent` vault fields + `compatible()` | A1     |
| provider→env mapping                             | A1     |
| select fields + compatibility 422                | A1     |
| `resolveAgent` facade                            | A2     |
| acp carries `agent` in projectSpec               | A2     |
| settings section selects                         | A3     |
| codex/opencode request-sourced                   | B1     |
| `projectSpec.agent` → `provisioning.agent`       | B1     |
| geofront untouched                               | (none) |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-phase-4a-multi-provider.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Suggested order A1 → A2 → A3, then B1. **Which approach?**
