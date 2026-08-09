<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Namespace-Aware Story Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Storybook fixtures for `/settings/api/coding-credentials` dispatch on the `namespace` query parameter, so `CodeHostSection`'s stories serve the `forge` form instead of `agent-provider` data.

**Architecture:** Three handler families share one URL. Each resolver checks the request's `namespace` and returns `undefined` when it is not its own, which makes MSW fall through to the next matching handler. Scenarios then compose additively. A CI-gated unit test asserts every family answers only its own namespace, so a future family that forgets its guard fails the build rather than silently hijacking a sibling section.

**Tech Stack:** MSW 2.15.0, Storybook 10, Playwright (`@crvy/strybk`), Bun test runner, Svelte 5 runes.

Spec: [`docs/superpowers/specs/2026-07-31-story-fixture-namespace-design.md`](../specs/2026-07-31-story-fixture-namespace-design.md)

## Global Constraints

- The guard helper is `isNamespace(request: Request, namespace: string): boolean`, comparing `new URL(request.url).searchParams.get('namespace')` for strict equality.
- A resolver that is not for the request's namespace returns `undefined` — never `HttpResponse` with an error status, and never `passthrough()`. Fall-through depends on it (`node_modules/msw/lib/core/utils/executeHandlers.js:33`–`41` breaks only on `result?.response`).
- In any `async` resolver the guard runs **before** any `await`. Guarding after a `delay()` makes foreign-namespace requests hang instead of falling through.
- The `forge` fixture body carries exactly `namespace`, `configured`, `complete`, `missing`, `fields`. Never `allowedAgents`, `catalog`, `pluginServers`, `maxMcpServers`, or `selections` — the route attaches those per-namespace (`src/debug/settings/coding-credentials-routes.ts:213`–`225`).
- Forge field labels are copied verbatim from `src/debug/settings/coding-credentials-fields-meta.ts:63`–`79`: `Code host`, `Instance URL (enterprise / self-hosted)`, `Access token`.
- `FORGE_KINDS` is `['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted']` (`src/coding-credentials/types.ts:56`).
- **`max-lines` is enforced at 300 for non-test files, and `client/stories/msw/settings-handlers-personal.ts` is currently exactly 300 lines.** Any net addition to that file fails lint. This is why Task 1 moves code out of it rather than editing in place.
- Every new file needs the repo's SPDX/BUSL-1.1 header. Copy the shape from a sibling file. **Do NOT run `bun run license:headers`** — it stamps dozens of unrelated pre-existing files.
- Formatter is `oxfmt` via `bun run format`, not prettier. Run it before committing and accept its output.
- Import paths use the `.js` extension, including for `.ts` sources.
- Never add lint-disable or type-ignore comments; a repo hook blocks them. If a lint rule blocks an approach, restructure the code. `vitest(no-conditional-in-test)` forbids `if` inside `test()` bodies — extract helpers to module level.
- `tests/client/**` is excluded from default `bun test` discovery by `bunfig.toml`. The only working invocation is:
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
- The guard test must pass under the default Bun test timeout. If it needs a raised `--timeout` to pass, a `loading` family is being probed on its own namespace — fix the probe, do not raise the timeout.
- **Do NOT run `bun shoot:gen`.** It invokes `bun run license:headers` internally. Story names do not change in this plan, so the generated spec regions need no regeneration.

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `client/stories/msw/namespace.ts` (create) | The `isNamespace` guard. Its own module so both fixture files import a util rather than each other. |
| `client/stories/msw/settings-handlers-coding.ts` (create) | Every `agent-provider` and `forge` fixture and handler family for the shared endpoint, all guarded. |
| `client/stories/msw/settings-handlers-personal.ts` (modify) | Loses the agent-provider block (lines 19–107), dropping it to ~211 lines. Keeps `HandlerFamily`, `boom`, `NEVER_RESOLVE_MS`, which its other families still use. |
| `client/stories/msw/settings-handlers-personal-2.ts` (modify) | Its seven `mcp` handlers gain guards in place. 241 lines today; comfortably under the ceiling after. |
| `client/stories/msw/scenarios.ts` (modify) | Re-points the coding-credentials imports and adds four `settings-code-host-*` keys. |
| `client/settings/sections/CodeHostSection.stories.svelte` (modify) | Retargets its four stories to the forge scenarios. |
| `tests/client/stories/msw/coding-credentials-namespace.test.ts` (create) | The guard regression test. |
| `tests/client/stories/msw/namespace.test.ts` (create) | Unit coverage of `isNamespace` — match, mismatch, and missing-param. |
| `tests/client/stories/msw/settings-handlers-coding.test.ts` (create) | Mirror test for the new fixture module; receives the assertions trimmed out of `settings-handlers-personal.test.ts`. |
| `tests/client/stories/msw/settings-handlers-personal.test.ts` (modify) | Loses its `codingCredentialsHandlers` assertions, which move to the mirror test above. |

