<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugins as MCP Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a papai plugin expose its registered tools as a standards-compliant HTTP-MCP server so the coding agent can consume them through the existing sandbox MCP broker — proven by exposing `synthetic-web-search`'s `search` to the coding agent.

**Architecture:** papai grows a public, token-authed streamable-HTTP MCP endpoint (`/mcp/plugin/<pluginId>`) mounted before the settings auth gate, alongside the transcript-viewer capability-token routes. Each brokered call is bound to the initiator's context by a stateless HMAC-signed token minted at coding-session start. papai's endpoint is _just another HTTPS upstream_ to the existing broker — magi, its worker enclosure, the mediator gate, and the `projectSpec.mcp`/`mcpToken` wiring are all unchanged. Eligible plugins are auto-published as internal catalog entries the operator toggles + policies; the user picks one with no token to paste.

**Tech Stack:** Bun runtime, TypeScript (strict, `.js` import extensions), Zod v4, `@modelcontextprotocol/sdk` server primitives (low-level `Server` + `WebStandardStreamableHTTPServerTransport`), Vercel AI SDK schema helpers (`asSchema`), `node:crypto` HMAC, Svelte 5 settings UI.

---

## Reference facts (verified against the codebase — cite, don't re-discover)

**Plugin runtime**

- `contributionRegistry.getContributions(pluginId): ActivePluginContributions | undefined` — `src/plugins/contributions.ts:141`. `.tools: PluginTool[]`, `.manifest: PluginManifest`.
- `PluginTool = { name: string; description: string; inputSchema?: z.ZodType; execute(input, runtimeContext, options): Promise<unknown> }` — `src/plugins/runtime-types.ts:85`.
- `getPluginToolInputSchema(pluginTool): FlexibleSchema` — `src/plugins/input-schema.ts:20` (normalizes Zod **and** raw-JSON-schema authoring, e.g. `synthetic-web-search`).
- `buildPluginToolRuntimeContext(pluginId, manifest, { provider?, storageContextId, chatUserId }): PluginToolRuntimeContext` — `src/plugins/tool-runtime.ts:196`. Builds `adminConfig`/`contextConfig`/`rateLimit`/`attachments`/etc. from the manifest.
- `getPluginContextEligibility(pluginId, configContextId): PluginContextEligibility` and `getPluginsForContext(configContextId): DiscoveredPlugin[]` — `src/plugins/registry.js` (`registry.ts:244`). `configContextId` is the group-shared config-context id.
- `pluginRegistry.getActivePlugins(): DiscoveredPlugin[]` — `src/plugins/registry.ts:226`.
- AI SDK: `asSchema(flexible).jsonSchema` yields `JSONSchema7 | PromiseLike<JSONSchema7>` (`@ai-sdk/provider-utils`). Await it.

**Coding credentials / session wiring**

- Namespaces `['agent-provider','forge','mcp']`; `mcp` fields `['server','upstream_token']` — `src/coding-credentials/types.ts:6,52`.
- `getCodingCredentials(contextId, namespace): CodingCredentialConfig | null`, `updateCodingCredentials(...)`, `clearCodingCredentials(...)` — `src/coding-credentials/store.ts:76,83,113`.
- `resolveMcp(storageContextId, chatUserId): ResolvedMcp | null` and `resolveMcpToken(storageContextId, chatUserId): string | undefined` — `src/coding-credentials/resolve-agent-secrets.ts:196,230`. `ResolvedMcp = { url, host, header, allowedHosts, toolPolicy? }`; `ToolPolicy = { default: Permission; tools?: Record<string,Permission> }` (`:167`).
- `identityContext(storageContextId, chatUserId)` and `configContextOf(storageContextId)` — same file (`:39,21`). `parseScopedContextId(...)?.platformInstanceId` from `src/chat/scoped-context.js`.
- `buildSessionProjectSpec(repo, agent, codingSecrets)` — `plugins/acp/tools.ts:109` (populates `projectSpec.mcp`). `startSessionTool` adds top-level `mcpToken` — `plugins/acp/session-tools.ts:64`. **No change needed here** — resolvers do the work.
- Admin catalog: `resolveMcpCatalog(pi)`, `setMcpCatalog(pi, entries)`, `adminMcpCatalogContextId(pi)` — `src/coding-credentials/mcp-catalog.ts`. Backed by `getCachedConfig`/`setCachedConfig` from `src/cache.js`.

**HTTP route + env + signing**

- `getSettingsPublicBaseUrl(): string | null` — `src/settings/config.ts:6` (trimmed, trailing slash stripped, empty→null).
- `resolveInstanceConfigKey(): string` — `src/instances/config-key.ts` (from `INSTANCE_CONFIG_KEY`).
- HMAC template: `src/chat/mattermost/action-signing.ts` (`createHmac('sha256', secret).update(payload).digest('base64url')` + `timingSafeEqual`).
- Public route mount: `routeTranscriptPaths(req, url): Promise<Response|null>` in `src/debug/transcript-viewer.ts`, mounted in `src/debug/server.ts:230-232` **before** `isAuthorizedRequest`.
- Settings API dispatch: `routeSettingsApi(req, url)` in `src/debug/settings-api-router.ts:68`; admin sub-dispatch `routeAdminApi` (`:31`), pattern line `:58` (`/settings/api/admin/mcp-catalog`).
- User `mcp` GET/PATCH: `handleCodingCredentialsRoutes` — `src/debug/settings/coding-credentials-routes.ts:217`; the `namespace === 'mcp'` GET branch is `:175-178`.

**Client**

- `CodingMcpSection.svelte` — `client/settings/sections/CodingMcpSection.svelte`. Options come from `catalog` via `selectOptionsFor` (`:47`); `catalogEmpty` gates save (`:41,105,245`).
- Fetchers: `fetchCodingCredentials`/`patchCodingCredentials`/`clearCodingCredentials` — `client/settings/coding-credentials-fetchers.ts`. Response type `CodingCredentialsResponse` — `client/settings/fetcher-schemas.ts`.
- Admin catalog client: `AdminMcpCatalogSection.svelte` + `fetchAdminMcpCatalog`/`postAdminMcpCatalog` in `client/settings/admin-fetchers.ts:231`; schema `client/settings/fetcher-schemas-mcp-catalog.ts`.
- Visual specs: `tests/visual/settings/sections/*.spec.ts` (+ `admin/`), one per component.
- Client build: `bun run build:client`.

**MCP SDK server surface (verified present)**

- Low-level: `import { Server } from '@modelcontextprotocol/sdk/server/index.js'` with `server.setRequestHandler(ListToolsRequestSchema, handler)` / `setRequestHandler(CallToolRequestSchema, handler)`.
- Schemas: `import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'`.
- Transport: `import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'`; construct with `{ sessionIdGenerator: undefined }` for stateless mode; `await transport.handleRequest(req: Request): Promise<Response>`.

---

## File Structure

**New — `src/mcp-server/`** (the host layer)

| File                              | Responsibility                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/mcp-server/token.ts`         | Mint/verify the stateless HMAC binding token; signing-secret resolution                           |
| `src/mcp-server/plugin-bridge.ts` | List a plugin's tools as MCP descriptors; execute one tool in a bound context                     |
| `src/mcp-server/server-route.ts`  | `routePluginMcpPaths` — token verify → eligibility → per-request MCP `Server` wired to the bridge |
| `src/mcp-server/index.ts`         | Barrel re-export                                                                                  |

**New — coding-credentials + settings**

| File                                                                 | Responsibility                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/coding-credentials/mcp-plugin-servers.ts`                       | Operator config for internal servers + effective-entry derivation |
| `src/debug/settings/admin/mcp-plugin-servers-routes.ts`              | Admin GET/POST for internal-server toggles + policy               |
| `client/settings/sections/admin/AdminMcpPluginServersSection.svelte` | Admin UI: toggle + tool-policy per exposable plugin               |

