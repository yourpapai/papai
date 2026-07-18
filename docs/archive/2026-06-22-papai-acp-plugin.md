<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — ACP Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party papai plugin `plugins/acp/` that lets a chat user drive sandboxed coding-agent sessions by calling the external **magi** control service over HTTP. It exposes LLM tools (start / list / status / finish / cancel a session, answer a permission, review a PR, list projects / agents), an `/acp` command, and a prompt fragment; it authenticates to magi with an admin-configured bearer token and base URL, and uses `plugin_kv` to scope session listings to the originating chat context.

**Architecture:** Spec plan #7 (`docs/superpowers/specs/2026-06-16-acp-plugin-design.md`, §6.1). A thin client: the plugin holds NO ACP/git/forge logic — every tool is a typed wrapper over a magi REST endpoint, called via `ctx.providerRuntime.httpFetch`. magi's base URL + token live in **admin-scoped** `configRequirements`; the base URL is also in `providerAllowedHostsFromConfig` so a LAN `http://magi:8787` is allowlisted (admin-tier hosts bypass the HTTPS/SSRF checks). The plugin injects `contextId = runtimeContext.storageContextId` into start/review calls (so magi's milestone Notifier can post back to `/api/notify`), and records each session id under `plugin_kv` to scope `list_sessions` to this chat.

**magi REST contract (from plan #5, already implemented):** bearer auth on all routes.

- `POST /sessions { project, agent, contextId, prompt }` → `202 { id, status }`
- `GET /sessions?filter=new|active|waiting|review|done` → `Session[]`
- `GET /sessions/:id` → `Session | 404`
- `POST /sessions/:id/finish { message, action: 'push'|'pr', title?, body? }` → `Session`
- `POST /sessions/:id/cancel` → `Session`
- `GET /sessions/:id/permissions` → `PendingPermission[]` (each has `toolCallId`, `title`)
- `POST /sessions/:id/permission { toolCallId, decision: 'allow'|'deny' }` → `{ resolved: boolean }`
- `POST /reviews { project, prNumber, contextId }` → `202 { id, status }`
- `GET /projects` → `ProjectSummary[]`; `GET /agents` → `{ name }[]`

**Tech Stack:** Bun, TypeScript (strict, `.js` imports), pino. **No zod and no other bare-module imports in the plugin's static graph** (discovery rejects them) — use raw JSON-Schema objects for tool `inputSchema` + manual guards (the `synthetic-web-search` pattern). Tests use `bun:test` with hand-built mock contexts (no DB).

---

## House rules (papai harness — obey)

- No semicolons; single quotes; 120-col; `.js` on every relative import; `import type` for type-only; BUSL header on every `.ts` (and this `.md`).
- **Plugin static-graph rule:** `index.ts` and everything it statically imports must NOT import bare modules (no `zod`, no npm packages). Relative imports (`./client.js`, `./schemas.js`) and **type-only** imports from `../../src/**` are fine (types are erased). Globals (`Response`, `URL`, `JSON`) are fine.
- Tool `execute` returns a plain JSON-serializable value; on failure return a structured `{ error, ... }` object rather than throwing.
- TDD write-hook applies to `plugins/**/*.ts`: write the matching `tests/plugins/acp/<x>.test.ts` (importing the module via its `.js` path) **before** the source file.
- knip: `plugins/*/index.ts!` is already an entry and `plugins/**/*.ts!` is in `project`; dynamically-loaded plugin entries need an `ignoreIssues` entry (Task 6). No inline lint-disable.
- Per-task gate: `bun check`. Final: `bun run test` + `bun check:full`.

## File Structure

**Create:**

- `plugins/acp/plugin.json` — manifest (id `acp`, `http`/`storage`/`commands` perms, admin config for base URL + token, tool/command/fragment contributions).
- `plugins/acp/schemas.ts` — raw JSON-Schema `as const` objects for each tool's `inputSchema` (plain objects, zero imports).
- `plugins/acp/client.ts` — `readMagiConfig`, `callMagi`, and small input guards (`asString`, `optionalString`, `asPositiveInt`). Relative/type-only imports only.
- `plugins/acp/index.ts` — factory/`activate`: captures `httpFetch`, registers all tools + the `/acp` command + the prompt fragment.
- Tests under `tests/plugins/acp/`.

**Modify:**

- `knip.jsonc` — `ignoreIssues` entry for the dynamically-loaded plugin entry.

---

## Task 1: Scaffold + magi client + read-only tools (`list_projects`, `list_agents`)

Establishes the manifest, the `httpFetch`/`adminConfig` wiring, the `callMagi` helper, and two simple GET tools end-to-end.

**Files:** Create `plugins/acp/plugin.json`, `plugins/acp/schemas.ts`, `plugins/acp/client.ts`, `plugins/acp/index.ts`, `tests/plugins/acp/read-tools.test.ts`

- [ ] **Step 1: Create the manifest** `plugins/acp/plugin.json`

```json
{
  "id": "acp",
  "name": "ACP Coding Sessions",
  "version": "1.0.0",
  "description": "Drive sandboxed AI coding-agent sessions via the magi control service",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": [
      "start_session",
      "list_sessions",
      "session_status",
      "finish_session",
      "cancel_session",
      "answer_permission",
      "review_pr",
      "list_projects",
      "list_agents"
    ],
    "commands": ["acp"],
    "promptFragments": ["acp-hint"]
  },
  "permissions": ["http", "storage", "commands"],
  "providerAllowedHostsFromConfig": ["magi_base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "magi_base_url", "label": "Magi Base URL", "required": true, "sensitive": false, "scope": "admin" },
    { "key": "magi_token", "label": "Magi Bearer Token", "required": true, "sensitive": true, "scope": "admin" }
  ],
  "activationTimeoutMs": 5000
}
```

- [ ] **Step 2: Create `plugins/acp/schemas.ts`** (raw JSON Schema, zero imports)

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

export const startSessionSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Configured project name (see list_projects)' },
    prompt: { type: 'string', description: 'What the coding agent should do' },
    agent: { type: 'string', description: 'Agent preset; omit to use the default' },
  },
  required: ['project', 'prompt'],
  additionalProperties: false,
} as const