**The repo's TDD write hook requires an exact-name mirror test before it will let you write a new source file.** Creating `client/stories/msw/namespace.ts` requires `tests/client/stories/msw/namespace.test.ts` to exist first; the same holds for `settings-handlers-coding.ts`. Task 1 discovered this. Task 3 adds `forgeHandlers` to `settings-handlers-coding.ts`, so extend that module's mirror test in the same task rather than treating the guard test as its only coverage.
| `tests/visual/settings/sections/CodeHostSection.spec.ts` (modify) | Three manual states retarget from agent-provider testids to forge ones, and the self-hosted reveal state is added. |

---

### Task 1: Guard helper and the agent-provider move

**Files:**

- Create: `client/stories/msw/namespace.ts`
- Create: `client/stories/msw/settings-handlers-coding.ts`
- Modify: `client/stories/msw/settings-handlers-personal.ts` (delete lines 19–107)
- Modify: `client/stories/msw/scenarios.ts` (import source only)
- Test: `tests/client/stories/msw/coding-credentials-namespace.test.ts`

**Interfaces:**

- Consumes: `HandlerFamily` from `./settings-handlers-personal.js` (declared at line 12; `{ populated, empty, error, loading }`, each `HttpHandler[]`).
- Produces:
  - `isNamespace(request: Request, namespace: string): boolean` from `client/stories/msw/namespace.ts`
  - `codingCredentialsHandlers: HandlerFamily` from `client/stories/msw/settings-handlers-coding.ts` (moved; same name as before)
  - Task 3 adds `forgeHandlers: HandlerFamily` to the same file.

- [ ] **Step 1: Write the failing test**

Create `tests/client/stories/msw/coding-credentials-namespace.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { getResponse } from 'msw'
import type { HttpHandler } from 'msw'

import { codingCredentialsHandlers } from '../../../../client/stories/msw/settings-handlers-coding.js'

const NAMESPACES = ['agent-provider', 'forge', 'mcp'] as const

const request = (namespace: string): Request =>
  new Request(`http://localhost/settings/api/coding-credentials?contextId=ctx-personal-1&namespace=${namespace}`)

/** Which of the three namespaces this handler set produces a response for. */
const answeredNamespaces = async (handlers: HttpHandler[]): Promise<string[]> => {
  const answered: string[] = []
  for (const namespace of NAMESPACES) {
    const response = await getResponse(handlers, request(namespace))
    if (response !== undefined) answered.push(namespace)
  }
  return answered
}

/**
 * Namespaces a handler set answers other than its own — must always be empty.
 *
 * Deliberately does NOT call answeredNamespaces and filter: the `loading` families delay
 * for NEVER_RESOLVE_MS on their own namespace, so probing it would stall the test for a
 * full minute. Only the foreign namespaces are requested, and each must fall through
 * immediately. A guard placed after the delay turns this into a test timeout.
 */
const foreignNamespaces = async (handlers: HttpHandler[], own: string): Promise<string[]> => {
  const answered: string[] = []
  for (const namespace of NAMESPACES.filter((ns) => ns !== own)) {
    const response = await getResponse(handlers, request(namespace))
    if (response !== undefined) answered.push(namespace)
  }
  return answered
}

const RESPONDING: { name: string; handlers: HttpHandler[]; own: string }[] = [
  { name: 'agent-provider populated', handlers: codingCredentialsHandlers.populated, own: 'agent-provider' },
  { name: 'agent-provider empty', handlers: codingCredentialsHandlers.empty, own: 'agent-provider' },
  { name: 'agent-provider error', handlers: codingCredentialsHandlers.error, own: 'agent-provider' },
]