**Modified**

| File                                                                                            | Change                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/plugins/types.ts`                                                                          | `mcpServer` boolean on `pluginManifestSchema`                             |
| `src/coding-credentials/resolve-agent-secrets.ts`                                               | Internal-server branch in `resolveMcp`; minted token in `resolveMcpToken` |
| `src/debug/server.ts`                                                                           | Mount `routePluginMcpPaths` before the auth gate                          |
| `src/debug/settings-api-router.ts`                                                              | Register the admin internal-servers route                                 |
| `src/debug/settings/coding-credentials-routes.ts`                                               | Add `pluginServers` to the `mcp` GET response                             |
| `client/settings/coding-credentials-fetchers.ts` / `client/settings/fetcher-schemas.ts`         | `pluginServers` in the response schema                                    |
| `client/settings/sections/CodingMcpSection.svelte`                                              | Internal servers in the picker; skip token when internal                  |
| `client/settings/admin-fetchers.ts` / new admin schema                                          | Fetchers for the internal-servers admin route                             |
| `plugins/synthetic-web-search/plugin.json`                                                      | `"mcpServer": true` (proof)                                               |
| `docs/architecture/environment.md`, `docs/architecture/coding-sessions.md`, `src/mcp/CLAUDE.md` | Document the new surface + operator requirements                          |

---

## Phase 1 — Binding token (`src/mcp-server/token.ts`)

Pure, dependency-light, fully unit-testable. Do this first.

### Task 1: Signing secret + token mint/verify

**Files:**

- Create: `src/mcp-server/token.ts`
- Test: `tests/mcp-server/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-server/token.test.ts
import { describe, expect, test } from 'bun:test'

import { mintPluginMcpToken, verifyPluginMcpToken } from '../../src/mcp-server/token.js'

const CLAIMS = {
  storageContextId: 'pi123:thread:42',
  chatUserId: 'user-7',
  pluginId: 'synthetic-web-search',
}