export const listSessionsSchema = {
  type: 'object',
  properties: {
    filter: {
      type: 'string',
      enum: ['new', 'active', 'waiting', 'review', 'done'],
      description: 'Which sessions to list; defaults to active',
    },
  },
  additionalProperties: false,
} as const

export const sessionIdSchema = {
  type: 'object',
  properties: { sessionId: { type: 'string', description: 'magi session id' } },
  required: ['sessionId'],
  additionalProperties: false,
} as const

export const finishSessionSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    action: { type: 'string', enum: ['push', 'pr'], description: 'push the branch, or open a PR' },
    message: { type: 'string', description: 'Commit message; defaults to a generic message' },
    title: { type: 'string', description: 'PR title (action=pr)' },
    body: { type: 'string', description: 'PR body (action=pr)' },
  },
  required: ['sessionId', 'action'],
  additionalProperties: false,
} as const

export const answerPermissionSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    decision: { type: 'string', enum: ['allow', 'deny'] },
  },
  required: ['sessionId', 'decision'],
  additionalProperties: false,
} as const

export const reviewPrSchema = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    prNumber: { type: 'integer', description: 'Pull/merge request number' },
  },
  required: ['project', 'prNumber'],
  additionalProperties: false,
} as const
```

- [ ] **Step 3: Write the failing test** `tests/plugins/acp/read-tools.test.ts`

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import factory from '../../../plugins/acp/index.js'
import type { PluginContext, PluginToolRuntimeContext } from '../../../src/plugins/context.js'
import type { PluginTool } from '../../../src/plugins/types.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function activate(httpFetch: HttpFetch): Map<string, PluginTool> {
  const tools = new Map<string, PluginTool>()
  const ctx = {
    pluginId: 'acp',
    contextId: '__system__',
    permissions: new Set(['http', 'storage', 'commands']),
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registration: {
      registerTool: (t: PluginTool) => tools.set(t.name, t),
      registerPromptFragment: () => {},
      registerCommand: () => {},
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
      registerTaskProviderType: () => {},
    },
    providerRuntime: {
      httpFetch,
      allowedHosts: new Set<string>(),
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    },
    adminConfig: { get: () => undefined },
  } as unknown as PluginContext
  factory().activate(ctx)
  return tools
}

function runtimeCtx(overrides: { httpUrls?: string[] } = {}): PluginToolRuntimeContext {
  const _ = overrides
  return {
    pluginId: 'acp',
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    adminConfig: {
      get: (k: string) => (k === 'magi_base_url' ? 'http://magi:8787' : k === 'magi_token' ? 'tok' : undefined),
    },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => Promise.reject(new Error('no')) },
  } as unknown as PluginToolRuntimeContext
}

const options = { toolCallId: 'c1', messages: [] } as unknown as Parameters<PluginTool['execute']>[2]

describe('acp read tools', () => {
  test('list_projects GETs /projects with bearer auth', async () => {
    let seenUrl = ''
    let seenAuth: string | null = null
    const httpFetch: HttpFetch = (url, init) => {
      seenUrl = url
      seenAuth = new Headers(init?.headers).get('authorization')
      return Promise.resolve(
        jsonResponse([{ name: 'demo', baseBranch: 'main', forgeKind: 'github', agent: 'claude-code-acp' }]),
      )
    }
    const tools = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), options)
    expect(seenUrl).toBe('http://magi:8787/projects')
    expect(seenAuth).toBe('Bearer tok')
    expect(result).toEqual([{ name: 'demo', baseBranch: 'main', forgeKind: 'github', agent: 'claude-code-acp' }])
  })

  test('list_agents GETs /agents', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([{ name: 'claude-code-acp' }])))
    const tools = activate(httpFetch)
    const result = await tools.get('list_agents')!.execute({}, runtimeCtx(), options)
    expect(result).toEqual([{ name: 'claude-code-acp' }])
  })

  test('returns not_configured when admin config is missing', async () => {
    const tools = activate(mock())
    const rt = { ...runtimeCtx(), adminConfig: { get: () => undefined } } as unknown as PluginToolRuntimeContext
    const result = await tools.get('list_projects')!.execute({}, rt, options)
    expect(result).toEqual({ error: 'not_configured', message: 'magi base URL or token is not configured' })
  })

  test('surfaces a magi error response', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ error: 'boom' }, 500))
    const tools = activate(httpFetch)
    const result = await tools.get('list_projects')!.execute({}, runtimeCtx(), options)
    expect(result).toEqual({ error: 'magi_error', status: 500, body: { error: 'boom' } })
  })
})
```