// The `loading` families delay past any test timeout for their own namespace, so they are
// asserted negatively via foreignNamespaces, which never requests the own namespace.
const LOADING: { name: string; handlers: HttpHandler[]; own: string }[] = [
  { name: 'agent-provider loading', handlers: codingCredentialsHandlers.loading, own: 'agent-provider' },
]

test.each(RESPONDING)('$name answers only its own namespace', async ({ handlers, own }) => {
  expect(await answeredNamespaces(handlers)).toEqual([own])
})

test.each(LOADING)('$name falls through for foreign namespaces', async ({ handlers, own }) => {
  expect(await foreignNamespaces(handlers, own)).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' \
  tests/client/stories/msw/coding-credentials-namespace.test.ts
```

Expected: FAIL — the module `client/stories/msw/settings-handlers-coding.js` does not exist yet, so the import cannot resolve.

- [ ] **Step 3: Create the guard helper**

Create `client/stories/msw/namespace.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * True when the request targets `namespace`.
 *
 * `/settings/api/coding-credentials` serves three namespaces off one URL. Handlers for it
 * must return `undefined` when this is false, so MSW falls through to the next matching
 * handler instead of answering another section's request with the wrong body.
 */
export const isNamespace = (request: Request, namespace: string): boolean =>
  new URL(request.url).searchParams.get('namespace') === namespace
```

- [ ] **Step 4: Create the coding handlers file**

Create `client/stories/msw/settings-handlers-coding.ts` from `settings-handlers-personal.ts:19`–`106`. Three changes from the source, and no others — every fixture object body is byte-identical, so the CodingCredentialsSection baselines cannot move:

1. `type AgentProviderField` → `type FixtureField` and `agentProviderField()` → `credentialField()`. The forge fixture in Task 3 reuses the helper, so the name must not say agent-provider. Signature and body are unchanged.
2. The three `/settings/api/coding-credentials` resolvers gain namespace guards. The `error` family's `http.get('/settings/api/coding-credentials', boom)` — which passes `boom` as the resolver directly — becomes an arrow that guards first.
3. `NEVER_RESOLVE_MS` and `boom` are re-declared here. They are *not* moved: `settings-handlers-personal.ts` still has 4 uses of each in its other families.

The `/models` handler is a different URL and takes no namespace, so it stays unguarded:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'

import { isNamespace } from './namespace.js'
import type { HandlerFamily } from './settings-handlers-personal.js'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

// --- Coding credentials (GET /settings/api/coding-credentials) ---
// Three namespaces share this URL: 'agent-provider' and 'forge' here, 'mcp' in
// settings-handlers-personal-2.ts. Every resolver must guard on its own namespace.

const AGENT_OPTIONS = ['claude', 'codex', 'opencode']
const PROVIDER_OPTIONS = ['anthropic', 'openai', 'openai-compatible']
const AUTH_METHOD_OPTIONS = ['api-key', 'oauth-subscription']

type FixtureField = Record<string, unknown>

function credentialField(key: string, label: string, overrides: FixtureField = {}): FixtureField {
  return { key, label, required: false, sensitive: false, hasValue: false, value: '', ...overrides }
}

function agentProviderFields(hasValue: boolean): FixtureField[] {
  return [
    credentialField('agent', 'Coding agent', {
      required: true,
      hasValue,
      value: 'claude',
      control: 'select',
      options: AGENT_OPTIONS,
    }),
    credentialField('provider', 'Model provider', {
      required: true,
      hasValue,
      value: 'anthropic',
      control: 'select',
      options: PROVIDER_OPTIONS,
    }),
    credentialField('auth_method', 'Auth method', {
      hasValue,
      value: 'api-key',
      control: 'select',
      options: AUTH_METHOD_OPTIONS,
    }),
    credentialField('provider_api_key', 'API key', {
      required: true,
      sensitive: true,
      hasValue,
      value: hasValue ? '****ab12' : '',
    }),
    credentialField('provider_base_url', 'Base URL'),
    credentialField('model', 'Model', { hasValue, value: hasValue ? 'claude-sonnet-4' : '', control: 'combobox' }),
  ]
}

const codingCredentialsPopulated = {
  namespace: 'agent-provider',
  configured: true,
  complete: true,
  missing: [],
  fields: agentProviderFields(true),
  allowedAgents: AGENT_OPTIONS,
}

const codingCredentialsEmpty = {
  namespace: 'agent-provider',
  configured: false,
  complete: false,
  missing: ['provider_api_key'],
  fields: agentProviderFields(false),
  allowedAgents: AGENT_OPTIONS,
}

const codingModelsPopulated = {
  ok: true,
  models: [
    { value: 'claude-sonnet-4', label: 'claude-sonnet-4' },
    { value: 'claude-opus-4', label: 'claude-opus-4' },
  ],
}

export const codingCredentialsHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials/models', () => HttpResponse.json(codingModelsPopulated)),
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'agent-provider') ? HttpResponse.json(codingCredentialsPopulated) : undefined,
    ),
  ],
  empty: [
    http.get('/settings/api/coding-credentials/models', () => HttpResponse.json({ ok: false, models: [] })),
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'agent-provider') ? HttpResponse.json(codingCredentialsEmpty) : undefined,
    ),
  ],
  error: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'agent-provider') ? boom() : undefined,
    ),
  ],
  loading: [
    http.get('/settings/api/coding-credentials', async ({ request }) => {
      // Guard before the delay: a foreign namespace must fall through immediately,
      // not hang for NEVER_RESOLVE_MS.
      if (!isNamespace(request, 'agent-provider')) return undefined
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingCredentialsEmpty)
    }),
  ],
}
```

- [ ] **Step 5: Delete the moved block from `settings-handlers-personal.ts`**

Delete lines 19–107 inclusive — from the comment `// --- Coding credentials (GET /settings/api/coding-credentials) ---` through the closing `}` of `export const codingCredentialsHandlers` at line 106, plus the blank line 107. Line 108 (`// --- Memory (GET /settings/api/memory) ---`) becomes the first line after the `HandlerFamily` interface.

Leave `HandlerFamily` (lines 12–17), `NEVER_RESOLVE_MS` (line 9), and `boom` (line 10) in place: the file's other families still use them, 4 uses each.

Verify the file shrank:

```bash
wc -l client/stories/msw/settings-handlers-personal.ts
```

Expected: ~211 lines, and in all cases fewer than 300.

- [ ] **Step 6: Re-point the import in `scenarios.ts`**

`scenarios.ts` imports `codingCredentialsHandlers` at line 59, inside the block at lines 58–67 that pulls from `./settings-handlers-personal.js`. Delete that one line from the block — the block's seven other names stay — and add a new import statement. oxfmt sorts import statements by module path, so `./settings-handlers-coding.js` belongs above the `./settings-handlers-group.js` block; run `bun run format` and accept its placement:

```ts
import { codingCredentialsHandlers } from './settings-handlers-coding.js'
```

The four scenario keys at lines 207–210 keep referring to `codingCredentialsHandlers` and need no edit.

- [ ] **Step 7: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' \
  tests/client/stories/msw/coding-credentials-namespace.test.ts
```

Expected: PASS, 4 tests (3 responding + 1 loading).

- [ ] **Step 8: Verify the guard actually guards**

Temporarily change the `error` family's guard to `isNamespace(request, 'mcp') ? boom() : undefined` and re-run the command from Step 7.

Expected: FAIL on `agent-provider error answers only its own namespace`, with received `["mcp"]` against expected `["agent-provider"]`.

Revert the change and confirm the test passes again.

- [ ] **Step 9: Run the full checks**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all pass. `max-lines` must not fire on any file.

- [ ] **Step 10: Commit**

```bash
git add client/stories/msw/namespace.ts client/stories/msw/settings-handlers-coding.ts \
        client/stories/msw/settings-handlers-personal.ts client/stories/msw/scenarios.ts \
        tests/client/stories/msw/coding-credentials-namespace.test.ts
git commit -m "refactor(stories): guard agent-provider fixtures by namespace"
```

---

### Task 2: Guard the MCP handlers

**Files:**

- Modify: `client/stories/msw/settings-handlers-personal-2.ts:175`–`197`
- Test: `tests/client/stories/msw/coding-credentials-namespace.test.ts`

**Interfaces:**

- Consumes: `isNamespace(request: Request, namespace: string): boolean` from `./namespace.js`.
- Produces: no new exports. `codingMcpHandlers`, `codingMcpNoCatalogHandlers`, `codingMcpInternalAvailableHandlers`, and `codingMcpInternalSelectedHandlers` keep their existing names and types (`HandlerFamily` for the first, `HttpHandler[]` for the other three).

- [ ] **Step 1: Extend the test with the MCP cases**

In `tests/client/stories/msw/coding-credentials-namespace.test.ts`, add the import:

```ts
import {
  codingMcpHandlers,
  codingMcpInternalAvailableHandlers,
  codingMcpInternalSelectedHandlers,
  codingMcpNoCatalogHandlers,
} from '../../../../client/stories/msw/settings-handlers-personal-2.js'
```

Append to the `RESPONDING` array:

```ts
  { name: 'mcp populated', handlers: codingMcpHandlers.populated, own: 'mcp' },
  { name: 'mcp empty', handlers: codingMcpHandlers.empty, own: 'mcp' },
  { name: 'mcp error', handlers: codingMcpHandlers.error, own: 'mcp' },
  { name: 'mcp no-catalog', handlers: codingMcpNoCatalogHandlers, own: 'mcp' },
  { name: 'mcp internal-available', handlers: codingMcpInternalAvailableHandlers, own: 'mcp' },
  { name: 'mcp internal-selected', handlers: codingMcpInternalSelectedHandlers, own: 'mcp' },
```

Append to the `LOADING` array:

```ts
  { name: 'mcp loading', handlers: codingMcpHandlers.loading, own: 'mcp' },
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' \
  tests/client/stories/msw/coding-credentials-namespace.test.ts
```

Expected: FAIL on the six new `RESPONDING` cases — each currently answers all three namespaces, so received is `["agent-provider", "forge", "mcp"]` against expected `["mcp"]`. The `mcp loading` case fails by timing out, because its unguarded resolver delays on every namespace.

- [ ] **Step 3: Guard the MCP handlers**

In `client/stories/msw/settings-handlers-personal-2.ts`, add the import:

```ts
import { isNamespace } from './namespace.js'
```

Replace the four-family block and the three standalone handler arrays:

```ts
export const codingMcpHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpPopulated) : undefined,
    ),
  ],
  empty: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpEmpty) : undefined,
    ),
  ],
  error: [http.get('/settings/api/coding-credentials', ({ request }) => (isNamespace(request, 'mcp') ? boom() : undefined))],
  loading: [
    http.get('/settings/api/coding-credentials', async ({ request }) => {
      // Guard before the delay: a foreign namespace must fall through immediately.
      if (!isNamespace(request, 'mcp')) return undefined
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingMcpEmpty)
    }),
  ],
}