describe('plugin mcp token', () => {
  test('round-trips valid claims', () => {
    const token = mintPluginMcpToken(CLAIMS)
    expect(verifyPluginMcpToken(token)).toEqual(CLAIMS)
  })

  test('rejects a tampered payload', () => {
    const token = mintPluginMcpToken(CLAIMS)
    const [payload, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...CLAIMS, pluginId: 'evil', exp: 9_999_999_999 }), 'utf8').toString(
      'base64url',
    )
    expect(verifyPluginMcpToken(`${forged}.${sig}`)).toBeNull()
  })

  test('rejects an expired token', () => {
    const token = mintPluginMcpToken(CLAIMS, 1)
    // 2 seconds later
    expect(verifyPluginMcpToken(token, Date.now() + 2000)).toBeNull()
  })

  test('rejects a malformed token', () => {
    expect(verifyPluginMcpToken('not-a-token')).toBeNull()
    expect(verifyPluginMcpToken('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/mcp-server/token.test.ts`
Expected: FAIL — cannot find module `../../src/mcp-server/token.js`.

- [ ] **Step 3: Implement `src/mcp-server/token.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { resolveInstanceConfigKey } from '../instances/config-key.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'mcp-server:token' })

/** 30 days — a token must outlast a long-running coding session. Mass-revoke by rotating the secret. */
export const PLUGIN_MCP_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

/** Verified claims carried by a plugin-MCP binding token. */
export interface PluginMcpTokenClaims {
  storageContextId: string
  chatUserId: string
  pluginId: string
}

interface TokenEnvelope extends PluginMcpTokenClaims {
  v: 1
  exp: number
}

/**
 * Signing secret for the binding token. Defaults to a domain-separated HMAC of the instance
 * config key (so no new env var is required and rotating INSTANCE_CONFIG_KEY rotates this too);
 * a dedicated MCP_SERVER_SIGNING_SECRET overrides it for independent rotation.
 */
function getMcpTokenSigningSecret(): string {
  const override = process.env['MCP_SERVER_SIGNING_SECRET']
  if (override !== undefined && override.trim() !== '') return override.trim()
  return createHmac('sha256', resolveInstanceConfigKey()).update('mcp-plugin-token-v1').digest('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', getMcpTokenSigningSecret()).update(payload).digest('base64url')
}

function signaturesMatch(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Mint a signed, time-bounded token binding a brokered MCP call to a context + plugin. */
export function mintPluginMcpToken(
  claims: PluginMcpTokenClaims,
  ttlSeconds: number = PLUGIN_MCP_TOKEN_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const envelope: TokenEnvelope = { v: 1, exp, ...claims }
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Verify a token; returns the claims or null (invalid signature, expired, or malformed). Never throws. */
export function verifyPluginMcpToken(raw: string, nowMs: number = Date.now()): PluginMcpTokenClaims | null {
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  const payload = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!signaturesMatch(sig, sign(payload))) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (typeof decoded !== 'object' || decoded === null) return null
    const env = decoded as Partial<TokenEnvelope>
    if (env.v !== 1 || typeof env.exp !== 'number') return null
    if (
      typeof env.storageContextId !== 'string' ||
      typeof env.chatUserId !== 'string' ||
      typeof env.pluginId !== 'string'
    ) {
      return null
    }
    if (Math.floor(nowMs / 1000) >= env.exp) return null
    return {
      storageContextId: env.storageContextId,
      chatUserId: env.chatUserId,
      pluginId: env.pluginId,
    }
  } catch (err) {
    log.debug({ error: err instanceof Error ? err.message : String(err) }, 'failed to decode mcp token payload')
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/mcp-server/token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/token.ts tests/mcp-server/token.test.ts
git commit -m "feat(mcp-server): stateless HMAC binding token for plugin-MCP endpoints"
```

---

## Phase 2 — Plugin manifest opt-in

### Task 2: `mcpServer` manifest flag

**Files:**

- Modify: `src/plugins/types.ts:204` (inside `pluginManifestSchema`, next to `mcp:`)
- Test: `tests/plugins/manifest-mcp-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugins/manifest-mcp-server.test.ts
import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

const BASE = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'demo plugin',
  apiVersion: 1,
  main: 'index.ts',
}

describe('mcpServer manifest flag', () => {
  test('defaults to false when omitted', () => {
    const parsed = pluginManifestSchema.parse(BASE)
    expect(parsed.mcpServer).toBe(false)
  })

  test('accepts an explicit true', () => {
    const parsed = pluginManifestSchema.parse({ ...BASE, mcpServer: true })
    expect(parsed.mcpServer).toBe(true)
  })

  test('rejects a non-boolean', () => {
    expect(pluginManifestSchema.safeParse({ ...BASE, mcpServer: 'yes' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/manifest-mcp-server.test.ts`
Expected: FAIL — `parsed.mcpServer` is `undefined` (field not in schema).

- [ ] **Step 3: Add the field**

In `src/plugins/types.ts`, immediately after the `mcp: mcpPluginConfigSchema.optional(),` line (`:204`), add:

```ts
    // When true, this plugin's registered tools are exposed as an MCP server surface
    // (src/mcp-server/) that the coding agent can consume via the sandbox MCP broker.
    // Exposes ALL registered tools; the operator's per-tool policy does the filtering.
    mcpServer: z.boolean().optional().default(false),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/manifest-mcp-server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing manifest suite to confirm no regression**

Run: `bun test tests/plugins/manifest-mcp.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts tests/plugins/manifest-mcp-server.test.ts
git commit -m "feat(plugins): mcpServer manifest flag to expose tools as an MCP server"
```

---

## Phase 3 — Plugin bridge (`src/mcp-server/plugin-bridge.ts`)

Enumerate + execute a plugin's tools in a bound context. Uses raw (un-namespaced) tool names — a per-plugin endpoint means no collision.

### Task 3: List a plugin's MCP tool descriptors

**Files:**

- Create: `src/mcp-server/plugin-bridge.ts`
- Test: `tests/mcp-server/plugin-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-server/plugin-bridge.test.ts
import { afterEach, describe, expect, test } from 'bun:test'

import { contributionRegistry } from '../../src/plugins/contributions.js'
import { callPluginMcpTool, listPluginMcpTools } from '../../src/mcp-server/plugin-bridge.js'

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'demo',
  apiVersion: 1 as const,
  contributes: {
    tools: ['echo'],
    promptFragments: [],
    commands: [],
    jobs: [],
    configKeys: [],
    taskProviderTypes: [],
    attachmentTransformers: [],
  },
  permissions: [],
}

function registerDemo(execute: (input: unknown) => Promise<unknown>): void {
  contributionRegistry.register(
    'demo',
    {
      tools: [
        {
          name: 'echo',
          description: 'echoes the message',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          } as unknown as undefined,
          execute: (input: unknown) => execute(input),
        },
      ],
      promptFragments: [],
      commands: [],
      jobs: [],
      attachmentTransformers: [],
    },
    MANIFEST as never,
  )
}

afterEach(() => {
  contributionRegistry.unregister('demo')
})

describe('plugin-bridge listPluginMcpTools', () => {
  test('returns raw tool names with a JSON-schema inputSchema', async () => {
    registerDemo(async () => ({ ok: true }))
    const tools = await listPluginMcpTools('demo')
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('echo')
    expect(tools[0]!.description).toBe('echoes the message')
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object' })
  })

  test('returns [] for an unknown plugin', async () => {
    expect(await listPluginMcpTools('nope')).toEqual([])
  })
})

describe('plugin-bridge callPluginMcpTool', () => {
  test('executes the tool and wraps the result as text content', async () => {
    registerDemo(async (input) => ({
      echoed: (input as { message: string }).message,
    }))
    const result = await callPluginMcpTool({
      pluginId: 'demo',
      toolName: 'echo',
      input: { message: 'hi' },
      storageContextId: 'pi:thread:1',
      chatUserId: 'u1',
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('"echoed":"hi"')
  })

  test('returns an isError result for an unknown tool', async () => {
    registerDemo(async () => ({}))
    const result = await callPluginMcpTool({
      pluginId: 'demo',
      toolName: 'missing',
      input: {},
      storageContextId: 'pi:thread:1',
      chatUserId: 'u1',
    })
    expect(result.isError).toBe(true)
  })
})
```

> Note: `contributionRegistry.register/unregister` are on the singleton (`src/plugins/contributions.ts`). If `unregister` does not exist, add a minimal `unregister(pluginId: string): void { this.activeContributions.delete(pluginId) }` to the class in that step and note it in the commit. Confirm the method name by reading `src/plugins/contributions.ts` before writing the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/mcp-server/plugin-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/mcp-server/plugin-bridge.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asSchema } from 'ai'
import type { JSONSchema7 } from 'json-schema'

import { logger } from '../logger.js'
import { contributionRegistry } from '../plugins/contributions.js'
import { getPluginToolInputSchema } from '../plugins/input-schema.js'
import { buildPluginToolRuntimeContext } from '../plugins/tool-runtime.js'

const log = logger.child({ scope: 'mcp-server:plugin-bridge' })

/** An MCP tool descriptor derived from a plugin's registered tool. */
export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: JSONSchema7
}

/** An MCP tools/call result: text content only (matches the client-side text-only convention). */
export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

const EMPTY_OBJECT_SCHEMA: JSONSchema7 = { type: 'object', properties: {} }

/** List a plugin's registered tools as MCP descriptors. Returns [] if the plugin is not active. */
export async function listPluginMcpTools(pluginId: string): Promise<McpToolDescriptor[]> {
  const contributions = contributionRegistry.getContributions(pluginId)
  if (contributions === undefined) return []
  const descriptors: McpToolDescriptor[] = []
  for (const pluginTool of contributions.tools) {
    let jsonSchema: JSONSchema7 = EMPTY_OBJECT_SCHEMA
    try {
      const resolved = await asSchema(getPluginToolInputSchema(pluginTool)).jsonSchema
      if (resolved !== undefined && resolved !== null) jsonSchema = resolved as JSONSchema7
    } catch (err) {
      log.warn(
        {
          pluginId,
          tool: pluginTool.name,
          error: err instanceof Error ? err.message : String(err),
        },
        'failed to derive tool json schema; falling back to empty object schema',
      )
    }
    descriptors.push({
      name: pluginTool.name,
      description: pluginTool.description,
      inputSchema: jsonSchema,
    })
  }
  return descriptors
}

export interface CallPluginMcpToolArgs {
  pluginId: string
  toolName: string
  input: unknown
  storageContextId: string
  chatUserId: string
  abortSignal?: AbortSignal
}

function textResult(text: string, isError?: boolean): McpCallResult {
  return isError === true ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] }
}

/** Execute one plugin tool by name in the caller's bound context, returning a text MCP result. */
export async function callPluginMcpTool(args: CallPluginMcpToolArgs): Promise<McpCallResult> {
  const contributions = contributionRegistry.getContributions(args.pluginId)
  if (contributions === undefined) return textResult(`plugin not active: ${args.pluginId}`, true)
  const pluginTool = contributions.tools.find((t) => t.name === args.toolName)
  if (pluginTool === undefined) return textResult(`unknown tool: ${args.toolName}`, true)

  const runtimeContext = buildPluginToolRuntimeContext(args.pluginId, contributions.manifest, {
    provider: undefined,
    storageContextId: args.storageContextId,
    chatUserId: args.chatUserId,
  })

  try {
    const result = await pluginTool.execute(args.input, runtimeContext, {
      toolCallId: `mcp-${args.pluginId}-${args.toolName}`,
      abortSignal: args.abortSignal,
      messages: [],
    } as never)
    return textResult(typeof result === 'string' ? result : JSON.stringify(result))
  } catch (err) {
    log.warn(
      {
        pluginId: args.pluginId,
        tool: args.toolName,
        error: err instanceof Error ? err.message : String(err),
      },
      'plugin tool execution failed',
    )
    return textResult(err instanceof Error ? err.message : String(err), true)
  }
}
```

> `provider: undefined` uses the providerless execution path (the codebase already supports `buildProviderlessPluginAndMcpTools`). Provider-backed plugin tools over MCP (needing a `TaskProvider`) are documented follow-up; `synthetic-web-search` needs no provider. The `as never` casts on the `ToolExecutionOptions` bag mirror how the acp plugin constructs minimal option objects; if the local `ToolExecutionOptions` import is readily available, prefer typing it explicitly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/mcp-server/plugin-bridge.test.ts`
Expected: PASS (4 tests). Add `json-schema` types if missing: `bun add -d @types/json-schema` (only if the import errors under typecheck).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck` (or the repo's typecheck script)
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/plugin-bridge.ts tests/mcp-server/plugin-bridge.test.ts
git commit -m "feat(mcp-server): bridge to list and execute plugin tools as MCP"
```

---

## Phase 4 — MCP server HTTP route (`src/mcp-server/server-route.ts`)

### Task 4: `routePluginMcpPaths` — token-authed, per-request MCP server

**Files:**

- Create: `src/mcp-server/server-route.ts`
- Create: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/server-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-server/server-route.test.ts
import { afterEach, describe, expect, test } from 'bun:test'

import { contributionRegistry } from '../../src/plugins/contributions.js'
import { mintPluginMcpToken } from '../../src/mcp-server/token.js'
import { routePluginMcpPaths } from '../../src/mcp-server/server-route.js'

// NOTE: getPluginContextEligibility must report 'demo' eligible for this test's context.
// Register via contributionRegistry AND ensure pluginRegistry has an active entry for 'demo',
// or stub getPluginContextEligibility via dependency injection. Read
// src/plugins/registry.ts to pick the lightest real seam; if none, inject an
// `isEligible` dep into routePluginMcpPaths (default: getPluginContextEligibility).

const CLAIMS = {
  storageContextId: 'pi:thread:1',
  chatUserId: 'u1',
  pluginId: 'demo',
}

afterEach(() => contributionRegistry.unregister('demo'))

function jsonRpc(method: string, params: unknown, id = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params })
}

function post(token: string | null, body: string): Request {
  return new Request('https://bot.example.com/mcp/plugin/demo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body,
  })
}

describe('routePluginMcpPaths', () => {
  test('returns null for a non-matching path', async () => {
    const res = await routePluginMcpPaths(new Request('https://x/other'), new URL('https://x/other'))
    expect(res).toBeNull()
  })

  test('401 without a valid token', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const res = await routePluginMcpPaths(post(null, jsonRpc('tools/list', {})), url)
    expect(res?.status).toBe(401)
  })

  test('401 when token pluginId != path pluginId', async () => {
    const url = new URL('https://bot.example.com/mcp/plugin/demo')
    const token = mintPluginMcpToken({ ...CLAIMS, pluginId: 'other' })
    const res = await routePluginMcpPaths(post(token, jsonRpc('tools/list', {})), url)
    expect(res?.status).toBe(401)
  })
})
```

> This route test needs eligibility to pass. Read `src/plugins/registry.ts` first: if there is a test seam to register an active plugin entry, use it; otherwise add an optional injected dependency to `routePluginMcpPaths` (see Step 3, `deps` param defaulting to real functions) and pass a stub `isEligible: () => ({ eligible: true })` in the happy-path test. The three tests above avoid the happy path deliberately; add a `tools/list`-success test once the eligibility seam is settled.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/mcp-server/server-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/mcp-server/server-route.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// PUBLIC capability-token route family — mounted BEFORE the settings auth gate in
// src/debug/server.ts, mirroring the transcript viewer. Access control is possession
// of a valid signed binding token (src/mcp-server/token.ts), not a session cookie.
// The coding agent reaches this endpoint over the public internet via the sandbox MCP
// broker's credential-bearing worker enclosure.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { getPluginContextEligibility } from '../plugins/registry.js'
import { callPluginMcpTool, listPluginMcpTools } from './plugin-bridge.js'
import { verifyPluginMcpToken, type PluginMcpTokenClaims } from './token.js'

const log = logger.child({ scope: 'mcp-server:route' })
const PREFIX = '/mcp/plugin/'

export interface PluginMcpRouteDeps {
  verifyToken: (raw: string, nowMs?: number) => PluginMcpTokenClaims | null
  isEligible: (pluginId: string, configContextId: string) => { eligible: boolean }
}

const defaultDeps: PluginMcpRouteDeps = {
  verifyToken: verifyPluginMcpToken,
  isEligible: (pluginId, cc) => getPluginContextEligibility(pluginId, cc),
}

function extractBearer(req: Request): string | null {
  const raw = req.headers.get('authorization')
  if (raw === null || raw.trim() === '') return null
  const trimmed = raw.trim()
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

/** Route + serve a stateless MCP request for /mcp/plugin/<pluginId>. Returns null for non-matching paths. */
export async function routePluginMcpPaths(
  req: Request,
  url: URL,
  deps: PluginMcpRouteDeps = defaultDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith(PREFIX)) return null
  const pathPluginId = decodeURIComponent(url.pathname.slice(PREFIX.length).split('/')[0] ?? '')
  if (pathPluginId === '') return new Response('Not found', { status: 404 })

  const token = extractBearer(req)
  if (token === null) return unauthorized()
  const claims = deps.verifyToken(token)
  if (claims === null || claims.pluginId !== pathPluginId) return unauthorized()

  const configContextId = getConfigContextIdFromStorageContextId(claims.storageContextId)
  if (!deps.isEligible(claims.pluginId, configContextId).eligible) {
    log.warn({ pluginId: claims.pluginId, configContextId }, 'plugin not eligible for context; refusing (fail-closed)')
    return unauthorized()
  }

  const server = new Server(
    { name: `papai-plugin-${claims.pluginId}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await listPluginMcpTools(claims.pluginId),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callPluginMcpTool({
      pluginId: claims.pluginId,
      toolName: request.params.name,
      input: request.params.arguments ?? {},
      storageContextId: claims.storageContextId,
      chatUserId: claims.chatUserId,
    }),
  )

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(req)
  } finally {
    await server.close()
  }
}
```

> `server.close()` in `finally` releases the per-request transport. If `handleRequest` streams an SSE response body that must outlive the function, verify with the SDK d.ts whether `close()` cancels an in-flight stream — for the stateless single-message JSON path used here (Accept includes `application/json`), the response is complete before return. If SSE turns out to be forced, move `server.close()` into the transport's `onclose` instead; note the choice in the commit.

- [ ] **Step 4: Implement the barrel `src/mcp-server/index.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { routePluginMcpPaths } from './server-route.js'
export { mintPluginMcpToken, verifyPluginMcpToken, PLUGIN_MCP_TOKEN_TTL_SECONDS } from './token.js'
export type { PluginMcpTokenClaims } from './token.js'
```

- [ ] **Step 5: Run the tests**

Run: `bun test tests/mcp-server/server-route.test.ts`
Expected: PASS (3 tests: non-match→null, no token→401, wrong-plugin→401).

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/server-route.ts src/mcp-server/index.ts tests/mcp-server/server-route.test.ts
git commit -m "feat(mcp-server): token-authed streamable-HTTP route exposing plugin tools"
```

### Task 5: Mount the route before the auth gate

**Files:**

- Modify: `src/debug/server.ts` (import near `:23`; mount near `:230`)

- [ ] **Step 1: Add the import**

Near the other route imports (`src/debug/server.ts:23`):

```ts
import { routePluginMcpPaths } from '../mcp-server/index.js'
```

- [ ] **Step 2: Mount before the auth gate**

Immediately after the transcript-viewer block (`src/debug/server.ts:230-232`), before `if (!isAuthorizedRequest(req))`:

```ts
// Plugin-MCP trust domain: PUBLIC capability-token routes (signed binding token); must stay before the auth gate.
const pluginMcpResponse = await routePluginMcpPaths(req, url)
if (pluginMcpResponse !== null) return pluginMcpResponse
```

- [ ] **Step 3: Typecheck + boot smoke**

Run: `bun run typecheck`
Expected: no new errors. (A full server boot test is covered by the integration test in Phase 9.)

- [ ] **Step 4: Commit**

```bash
git add src/debug/server.ts
git commit -m "feat(mcp-server): mount /mcp/plugin route before the settings auth gate"
```

---

## Phase 5 — Operator internal-server config (`src/coding-credentials/mcp-plugin-servers.ts`)

### Task 6: Internal-server config store + effective-entry derivation

**Files:**

- Create: `src/coding-credentials/mcp-plugin-servers.ts`
- Test: `tests/coding-credentials/mcp-plugin-servers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/coding-credentials/mcp-plugin-servers.test.ts
import { describe, expect, test } from 'bun:test'

import { mcpPluginServerConfigsSchema } from '../../src/coding-credentials/mcp-plugin-servers.js'

describe('mcpPluginServerConfigsSchema', () => {
  test('accepts a valid config array', () => {
    const parsed = mcpPluginServerConfigsSchema.safeParse([
      {
        plugin_id: 'synthetic-web-search',
        enabled: true,
        default_tool_policy: 'allow',
      },
    ])
    expect(parsed.success).toBe(true)
  })

  test('requires default_tool_policy', () => {
    const parsed = mcpPluginServerConfigsSchema.safeParse([{ plugin_id: 'x', enabled: true }])
    expect(parsed.success).toBe(false)
  })

  test('rejects an unknown tool policy value', () => {
    const parsed = mcpPluginServerConfigsSchema.safeParse([
      { plugin_id: 'x', enabled: true, default_tool_policy: 'maybe' },
    ])
    expect(parsed.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/coding-credentials/mcp-plugin-servers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/coding-credentials/mcp-plugin-servers.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../cache.js'
import { logger } from '../logger.js'
import { getPluginsForContext } from '../plugins/registry.js'
import { getSettingsPublicBaseUrl } from '../settings/config.js'
import type { ToolPolicy } from './resolve-agent-secrets.js'

const log = logger.child({ scope: 'coding-credentials:mcp-plugin-servers' })
const PREFIX = '__admin_mcp_plugin_servers__:'
const KEY = 'mcp_plugin_servers'

/** The name prefix that marks a coding-MCP selection as a papai-hosted internal plugin server. */
export const INTERNAL_SERVER_PREFIX = 'plugin:'

const toolPolicyValue = z.enum(['allow', 'ask', 'deny'])

export const mcpPluginServerConfigSchema = z.object({
  plugin_id: z.string().min(1),
  enabled: z.boolean(),
  default_tool_policy: toolPolicyValue,
  tool_policy: z.record(z.string(), toolPolicyValue).optional(),
})
export type McpPluginServerConfig = z.infer<typeof mcpPluginServerConfigSchema>

export const mcpPluginServerConfigsSchema = z.array(mcpPluginServerConfigSchema)

export function adminMcpPluginServersContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}

export function resolveMcpPluginServerConfigs(platformInstanceId: string): McpPluginServerConfig[] {
  const raw = getCachedConfig(adminMcpPluginServersContextId(platformInstanceId), KEY)
  if (raw === null) return []
  try {
    const parsed = mcpPluginServerConfigsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function setMcpPluginServerConfigs(platformInstanceId: string, configs: McpPluginServerConfig[]): void {
  setCachedConfig(
    adminMcpPluginServersContextId(platformInstanceId),
    KEY,
    JSON.stringify(mcpPluginServerConfigsSchema.parse(configs)),
  )
}

/** An effective internal MCP server: a plugin that is enabled by the operator AND active+eligible for the context. */
export interface InternalMcpServer {
  name: string // `plugin:<pluginId>`
  pluginId: string
  label: string
  upstreamUrl: string
  header: string
  toolPolicy: ToolPolicy
}

function toolPolicyOf(config: McpPluginServerConfig): ToolPolicy {
  return { default: config.default_tool_policy, tools: config.tool_policy }
}

/**
 * The internal MCP servers a user in `configContextId` may actually select: operator-enabled,
 * plugin active+eligible for the context, `mcpServer` declared, and a public base URL configured.
 * Fail-closed: empty when SETTINGS_PUBLIC_BASE_URL is unset.
 */
export function listEnabledInternalMcpServers(
  platformInstanceId: string,
  configContextId: string,
): InternalMcpServer[] {
  const base = getSettingsPublicBaseUrl()
  if (base === null) {
    log.debug({ configContextId }, 'SETTINGS_PUBLIC_BASE_URL unset; no internal MCP servers')
    return []
  }
  const configs = new Map(resolveMcpPluginServerConfigs(platformInstanceId).map((c) => [c.plugin_id, c]))
  const eligible = getPluginsForContext(configContextId)
  const servers: InternalMcpServer[] = []
  for (const plugin of eligible) {
    if (plugin.manifest.mcpServer !== true) continue
    const config = configs.get(plugin.manifest.id)
    if (config === undefined || !config.enabled) continue
    servers.push({
      name: `${INTERNAL_SERVER_PREFIX}${plugin.manifest.id}`,
      pluginId: plugin.manifest.id,
      label: plugin.manifest.name,
      upstreamUrl: `${base}/mcp/plugin/${encodeURIComponent(plugin.manifest.id)}`,
      header: 'Authorization',
      toolPolicy: toolPolicyOf(config),
    })
  }
  return servers
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/coding-credentials/mcp-plugin-servers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/coding-credentials/mcp-plugin-servers.ts tests/coding-credentials/mcp-plugin-servers.test.ts
git commit -m "feat(coding-credentials): operator config + derivation for internal MCP servers"
```

---

## Phase 6 — Resolver integration

### Task 7: `resolveMcp` / `resolveMcpToken` internal-server branch

**Files:**

- Modify: `src/coding-credentials/resolve-agent-secrets.ts:196-234`
- Test: `tests/coding-credentials/resolve-mcp-internal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/coding-credentials/resolve-mcp-internal.test.ts
import { describe, expect, test } from 'bun:test'

import { verifyPluginMcpToken } from '../../src/mcp-server/token.js'
import { resolveMcp, resolveMcpToken } from '../../src/coding-credentials/resolve-agent-secrets.js'

// This test exercises the internal-server branch. Set up: a stored `mcp` vault whose
// `server` is `plugin:synthetic-web-search`, an operator config enabling that plugin,
// an eligible active plugin, and SETTINGS_PUBLIC_BASE_URL. Use the same DB/config test
// harness the existing resolve-agent-secrets / mcp-catalog tests use (read
// tests/coding-credentials/*.test.ts for the setup helpers — likely an in-memory DB +
// updateCodingCredentials + setMcpPluginServerConfigs + a registered active plugin).

test.todo('resolveMcp returns a derived internal entry (no token in vault) for an enabled plugin server')
test.todo('resolveMcpToken mints a verifiable token for an internal plugin server')
test.todo('resolveMcp returns null when the plugin is disabled by the operator (fail-closed)')
test.todo('resolveMcp returns null when SETTINGS_PUBLIC_BASE_URL is unset (fail-closed)')
```

> The resolver reads real DB-backed credentials and cached config. Before writing assertions, read an existing test in `tests/coding-credentials/` (e.g. the one covering `resolveMcp` against the catalog) to reuse its DB/config bootstrap. Convert each `test.todo` into a real test using that harness: seed `updateCodingCredentials(ctx, 'mcp', { server: 'plugin:synthetic-web-search' }, 'admin')`, `setMcpPluginServerConfigs(pi, [{ plugin_id, enabled: true, default_tool_policy: 'allow' }])`, register the plugin active+eligible, set `process.env.SETTINGS_PUBLIC_BASE_URL`. Then assert on `resolveMcp(storageContextId, chatUserId)` and `verifyPluginMcpToken(resolveMcpToken(...)!)`.

- [ ] **Step 2: Run the test to verify it fails (todos are pending)**

Run: `bun test tests/coding-credentials/resolve-mcp-internal.test.ts`
Expected: 4 todo tests reported; convert them to real tests in this step, then they FAIL against the unmodified resolver (`resolveMcp` requires a token and doesn't know internal servers).

- [ ] **Step 3: Modify `resolveMcp` and `resolveMcpToken`**

Add the import at the top of `src/coding-credentials/resolve-agent-secrets.ts`:

```ts
import { INTERNAL_SERVER_PREFIX, listEnabledInternalMcpServers } from './mcp-plugin-servers.js'
import { mintPluginMcpToken } from '../mcp-server/token.js'
```

Replace the body of `resolveMcp` (`:196-224`) with an internal-first branch:

```ts
export function resolveMcp(storageContextId: string, chatUserId: string): ResolvedMcp | null {
  const ctx = identityContext(storageContextId, chatUserId)
  const creds = getCodingCredentials(ctx, 'mcp')
  if (creds === null) return null
  const server = creds.server?.trim()
  if (server === undefined || server.length === 0) return null

  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) {
    log.warn({ contextId: ctx }, 'mcp vault has no platform instance to resolve against; refusing (fail-closed)')
    return null
  }

  // Internal papai-hosted plugin server: derive from the operator's enabled-server list; no vault token.
  if (server.startsWith(INTERNAL_SERVER_PREFIX)) {
    const entry = listEnabledInternalMcpServers(pi, configContextOf(storageContextId)).find((e) => e.name === server)
    if (entry === undefined) {
      log.warn({ contextId: ctx, server }, 'internal mcp server not enabled/eligible; refusing (fail-closed)')
      return null
    }
    return {
      url: entry.upstreamUrl,
      host: new URL(entry.upstreamUrl).hostname,
      header: entry.header,
      allowedHosts: [new URL(entry.upstreamUrl).hostname],
      toolPolicy: entry.toolPolicy,
    }
  }

  // External catalog server (unchanged): requires the user's own upstream token.
  const token = creds.upstream_token?.trim()
  if (token === undefined || token.length === 0) return null
  const entry = resolveMcpCatalog(pi).find((e) => e.name === server)
  if (entry === undefined) {
    log.warn({ contextId: ctx, server }, 'mcp server is not in the platform instance catalog; refusing (fail-closed)')
    return null
  }
  const hostname = new URL(entry.upstream_url).hostname
  return {
    url: entry.upstream_url,
    host: hostname,
    header: entry.header ?? 'Authorization',
    allowedHosts: [hostname],
    toolPolicy: catalogToolPolicy(entry),
  }
}
```

Replace `resolveMcpToken` (`:230-234`) with:

```ts
export function resolveMcpToken(storageContextId: string, chatUserId: string): string | undefined {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'mcp')
  const server = creds?.server?.trim()
  if (server !== undefined && server.startsWith(INTERNAL_SERVER_PREFIX)) {
    return mintPluginMcpToken({
      storageContextId,
      chatUserId,
      pluginId: server.slice(INTERNAL_SERVER_PREFIX.length),
    })
  }
  const token = creds?.upstream_token?.trim()
  return token === undefined || token.length === 0 ? undefined : token
}
```

> Watch for a circular import: `resolve-agent-secrets.ts` → `mcp-plugin-servers.ts` → `resolve-agent-secrets.ts` (for the `ToolPolicy` type only). The type-only import (`import type { ToolPolicy }`) is erased at runtime, so there is no runtime cycle. If the bundler still complains, move `ToolPolicy` into a small `src/coding-credentials/tool-policy.ts` and import from there in both files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/coding-credentials/resolve-mcp-internal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing resolver suite for no regression**

Run: `bun test tests/coding-credentials/`
Expected: PASS (external-catalog resolveMcp behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts tests/coding-credentials/resolve-mcp-internal.test.ts
git commit -m "feat(coding-credentials): resolve internal plugin MCP servers with minted token"
```

---

## Phase 7 — User picker (route + client)

### Task 8: Surface internal servers in the `mcp` coding-credentials GET

**Files:**

- Modify: `src/debug/settings/coding-credentials-routes.ts:175-178`
- Test: `tests/debug/settings/coding-credentials-mcp-plugin-servers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/debug/settings/coding-credentials-mcp-plugin-servers.test.ts
// Read an existing coding-credentials-routes test in tests/debug/settings/ for the
// authenticated-request harness (principal + platformInstanceId + CSRF). Then:
//  - enable an internal server via setMcpPluginServerConfigs + register an eligible plugin
//  - GET /settings/api/coding-credentials?namespace=mcp
//  - assert the JSON body has `pluginServers: [{ name: 'plugin:...', label: '...' }]`
import { describe, expect, test } from 'bun:test'
test.todo('mcp GET includes pluginServers derived from enabled internal servers')
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/settings/coding-credentials-mcp-plugin-servers.test.ts`
Expected: todo pending; convert to a real test, then FAIL (response has no `pluginServers`).

- [ ] **Step 3: Modify the `mcp` GET branch**

Add the import near the top of `src/debug/settings/coding-credentials-routes.ts`:

```ts
import { listEnabledInternalMcpServers } from '../../coding-credentials/mcp-plugin-servers.js'
```

Replace the `namespace === 'mcp'` branch (`:175-178`):

```ts
if (namespace === 'mcp') {
  const catalog = resolveMcpCatalog(authed.principal.platformInstanceId)
  const pluginServers = listEnabledInternalMcpServers(authed.principal.platformInstanceId, scope.scope.contextId).map(
    (s) => ({ name: s.name, label: s.label }),
  )
  return settingsJson(200, { ...fields, catalog, pluginServers })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/debug/settings/coding-credentials-mcp-plugin-servers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/coding-credentials-routes.ts tests/debug/settings/coding-credentials-mcp-plugin-servers.test.ts
git commit -m "feat(settings): expose internal plugin MCP servers in the coding-credentials picker"
```

### Task 9: Client — add internal servers to the picker; skip token when internal

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (add `pluginServers` to the coding-credentials response schema — read the file to find `CodingCredentialsResponseSchema`)
- Modify: `client/settings/sections/CodingMcpSection.svelte`
- Test: `tests/visual/settings/sections/CodingMcpSection.spec.ts` (extend)

- [ ] **Step 1: Extend the response schema**

In `client/settings/fetcher-schemas.ts`, add to the coding-credentials response object schema (find `CodingCredentialsResponseSchema`; it currently carries optional `catalog`):

```ts
  pluginServers: z.array(z.object({ name: z.string(), label: z.string() })).optional(),
```

Confirm `CodingCredentialField`/`CodingCredentialsResponse` types re-export from here (they are imported by `CodingMcpSection.svelte:17`).

- [ ] **Step 2: Wire the client — derive internal servers and merge into options**

In `client/settings/sections/CodingMcpSection.svelte`, add after `const catalog = ...` (`:40`):

```ts
const pluginServers = $derived(currentData?.pluginServers ?? [])
const selectedIsInternal = $derived(pluginServers.some((s) => s.name === drafts['server']))
```

Change `catalogEmpty` (`:41`) to account for internal servers:

```ts
const catalogEmpty = $derived(currentData !== null && catalog.length === 0 && pluginServers.length === 0)
```

Extend `selectOptionsFor` (`:47-50`):

```ts
function selectOptionsFor(field: CodingCredentialField): string[] {
  if (field.key !== 'server') return field.options ?? []
  return [...catalog.map((entry) => entry.name), ...pluginServers.map((s) => s.name)]
}
```

Skip the `upstream_token` row when an internal server is selected — wrap the `{#each fields as field}` body so the token field is omitted. Change the loop (`:181`) to filter:

```svelte
      {#each fields as field (field.key)}
        {#if !(field.key === 'upstream_token' && selectedIsInternal)}
        {@const effectiveRequired = field.required && !(field.key === 'upstream_token' && selectedIsInternal)}
        <!-- existing SettingsFieldShell block unchanged -->
        {/if}
      {/each}
```

Ensure the token is not persisted for internal selections — in `collectValues` (`:95-103`) add a guard at the top of the loop body:

```ts
for (const field of fields) {
  if (field.key === 'upstream_token' && selectedIsInternal) continue
  // ...existing body
}
```

- [ ] **Step 3: Update the visual spec**

Read `tests/visual/settings/sections/CodingMcpSection.spec.ts` and its story (`client/settings/sections/CodingMcpSection.stories.svelte`) to match the story-mock convention. Add a story/mock variant whose GET mock returns `pluginServers: [{ name: 'plugin:synthetic-web-search', label: 'Synthetic Web Search' }]` and empty `catalog`, and assert: the select lists the internal server, and selecting it hides the `coding-mcp-row-upstream_token` row (the `data-testid` from `:187`).

- [ ] **Step 4: Build the client + run the visual spec**

Run: `bun run build:client && bun test tests/visual/settings/sections/CodingMcpSection.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/sections/CodingMcpSection.svelte client/settings/sections/CodingMcpSection.stories.svelte tests/visual/settings/sections/CodingMcpSection.spec.ts
git commit -m "feat(settings-ui): pick internal plugin MCP servers without a token"
```

---

## Phase 8 — Admin section (toggle + tool policy)

### Task 10: Admin route for internal-server config

**Files:**

- Create: `src/debug/settings/admin/mcp-plugin-servers-routes.ts`
- Modify: `src/debug/settings-api-router.ts` (import + dispatch line near `:58`)
- Test: `tests/debug/settings/admin/mcp-plugin-servers-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/debug/settings/admin/mcp-plugin-servers-routes.test.ts
// Mirror tests/debug/settings/admin/mcp-catalog-routes.test.ts for the admin-auth + CSRF harness.
import { describe, expect, test } from 'bun:test'
test.todo('GET returns { available, configs } with mcpServer plugins in available')
test.todo('POST { kind: "plugin-servers", configs } persists and echoes configs')
test.todo('POST rejects an unknown default_tool_policy with 422')
```

Read `tests/debug/settings/admin/mcp-catalog-routes.test.ts` first and copy its auth/CSRF setup; convert the todos.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/settings/admin/mcp-plugin-servers-routes.test.ts`
Expected: todos pending → module not found once converted.

- [ ] **Step 3: Implement the route (mirror `mcp-catalog-routes.ts`)**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  mcpPluginServerConfigsSchema,
  resolveMcpPluginServerConfigs,
  setMcpPluginServerConfigs,
} from '../../../coding-credentials/mcp-plugin-servers.js'
import { contributionRegistry } from '../../../plugins/contributions.js'
import { pluginRegistry } from '../../../plugins/registry.js'
// Reuse the same auth/CSRF/JSON helpers mcp-catalog-routes.ts imports — read that file
// and copy the exact import list (authenticate/requireAdmin/requireCsrf/parseJsonBody/settingsJson).

const PostBodySchema = z.object({
  kind: z.literal('plugin-servers'),
  configs: mcpPluginServerConfigsSchema,
})

interface AvailablePluginServer {
  pluginId: string
  name: string
  description: string
  tools: string[]
}

function availablePluginServers(): AvailablePluginServer[] {
  return pluginRegistry
    .getActivePlugins()
    .filter((p) => p.manifest.mcpServer === true)
    .map((p) => ({
      pluginId: p.manifest.id,
      name: p.manifest.name,
      description: p.manifest.description,
      tools: (contributionRegistry.getContributions(p.manifest.id)?.tools ?? []).map((t) => t.name),
    }))
}

// handleGet: requireAdmin(authed, 'read') → settingsJson(200, { available: availablePluginServers(), configs: resolveMcpPluginServerConfigs(pi) })
// handlePost: requireAdmin(authed, 'write') + requireCsrf → parse PostBodySchema → setMcpPluginServerConfigs(pi, body.configs) → settingsJson(200, { available: availablePluginServers(), configs: body.configs })
// export function handleAdminMcpPluginServersRoutes(req, _url, pathname): Promise<Response> — GET/POST on
//   pathname === '/settings/api/admin/mcp-plugin-servers', else 405. Copy the dispatch skeleton verbatim from mcp-catalog-routes.ts.
```

> This route's auth/CSRF/response plumbing is byte-for-byte the `mcp-catalog-routes.ts` shape. Open that file, copy the `handleGet`/`handlePost`/`handleAdmin...Routes` skeleton, and swap: the `PostBodySchema` (above), the store calls (`resolveMcpPluginServerConfigs`/`setMcpPluginServerConfigs`), and the added `available` list. Keep `requireAdmin(authed, 'read'|'write')` and `requireCsrf` exactly as the catalog route uses them.

- [ ] **Step 4: Register the route**

In `src/debug/settings-api-router.ts`, add the import and, in `routeAdminApi` next to the `mcp-catalog` line (`:58`):

```ts
import { handleAdminMcpPluginServersRoutes } from './settings/admin/mcp-plugin-servers-routes.js'
// ...
if (p === '/settings/api/admin/mcp-plugin-servers') return handleAdminMcpPluginServersRoutes(req, url, p)
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/debug/settings/admin/mcp-plugin-servers-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/mcp-plugin-servers-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin/mcp-plugin-servers-routes.test.ts
git commit -m "feat(settings): admin route for internal plugin MCP server toggles + policy"
```

### Task 11: Admin client section

**Files:**

- Create: `client/settings/sections/admin/AdminMcpPluginServersSection.svelte`
- Modify: `client/settings/admin-fetchers.ts` (+ a schema file, mirroring `fetcher-schemas-mcp-catalog.ts`)
- Modify: `client/settings/SettingsApp.svelte` (register the section — read the file to match how `AdminMcpCatalogSection` is mounted)
- Test: `tests/visual/settings/sections/admin/AdminMcpPluginServersSection.spec.ts`

- [ ] **Step 1: Add fetchers + schema**

Create `client/settings/fetcher-schemas-mcp-plugin-servers.ts` mirroring `fetcher-schemas-mcp-catalog.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { z } from 'zod'

const ToolPolicyValue = z.enum(['allow', 'ask', 'deny'])
export const AdminMcpPluginServerConfigSchema = z.object({
  plugin_id: z.string(),
  enabled: z.boolean(),
  default_tool_policy: ToolPolicyValue,
  tool_policy: z.record(z.string(), ToolPolicyValue).optional(),
})
export const AdminMcpPluginServersResponseSchema = z.object({
  available: z.array(
    z.object({
      pluginId: z.string(),
      name: z.string(),
      description: z.string(),
      tools: z.array(z.string()),
    }),
  ),
  configs: z.array(AdminMcpPluginServerConfigSchema),
})
export type AdminMcpPluginServersResponse = z.infer<typeof AdminMcpPluginServersResponseSchema>
```

In `client/settings/admin-fetchers.ts`, mirror `fetchAdminMcpCatalog`/`postAdminMcpCatalog` (`:231`):

```ts
export const fetchAdminMcpPluginServers = (): Promise<AdminMcpPluginServersResponse> =>
  getJson('/settings/api/admin/mcp-plugin-servers', (b) => AdminMcpPluginServersResponseSchema.parse(b))
export const postAdminMcpPluginServers = (configs: unknown): Promise<AdminMcpPluginServersResponse> =>
  writeJson('/settings/api/admin/mcp-plugin-servers', 'POST', { kind: 'plugin-servers', configs }, (b) =>
    AdminMcpPluginServersResponseSchema.parse(b),
  )
```

- [ ] **Step 2: Build the section component**

Create `client/settings/sections/admin/AdminMcpPluginServersSection.svelte`. Model its structure on `AdminMcpCatalogSection.svelte`: load via `fetchAdminMcpPluginServers`, render one row per `available` plugin (name + description + tool list), each with an `enabled` checkbox and a `default_tool_policy` `<select>` (allow/ask/deny) plus optional per-tool policy selects; a single "Save" that `postAdminMcpPluginServers(draftConfigs)` where `draftConfigs` merges each available plugin's row state (default an absent config to `{ enabled: false, default_tool_policy: 'deny' }` — secure by default). Use `data-testid` attributes (`admin-mcp-plugin-servers-*`) consistent with the catalog section's testids.

- [ ] **Step 3: Register the section in the admin panel**

Read `client/settings/SettingsApp.svelte` to see how `AdminMcpCatalogSection` is imported and placed; add `AdminMcpPluginServersSection` directly after it (same admin grouping/nav entry pattern).

- [ ] **Step 4: Visual spec**

Create `tests/visual/settings/sections/admin/AdminMcpPluginServersSection.spec.ts` mirroring `AdminMcpCatalogSection.spec.ts`; mock GET to return one available plugin (`synthetic-web-search`, tools `['search']`) with no stored config, assert the row renders with a disabled-by-default enable checkbox and a `deny` default policy; toggle + save asserts the POST body shape.

- [ ] **Step 5: Build + run**

Run: `bun run build:client && bun test tests/visual/settings/sections/admin/AdminMcpPluginServersSection.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas-mcp-plugin-servers.ts client/settings/admin-fetchers.ts client/settings/sections/admin/AdminMcpPluginServersSection.svelte client/settings/SettingsApp.svelte tests/visual/settings/sections/admin/AdminMcpPluginServersSection.spec.ts
git commit -m "feat(settings-ui): admin section to expose plugins as internal MCP servers"
```

---

## Phase 9 — Proof, integration test, docs

### Task 12: Enable the proof plugin + end-to-end route integration test

**Files:**

- Modify: `plugins/synthetic-web-search/plugin.json`
- Test: `tests/mcp-server/integration.test.ts`

- [ ] **Step 1: Add the flag to the manifest**

In `plugins/synthetic-web-search/plugin.json`, add a top-level field:

```json
  "mcpServer": true,
```

- [ ] **Step 2: Write the integration test**

```ts
// tests/mcp-server/integration.test.ts
import { afterEach, describe, expect, test } from 'bun:test'

import { contributionRegistry } from '../../src/plugins/contributions.js'
import { mintPluginMcpToken } from '../../src/mcp-server/token.js'
import { routePluginMcpPaths } from '../../src/mcp-server/server-route.js'

// Register a fake plugin 'demo' active+eligible (reuse the plugin-bridge test's registerDemo helper —
// factor it into tests/utils if shared). Inject an isEligible stub returning { eligible: true } via the
// routePluginMcpPaths deps param so this test does not depend on the real registry state.

afterEach(() => contributionRegistry.unregister('demo'))

async function call(method: string, params: unknown, token: string): Promise<unknown> {
  const url = new URL('https://bot.example.com/mcp/plugin/demo')
  const req = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const res = await routePluginMcpPaths(req, url, {
    verifyToken: (t) =>
      t === token
        ? {
            storageContextId: 'pi:thread:1',
            chatUserId: 'u1',
            pluginId: 'demo',
          }
        : null,
    isEligible: () => ({ eligible: true }),
  })
  expect(res).not.toBeNull()
  return res!.json()
}

describe('plugin MCP endpoint (integration)', () => {
  test('tools/list then tools/call round-trips through the bridge', async () => {
    // registerDemo with an echo tool (see plugin-bridge.test.ts)
    const token = mintPluginMcpToken({
      storageContextId: 'pi:thread:1',
      chatUserId: 'u1',
      pluginId: 'demo',
    })
    const listed = (await call('tools/list', {}, token)) as {
      result: { tools: Array<{ name: string }> }
    }
    expect(listed.result.tools.map((t) => t.name)).toContain('echo')

    const called = (await call('tools/call', { name: 'echo', arguments: { message: 'hi' } }, token)) as {
      result: { content: Array<{ text: string }> }
    }
    expect(called.result.content[0]!.text).toContain('hi')
  })
})
```

> If the stateless transport returns SSE (content-type `text/event-stream`) rather than a single JSON body, parse the SSE frame instead of `res.json()` — read one `data:` line and `JSON.parse` it. Decide based on the transport's actual response content-type when you run it; adjust the `call` helper accordingly. Keep the assertions the same.

- [ ] **Step 3: Run the integration test**

Run: `bun test tests/mcp-server/integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Full suite + typecheck + lint**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add plugins/synthetic-web-search/plugin.json tests/mcp-server/integration.test.ts
git commit -m "feat(web-search): expose search as an MCP server; add endpoint integration test"
```

### Task 13: Documentation

**Files:**

- Modify: `docs/architecture/environment.md`
- Modify: `docs/architecture/coding-sessions.md`
- Modify: `src/mcp/CLAUDE.md`

- [ ] **Step 1: Environment doc**

Add to `docs/architecture/environment.md`:

- `MCP_SERVER_SIGNING_SECRET` — **optional**; overrides the default binding-token signing key (which is derived from `INSTANCE_CONFIG_KEY`). Set it to rotate plugin-MCP tokens independently of the instance key; rotating either value invalidates all outstanding tokens.
- A note that exposing a plugin MCP server requires `SETTINGS_PUBLIC_BASE_URL` (the endpoint URL is derived from it) **and** that the operator must admit papai's public-origin host in magi's geofront egress ceiling (`[egress.policy.ceiling]` in `org.toml`), same as any external MCP upstream.

- [ ] **Step 2: Coding-sessions doc**

Add a subsection under the Sandbox MCP broker area of `docs/architecture/coding-sessions.md` describing: papai can now host internal plugin MCP servers (`/mcp/plugin/<id>`, `src/mcp-server/`); they are auto-published to the coding MCP catalog as `plugin:<id>` entries the operator toggles + policies (Admin → MCP servers); `resolveMcp` derives the URL from `SETTINGS_PUBLIC_BASE_URL` and `resolveMcpToken` mints a stateless HMAC binding token bound to the initiator's context; magi treats it as any other opaque upstream + credential (INV-1/INV-2 unchanged); single-upstream-per-session still applies.

- [ ] **Step 3: MCP adapter doc**

Add a short note to `src/mcp/CLAUDE.md` clarifying the direction split: `src/mcp/` is papai-as-MCP-**client** (consuming upstreams); the new `src/mcp-server/` is papai-as-MCP-**server** (a plugin host surface for the coding agent) — distinct, non-overlapping modules.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/environment.md docs/architecture/coding-sessions.md src/mcp/CLAUDE.md
git commit -m "docs: plugins-as-MCP-servers surface, signing secret, and operator egress note"
```

---

## Deferred / out of scope (do NOT build here)

- **Multi-server multiplexing** — a session still gets one upstream (one plugin server _or_ one external server). Array-shaped `projectSpec.mcp`, a routing mediator in magi, N worker enclosures, and multi-select UI are a separate spec.
- **Provider-backed plugin tools over MCP** — the bridge executes providerless (`provider: undefined`). Plugins whose tools need a `TaskProvider` are follow-up.
- **Per-token revocation/audit** — revocation is time-based (secret rotation) only.
- **Non-text tool output** — images/resources are dropped, matching the existing MCP text-only convention.

## Self-review notes (author)

- **Spec coverage:** Component 1 (manifest)→Task 2; Component 2 (server surface)→Tasks 3-5; Component 3 (token)→Task 1; Component 4 (catalog auto-publish)→Tasks 6, 8-11; Component 5 (resolvers)→Task 7; Component 6 (egress)→Task 13; Component 7 (security: token verify, eligibility fail-closed, no-log)→Tasks 1,3,4; Component 8 (proof)→Task 12. All covered.
- **Type consistency:** `PluginMcpTokenClaims` (Task 1) is consumed unchanged by Tasks 3-4,7; `McpCallResult`/`McpToolDescriptor` (Task 3) consumed by Task 4; `InternalMcpServer`/`McpPluginServerConfig` (Task 6) consumed by Tasks 7-11; `ToolPolicy` reused from `resolve-agent-secrets.ts`. Server-selection name format `plugin:<id>` is the single source of truth via `INTERNAL_SERVER_PREFIX`.
- **Known implementation checkpoints flagged inline:** `contributionRegistry.unregister` existence; stateless-transport SSE-vs-JSON response shape; potential type-only import cycle; eligibility test seam. Each has a concrete fallback in the task note.