Run `bun test tests/plugins/acp/read-tools.test.ts` → FAIL (no `index.js`). (Confirm `PluginToolRuntimeContext` and `PluginTool` are exported from `src/plugins/context.js` / `src/plugins/types.js`; the synthetic-web-search test imports them from `../../src/plugins/types.js` — match whatever resolves.)

- [ ] **Step 4: Create `plugins/acp/client.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

export type AdminConfigReader = { get(key: string): string | undefined }

export type MagiConfig = { baseUrl: string; token: string }

export type MagiResult = unknown

export const NOT_CONFIGURED = { error: 'not_configured', message: 'magi base URL or token is not configured' } as const

export function readMagiConfig(adminConfig: AdminConfigReader): MagiConfig | null {
  const baseUrl = adminConfig.get('magi_base_url')
  const token = adminConfig.get('magi_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') {
    return null
  }
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}

export async function callMagi(
  httpFetch: HttpFetch,
  cfg: MagiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<MagiResult> {
  const res = await httpFetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data: unknown = text === '' ? null : JSON.parse(text)
  if (!res.ok) {
    return { error: 'magi_error', status: res.status, body: data }
  }
  return data
}

// --- input guards (raw JSON-schema validates shape for the LLM; these narrow at runtime) ---

export function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

export function asString(input: Record<string, unknown>, key: string): string | null {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function asPositiveInt(input: Record<string, unknown>, key: string): number | null {
  const v = input[key]
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}
```

- [ ] **Step 5: Create `plugins/acp/index.ts`** (Task 1 version: factory + the two read tools)

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { callMagi, NOT_CONFIGURED, readMagiConfig } from './client.js'
import type { HttpFetch } from './client.js'
import { emptySchema } from './schemas.js'

type Registration = {
  registerTool(tool: { name: string; description: string; inputSchema?: unknown; execute: ToolExecute }): void
  registerPromptFragment(fragment: { name: string; content: string }): void
  registerCommand(command: { name: string; description: string; execute: CommandExecute }): void
}

type AdminConfigReader = { get(key: string): string | undefined }
type RuntimeContext = { storageContextId: string; adminConfig: AdminConfigReader; kv: KvStore }
type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
type CommandExecute = (
  message: unknown,
  reply: { text(s: string): Promise<void> | void },
  auth: unknown,
) => Promise<void> | void