export const codingMcpNoCatalogHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpNoCatalog) : undefined,
  ),
]

export const codingMcpInternalAvailableHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpInternalAvailable) : undefined,
  ),
]

export const codingMcpInternalSelectedHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpInternalSelected) : undefined,
  ),
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' \
  tests/client/stories/msw/coding-credentials-namespace.test.ts
```

Expected: PASS, 11 tests (9 responding + 2 loading).

- [ ] **Step 5: Run the full checks**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/stories/msw/settings-handlers-personal-2.ts \
        tests/client/stories/msw/coding-credentials-namespace.test.ts
git commit -m "refactor(stories): guard mcp fixtures by namespace"
```

---

### Task 3: The forge fixture, scenarios, and story retarget

**Files:**

- Modify: `client/stories/msw/settings-handlers-coding.ts` (append the forge block)
- Modify: `client/stories/msw/scenarios.ts` (import + four new keys)
- Modify: `client/settings/sections/CodeHostSection.stories.svelte`
- Test: `tests/client/stories/msw/coding-credentials-namespace.test.ts`

**Interfaces:**

- Consumes: `isNamespace`, `credentialField(key: string, label: string, overrides?: FixtureField): FixtureField`, `HandlerFamily`, and the module-local `boom` / `NEVER_RESOLVE_MS` — all already in `settings-handlers-coding.ts` from Task 1.
- Produces: `forgeHandlers: HandlerFamily` from `client/stories/msw/settings-handlers-coding.ts`, and the scenario keys `settings-code-host-populated`, `settings-code-host-empty`, `settings-code-host-error`, `settings-code-host-loading`.

