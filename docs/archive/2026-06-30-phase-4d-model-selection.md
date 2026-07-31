<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4d — Coding-session Model Selection + Codex Base-URL Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick a specific LLM model per coding agent (claude/codex/opencode), applied uniformly over ACP, and make a custom base URL actually take effect for codex.

**Architecture:** papai stores a `model` in the per-identity `agent-provider` vault and carries it in `projectSpec.model` to magi. magi applies it after `session/new` via ACP `session/set_config_option` (uniform across agents — no model env var). For codex, magi generates `~/.codex/config.toml` from the configured base URL (the connection-level fix; the old dead `OPENAI_BASE_URL` env is removed). The settings UI offers a model combobox populated by a provider `/v1/models` HTTP proxy with a free-text fallback.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, `@agentclientprotocol/sdk@0.28.1`, Svelte 5 (runes), `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-30-phase-4d-model-selection-design.md`

**Repos (two working trees):**

- **magi** — `/Users/ki/Projects/yourpapai/magi` (Tasks 1–3)
- **papai** — `/Users/ki/Projects/yourpapai/papai` (Tasks 4–7)

Run each repo's tests from that repo's root with `bun test <path>`. Commit in the repo where the files live.

---

## File structure (what changes, and why)

**magi**

- `src/project/config.ts` — add `model?: string` to `ProjectSpec`; validate it in `validateRepoSpec`. (Model rides the spec, not the secrets bundle.)
- `src/session/store.ts` — round-trip `model` in `parseProjectSpec` (serialization is `JSON.stringify(projectSpec)`, so only the parse side needs the field).
- `src/acp/select-model.ts` _(new)_ — pure helper `selectModelConfig(configOptions, model)`; isolated so it is unit-testable without a live agent.
- `src/acp/types.ts` — add `model?: string` to `RunAcpSessionOptions`.
- `src/acp/client.ts` — after `session/new`, apply the model via `session/set_config_option`.
- `src/session/manager.ts` — thread `projectSpec.model` → `runTurn` → `runAcpSession`.
- `src/server/router.ts` — derive the launch agent from validated `projectSpec.agent` (#5 reconciliation).
- `src/runtime/geofront/provisioning/codex-config.ts` _(new)_ — `generateCodexConfigToml(baseUrl)`.
- `src/runtime/geofront/provisioning/presets.ts` — codex preset: drop dead `OPENAI_BASE_URL` env, add a generated-config secret target.
- `src/runtime/geofront/provisioning/secret-stager.ts` — handle the new `generateCodexConfig` secret variant.

**papai**

- `src/coding-credentials/types.ts` — add `'model'` to `AGENT_PROVIDER_FIELDS`.
- `src/coding-credentials/resolve-agent-secrets.ts` — add `resolveModel`.
- `src/coding-credentials/provider-models.ts` _(new)_ — `fetchProviderModels(...)` for the `/models` proxy.
- `src/plugins/tool-runtime.ts` + `src/plugins/types.ts` — add `resolveModel()` to the `codingSecrets` facade + its type.
- `plugins/acp/tools.ts` — add `resolveModel` to the `codingSecrets` interface; include `model` in `buildSessionProjectSpec`.
- `src/debug/settings/coding-credentials-routes.ts` — `combobox` control, `model` field metadata, model validation, `/models` handler.
- `src/debug/settings-api-router.ts` — route `/settings/api/coding-credentials/models`.
- `client/settings/fetcher-schemas.ts` + `client/settings/fetchers.ts` — `combobox` control type + `fetchCodingModels`.
- `client/settings/sections/CodingCredentialsSection.svelte` — render the model combobox + reset on agent change.
- `docs/architecture/coding-sessions.md` — document the feature.

---

# Tasks 1–3 — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task 1: `ProjectSpec.model` plumbing (config + store round-trip)

**Files:**

- Modify: `src/project/config.ts` (`ProjectSpec` interface ~60-68, `validateRepoSpec` ~146-186)
- Modify: `src/session/store.ts` (`parseProjectSpec` ~46-59)
- Test: `tests/project/config.test.ts` (or the existing config test file — confirm with `ls tests/project`), `tests/session/store.test.ts`

- [ ] **Step 1: Write the failing test for model validation**

Add to the config test file (create `tests/project/config.test.ts` if none exists; match the repo's existing test imports — check a sibling test for the exact import of `validateRepoSpec`):

```ts
import { describe, expect, it } from 'bun:test'
import { validateRepoSpec } from '../../src/project/config.js'

const policy = { allowedHosts: ['github.com'] }
const base = {
  name: 'r',
  repoUrl: 'https://github.com/o/r',
  baseBranch: 'main',
  permissionPreset: 'cautious',
  agent: 'claude',
}

describe('validateRepoSpec model', () => {
  it('returns model when provided', () => {
    expect(validateRepoSpec({ ...base, model: 'claude-sonnet-4-6' }, policy).model).toBe('claude-sonnet-4-6')
  })
  it('omits model when absent or blank', () => {
    expect(validateRepoSpec(base, policy).model).toBeUndefined()
    expect(validateRepoSpec({ ...base, model: '   ' }, policy).model).toBeUndefined()
  })
  it('rejects an over-long model', () => {
    expect(() => validateRepoSpec({ ...base, model: 'x'.repeat(201) }, policy)).toThrow(/model/)
  })
  it('rejects control characters', () => {
    expect(() => validateRepoSpec({ ...base, model: 'a\nb' }, policy)).toThrow(/model/)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/project/config.test.ts`
Expected: FAIL — `model` is not a property of the returned spec / no validation.

- [ ] **Step 3: Add `model` to `ProjectSpec` and validate it**

In `src/project/config.ts`, add to the `ProjectSpec` interface (after `providerHost?: string`):

```ts
  providerHost?: string
  model?: string
```

Add this helper above `validateRepoSpec`:

```ts
function parseModel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (t.length === 0) return undefined
  if (t.length > 200) throw new Error('projectSpec.model too long (max 200)')
  if (/[\u0000-\u001f]/u.test(t)) throw new Error('projectSpec.model contains control characters')
  return t
}
```

In `validateRepoSpec`, before the final `return`, compute the model and include it:

```ts
const providerHostRaw = o['providerHost']
const providerHost = typeof providerHostRaw === 'string' && providerHostRaw.length > 0 ? providerHostRaw : undefined
const model = parseModel(o['model'])
return { name, repoUrl, baseBranch, permissionPreset, agent: agentRaw, forge, providerHost, model }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun test tests/project/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store round-trip test**

Add to `tests/session/store.test.ts` (match its existing setup for creating a store; if a helper builds a `ProjectSpec`, reuse it). Minimal assertion on `parseProjectSpec` via a stored+reloaded session — if the test file exposes `parseProjectSpec` indirectly, assert the reloaded session's `projectSpec.model`:

```ts
it('round-trips projectSpec.model', () => {
  // build a CreateSessionInput whose projectSpec has model set, store.create it, reload, assert
  // (follow the existing store test's create/get pattern in this file)
})
```

If `parseProjectSpec` is not exported, export it for testing OR assert through `store.get(id).projectSpec.model`. Confirm by reading the existing store test.

- [ ] **Step 6: Run it to confirm it fails**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — reloaded `projectSpec.model` is `undefined`.

- [ ] **Step 7: Round-trip `model` in `parseProjectSpec`**

In `src/session/store.ts` `parseProjectSpec`, after the `providerHost` lines:

```ts
const providerHostRaw = readStringField(parsed, 'providerHost')
const providerHost = providerHostRaw.length > 0 ? providerHostRaw : undefined
const modelRaw = readStringField(parsed, 'model')
const model = modelRaw.length > 0 ? modelRaw : undefined
return { name, repoUrl, baseBranch, permissionPreset, agent, forge, providerHost, model }
```

(The serialize side stores `JSON.stringify(input.projectSpec)`, so `model` already persists — only the parse side needed it.)

- [ ] **Step 8: Run tests to confirm pass**

Run: `bun test tests/session/store.test.ts tests/project/config.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/ki/Projects/yourpapai/magi
git add src/project/config.ts src/session/store.ts tests/project/config.test.ts tests/session/store.test.ts
git commit -m "feat(coding-sessions): carry projectSpec.model through spec validation + store"
```

---

## Task 2: Apply the model over ACP (`set_config_option`) + router agent reconciliation (#5)

**Files:**

- Create: `src/acp/select-model.ts`
- Test: `tests/acp/select-model.test.ts`
- Modify: `src/acp/types.ts` (`RunAcpSessionOptions` ~14-20)
- Modify: `src/acp/client.ts` (`runSession` ~27-43)
- Modify: `src/session/manager.ts` (`runLifecycle` call ~158-159, `runTurn` signature ~214-235)
- Modify: `src/server/router.ts` (`handleStart` ~88-115)
- Test: `tests/server/router.test.ts`

- [ ] **Step 1: Write the failing test for the pure selector**

Create `tests/acp/select-model.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { selectModelConfig } from '../../src/acp/select-model.js'

const opts = [
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
  {
    id: 'model',
    category: 'model',
    type: 'select',
    currentValue: 'gpt-5',
    options: [
      { value: 'gpt-5', name: 'GPT-5' },
      { value: 'o3', name: 'o3' },
    ],
  },
]

describe('selectModelConfig', () => {
  it('matches by value', () => {
    expect(selectModelConfig(opts, 'o3')).toEqual({ configId: 'model', value: 'o3' })
  })
  it('matches by display name', () => {
    expect(selectModelConfig(opts, 'GPT-5')).toEqual({ configId: 'model', value: 'gpt-5' })
  })
  it('flattens grouped options', () => {
    const grouped = [
      {
        id: 'model',
        category: 'model',
        type: 'select',
        currentValue: 'x',
        options: [{ name: 'Group', options: [{ value: 'x', name: 'X' }] }],
      },
    ]
    expect(selectModelConfig(grouped, 'x')).toEqual({ configId: 'model', value: 'x' })
  })
  it('returns null when no model category', () => {
    expect(selectModelConfig([opts[0]], 'o3')).toBeNull()
  })
  it('returns null on no match', () => {
    expect(selectModelConfig(opts, 'nope')).toBeNull()
  })
  it('returns null on empty/undefined options', () => {
    expect(selectModelConfig(undefined, 'o3')).toBeNull()
    expect(selectModelConfig(null, 'o3')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/acp/select-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure selector**

Create `src/acp/select-model.ts` (structural typing — does not depend on a specific exported SDK type name):

```ts
interface FlatOption {
  value: string
  name: string
}

function flattenOptions(options: unknown): FlatOption[] {
  if (!Array.isArray(options)) return []
  const out: FlatOption[] = []
  for (const entry of options) {
    if (entry === null || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    if (typeof rec['value'] === 'string') {
      out.push({ value: rec['value'], name: typeof rec['name'] === 'string' ? rec['name'] : rec['value'] })
    } else if ('options' in rec) {
      out.push(...flattenOptions(rec['options']))
    }
  }
  return out
}

/**
 * Given the `configOptions` from `session/new`, find the model selector and the
 * option matching `model` (by value, then by display name). Returns the
 * `{ configId, value }` to pass to `session/set_config_option`, or null when
 * there is no model selector or no matching option.
 */
export function selectModelConfig(
  configOptions: readonly unknown[] | null | undefined,
  model: string,
): { configId: string; value: string } | null {
  if (!Array.isArray(configOptions)) return null
  for (const entry of configOptions) {
    if (entry === null || typeof entry !== 'object') continue
    const opt = entry as Record<string, unknown>
    if (opt['category'] !== 'model' || opt['type'] !== 'select') continue
    if (typeof opt['id'] !== 'string') continue
    const match = flattenOptions(opt['options']).find((o) => o.value === model || o.name === model)
    if (match !== undefined) return { configId: opt['id'], value: match.value }
  }
  return null
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/acp/select-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `model` to `RunAcpSessionOptions`**

In `src/acp/types.ts`:

```ts
export interface RunAcpSessionOptions {
  socketPath: string
  cwd: string
  prompt: string
  model?: string
  signal?: AbortSignal
  handlers: AcpSessionHandlers
}
```

- [ ] **Step 6: Verify the SDK method accessor, then apply the model in `client.ts`**

First confirm the accessor name (avoids guessing):

Run: `cd /Users/ki/Projects/yourpapai/magi && grep -n 'setConfigOption' node_modules/@agentclientprotocol/sdk/dist/acp.js | head`
Expected: a line like `setConfigOption: schema.AGENT_METHODS.session_set_config_option` under the `agent.session` group → accessor is `acp.methods.agent.session.setConfigOption`. If the grouping differs, use the actual path shown.

In `src/acp/client.ts`, add the import and make `runSession`'s callback apply the model. Replace the `buildSession(...).withSession(...)` block (lines ~38-42):

```ts
import { selectModelConfig } from './select-model.js'
```

```ts
return cx.buildSession(opts.cwd).withSession(async (session: acp.ActiveSession): Promise<acp.PromptResponse> => {
  opts.handlers.onSessionCreated(session.sessionId)
  if (opts.model !== undefined && opts.model.length > 0) {
    const choice = selectModelConfig(session.newSessionResponse.configOptions, opts.model)
    if (choice === null) {
      logger.warn({ model: opts.model }, 'requested model not offered by agent; using default')
    } else {
      await cx.request(acp.methods.agent.session.setConfigOption, {
        sessionId: session.sessionId,
        configId: choice.configId,
        value: choice.value,
      })
      logger.info({ model: opts.model, configId: choice.configId }, 'applied session model')
    }
  }
  const promptDone = session.prompt(opts.prompt)
  return drainUpdates(session, opts, promptDone)
})
```

- [ ] **Step 7: Thread `model` through the manager**

In `src/session/manager.ts`:

Change the `runTurn` call inside `runLifecycle` (currently `await this.runTurn(id, launched, project, prepared, input.prompt, signal)`):

```ts
await this.runTurn(id, launched, project, prepared, input.prompt, input.projectSpec.model, signal)
```

Change the `runTurn` signature (add `model` after `prompt`):

```ts
    id: string,
    launched: LaunchedAgent,
    project: ProjectConfig,
    prepared: PreparedWorkspace,
    prompt: string,
    model: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
```

In the `runAcpSession({ ... })` call inside `runTurn`, add `model`:

```ts
    const result = await runAcpSession({
      socketPath: launched.socketPath,
      cwd: prepared.worktreePath,
      prompt,
      model,
      signal,
      handlers: {
```

- [ ] **Step 8: Typecheck the manager/client wiring**

Run: `cd /Users/ki/Projects/yourpapai/magi && bun run typecheck` (or the repo's typecheck script — check `package.json`; e.g. `tsc --noEmit`)
Expected: PASS (no type errors from the new `model` param / opts).

- [ ] **Step 9: Write the failing router #5 test**

In `tests/server/router.test.ts` (match its existing harness for building `ServerDeps` with a fake manager that records `startSession` input):

```ts
it('launches with the validated projectSpec.agent, ignoring an unvalidated top-level body.agent', async () => {
  // POST /sessions with body.agent='codex' but projectSpec.agent='claude'
  // assert the fake manager.startSession received input.agent === 'claude'
})
```

- [ ] **Step 10: Run it to confirm it fails**

Run: `bun test tests/server/router.test.ts`
Expected: FAIL — current code passes `agent: body.agent` (`'codex'`).

- [ ] **Step 11: Reconcile the agent source in `handleStart`**

In `src/server/router.ts` `handleStart`, replace the top-of-function reads and the `startSession` call so the launch agent comes from the validated spec:

```ts
async function handleStart(deps: ServerDeps, request: Request): Promise<Response> {
  const body = await readBody(request)
  const contextId = asString(body['contextId'])
  const prompt = asString(body['prompt'])
  if (contextId === null || prompt === null) {
    return json({ error: 'contextId, prompt are required' }, 400)
  }
  if (!deps.rateLimiter.check(contextId)) {
    return json({ error: 'rate limit exceeded; try again later' }, 429)
  }
  let projectSpec
  try {
    projectSpec = validateRepoSpec(body['projectSpec'], deps.policy)
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : 'invalid projectSpec' }, 400)
  }
  const forgeToken = asString(body['forgeToken']) ?? undefined
  const session = deps.manager.startSession({
    projectSpec,
    agent: projectSpec.agent,
    contextId,
    prompt,
    secrets: asStringRecord(body['secrets']),
    forgeToken,
  })
  return json({ id: session.id, status: session.status }, 202)
}
```

(`body['agent']` is no longer read; the validated spec is the single source of truth.)

- [ ] **Step 12: Run the router test to confirm pass**

Run: `bun test tests/server/router.test.ts`
Expected: PASS. Also run `bun test tests/acp/select-model.test.ts` again — still PASS.

- [ ] **Step 13: Commit**

```bash
cd /Users/ki/Projects/yourpapai/magi
git add src/acp/select-model.ts src/acp/types.ts src/acp/client.ts src/session/manager.ts src/server/router.ts tests/acp/select-model.test.ts tests/server/router.test.ts
git commit -m "feat(coding-sessions): apply projectSpec.model via ACP set_config_option; use validated agent for launch"
```

---

## Task 3: Codex `config.toml` generation (base-URL fix) + drop dead `OPENAI_BASE_URL` env

**Files:**

- Create: `src/runtime/geofront/provisioning/codex-config.ts`
- Test: `tests/runtime/geofront/provisioning/codex-config.test.ts`
- Modify: `src/project/config.ts` (`SecretSource` union ~23-27)
- Modify: `src/runtime/geofront/provisioning/presets.ts` (`codexPreset` ~28-38)
- Modify: `src/runtime/geofront/provisioning/secret-stager.ts` (`stageOne` ~20-53)
- Test: `tests/runtime/geofront/provisioning/secret-stager.test.ts`

- [ ] **Step 1: Verify the container user's home directory (config.toml target path)**

Codex reads `$CODEX_HOME/config.toml`, defaulting to `~/.codex`. Confirm the workspace user's home so the manifest `file` target is correct (the manifest target is written literally — `~` does NOT expand in the init script).

Run: `cd /Users/ki/Projects/yourpapai/magi && grep -rniE 'WORKDIR|USER |/home/|useradd|adduser|HOME' src/runtime/geofront/provisioning/dockerfile.ts src/runtime/geofront/provisioning/assets/ 2>/dev/null | head`
Expected: confirms the home (the init script defaults `MAGI_WORKSPACE` to `/home/dev/workspace`, implying home `/home/dev`). Use the discovered home in the constant below. If it is not `/home/dev`, substitute the real path everywhere `CODEX_CONFIG_TARGET` appears.

- [ ] **Step 2: Write the failing test for the TOML generator**

Create `tests/runtime/geofront/provisioning/codex-config.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { generateCodexConfigToml } from '../../../../src/runtime/geofront/provisioning/codex-config.js'

describe('generateCodexConfigToml', () => {
  it('emits a custom model_provider pointing at the base URL with OPENAI_API_KEY', () => {
    const toml = generateCodexConfigToml('https://llm.corp.com/v1')
    expect(toml).toContain('model_provider = "custom"')
    expect(toml).toContain('[model_providers.custom]')
    expect(toml).toContain('base_url = "https://llm.corp.com/v1"')
    expect(toml).toContain('env_key = "OPENAI_API_KEY"')
    expect(toml).toContain('wire_api = "chat"')
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `bun test tests/runtime/geofront/provisioning/codex-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the generator**

Create `src/runtime/geofront/provisioning/codex-config.ts`:

```ts
// Absolute path because manifest targets are written literally (no `~` expansion
// in the init script). Confirmed against the workspace base image (Task 3, Step 1).
export const CODEX_CONFIG_TARGET = '/home/dev/.codex/config.toml'

/**
 * Codex sources its provider base URL from config.toml (it ignores OPENAI_BASE_URL).
 * Generate a `custom` provider pointing at the user's base URL; the API key is read
 * from the OPENAI_API_KEY env var (staged separately). `wire_api = "chat"` is the
 * broadly-compatible default for OpenAI-compatible proxies. The session model is
 * applied separately over ACP.
 */
export function generateCodexConfigToml(baseUrl: string): string {
  return [
    'model_provider = "custom"',
    '[model_providers.custom]',
    'name = "custom"',
    `base_url = "${baseUrl}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "chat"',
    '',
  ].join('\n')
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `bun test tests/runtime/geofront/provisioning/codex-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the `generateCodexConfig` secret variant to `SecretSource`**

In `src/project/config.ts`, extend the `SecretSource` union:

```ts
export type SecretSource =
  | { hostPath: string; target: string }
  | { keychain: string; target: string }
  | { env: string; targetEnv: string }
  | { request: string; targetEnv: string; required?: boolean }
  | { generateCodexConfig: true; target: string }
```

- [ ] **Step 7: Update the codex preset (drop dead env, add generated config)**

In `src/runtime/geofront/provisioning/presets.ts`, import the target and rewrite `codexPreset`:

```ts
import { CODEX_CONFIG_TARGET } from './codex-config.js'
```

```ts
function codexPreset(): AgentPreset {
  return {
    install: [guardedNpmInstall('codex-acp', '@zed-industries/codex-acp')],
    defaultEntrypoint: ['codex-acp'],
    secretTargets: [
      { request: 'OPENAI_API_KEY', targetEnv: 'OPENAI_API_KEY', required: true },
      { generateCodexConfig: true, target: CODEX_CONFIG_TARGET },
    ],
  }
}
```

(The `OPENAI_BASE_URL` env target is removed — it never reached the Codex CLI.)

- [ ] **Step 8: Write the failing stager test**

In `tests/runtime/geofront/provisioning/secret-stager.test.ts` (reuse the file's existing `SecretStagerDeps` fakes + temp dir; check how it currently builds a `ProvisioningPlan`):

```ts
it('stages a generated codex config.toml as a file when OPENAI_BASE_URL is present', async () => {
  // plan.secrets = [{ generateCodexConfig: true, target: '/home/dev/.codex/config.toml' }]
  // requestSecrets = { OPENAI_BASE_URL: 'https://llm.corp.com/v1' }
  // after stageSecrets, the manifest contains a `file\t<staged>\t/home/dev/.codex/config.toml` line
  // and the staged file content contains 'base_url = "https://llm.corp.com/v1"'
})

it('skips the codex config when no base URL is provided', async () => {
  // same plan, requestSecrets = {} → no manifest entry for the config target
})
```

- [ ] **Step 9: Run it to confirm it fails**

Run: `bun test tests/runtime/geofront/provisioning/secret-stager.test.ts`
Expected: FAIL — the `generateCodexConfig` branch does not exist.

- [ ] **Step 10: Handle the variant in `stageOne`**

In `src/runtime/geofront/provisioning/secret-stager.ts`, add the import and a branch at the top of `stageOne` (before the `'hostPath' in secret` check):

```ts
import { generateCodexConfigToml } from './codex-config.js'
```

```ts
if ('generateCodexConfig' in secret) {
  const baseUrl = requestSecrets['OPENAI_BASE_URL']
  if (baseUrl === undefined || baseUrl.length === 0) return null
  await writeFile(join(dir, staged), generateCodexConfigToml(baseUrl))
  return { staged, line: `file\t${staged}\t${secret.target}` }
}
```

- [ ] **Step 11: Run tests to confirm pass**

Run: `bun test tests/runtime/geofront/provisioning/`
Expected: PASS (codex-config + secret-stager).

- [ ] **Step 12: Typecheck**

Run: `cd /Users/ki/Projects/yourpapai/magi && bun run typecheck`
Expected: PASS — the `SecretSource` union exhaustiveness still holds (`stageOne` handles every variant).

- [ ] **Step 13: Commit**

```bash
cd /Users/ki/Projects/yourpapai/magi
git add src/runtime/geofront/provisioning/codex-config.ts src/runtime/geofront/provisioning/presets.ts src/runtime/geofront/provisioning/secret-stager.ts src/project/config.ts tests/runtime/geofront/provisioning/codex-config.test.ts tests/runtime/geofront/provisioning/secret-stager.test.ts
git commit -m "feat(coding-sessions): generate codex config.toml for custom base URL; drop dead OPENAI_BASE_URL env"
```

---

# Tasks 4–7 — papai (`/Users/ki/Projects/yourpapai/papai`)

## Task 4: papai vault `model` field + `resolveModel` + facade + `projectSpec.model`

**Files:**

- Modify: `src/coding-credentials/types.ts` (`AGENT_PROVIDER_FIELDS` line 30)
- Modify: `src/coding-credentials/resolve-agent-secrets.ts` (add `resolveModel`, near `resolveAgent` ~83-87)
- Modify: `src/plugins/tool-runtime.ts` (`buildCodingSecretsFacade`)
- Modify: `src/plugins/types.ts` (`PluginToolRuntimeContext['codingSecrets']` type — find with grep below)
- Modify: `plugins/acp/tools.ts` (`codingSecrets` interface ~21-27, `buildSessionProjectSpec` ~75-88)
- Test: `tests/coding-credentials/resolve-agent-secrets.test.ts`, `tests/plugins/acp/tools.test.ts` (confirm exact paths with `ls tests/coding-credentials tests/plugins/acp`)

- [ ] **Step 1: Write the failing test for `resolveModel`**

In `tests/coding-credentials/resolve-agent-secrets.test.ts` (reuse its store-seeding helpers; mirror an existing `resolveAgent` test):

```ts
it('resolveModel returns the stored model from the identity context', () => {
  // seed agent-provider creds with model: 'claude-sonnet-4-6' for the identity context
  expect(resolveModel(storageContextId, chatUserId)).toBe('claude-sonnet-4-6')
})
it('resolveModel returns null when model is absent or blank', () => {
  // seed creds without model → null; seed model:'  ' → null
})
```

(Add `resolveModel` to the import from `../../src/coding-credentials/resolve-agent-secrets.js`.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/coding-credentials/resolve-agent-secrets.test.ts`
Expected: FAIL — `resolveModel` is not exported.

- [ ] **Step 3: Add `model` to the vault fields and implement `resolveModel`**

In `src/coding-credentials/types.ts`:

```ts
export const AGENT_PROVIDER_FIELDS = ['agent', 'provider', 'provider_api_key', 'provider_base_url', 'model'] as const
```

(Leave `REQUIRED_AGENT_PROVIDER_FIELDS` unchanged — model is optional.)

In `src/coding-credentials/resolve-agent-secrets.ts`, add next to `resolveAgent` (model follows the identity context only — like the agent, and intentionally **not** pinned by `forceSharedKey`):

```ts
/**
 * Resolve the acting identity's configured model. Like resolveAgent, this reads
 * the identity context only (a user's model is their preference; an operator-forced
 * shared key does not override it). Returns null when absent or empty.
 */
export function resolveModel(storageContextId: string, chatUserId: string): string | null {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'agent-provider')
  const model = creds?.model?.trim()
  return model === undefined || model.length === 0 ? null : model
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/coding-credentials/resolve-agent-secrets.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `resolveModel` to the facade type and implementation**

Find the `codingSecrets` type:

Run: `grep -rn "resolveProviderHost" src/plugins/types.ts`
Expected: a `codingSecrets: { ... resolveProviderHost(): string | null }` block.

In `src/plugins/types.ts`, add to that interface:

```ts
    resolveModel(): string | null
```

In `src/plugins/tool-runtime.ts`, add the import (alongside the other resolvers) and the facade method:

```ts
import { /* …existing…, */ resolveModel } from '../coding-credentials/resolve-agent-secrets.js'
```

```ts
    resolveModel(): string | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      return resolveModel(storageContextId, chatUserId)
    },
```

In `plugins/acp/tools.ts`, add to the `codingSecrets` interface (after `resolveProviderHost`):

```ts
    resolveProviderHost(): string | null
    resolveModel(): string | null
```

- [ ] **Step 6: Write the failing test for `buildSessionProjectSpec` including model**

In `tests/plugins/acp/tools.test.ts` (reuse its fake `codingSecrets`; add `resolveModel` to the fake):

```ts
it('buildSessionProjectSpec includes model when resolveModel returns a value', () => {
  const cs = { resolveForge: () => null, resolveProviderHost: () => null, resolveModel: () => 'opus' } as any
  expect(
    buildSessionProjectSpec(
      { name: 'r', repoUrl: 'https://github.com/o/r', baseBranch: 'm', permissionPreset: 'cautious' },
      'claude',
      cs,
    ).model,
  ).toBe('opus')
})
it('buildSessionProjectSpec omits model when resolveModel returns null', () => {
  const cs = { resolveForge: () => null, resolveProviderHost: () => null, resolveModel: () => null } as any
  expect(
    'model' in
      buildSessionProjectSpec(
        { name: 'r', repoUrl: 'https://github.com/o/r', baseBranch: 'm', permissionPreset: 'cautious' },
        'claude',
        cs,
      ),
  ).toBe(false)
})
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `bun test tests/plugins/acp/tools.test.ts`
Expected: FAIL — `model` not present.

- [ ] **Step 8: Include `model` in `buildSessionProjectSpec`**

In `plugins/acp/tools.ts` `buildSessionProjectSpec`:

```ts
export function buildSessionProjectSpec(
  repo: RepoEntry,
  agent: string,
  codingSecrets: RuntimeContext['codingSecrets'],
): Record<string, unknown> {
  const base = buildProjectSpec(repo, agent)
  const forge = codingSecrets.resolveForge()
  const providerHost = codingSecrets.resolveProviderHost()
  const model = codingSecrets.resolveModel()
  return {
    ...base,
    ...(forge === null ? {} : { forge }),
    ...(providerHost === null ? {} : { providerHost }),
    ...(model === null ? {} : { model }),
  }
}
```

(Both `start_session` and `review_pr` call `buildSessionProjectSpec`, so both now carry `model`.)

- [ ] **Step 9: Run tests + typecheck**

Run: `bun test tests/plugins/acp/tools.test.ts && bun run typecheck`
Expected: PASS. (Any other fake `codingSecrets` in the suite must gain a `resolveModel` — fix compile errors by adding `resolveModel: () => null` to those fakes.)

- [ ] **Step 10: Commit**

```bash
cd /Users/ki/Projects/yourpapai/papai
git add src/coding-credentials/types.ts src/coding-credentials/resolve-agent-secrets.ts src/plugins/types.ts src/plugins/tool-runtime.ts plugins/acp/tools.ts tests/coding-credentials/resolve-agent-secrets.test.ts tests/plugins/acp/tools.test.ts
git commit -m "feat(coding-sessions): add per-identity model to agent-provider vault + projectSpec"
```

---

## Task 5: Settings route — `combobox` control, `model` field metadata, model validation

**Files:**

- Modify: `src/debug/settings/coding-credentials-routes.ts` (`FieldMeta` ~32-39, `FIELDS_META` ~41-54, `checkCompatibility` ~141-170)
- Modify: `client/settings/fetcher-schemas.ts` (the `CodingCredentialField` `control` union — find with grep)
- Test: `tests/debug/settings/coding-credentials-routes.test.ts` (confirm path with `ls tests/debug/settings`)

- [ ] **Step 1: Write the failing test for model validation**

In the routes test file (reuse its harness for issuing a PATCH with a fake authenticated principal):

```ts
it('accepts a valid model', async () => {
  // PATCH agent-provider values { agent:'claude', provider:'anthropic', provider_api_key:'k', model:'claude-sonnet-4-6' }
  // expect 200
})
it('rejects an over-long model with 422', async () => {
  // model: 'x'.repeat(201) → 422
})
it('rejects a model with control characters with 422', async () => {
  // model: 'a\nb' → 422
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: FAIL — model is accepted unconditionally (no validation) / over-long is stored.

- [ ] **Step 3: Add the `combobox` control type, the `model` field, and validation**

In `src/debug/settings/coding-credentials-routes.ts`:

Widen `FieldMeta.control`:

```ts
  control?: 'select' | 'combobox'
```

Add the `model` entry to `FIELDS_META['agent-provider']` (after `provider_base_url`):

```ts
    { key: 'provider_base_url', label: 'Base URL', required: false, sensitive: false },
    { key: 'model', label: 'Model', required: false, sensitive: false, control: 'combobox' },
```

Add model validation inside `checkCompatibility`, before the final `return null`:

```ts
const modelRaw = merged.model?.trim()
if (modelRaw !== undefined && modelRaw.length > 0) {
  if (modelRaw.length > 200) {
    return settingsJson(422, { error: 'model too long (max 200)' })
  }
  if (/[\u0000-\u001f]/u.test(modelRaw)) {
    return settingsJson(422, { error: 'model contains control characters' })
  }
}
return null
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `combobox` to the client field schema**

Run: `grep -n "control" client/settings/fetcher-schemas.ts`
Expected: a Zod enum like `z.enum(['select'])` (or `.optional()`) for `control` on the coding field schema.

Update that enum to include `'combobox'`, e.g.:

```ts
control: z.enum(['select', 'combobox']).optional(),
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/ki/Projects/yourpapai/papai
git add src/debug/settings/coding-credentials-routes.ts client/settings/fetcher-schemas.ts tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(settings): model field with combobox control + validation in coding credentials route"
```

---

## Task 6: `/models` provider proxy (SSRF-guarded) + fetcher + UI combobox

**Files:**

- Create: `src/coding-credentials/provider-models.ts`
- Test: `tests/coding-credentials/provider-models.test.ts`
- Modify: `src/debug/settings/coding-credentials-routes.ts` (add `handleModels` + route in `handleCodingCredentialsRoutes`)
- Modify: `src/debug/settings-api-router.ts` (line ~73 area)
- Modify: `client/settings/fetcher-schemas.ts` (+ models response schema), `client/settings/fetchers.ts` (+ `fetchCodingModels`)
- Modify: `client/settings/sections/CodingCredentialsSection.svelte`
- Test: `tests/debug/settings/coding-credentials-routes.test.ts` (models endpoint)

- [ ] **Step 1: Write the failing test for `fetchProviderModels`**

Create `tests/coding-credentials/provider-models.test.ts` (use `setMockFetch`/`restoreFetch` from `tests/utils/test-helpers.ts`):

```ts
import { afterEach, describe, expect, it } from 'bun:test'
import { fetchProviderModels } from '../../src/coding-credentials/provider-models.js'
import { restoreFetch, setMockFetch } from '../utils/test-helpers.js'

afterEach(() => restoreFetch())

describe('fetchProviderModels', () => {
  it('lists OpenAI models', async () => {
    setMockFetch(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'o3' }] }), { status: 200 }))
    expect(await fetchProviderModels('openai', undefined, 'k', 'codex')).toEqual([
      { value: 'gpt-5', label: 'gpt-5' },
      { value: 'o3', label: 'o3' },
    ])
  })
  it('lists Anthropic models', async () => {
    setMockFetch(async () => new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }), { status: 200 }))
    expect(await fetchProviderModels('anthropic', undefined, 'k', 'claude')).toEqual([
      { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    ])
  })
  it('prefixes ids for opencode', async () => {
    setMockFetch(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }))
    expect(await fetchProviderModels('openai', undefined, 'k', 'opencode')).toEqual([
      { value: 'openai/gpt-5', label: 'openai/gpt-5' },
    ])
  })
  it('throws on a non-200', async () => {
    setMockFetch(async () => new Response('nope', { status: 500 }))
    await expect(fetchProviderModels('openai', undefined, 'k', 'codex')).rejects.toThrow()
  })
  it('rejects a private base URL (SSRF)', async () => {
    await expect(fetchProviderModels('openai-compatible', 'http://127.0.0.1/v1', 'k', 'codex')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/coding-credentials/provider-models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `provider-models.ts`**

Create `src/coding-credentials/provider-models.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertPublicUrl } from '../web/safe-fetch.js'

export interface ModelOption {
  value: string
  label: string
}

const stripSlash = (u: string): string => u.replace(/\/+$/u, '')

function modelsRequest(
  provider: string,
  baseUrl: string | undefined,
  key: string,
): { url: string; headers: Record<string, string> } {
  const base = baseUrl?.trim()
  if (provider === 'anthropic') {
    const root = base !== undefined && base.length > 0 ? stripSlash(base) : 'https://api.anthropic.com'
    return { url: `${root}/v1/models`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
  }
  // openai + openai-compatible: OPENAI_BASE_URL convention already includes the version segment.
  const root = base !== undefined && base.length > 0 ? stripSlash(base) : 'https://api.openai.com/v1'
  return { url: `${root}/models`, headers: { authorization: `Bearer ${key}` } }
}

// opencode model ids are `provider/model`; claude/codex use bare ids. We only know
// the prefix for the well-known providers (custom openai-compatible → no prefix).
function opencodePrefix(provider: string): string | null {
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'openai') return 'openai'
  return null
}

function extractIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as Record<string, unknown>)['data']
  if (!Array.isArray(data)) return []
  return data
    .map((e) => (typeof e === 'object' && e !== null ? (e as Record<string, unknown>)['id'] : undefined))
    .filter((id): id is string => typeof id === 'string')
}

/**
 * Fetch the provider's model ids for the settings combobox. SSRF-guarded via
 * assertPublicUrl. For opencode, ids are prefixed with the provider where known.
 * Throws on network error / non-200 / blocked URL — the caller degrades to free-text.
 */
export async function fetchProviderModels(
  provider: string,
  baseUrl: string | undefined,
  key: string,
  agent: string,
): Promise<ModelOption[]> {
  const { url, headers } = modelsRequest(provider, baseUrl, key)
  await assertPublicUrl(new URL(url))
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`provider models request failed: ${res.status}`)
  const ids = extractIds(await res.json())
  const prefix = agent === 'opencode' ? opencodePrefix(provider) : null
  return ids.map((id) => {
    const v = prefix !== null ? `${prefix}/${id}` : id
    return { value: v, label: v }
  })
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/coding-credentials/provider-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test for `/models`**

In `tests/debug/settings/coding-credentials-routes.test.ts`:

```ts
it('GET /models returns {ok:false, models:[]} when no key is stored', async () => {
  // GET /settings/api/coding-credentials/models?agent=claude with empty vault → ok:false, models:[]
})
it('GET /models returns models when a key is stored', async () => {
  // seed agent-provider key+provider; setMockFetch to return OpenAI-shaped data; expect ok:true with mapped models
})
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: FAIL — `/models` is not routed (falls through / 405 or 404).

- [ ] **Step 7: Add the `handleModels` handler and route it**

In `src/debug/settings/coding-credentials-routes.ts`, add the import and handler:

```ts
import { fetchProviderModels } from '../../coding-credentials/provider-models.js'
```

```ts
async function handleModels(authed: AuthenticatedSettingsRequest, url: URL): Promise<Response> {
  const scope = resolveContextScope(authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const agent = url.searchParams.get('agent') ?? ''
  const creds = getCodingCredentials(scope.scope.contextId, 'agent-provider') ?? {}
  const provider = (creds as Record<string, string | undefined>)['provider']?.trim() ?? 'anthropic'
  const key = (creds as Record<string, string | undefined>)['provider_api_key']?.trim() ?? ''
  const baseUrl = (creds as Record<string, string | undefined>)['provider_base_url']?.trim()
  if (key.length === 0) return settingsJson(200, { ok: false, models: [] })
  try {
    const models = await fetchProviderModels(provider, baseUrl, key, agent)
    return settingsJson(200, { ok: true, models })
  } catch {
    return settingsJson(200, { ok: false, models: [] })
  }
}
```

Route it in `handleCodingCredentialsRoutes` (GET on the `/models` subpath, before the existing GET branch):

```ts
export function handleCodingCredentialsRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method === 'GET' && url.pathname.endsWith('/coding-credentials/models')) {
    return handleModels(auth.authed, url)
  }
  if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed, url))
  if (req.method === 'PATCH') return handlePatch(req, auth.authed)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
```

In `src/debug/settings-api-router.ts`, add the new path next to the existing mount (line ~73):

```ts
if (url.pathname === '/settings/api/coding-credentials/models') return handleCodingCredentialsRoutes(req, url)
if (url.pathname === '/settings/api/coding-credentials') return handleCodingCredentialsRoutes(req, url)
```

- [ ] **Step 8: Run the route test to confirm pass**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the client fetcher + schema**

In `client/settings/fetcher-schemas.ts`, add a models response schema (near the coding schemas):

```ts
export const CodingModelsResponseSchema = z.object({
  ok: z.boolean(),
  models: z.array(z.object({ value: z.string(), label: z.string() })),
})
export type CodingModelsResponse = z.infer<typeof CodingModelsResponseSchema>
```

In `client/settings/fetchers.ts`, add (mirroring `fetchCodingCredentials`; reuse `ctxQuery`):

```ts
import { CodingModelsResponseSchema, type CodingModelsResponse } from './fetcher-schemas.js'

export const fetchCodingModels = (contextId: string, agent: string): Promise<CodingModelsResponse> =>
  getJson(`/settings/api/coding-credentials/models?${ctxQuery(contextId)}&agent=${encodeURIComponent(agent)}`, (b) =>
    CodingModelsResponseSchema.parse(b),
  )
```

- [ ] **Step 10: Render the combobox in the Svelte section**

In `client/settings/sections/CodingCredentialsSection.svelte`:

Add the import and model state near the other imports/state:

```ts
import { fetchCodingCredentials, fetchCodingModels, patchCodingCredentials } from '../fetchers.js'
```

```ts
let modelOptions: { value: string; label: string }[] = $state([])
```

Load model options when the context/agent/key allow it. Add this effect after the existing `$effect`:

```ts
$effect(() => {
  const id = contextId
  const agent = currentAgent
  const hasKey = fields.find((f) => f.key === 'provider_api_key')?.hasValue === true
  untrack(() => {
    if (!hasKey || agent.length === 0) {
      modelOptions = []
      return
    }
    void fetchCodingModels(id, agent)
      .then((r) => {
        if (id === contextId) modelOptions = r.ok ? r.models : []
      })
      .catch(() => {
        if (id === contextId) modelOptions = []
      })
  })
})
```

Reset the model draft when the agent changes — extend `onSelectChange`'s `agent` branch:

```ts
if (field.key === 'agent') {
  const compatible = compatibleProviders(value, fields.find((f) => f.key === 'provider')?.options ?? [])
  const currentProvider = drafts['provider'] ?? ''
  if (compatible.length > 0 && !compatible.includes(currentProvider)) {
    updateDraft('provider', compatible[0]!)
  }
  updateDraft('model', '')
}
```

Render the combobox. In the field loop, add a branch alongside `{#if field.control === 'select'}`:

```svelte
          {:else if field.control === 'combobox'}
            <div class="settings-field__editor">
              <Field label="Value">
                {#snippet children()}
                  <input
                    list={`coding-models-${field.key}`}
                    data-testid={`coding-combobox-${field.key}`}
                    value={drafts[field.key] ?? ''}
                    placeholder="model id (leave blank for the agent default)"
                    disabled={saving || loading}
                    oninput={(e) => updateDraft(field.key, (e.currentTarget as HTMLInputElement).value)}
                    class="coding-select" />
                  <datalist id={`coding-models-${field.key}`}>
                    {#each modelOptions as opt (opt.value)}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </datalist>
                {/snippet}
              </Field>
            </div>
```

(The combobox is plain free-text input with `<datalist>` suggestions — typing any value is always allowed.)

- [ ] **Step 11: Typecheck + build the client**

Run: `cd /Users/ki/Projects/yourpapai/papai && bun run typecheck`
Expected: PASS. If the repo has a client build/check script (e.g. `bun run check:client` or `svelte-check`), run it and expect PASS.

- [ ] **Step 12: Run the full coding-related suites**

Run: `bun test tests/coding-credentials/ tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
cd /Users/ki/Projects/yourpapai/papai
git add src/coding-credentials/provider-models.ts src/debug/settings/coding-credentials-routes.ts src/debug/settings-api-router.ts client/settings/fetcher-schemas.ts client/settings/fetchers.ts client/settings/sections/CodingCredentialsSection.svelte tests/coding-credentials/provider-models.test.ts tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(settings): /models provider proxy (SSRF-guarded) + model combobox UI"
```

---

## Task 7: Documentation

**Files:**

- Modify: `docs/architecture/coding-sessions.md`

- [ ] **Step 1: Document model selection + the codex base-URL fix**

In `docs/architecture/coding-sessions.md`, in the "Agent/provider picker" area, add that the `agent-provider` namespace now also has a `model` field (optional, per-identity via `resolveModel`, not pinned by `forceSharedKey`), carried as `projectSpec.model` and applied by magi over ACP `session/set_config_option` after `session/new` (uniform across agents; unknown model ⇒ warn + agent default). Note the settings UI renders it as a `combobox` populated by the SSRF-guarded `/settings/api/coding-credentials/models` proxy (provider `/v1/models`) with a free-text fallback.

Add a short note that **codex's base URL is now applied via a generated `~/.codex/config.toml`** (`[model_providers.custom]`, `wire_api="chat"`) staged through the provisioning manifest's `file` kind — the previous `OPENAI_BASE_URL` env target was a no-op (Codex ignores it) and has been removed. Also note the router now derives the launch agent from the validated `projectSpec.agent`.

- [ ] **Step 2: Verify the doc reads correctly**

Run: `cd /Users/ki/Projects/yourpapai/papai && npx oxfmt --check docs/architecture/coding-sessions.md`
Expected: PASS (run `npx oxfmt --write docs/architecture/coding-sessions.md` if it reports issues).

- [ ] **Step 3: Commit**

```bash
cd /Users/ki/Projects/yourpapai/papai
git add docs/architecture/coding-sessions.md
git commit -m "docs(coding-sessions): document model selection + codex base-URL fix"
```

---

## Integration verification (after all tasks)

- [ ] **magi:** `cd /Users/ki/Projects/yourpapai/magi && bun test` — full suite green.
- [ ] **papai:** `cd /Users/ki/Projects/yourpapai/papai && bun test && bun run typecheck` — full suite + types green.
- [ ] **Manual (codex base URL):** confirm a codex session against an OpenAI-compatible endpoint reaches the model — the staged `/home/dev/.codex/config.toml` contains the custom `base_url` and the agent connects (per Task 3, Step 1 home verification).
- [ ] **Manual (model apply):** start a session with a `model` set and confirm the magi log shows `applied session model` (or the warn line if the agent does not offer that model). Verify per agent — claude / codex / opencode — since adapter `configOptions[category=model]` coverage is the key runtime risk.