type ActivationContext = {
  registration: Registration
  providerRuntime?: { httpFetch: HttpFetch }
  log: { info(meta: unknown, msg: string): void }
}

function requireActivationContext(ctx: unknown): ActivationContext {
  if (typeof ctx !== 'object' || ctx === null) throw new Error('acp: invalid plugin context')
  return ctx as ActivationContext
}

// A read tool: read magi config from adminConfig, GET the path, return the JSON (or a structured error).
function getTool(
  name: string,
  description: string,
  path: string,
  httpFetch: HttpFetch | undefined,
): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name,
    description,
    inputSchema: emptySchema,
    execute: async (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      return callMagi(httpFetch, cfg, 'GET', path)
    },
  }
}

const factory = (): { activate(ctx: unknown): void; deactivate(ctx: unknown): void } => {
  return {
    activate(rawCtx: unknown): void {
      const ctx = requireActivationContext(rawCtx)
      const httpFetch = ctx.providerRuntime === undefined ? undefined : ctx.providerRuntime.httpFetch

      ctx.registration.registerTool(
        getTool('list_projects', 'List coding projects configured in magi.', '/projects', httpFetch),
      )
      ctx.registration.registerTool(
        getTool('list_agents', 'List coding agents available in magi.', '/agents', httpFetch),
      )

      ctx.log.info({}, 'acp plugin activated')
    },
    deactivate(): void {},
  }
}

export default factory
```

Run `bun test tests/plugins/acp/read-tools.test.ts` → PASS. Then `bun check`.

- [ ] **Step 6: Commit**

```bash
git add plugins/acp/plugin.json plugins/acp/schemas.ts plugins/acp/client.ts plugins/acp/index.ts tests/plugins/acp/read-tools.test.ts
git commit -m "feat(acp-plugin): scaffold acp plugin with magi client and read tools"
```

---

## Task 2: `start_session` + kv session tracking

`start_session` injects `contextId = runtimeContext.storageContextId`, POSTs `/sessions`, and on success records the session id in `plugin_kv` (so `list_sessions` can scope to this chat).

**Files:** Modify `plugins/acp/index.ts`; create `tests/plugins/acp/start-session.test.ts`

- [ ] **Step 1: Write the failing test** `tests/plugins/acp/start-session.test.ts`

First, **extract the shared harness from Task 1** into `tests/plugins/acp/support.ts` (BUSL header): export `activate(httpFetch)` (returns the `Map<string, PluginTool>` of registered tools), `runtimeCtx(opts?)`, and a new `runtimeCtxWithKv(store: Map<string, string>)` that backs `kv.get/set/delete/list` with the `Map` (so kv assertions work — the Task-1 read tools used a no-op kv), plus the `options` constant and `jsonResponse(body, status?)` helper. Refactor `read-tools.test.ts` to import from `./support.js`. Then write `start-session.test.ts` importing the same helpers, using the same harness as Task 1's full test, covering exactly these cases:

1. **start_session injects context, POSTs `/sessions`, records kv.** httpFetch captures the request body and returns `202 { id: 's-1', status: 'queued' }`. Call `tools.get('start_session')!.execute({ project: 'demo', prompt: 'do it' }, runtimeCtxWithKv(store), options)`. Assert: the captured body equals `{ project: 'demo', agent: 'claude-code-acp', contextId: 'ctx-1', prompt: 'do it' }` (note `contextId` = the runtime's `storageContextId`, NOT an LLM arg; `agent` defaulted), the result equals `{ id: 's-1', status: 'queued' }`, and `store.get('session:s-1')` is defined.
2. **explicit agent is forwarded.** Passing `{ project, prompt, agent: 'opencode' }` sends `agent: 'opencode'` in the body.
3. **missing project/prompt → validation error.** `execute({ project: 'demo' }, …)` returns `{ error: 'invalid_input', message: 'project and prompt are required' }` and does NOT call httpFetch.
4. **not configured.** With an `adminConfig.get` returning `undefined`, returns the `not_configured` object and does not call httpFetch.

Run `bun test tests/plugins/acp/start-session.test.ts` → FAIL (no `start_session` registered yet).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — in `plugins/acp/index.ts`, add a `startSessionTool(httpFetch)` and register it. Add the needed imports (`asObject`, `asString`, `optionalString`, `callMagi`, `readMagiConfig`, `startSessionSchema`).

```ts
const DEFAULT_AGENT = 'claude-code-acp'

function startSessionTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'start_session',
    description: 'Start a sandboxed coding-agent session on a configured project.',
    inputSchema: startSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prompt = asString(args, 'prompt')
      if (project === null || prompt === null) {
        return { error: 'invalid_input', message: 'project and prompt are required' }
      }
      const agent = optionalString(args, 'agent') ?? DEFAULT_AGENT
      const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
        project,
        agent,
        contextId: runtimeContext.storageContextId,
        prompt,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}

function sessionIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const id = (result as Record<string, unknown>)['id']
  return typeof id === 'string' && id.length > 0 ? id : null
}
```

Register it in `activate`: `ctx.registration.registerTool(startSessionTool(httpFetch))`. Add `import { asObject, asString, callMagi, NOT_CONFIGURED, optionalString, readMagiConfig } from './client.js'` and `import { startSessionSchema } from './schemas.js'` (merge with existing imports).

- [ ] **Step 4: Run → PASS; `bun check`; commit**

```bash
git add plugins/acp/index.ts tests/plugins/acp/start-session.test.ts tests/plugins/acp/support.ts
git commit -m "feat(acp-plugin): start_session tool with kv session tracking"
```

---

## Task 3: `list_sessions` (kv-scoped) + `session_status`

`list_sessions` GETs `/sessions?filter=` then filters to session ids recorded under this context's kv. `session_status` GETs `/sessions/:id`.

**Files:** Modify `plugins/acp/index.ts`; create `tests/plugins/acp/list-status.test.ts`

- [ ] **Step 1: Write the failing test**

Cover: (a) `list_sessions` returns only sessions whose `id` is present in kv (`session:*`) — seed kv with `session:s-1` and have magi return `[{id:'s-1',...},{id:'s-2',...}]`, expect only `s-1`; (b) `filter` defaults to `active` and is forwarded as the query param; (c) `session_status` GETs `/sessions/s-1`; (d) invalid filter → `{ error: 'invalid_input' }` (the JSON-schema enum already constrains the LLM, but guard anyway).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** in `index.ts`:

```ts
const SESSION_FILTERS = ['new', 'active', 'waiting', 'review', 'done']

function listSessionsTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'list_sessions',
    description: 'List coding sessions started from this chat (filter: new|active|waiting|review|done).',
    inputSchema: listSessionsSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const filterRaw = optionalString(args, 'filter') ?? 'active'
      if (!SESSION_FILTERS.includes(filterRaw)) {
        return { error: 'invalid_input', message: `filter must be one of ${SESSION_FILTERS.join(', ')}` }
      }
      const result = await callMagi(httpFetch, cfg, 'GET', `/sessions?filter=${encodeURIComponent(filterRaw)}`)
      if (!Array.isArray(result)) return result
      const known = new Set(runtimeContext.kv.list('session:').map((row): string => row.key.slice('session:'.length)))
      return result.filter((s): boolean => {
        const id = sessionIdOf(s)
        return id !== null && known.has(id)
      })
    },
  }
}

function sessionStatusTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'session_status',
    description: 'Get the status and metadata of a coding session.',
    inputSchema: sessionIdSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return { error: 'invalid_input', message: 'sessionId is required' }
      return callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}`)
    },
  }
}
```

Register both; add `listSessionsSchema`, `sessionIdSchema` to the schemas import.

- [ ] **Step 4: Run → PASS; `bun check`; commit**

```bash
git add plugins/acp/index.ts tests/plugins/acp/list-status.test.ts
git commit -m "feat(acp-plugin): list_sessions (kv-scoped) and session_status"
```

---

## Task 4: `finish_session`, `cancel_session`, `answer_permission`

**Files:** Modify `plugins/acp/index.ts`; create `tests/plugins/acp/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test** covering: `finish_session` POSTs `/sessions/:id/finish` with `{ message, action, title?, body? }` (message defaults when omitted); `cancel_session` POSTs `/sessions/:id/cancel`; `answer_permission` first GETs `/sessions/:id/permissions`, then POSTs `/sessions/:id/permission` once per pending `toolCallId` with the decision, and returns a summary `{ resolved: <count> }`; invalid inputs → `{ error: 'invalid_input' }`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** in `index.ts`:

```ts
const DEFAULT_FINISH_MESSAGE = 'Apply changes from magi coding session'

function finishSessionTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'finish_session',
    description: 'Finish a session: commit + push the branch, or open a PR.',
    inputSchema: finishSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const action = asString(args, 'action')
      if (sessionId === null || (action !== 'push' && action !== 'pr')) {
        return { error: 'invalid_input', message: 'sessionId and action (push|pr) are required' }
      }
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/finish`, {
        message: optionalString(args, 'message') ?? DEFAULT_FINISH_MESSAGE,
        action,
        title: optionalString(args, 'title'),
        body: optionalString(args, 'body'),
      })
    },
  }
}

function cancelSessionTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'cancel_session',
    description: 'Cancel a running coding session and tear down its sandbox.',
    inputSchema: sessionIdSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return { error: 'invalid_input', message: 'sessionId is required' }
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/cancel`)
    },
  }
}

function answerPermissionTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'answer_permission',
    description: "Answer a coding agent's pending permission request (allow or deny).",
    inputSchema: answerPermissionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const decision = asString(args, 'decision')
      if (sessionId === null || (decision !== 'allow' && decision !== 'deny')) {
        return { error: 'invalid_input', message: 'sessionId and decision (allow|deny) are required' }
      }
      const pending = await callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}/permissions`)
      if (!Array.isArray(pending)) return pending
      const toolCallIds = pending
        .map((p): string | null => asString(asObject(p), 'toolCallId'))
        .filter((id): id is string => id !== null)
      if (toolCallIds.length === 0) return { resolved: 0, message: 'no pending permission requests' }
      await Promise.all(
        toolCallIds.map(
          (toolCallId): Promise<unknown> =>
            callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/permission`, {
              toolCallId,
              decision,
            }),
        ),
      )
      return { resolved: toolCallIds.length, decision }
    },
  }
}
```

Register all three; add `finishSessionSchema`, `answerPermissionSchema` to the schemas import.

- [ ] **Step 4: Run → PASS; `bun check`; commit**

```bash
git add plugins/acp/index.ts tests/plugins/acp/lifecycle.test.ts
git commit -m "feat(acp-plugin): finish, cancel, answer_permission tools"
```

---

## Task 5: `review_pr` tool + `/acp` command + prompt fragment

**Files:** Modify `plugins/acp/index.ts`; create `tests/plugins/acp/review-command.test.ts`

- [ ] **Step 1: Write the failing test** covering: `review_pr` injects `contextId = storageContextId`, POSTs `/reviews` with `{ project, prNumber, contextId }`, validates `prNumber` is a positive int; the registered command (capture it via a `registerCommand` spy) replies with help/status text; the prompt fragment is registered with non-empty content.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** in `index.ts`:

```ts
function reviewPrTool(httpFetch: HttpFetch | undefined): {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
} {
  return {
    name: 'review_pr',
    description: 'Start a review session for an open pull/merge request; findings are posted as inline comments.',
    inputSchema: reviewPrSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prNumber = asPositiveInt(args, 'prNumber')
      if (project === null || prNumber === null) {
        return { error: 'invalid_input', message: 'project and a positive prNumber are required' }
      }
      const result = await callMagi(httpFetch, cfg, 'POST', '/reviews', {
        project,
        prNumber,
        contextId: runtimeContext.storageContextId,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}

const ACP_PROMPT_FRAGMENT =
  'Coding sessions: use start_session(project, prompt) to run a sandboxed AI coding agent on a ' +
  'configured project, list_sessions/session_status to check progress, answer_permission(sessionId, ' +
  'decision) when the agent needs approval, finish_session(sessionId, action) to commit/push or open a ' +
  'PR, cancel_session to stop one, and review_pr(project, prNumber) to review an open PR. ' +
  'Use list_projects/list_agents to discover what is configured. The user is notified when a session ' +
  'finishes or needs input.'

const ACP_COMMAND_TEXT =
  'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
  'health check", "what sessions are running?", or "review PR 42 on demo".'
```

In `activate`, register:

```ts
ctx.registration.registerTool(reviewPrTool(httpFetch))
ctx.registration.registerPromptFragment({ name: 'acp-hint', content: ACP_PROMPT_FRAGMENT })
ctx.registration.registerCommand({
  name: 'acp',
  description: 'About ACP coding sessions',
  execute: (_message: unknown, reply: { text(s: string): Promise<void> | void }): Promise<void> | void =>
    reply.text(ACP_COMMAND_TEXT),
})
```

Add `asPositiveInt` to the client import and `reviewPrSchema` to the schemas import. Confirm the prompt fragment content is under the 2,000-char budget (it is).

- [ ] **Step 4: Run → PASS; `bun check`; commit**

```bash
git add plugins/acp/index.ts tests/plugins/acp/review-command.test.ts
git commit -m "feat(acp-plugin): review_pr tool, /acp command, prompt fragment"
```

---

## Task 6: knip entry + full gate

**Files:** Modify `knip.jsonc`

- [ ] **Step 1: Run knip to see what the new plugin trips**

Run: `bun run knip 2>&1 | tail -20`
Expected: the dynamically-loaded plugin entry `plugins/acp/index.ts` (default export imported by the loader by path) is flagged `exports`, mirroring the existing `plugins/*/index.ts` entries in `ignoreIssues`. If `tests/plugins/acp/support.ts` (shared test helpers) is flagged, add it too.

- [ ] **Step 2: Add the `ignoreIssues` entries** in `knip.jsonc`, alongside the other `plugins/*/index.ts` lines:

```jsonc
    // ACP plugin entry default export is imported dynamically by the plugin loader.
    "plugins/acp/index.ts": ["exports"],
```

(Add `"plugins/acp/client.ts": ["exports"]` and/or the test-support file ONLY if knip actually flags them — `client.ts` is statically imported by `index.ts`, so its exports should be seen as used; do not pre-add unneeded entries, knip will tell you.)

- [ ] **Step 3: Full gate**

Run: `bun run test` then `bun check:full`
Expected: 12/12 — lint, typecheck, format, license-headers, knip, test, test:client, duplicates, review-loop. Fix anything red.

- [ ] **Step 4: Manual sanity (optional)** — with magi running and `magi_base_url`/`magi_token` set as admin plugin config, approve + enable the `acp` plugin, and confirm `list_projects` returns magi's projects in chat. (Discovery → approve in settings UI → restart → enable per context.)

- [ ] **Step 5: Commit**

```bash
git add knip.jsonc
git commit -m "chore(acp-plugin): register acp plugin entry in knip"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** plan #7 — the thin `acp` plugin: tools (start/list/status/finish/cancel/answer-permission/review/list-projects/list-agents), `/acp` command, prompt fragment, admin config (magi base URL + bearer), `plugin_kv` session→context scoping. `acp_send` (multi-turn continuation) is intentionally omitted (magi has no continuation endpoint — deferred from #5).
- **Static-graph rule is load-bearing:** `index.ts`/`client.ts`/`schemas.ts` must have NO bare-module imports (discovery rejects them). That's why `inputSchema` uses raw JSON-Schema objects and inputs are validated with manual guards instead of zod. If you reach for zod, you must move it behind an `import.meta.require('./runtime.js')` bridge (audio-transcribe pattern) — but the guard approach here avoids that entirely.
- **`contextType`/`threadId` are not available** in the tool runtime context, so the plugin passes only `contextId = storageContextId` to magi. DM notifications work; thread-scoped group notifications are inferred by papai's `/api/notify`; unambiguous non-thread (Discord) group notifications are a future enhancement requiring the runtime to expose `contextType` (note for #8 and a possible follow-up that threads `contextType` through `PluginToolRuntimeContext` → magi `/sessions` → Notifier).
- **Config read at execute time** (`runtimeContext.adminConfig.get`), never cached at activate — so admin config changes apply without restart (the `httpFetch` reference itself is captured at activate, which is fine).
- **Admin base URL must be a full URL** (e.g. `http://magi:8787`); admin-tier hosts bypass HTTPS/SSRF, so a LAN magi works. The token is sensitive/admin-scoped.
- **kv scoping:** sessions are recorded as `session:<id>` in `plugin_kv` (auto-scoped to `(pluginId, storageContextId)`), and `list_sessions` filters magi's list to those ids — so each chat only sees its own sessions.
- **Tests:** hand-built mock `PluginContext`/`PluginToolRuntimeContext` (no DB), capture registered tools/command via spies, mock `httpFetch`. Extract shared `activate`/`runtimeCtx` helpers to `tests/plugins/acp/support.ts` to avoid duplication across the five test files.
- **Type discipline:** the local structural `Registration`/`RuntimeContext`/`ToolExecute` types in `index.ts` mirror the real plugin types without importing runtime values (keeps the static graph clean); ensure they stay compatible with `src/plugins` shapes (the tests, which import the real types, are the check).