- [ ] **Step 1: Extend the test with the forge cases**

In `tests/client/stories/msw/coding-credentials-namespace.test.ts`, change the `settings-handlers-coding.js` import to:

```ts
import { codingCredentialsHandlers, forgeHandlers } from '../../../../client/stories/msw/settings-handlers-coding.js'
```

Append to the `RESPONDING` array:

```ts
  { name: 'forge populated', handlers: forgeHandlers.populated, own: 'forge' },
  { name: 'forge empty', handlers: forgeHandlers.empty, own: 'forge' },
  { name: 'forge error', handlers: forgeHandlers.error, own: 'forge' },
```

Append to the `LOADING` array:

```ts
  { name: 'forge loading', handlers: forgeHandlers.loading, own: 'forge' },
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' \
  tests/client/stories/msw/coding-credentials-namespace.test.ts
```

Expected: FAIL — `forgeHandlers` is not exported from `settings-handlers-coding.js`.

- [ ] **Step 3: Add the forge fixture and handlers**

Append to `client/stories/msw/settings-handlers-coding.ts`:

```ts
// --- Forge (namespace: 'forge') ---
// Mirrors FIELDS_META.forge in src/debug/settings/coding-credentials-fields-meta.ts:63-79.
// The route attaches allowedAgents only for 'agent-provider' and the catalog keys only for
// 'mcp', so a forge body carries neither.

const FORGE_KIND_OPTIONS = ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted']

function forgeFields(hasValue: boolean): FixtureField[] {
  return [
    credentialField('kind', 'Code host', {
      required: true,
      hasValue,
      // A SaaS kind, so instance_url starts hidden and the reveal interaction is observable.
      value: hasValue ? 'github' : '',
      control: 'select',
      options: FORGE_KIND_OPTIONS,
    }),
    credentialField('instance_url', 'Instance URL (enterprise / self-hosted)'),
    credentialField('forge_token', 'Access token', {
      required: true,
      sensitive: true,
      hasValue,
      value: hasValue ? '****cd34' : '',
    }),
  ]
}

const forgePopulated = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: forgeFields(true),
}

// `missing` follows allRequiredFields (src/coding-credentials/store.ts:60): both required fields.
const forgeEmpty = {
  namespace: 'forge',
  configured: false,
  complete: false,
  missing: ['kind', 'forge_token'],
  fields: forgeFields(false),
}

export const forgeHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'forge') ? HttpResponse.json(forgePopulated) : undefined,
    ),
  ],
  empty: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'forge') ? HttpResponse.json(forgeEmpty) : undefined,
    ),
  ],
  error: [http.get('/settings/api/coding-credentials', ({ request }) => (isNamespace(request, 'forge') ? boom() : undefined))],
  loading: [
    http.get('/settings/api/coding-credentials', async ({ request }) => {
      // Guard before the delay: a foreign namespace must fall through immediately.
      if (!isNamespace(request, 'forge')) return undefined
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(forgeEmpty)
    }),
  ],
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' \
  tests/client/stories/msw/coding-credentials-namespace.test.ts
```

Expected: PASS, 15 tests (12 responding + 3 loading).

- [ ] **Step 5: Add the scenario keys**

In `client/stories/msw/scenarios.ts`, extend the coding import to:

```ts
import { codingCredentialsHandlers, forgeHandlers } from './settings-handlers-coding.js'
```

Add four keys immediately after the `settings-coding-credentials-loading` entry (currently line 210):

```ts
  'settings-code-host-populated': [...forgeHandlers.populated],
  'settings-code-host-empty': [...forgeHandlers.empty],
  'settings-code-host-error': [...forgeHandlers.error],
  'settings-code-host-loading': [...forgeHandlers.loading],
```

- [ ] **Step 6: Retarget the CodeHostSection stories**

In `client/settings/sections/CodeHostSection.stories.svelte`, make five single-line edits. Keep every `<Story>` block's existing multi-line shape and attribute order — change only the strings, so the markup formatter has nothing to reflow.

Line 20, the comment. It currently reads "same endpoint as CodingCredentialsSection", which is what made the wrong fixture look deliberate:

```svelte
<!-- CodeHostSection reads the 'forge' namespace of /settings/api/coding-credentials -->
```

Then the four `fixtures` values, at lines 24, 30, 36, and 42 respectively:

| Line | From | To |
| ---- | ---- | -- |
| 24 | `'settings-coding-credentials-populated'` | `'settings-code-host-populated'` |
| 30 | `'settings-coding-credentials-empty'` | `'settings-code-host-empty'` |
| 36 | `'settings-coding-credentials-error'` | `'settings-code-host-error'` |
| 42 | `'settings-coding-credentials-loading'` | `'settings-code-host-loading'` |

Story **names** stay `Populated`, `Empty`, `Error`, `Loading`, and the `defineMeta` title stays `settings/sections/CodeHostSection`. The generated spec region keys off both, and this plan does not regenerate it.

- [ ] **Step 7: Run the full checks**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/stories/msw/settings-handlers-coding.ts client/stories/msw/scenarios.ts \
        client/settings/sections/CodeHostSection.stories.svelte \
        tests/client/stories/msw/coding-credentials-namespace.test.ts
git commit -m "feat(stories): add forge fixtures and retarget CodeHostSection"
```

---

### Task 4: Retarget the visual spec, verify, and cover the reveal

**Files:**

- Modify: `tests/visual/settings/sections/CodeHostSection.spec.ts` (manual region only, below `// @generated-end auto-screenshots`)

**Interfaces:**

- Consumes: the scenario keys `settings-code-host-*` from Task 3, reached through the story ids `settings-sections-codehostsection--{populated,empty,error,loading}`.
- Produces: nothing later tasks consume — this is the final task.

**Why this task is not verification-only.** Three of the spec's existing manual states drive testids that belong to the agent-provider form and will not exist once Task 3 lands: `coding-replace-provider_api_key`, `coding-input-provider_api_key`, and `coding-input-provider_base_url`. The forge fixture's fields are `kind`, `instance_url`, and `forge_token`. Left alone, those three states fail with locator timeouts. They are retargeted in Step 1, before anything is shot.

- [ ] **Step 1: Retarget the manual states to forge fields**

In `tests/visual/settings/sections/CodeHostSection.spec.ts`, below `// @generated-end auto-screenshots`, replace three tests. The other three manual states (`populated, narrow`, `empty, narrow`, `save hover`) use `code-host-save` and viewport calls only, and need no change.

Replace `'CodeHostSection — replace secret open'` and `'CodeHostSection — dirty form, primary enabled'`. `forge_token` is sensitive with a stored value in the populated fixture, so the Replace affordance renders exactly as it did for `provider_api_key`:

```ts
test('CodeHostSection — replace secret open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-replace-forge_token').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodeHostSection — dirty form, primary enabled', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-replace-forge_token').click()
  await sharedPage.getByTestId('coding-input-forge_token').fill('ghp_new_token_value')
  await expect(sharedPage).toHaveScreenshot()
})
```

Replace `'CodeHostSection — long value overflow'`. Forge has no always-visible free-text field, so the long value goes into `instance_url`, which first has to be revealed by choosing a self-hosted kind:

```ts
test('CodeHostSection — long value overflow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await sharedPage
    .getByTestId('coding-input-instance_url')
    .fill('https://gitlab.self-hosted.internal.example.company.com/api/v4/very/long/path/segment')
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 2: Establish control baselines for the two unaffected sections**

Storybook caches concatenated CSS at startup (`bun storybook:prepare`) and `playwright.config.ts` sets `reuseExistingServer: true`, so a warm server serves stale assets. Stop any running Storybook, then:

```bash
bun storybook
```

Wait for it to serve on port 6006, then in another shell:

```bash
bun shoot -g CodingCredentialsSection
bun shoot -g CodingMcpSection
```

Expected: both pass, writing fresh baselines under `.storybook-shots/**`. These are the control: they must still pass after this branch's changes, proving the guards did not break the two sections that already worked.

- [ ] **Step 3: Re-shoot CodeHostSection**

```bash
bun shoot -g CodeHostSection
```

Expected: all ten states pass — the four generated plus the six manual — and rewrite their baselines. A locator timeout on `replace secret open`, `dirty form`, or `long value overflow` means Step 1 was skipped or mistyped.

- [ ] **Step 4: Read the regenerated screenshots and confirm the forge form**

Read the PNGs under `.storybook-shots/settings/sections/CodeHostSection.spec.ts/` with the Read tool.

Expected: the Populated and Empty states show fields labelled **Code host**, **Access token** — and *not* `Coding agent`, `Model provider`, `Auth method`, `API key`, `Base URL`, or `Model`. `Instance URL (enterprise / self-hosted)` must be **absent**, because the stored kind is `github`.

If the agent-provider fields still appear, the story is still resolving the old scenario — recheck Task 3 Step 6 and confirm Storybook was restarted.

- [ ] **Step 5: Add the self-hosted reveal state**

Append to `tests/visual/settings/sections/CodeHostSection.spec.ts`, after the manual states edited in Step 1. This is the minimal proof of the reveal at the default viewport — the long-value-overflow state also switches kind, but it is shot narrow with a filled field, so it cannot isolate the reveal:

```ts
test('CodeHostSection — self-hosted kind reveals Instance URL', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await expect(sharedPage).toHaveScreenshot()
})
```

`coding-select-kind` follows the section's existing testid pattern (`CodeHostSection.svelte:212`), which this spec file already uses throughout.

- [ ] **Step 6: Shoot the new state and confirm the reveal**

```bash
bun shoot -g CodeHostSection
```

Then read the new PNG with the Read tool.

Expected: the shot shows **Instance URL (enterprise / self-hosted)** present, which it is not in the Populated shot from Step 4. That difference is the proof that the conditional reveal works — a field that merely rendered in both would prove nothing.

- [ ] **Step 7: Verify the control sections are unchanged**

Run Playwright **without** `--update-snapshots`, so it compares against the Step 2 baselines instead of rewriting them:

```bash
bunx playwright test -g CodingCredentialsSection
bunx playwright test -g CodingMcpSection
```

Expected: both PASS with no pixel diffs. A failure here means a guard changed what one of those two sections receives, which is a regression in this branch's work — not an acceptable re-baseline.

- [ ] **Step 8: Run the full checks**

```bash
bun run check:full
```

Expected: all checks pass, including `test:client`, which runs the guard test in CI.

Two pre-existing failures on this branch are unrelated and out of scope — confirm they are no worse, and do not fix them: `tests/visual/settings/sections/ByokSection.spec.ts` (story-name drift from commit `188b5660e`) and `DataTable.spec.ts` (mounts with `Cannot read properties of undefined (reading 'length')`).

- [ ] **Step 9: Commit**

```bash
git add tests/visual/settings/sections/CodeHostSection.spec.ts
git commit -m "test(visual): retarget CodeHostSection states to forge fields"
```

Do not commit anything under `.storybook-shots/` — it is gitignored and always regenerated.

---

## Acceptance

1. `bun run check:full` passes.
2. The guard test passes and fails when any single guard is removed (verified in Task 1 Step 8).
3. All eleven CodeHostSection states shoot without a locator timeout and show the forge form.
4. CodingCredentialsSection and CodingMcpSection compare clean without `--update-snapshots`.

## Out of scope

- The composed `SettingsApp` scenarios. They register no coding-credentials handler, but the three coding sections sit inside the collapsible Advanced block (`client/settings/SettingsApp.svelte:245`) and `advancedCollapsed` initialises to `!ADVANCED_IDS.includes(initialHash)` (`:102`). Storybook renders with no URL hash, so they never mount and no fetch is issued.
- The agent-provider empty fixture's understated `missing: ['provider_api_key']` (`settings-handlers-coding.ts` after Task 1; `agent` and `provider` are required too). Correcting it would move the CodingCredentialsSection baselines that Task 4 Step 6 uses as its control.
- The remaining CodeHostSection review findings — the unmarked required `instance_url`, the unrendered connection status, the absent first-setup guidance. Those are sub-projects B and D.
