<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect external MCP (Model Context Protocol) servers to extend the bot's tool surface — user-configured via `/config` (Streamable HTTP) and admin-packaged as declarative plugin manifests (HTTP + stdio).

**Architecture:** Core `src/mcp/` module handles connection pooling, tool discovery, and ToolSet conversion. Two entry points: user-configured endpoints read from `user_config` and plugin-manifest endpoints read from `plugin.json`'s `mcp` field. Both merge into `makeTools()` output, namespaced and subject to tool preferences.

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP client), Vercel AI SDK (`tool()`, `jsonSchema()`), Zod v4, existing plugin system, AES-256-GCM encryption via `src/instances/encryption.ts`.

**Spec:** `docs/superpowers/specs/2026-05-27-mcp-adapter-design.md`

---

## File Structure

| File                                 | Create/Modify | Purpose                                                               |
| ------------------------------------ | ------------- | --------------------------------------------------------------------- |
| `src/mcp/types.ts`                   | Create        | `McpEndpointConfig`, `McpServerStatus`, Zod schemas                   |
| `src/mcp/client-pool.ts`             | Create        | Connection pool: connect, idle timeout, reconnect, shutdown           |
| `src/mcp/tool-adapter.ts`            | Create        | MCP tool → AI SDK ToolSet conversion                                  |
| `src/mcp/user-endpoints.ts`          | Create        | Read user-configured endpoints from config, build ToolSet             |
| `src/mcp/plugin-endpoints.ts`        | Create        | Read declarative MCP plugin manifests, build ToolSet                  |
| `src/mcp/index.ts`                   | Create        | Public re-exports                                                     |
| `src/plugins/types.ts`               | Modify        | Add `mcp` field to `pluginManifestSchema`                             |
| `src/plugins/discovery.ts`           | Modify        | Allow plugins with `mcp` to skip `main` validation                    |
| `src/tools/index.ts`                 | Modify        | Wire `buildMcpToolSet` and `buildPluginMcpToolSet` into `makeTools()` |
| `src/tools/tool-metadata.ts`         | Modify        | Add `'mcp'` domain for MCP tool classification                        |
| `src/types/config.ts`                | Modify        | Add `'mcp_endpoints'` config key                                      |
| `src/config-keys.ts`                 | Modify        | Include `'mcp_endpoints'` in context key filtering                    |
| `src/debug/server.ts`                | Modify        | Add `/mcp/status` admin route                                         |
| `src/debug/mcp-routes.ts`            | Create        | Admin read-only MCP status handler                                    |
| `tests/mcp/types.test.ts`            | Create        | Type/schema validation tests                                          |
| `tests/mcp/client-pool.test.ts`      | Create        | Connection pool unit tests                                            |
| `tests/mcp/tool-adapter.test.ts`     | Create        | Tool conversion tests                                                 |
| `tests/mcp/user-endpoints.test.ts`   | Create        | User endpoint resolution tests                                        |
| `tests/mcp/plugin-endpoints.test.ts` | Create        | Plugin endpoint resolution tests                                      |
| `tests/mcp/integration.test.ts`      | Create        | Full flow integration tests with mock MCP server                      |
| `tests/plugins/manifest-mcp.test.ts` | Create        | Manifest `mcp` field validation tests                                 |

---

### Task 1: Install MCP SDK and Create Types

**Files:**

- Modify: `package.json`
- Create: `src/mcp/types.ts`
- Create: `tests/mcp/types.test.ts`

- [ ] **Step 1: Install the MCP SDK**

```bash
bun add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write type tests**

```typescript
// tests/mcp/types.test.ts
import { describe, expect, it } from 'bun:test'
import { mcpEndpointConfigSchema, mcpPluginConfigSchema, sanitizeServerId } from '../../src/mcp/types.js'

describe('mcpEndpointConfigSchema', () => {
  it('accepts a valid streamable-http endpoint', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'my-github',
      url: 'https://api.github.com/mcp',
      label: 'GitHub',
      headers: { Authorization: 'Bearer tok_123' },
      enabled: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing id', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      url: 'https://example.com/mcp',
      label: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-https url', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'test',
      url: 'http://example.com/mcp',
      label: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('defaults enabled to true', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'test',
      url: 'https://example.com/mcp',
      label: 'Test',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.enabled).toBe(true)
  })

  it('accepts optional toolFilter', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'test',
      url: 'https://example.com/mcp',
      label: 'Test',
      toolFilter: ['tool_a', 'tool_b'],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.toolFilter).toEqual(['tool_a', 'tool_b'])
  })
})

describe('mcpPluginConfigSchema', () => {
  it('accepts streamable-http with url', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
      url: 'https://api.github.com/mcp',
    })
    expect(result.success).toBe(true)
  })

  it('rejects streamable-http without url', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
    })
    expect(result.success).toBe(false)
  })

  it('accepts stdio with command', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects stdio without command', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'stdio',
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional headers, env, toolFilter, idleTimeoutMs', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer ${TOKEN}' },
      toolFilter: ['tool_a'],
      idleTimeoutMs: 30000,
    })
    expect(result.success).toBe(true)
  })
})

describe('sanitizeServerId', () => {
  it('lowercases and replaces non-alphanum with hyphens', () => {
    expect(sanitizeServerId('My_Server Name')).toBe('my-server-name')
  })

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeServerId('--hello--')).toBe('hello')
  })

  it('collapses multiple hyphens', () => {
    expect(sanitizeServerId('a___b')).toBe('a-b')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test tests/mcp/types.test.ts
```

Expected: FAIL — module `../../src/mcp/types.js` not found.

- [ ] **Step 4: Implement types**

```typescript
// src/mcp/types.ts
import { z } from 'zod'

const serverIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, 'Server ID must be lowercase kebab-case starting with a letter')

const toolNameSchema = z.string().min(1).max(128)

const headerValueSchema = z.string()

/**
 * Schema for a user-configured MCP endpoint (stored in user_config as JSON).
 * Streamable HTTP only.
 */
export const mcpEndpointConfigSchema = z.object({
  id: serverIdSchema,
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'MCP endpoint URL must use HTTPS',
    }),
  label: z.string().min(1).max(128),
  headers: z.record(headerValueSchema).optional(),
  enabled: z.boolean().optional().default(true),
  toolFilter: z.array(toolNameSchema).optional(),
})

export type McpEndpointConfig = z.output<typeof mcpEndpointConfigSchema>

/**
 * Schema for the `mcp` field in a plugin manifest.
 * Supports both Streamable HTTP and stdio transports.
 */
export const mcpPluginConfigSchema = z
  .object({
    transport: z.enum(['streamable-http', 'stdio']),
    url: z.string().url().optional(),
    headers: z.record(headerValueSchema).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(headerValueSchema).optional(),
    toolFilter: z.array(toolNameSchema).optional(),
    idleTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
  })
  .refine((m) => m.transport !== 'streamable-http' || m.url !== undefined, {
    message: 'url is required when transport is streamable-http',
    path: ['url'],
  })
  .refine((m) => m.transport !== 'stdio' || m.command !== undefined, {
    message: 'command is required when transport is stdio',
    path: ['command'],
  })

export type McpPluginConfig = z.output<typeof mcpPluginConfigSchema>

/** Connection status for an MCP server. */
export type McpServerStatus = 'connecting' | 'connected' | 'idle' | 'disconnected' | 'error'

/** Status info for admin display. */
export type McpServerInfo = {
  id: string
  label: string
  transport: string
  url: string | null
  status: McpServerStatus
  toolCount: number
  lastToolCallAt: number | null
  lastError: string | null
}

/**
 * Sanitize a user-chosen or plugin ID into a valid server ID component
 * for use in tool namespacing (mcp_<id>__<tool>).
 */
export function sanitizeServerId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/mcp/types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/mcp/types.ts tests/mcp/types.test.ts
git commit -m "feat(mcp): add types and Zod schemas for MCP endpoint configs"
```

---

### Task 2: Connection Pool

**Files:**

- Create: `src/mcp/client-pool.ts`
- Create: `tests/mcp/client-pool.test.ts`

- [ ] **Step 1: Write connection pool tests**

```typescript
// tests/mcp/client-pool.test.ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Mock the MCP SDK modules
const mockConnect = mock(() => Promise.resolve())
const mockClose = mock(() => Promise.resolve())
const mockListTools = mock(() =>
  Promise.resolve({ tools: [{ name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object' } }] }),
)
const mockCallTool = mock(() => Promise.resolve({ content: [{ type: 'text', text: 'result' }] }))

const mockClient: Partial<Client> = {
  connect: mockConnect as unknown as Client['connect'],
  close: mockClose as unknown as Client['close'],
  listTools: mockListTools as unknown as Client['listTools'],
  callTool: mockCallTool as unknown as Client['callTool'],
}

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mockConnect
    close = mockClose
    listTools = mockListTools
    callTool = mockCallTool
  },
}))

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL) {}
  },
}))

import { McpConnectionPool } from '../../src/mcp/client-pool.js'

describe('McpConnectionPool', () => {
  let pool: McpConnectionPool

  beforeEach(() => {
    mockConnect.mockClear()
    mockClose.mockClear()
    mockListTools.mockClear()
    mockCallTool.mockClear()
    pool = new McpConnectionPool({ defaultIdleTimeoutMs: 100 })
  })

  afterEach(async () => {
    await pool.shutdown()
  })

  it('creates a new connection on first getOrCreate', async () => {
    const conn = await pool.getOrCreate({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: {},
    })
    expect(conn).toBeDefined()
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('returns the same connection for identical config', async () => {
    const config = { transport: 'streamable-http' as const, url: 'https://example.com/mcp', headers: {} }
    const a = await pool.getOrCreate(config)
    const b = await pool.getOrCreate(config)
    expect(a).toBe(b)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('creates different connections for different URLs', async () => {
    const a = await pool.getOrCreate({
      transport: 'streamable-http',
      url: 'https://a.example.com/mcp',
      headers: {},
    })
    const b = await pool.getOrCreate({
      transport: 'streamable-http',
      url: 'https://b.example.com/mcp',
      headers: {},
    })
    expect(a).not.toBe(b)
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('shuts down all connections', async () => {
    await pool.getOrCreate({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: {},
    })
    await pool.shutdown()
    expect(mockClose).toHaveBeenCalled()
  })

  it('returns server info for active connections', async () => {
    await pool.getOrCreate({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: {},
      label: 'Test Server',
    })
    const infos = pool.getServerInfos()
    expect(infos).toHaveLength(1)
    expect(infos[0].url).toBe('https://example.com/mcp')
    expect(infos[0].label).toBe('Test Server')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/mcp/client-pool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement connection pool**

```typescript
// src/mcp/client-pool.ts
import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { logger } from '../logger.js'
import type { McpEndpointConfig, McpPluginConfig, McpServerInfo, McpServerStatus } from './types.js'

const log = logger.child({ scope: 'mcp:pool' })

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

type PoolEntry = {
  client: Client
  configHash: string
  label: string
  transport: string
  url: string | null
  status: McpServerStatus
  toolCount: number
  lastToolCallAt: number | null
  lastError: string | null
  idleTimer: ReturnType<typeof setTimeout> | null
  idleTimeoutMs: number
}

type ResolvedConfig = {
  transport: 'streamable-http' | 'stdio'
  url: string | null
  headers: Record<string, string>
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  label: string
  idleTimeoutMs: number
  toolFilter: string[] | null
}

export type PoolConnection = {
  client: Client
  config: ResolvedConfig
}

function resolveUserConfig(endpoint: McpEndpointConfig): ResolvedConfig {
  return {
    transport: 'streamable-http',
    url: endpoint.url,
    headers: endpoint.headers ?? {},
    command: null,
    args: null,
    env: null,
    label: endpoint.label,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    toolFilter: endpoint.toolFilter ?? null,
  }
}

function resolvePluginConfig(pluginId: string, mcp: McpPluginConfig): ResolvedConfig {
  return {
    transport: mcp.transport,
    url: mcp.url ?? null,
    headers: mcp.headers ?? {},
    command: mcp.command ?? null,
    args: mcp.args ?? null,
    env: mcp.env ?? null,
    label: pluginId,
    idleTimeoutMs: mcp.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    toolFilter: mcp.toolFilter ?? null,
  }
}

function configHash(config: ResolvedConfig): string {
  const key = JSON.stringify({
    t: config.transport,
    u: config.url,
    h: config.headers,
    c: config.command,
    a: config.args,
  })
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export type McpPoolDeps = {
  createClient?: () => Client
  defaultIdleTimeoutMs?: number
}

export class McpConnectionPool {
  private readonly entries = new Map<string, PoolEntry>()
  private readonly defaultIdleTimeoutMs: number
  private readonly createClient: () => Client

  constructor(deps?: McpPoolDeps) {
    this.defaultIdleTimeoutMs = deps?.defaultIdleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.createClient = deps?.createClient ?? (() => new Client({ name: 'papai-mcp', version: '1.0.0' }))
  }

  async getOrCreateFromUser(endpoint: McpEndpointConfig): Promise<PoolConnection> {
    return this.getOrCreateInternal(resolveUserConfig(endpoint))
  }

  async getOrCreateFromPlugin(pluginId: string, mcp: McpPluginConfig): Promise<PoolConnection> {
    return this.getOrCreateInternal(resolvePluginConfig(pluginId, mcp))
  }

  private async getOrCreateInternal(config: ResolvedConfig): Promise<PoolConnection> {
    const hash = configHash(config)
    const existing = this.entries.get(hash)
    if (existing !== undefined && existing.status === 'connected') {
      this.resetIdleTimer(hash)
      return { client: existing.client, config }
    }

    if (existing !== undefined) {
      // Reconnect existing entry
      await this.connectEntry(existing, config)
      this.resetIdleTimer(hash)
      return { client: existing.client, config }
    }

    const entry: PoolEntry = {
      client: this.createClient(),
      configHash: hash,
      label: config.label,
      transport: config.transport,
      url: config.url,
      status: 'connecting',
      toolCount: 0,
      lastToolCallAt: null,
      lastError: null,
      idleTimer: null,
      idleTimeoutMs: config.idleTimeoutMs,
    }
    this.entries.set(hash, entry)
    await this.connectEntry(entry, config)
    this.resetIdleTimer(hash)
    return { client: entry.client, config }
  }

  private async connectEntry(entry: PoolEntry, config: ResolvedConfig): Promise<void> {
    try {
      if (config.transport === 'streamable-http' && config.url !== null) {
        const transport = new StreamableHTTPClientTransport(new URL(config.url))
        await entry.client.connect(transport)
      }
      // stdio transport support would go here (future extension)
      entry.status = 'connected'
      entry.lastError = null
      log.info({ label: entry.label, url: entry.url }, 'MCP connection established')
    } catch (error) {
      entry.status = 'error'
      entry.lastError = error instanceof Error ? error.message : String(error)
      log.warn({ label: entry.label, error: entry.lastError }, 'MCP connection failed')
      throw error
    }
  }

  recordToolCall(configHash: string): void {
    const entry = this.entries.get(configHash)
    if (entry === undefined) return
    entry.lastToolCallAt = Date.now()
    this.resetIdleTimer(configHash)
  }

  private resetIdleTimer(hash: string): void {
    const entry = this.entries.get(hash)
    if (entry === undefined) return
    if (entry.idleTimer !== null) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => void this.disconnectIdle(hash), entry.idleTimeoutMs)
  }

  private async disconnectIdle(hash: string): Promise<void> {
    const entry = this.entries.get(hash)
    if (entry === undefined || entry.status !== 'connected') return
    try {
      await entry.client.close()
    } catch {
      // ignore close errors
    }
    entry.status = 'idle'
    entry.idleTimer = null
    log.info({ label: entry.label }, 'MCP connection closed (idle timeout)')
  }

  async shutdown(): Promise<void> {
    const closings: Promise<void>[] = []
    for (const [hash, entry] of this.entries) {
      if (entry.idleTimer !== null) clearTimeout(entry.idleTimer)
      if (entry.status === 'connected' || entry.status === 'connecting') {
        closings.push(
          entry.client.close().catch(() => {
            // ignore shutdown errors
          }),
        )
      }
      this.entries.delete(hash)
    }
    await Promise.all(closings)
    log.info('MCP connection pool shut down')
  }

  getServerInfos(): McpServerInfo[] {
    const infos: McpServerInfo[] = []
    for (const entry of this.entries.values()) {
      infos.push({
        id: entry.configHash,
        label: entry.label,
        transport: entry.transport,
        url: entry.url,
        status: entry.status,
        toolCount: entry.toolCount,
        lastToolCallAt: entry.lastToolCallAt,
        lastError: entry.lastError,
      })
    }
    return infos
  }

  updateToolCount(hash: string, count: number): void {
    const entry = this.entries.get(hash)
    if (entry !== undefined) entry.toolCount = count
  }
}

/** Singleton connection pool. */
export const mcpPool = new McpConnectionPool()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/mcp/client-pool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/client-pool.ts tests/mcp/client-pool.test.ts
git commit -m "feat(mcp): add connection pool with idle timeout and reconnect"
```

---

### Task 3: Tool Adapter

**Files:**

- Create: `src/mcp/tool-adapter.ts`
- Create: `tests/mcp/tool-adapter.test.ts`

- [ ] **Step 1: Write tool adapter tests**

```typescript
// tests/mcp/tool-adapter.test.ts
import { describe, expect, it, mock } from 'bun:test'
import { convertMcpToolsToToolSet, type McpToolDef } from '../../src/mcp/tool-adapter.js'

describe('convertMcpToolsToToolSet', () => {
  const makeToolDef = (name: string, description = 'desc'): McpToolDef => ({
    name,
    description,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  })

  it('converts a single MCP tool to a namespaced ToolSet entry', () => {
    const tools = convertMcpToolsToToolSet('my-server', [makeToolDef('search')], {
      callTool: mock(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
    })
    expect(Object.keys(tools)).toEqual(['mcp_my-server__search'])
    expect(tools['mcp_my-server__search']!.description).toBe('desc')
  })

  it('namespaces multiple tools', () => {
    const tools = convertMcpToolsToToolSet('srv', [makeToolDef('a'), makeToolDef('b'), makeToolDef('c')], {
      callTool: mock(() => Promise.resolve({ content: [] })),
    })
    expect(Object.keys(tools)).toEqual(['mcp_srv__a', 'mcp_srv__b', 'mcp_srv__c'])
  })

  it('applies toolFilter when provided', () => {
    const tools = convertMcpToolsToToolSet(
      'srv',
      [makeToolDef('a'), makeToolDef('b'), makeToolDef('c')],
      { callTool: mock(() => Promise.resolve({ content: [] })) },
      ['a', 'c'],
    )
    expect(Object.keys(tools)).toEqual(['mcp_srv__a', 'mcp_srv__c'])
  })

  it('tool execute calls callTool with correct name and args', async () => {
    const callTool = mock(() => Promise.resolve({ content: [{ type: 'text', text: 'result' }] }))
    const tools = convertMcpToolsToToolSet('srv', [makeToolDef('my_tool')], { callTool })
    const result = await tools['mcp_srv__my_tool']!.execute({ query: 'test' }, { toolCallId: 'tc-1', messages: [] })
    expect(callTool).toHaveBeenCalledWith({ name: 'my_tool', arguments: { query: 'test' } })
    expect(result).toBe('result')
  })

  it('tool execute handles isError: true', async () => {
    const callTool = mock(() =>
      Promise.resolve({ content: [{ type: 'text', text: 'something went wrong' }], isError: true }),
    )
    const tools = convertMcpToolsToToolSet('srv', [makeToolDef('failing')], { callTool })
    const result = await tools['mcp_srv__failing']!.execute({}, { toolCallId: 'tc-1', messages: [] })
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/mcp/tool-adapter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement tool adapter**

```typescript
// src/mcp/tool-adapter.ts
import { jsonSchema, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'mcp:tool-adapter' })

/** Minimal MCP tool definition from listTools(). */
export type McpToolDef = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** Minimal callTool interface — matches Client.callTool signature. */
export type McpCallToolFn = (args: { name: string; arguments?: Record<string, unknown> }) => Promise<{
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}>

/**
 * Convert MCP tool definitions to a Vercel AI SDK ToolSet.
 * Tool names are namespaced as `mcp_<serverId>__<toolName>`.
 */
export function convertMcpToolsToToolSet(
  serverId: string,
  mcpTools: McpToolDef[],
  client: { callTool: McpCallToolFn },
  toolFilter?: string[] | null,
): ToolSet {
  const filterSet = toolFilter !== undefined && toolFilter !== null ? new Set(toolFilter) : null
  const result: ToolSet = {}

  for (const mcpTool of mcpTools) {
    if (filterSet !== null && !filterSet.has(mcpTool.name)) continue

    const namespacedName = `mcp_${serverId}__${mcpTool.name}`

    const inputSchemaObj = mcpTool.inputSchema ?? { type: 'object' }
    const inputSchema = jsonSchema(inputSchemaObj as Record<string, unknown>)

    const capturedName = mcpTool.name
    result[namespacedName] = tool({
      description: mcpTool.description ?? `MCP tool: ${capturedName}`,
      inputSchema,
      execute: async (input) => {
        log.debug({ tool: capturedName, serverId }, 'MCP tool call')
        try {
          const result = await client.callTool({
            name: capturedName,
            arguments: input as Record<string, unknown>,
          })
          if (result.isError === true) {
            const errorText = result.content
              .filter((c): c is { type: string; text: string } => c.type === 'text' && c.text !== undefined)
              .map((c) => c.text)
              .join('\n')
            log.warn({ tool: capturedName, error: errorText }, 'MCP tool returned error')
            return { error: errorText || 'MCP tool returned an error' }
          }
          const text = result.content
            .filter((c): c is { type: string; text: string } => c.type === 'text' && c.text !== undefined)
            .map((c) => c.text)
            .join('\n')
          log.debug({ tool: capturedName }, 'MCP tool call completed')
          return text
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          log.error({ tool: capturedName, error: msg }, 'MCP tool call failed')
          return { error: `MCP tool call failed: ${msg}` }
        }
      },
    })
  }

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/mcp/tool-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool-adapter.ts tests/mcp/tool-adapter.test.ts
git commit -m "feat(mcp): add tool adapter converting MCP tools to AI SDK ToolSet"
```

---

### Task 4: User-Configured Endpoints

**Files:**

- Modify: `src/types/config.ts`
- Modify: `src/config-keys.ts`
- Create: `src/mcp/user-endpoints.ts`
- Create: `tests/mcp/user-endpoints.test.ts`

- [ ] **Step 1: Add 'mcp_endpoints' config key**

In `src/types/config.ts`, add `'mcp_endpoints'` to the config key types and array:

```typescript
// Add after PreferenceConfigKey
export type McpConfigKey = 'mcp_endpoints'

// Update ConfigKey union
export type ConfigKey = TaskProviderConfigKey | PreferenceConfigKey | McpConfigKey

// Add to ALL_CONFIG_KEYS array
export const ALL_CONFIG_KEYS: readonly ConfigKey[] = [
  'kaneo_apikey',
  KANEO_WORKSPACE_CONFIG_KEY,
  'youtrack_token',
  'timezone',
  'mcp_endpoints',
]
```

- [ ] **Step 2: Update context key filtering**

In `src/config-keys.ts`, ensure `'mcp_endpoints'` is always available (it's a preference-level key, not provider-specific). The existing logic already returns `PREFERENCE_KEYS` as a fallback — add `'mcp_endpoints'` to the preference keys:

```typescript
// In src/config-keys.ts, add 'mcp_endpoints' to the preference keys returned by getConfigKeysForContext
```

- [ ] **Step 3: Write user-endpoints tests**

```typescript
// tests/mcp/user-endpoints.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { setupTestDb } from '../utils/test-db.js'
import { seedCommonTestPlatformInstances } from '../utils/test-seed.js'
import { clearUserCache } from '../../src/cache.js'
import { setConfig } from '../../src/config.js'

const TEST_USER = 'user-mcp-test'

// Mock the pool
const mockGetOrCreateFromUser = mock(() =>
  Promise.resolve({
    client: {
      listTools: mock(() =>
        Promise.resolve({ tools: [{ name: 'tool_a', description: 'A', inputSchema: { type: 'object' } }] }),
      ),
      callTool: mock(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
    },
    config: { toolFilter: null },
  }),
)

mock.module('../../src/mcp/client-pool.js', () => ({
  mcpPool: { getOrCreateFromUser: mockGetOrCreateFromUser },
}))

const { buildMcpToolSet, parseMcpEndpoints } = await import('../../src/mcp/user-endpoints.js')

describe('parseMcpEndpoints', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(TEST_USER)
  })

  it('returns empty array for null config', () => {
    expect(parseMcpEndpoints(null)).toEqual([])
  })

  it('parses valid JSON array', () => {
    const raw = JSON.stringify([{ id: 'gh', url: 'https://api.github.com/mcp', label: 'GitHub', enabled: true }])
    const result = parseMcpEndpoints(raw)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gh')
  })

  it('skips invalid entries', () => {
    const raw = JSON.stringify([
      { id: 'gh', url: 'https://api.github.com/mcp', label: 'GitHub', enabled: true },
      { url: 'https://bad.com' }, // missing id
    ])
    const result = parseMcpEndpoints(raw)
    expect(result).toHaveLength(1)
  })
})

describe('buildMcpToolSet', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(TEST_USER)
    mockGetOrCreateFromUser.mockClear()
  })

  it('returns empty ToolSet when no endpoints configured', async () => {
    const tools = await buildMcpToolSet(TEST_USER)
    expect(Object.keys(tools)).toHaveLength(0)
  })

  it('builds ToolSet from configured endpoints', async () => {
    setConfig(
      TEST_USER,
      'mcp_endpoints',
      JSON.stringify([{ id: 'gh', url: 'https://api.github.com/mcp', label: 'GitHub', enabled: true }]),
    )
    const tools = await buildMcpToolSet(TEST_USER)
    expect(Object.keys(tools)).toContain('mcp_gh__tool_a')
  })

  it('skips disabled endpoints', async () => {
    setConfig(
      TEST_USER,
      'mcp_endpoints',
      JSON.stringify([{ id: 'gh', url: 'https://api.github.com/mcp', label: 'GitHub', enabled: false }]),
    )
    const tools = await buildMcpToolSet(TEST_USER)
    expect(Object.keys(tools)).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
bun test tests/mcp/user-endpoints.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement user-endpoints**

```typescript
// src/mcp/user-endpoints.ts
import type { ToolSet } from 'ai'
import { getCachedConfig } from '../cache.js'
import { logger } from '../logger.js'
import { mcpPool } from './client-pool.js'
import { convertMcpToolsToToolSet } from './tool-adapter.js'
import { mcpEndpointConfigSchema, type McpEndpointConfig, sanitizeServerId } from './types.js'

const log = logger.child({ scope: 'mcp:user-endpoints' })

const MCP_ENDPOINTS_CONFIG_KEY = 'mcp_endpoints'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the raw JSON string from user_config into validated endpoint configs.
 * Invalid entries are silently skipped with a warning log.
 */
export function parseMcpEndpoints(raw: string | null): McpEndpointConfig[] {
  if (raw === null || raw.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const results: McpEndpointConfig[] = []
    for (const item of parsed) {
      const result = mcpEndpointConfigSchema.safeParse(item)
      if (result.success) {
        results.push(result.data)
      } else {
        log.warn({ issues: result.error.issues }, 'Skipping invalid MCP endpoint config entry')
      }
    }
    return results
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt mcp_endpoints config')
    return []
  }
}

/**
 * Build a ToolSet from user-configured MCP endpoints for the given context.
 * Gracefully skips endpoints that fail to connect.
 */
export async function buildMcpToolSet(contextId: string): Promise<ToolSet> {
  const raw = getCachedConfig(contextId, MCP_ENDPOINTS_CONFIG_KEY)
  const endpoints = parseMcpEndpoints(raw)
  if (endpoints.length === 0) return {}

  const enabled = endpoints.filter((e) => e.enabled)
  if (enabled.length === 0) return {}

  const merged: ToolSet = {}

  for (const endpoint of enabled) {
    try {
      const { client, config } = await mcpPool.getOrCreateFromUser(endpoint)
      const { tools: mcpTools } = await client.listTools()
      const serverId = sanitizeServerId(endpoint.id)
      const toolSet = convertMcpToolsToToolSet(serverId, mcpTools, client, config.toolFilter)
      Object.assign(merged, toolSet)
      log.info({ endpointId: endpoint.id, toolCount: Object.keys(toolSet).length }, 'MCP endpoint tools loaded')
    } catch (error) {
      log.warn(
        { endpointId: endpoint.id, error: error instanceof Error ? error.message : String(error) },
        'Failed to load MCP endpoint — skipping',
      )
    }
  }

  return merged
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test tests/mcp/user-endpoints.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/config.ts src/config-keys.ts src/mcp/user-endpoints.ts tests/mcp/user-endpoints.test.ts
git commit -m "feat(mcp): add user-configured endpoint resolution with config storage"
```

---

### Task 5: Plugin Manifest Schema Extension

**Files:**

- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/discovery.ts`
- Create: `tests/plugins/manifest-mcp.test.ts`

- [ ] **Step 1: Write manifest validation tests**

```typescript
// tests/plugins/manifest-mcp.test.ts
import { describe, expect, it } from 'bun:test'
import { pluginManifestSchema } from '../../src/plugins/types.js'

const baseManifest = {
  id: 'test-mcp',
  name: 'Test MCP Plugin',
  version: '1.0.0',
  description: 'A test MCP plugin',
  apiVersion: 1,
}

describe('pluginManifestSchema with mcp field', () => {
  it('accepts a manifest with streamable-http mcp config', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      mcp: {
        transport: 'streamable-http',
        url: 'https://api.github.com/mcp',
      },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.mcp?.transport).toBe('streamable-http')
  })

  it('accepts a manifest with stdio mcp config', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      mcp: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects streamable-http without url', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      mcp: { transport: 'streamable-http' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects stdio without command', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      mcp: { transport: 'stdio' },
    })
    expect(result.success).toBe(false)
  })

  it('allows main to be omitted when mcp is declared', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      mcp: { transport: 'streamable-http', url: 'https://example.com/mcp' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.main).toBe('index.ts') // default
  })

  it('accepts mcp with headers, env, toolFilter, idleTimeoutMs', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      mcp: {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
        toolFilter: ['tool_a'],
        idleTimeoutMs: 30000,
      },
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/plugins/manifest-mcp.test.ts
```

Expected: FAIL — `mcp` field not recognized in schema.

- [ ] **Step 3: Add `mcp` field to pluginManifestSchema**

In `src/plugins/types.ts`, add the `mcp` field import and schema:

```typescript
// Add import at top (already in types.ts)
import { mcpPluginConfigSchema } from '../mcp/types.js'

// Add to the pluginManifestSchema z.object({...}):
//   mcp: mcpPluginConfigSchema.optional(),
// This goes alongside the other optional fields like 'permissions', 'defaultEnabled', etc.
```

Also add the refine to allow `main` to be omitted when `mcp` is declared:

```typescript
// Add a .refine() after the existing refine:
.refine((m) => m.mcp === undefined || m.main !== undefined || true, {
  // main defaults to 'index.ts' so this always passes; the discovery step
  // will skip entry-point validation when mcp is declared and no explicit main.
})
```

- [ ] **Step 4: Update discovery to skip entry-point validation for MCP-only plugins**

In `src/plugins/discovery.ts`, when a manifest has `mcp` declared and no explicit `main` override, skip the entry-point existence check:

```typescript
// In the discovery function, after reading the manifest:
// if (manifest.mcp !== undefined && rawMain === undefined) {
//   // MCP-only plugin — no entry point needed
//   entryPoint = null
// }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/plugins/manifest-mcp.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/discovery.ts tests/plugins/manifest-mcp.test.ts
git commit -m "feat(plugins): extend manifest schema with mcp field for declarative MCP plugins"
```

---

### Task 6: Plugin-Manifest Endpoint Resolution

**Files:**

- Create: `src/mcp/plugin-endpoints.ts`
- Create: `tests/mcp/plugin-endpoints.test.ts`

- [ ] **Step 1: Write plugin-endpoints tests**

```typescript
// tests/mcp/plugin-endpoints.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test'

// Mock the pool
const mockGetOrCreateFromPlugin = mock(() =>
  Promise.resolve({
    client: {
      listTools: mock(() =>
        Promise.resolve({ tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] }),
      ),
      callTool: mock(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
    },
    config: { toolFilter: null },
  }),
)

mock.module('../../src/mcp/client-pool.js', () => ({
  mcpPool: { getOrCreateFromPlugin: mockGetOrCreateFromPlugin },
}))

const { buildPluginMcpToolSet } = await import('../../src/mcp/plugin-endpoints.js')

describe('buildPluginMcpToolSet', () => {
  beforeEach(() => {
    mockGetOrCreateFromPlugin.mockClear()
  })

  it('returns empty ToolSet when no plugins have mcp config', async () => {
    const tools = await buildPluginMcpToolSet([], new Map())
    expect(Object.keys(tools)).toHaveLength(0)
  })

  it('builds ToolSet from a plugin with mcp config', async () => {
    const pluginId = 'github-mcp'
    const manifests = new Map([
      [
        pluginId,
        {
          mcp: { transport: 'streamable-http' as const, url: 'https://api.github.com/mcp' },
          configRequirements: [],
        },
      ],
    ])
    const tools = await buildPluginMcpToolSet([pluginId], manifests)
    expect(Object.keys(tools)).toContain('plugin_github-mcp__search')
  })

  it('resolves ${VAR} placeholders in headers', async () => {
    const pluginId = 'test-mcp'
    const manifests = new Map([
      [
        pluginId,
        {
          mcp: {
            transport: 'streamable-http' as const,
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer ${token}' },
          },
          configRequirements: [],
          configValues: { token: 'my-secret' },
        },
      ],
    ])
    await buildPluginMcpToolSet([pluginId], manifests)
    expect(mockGetOrCreateFromPlugin).toHaveBeenCalledWith(
      pluginId,
      expect.objectContaining({
        headers: { Authorization: 'Bearer my-secret' },
      }),
    )
  })

  it('skips plugin with missing required config values', async () => {
    const pluginId = 'test-mcp'
    const manifests = new Map([
      [
        pluginId,
        {
          mcp: {
            transport: 'streamable-http' as const,
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer ${missing_token}' },
          },
          configRequirements: [{ key: 'missing_token', required: true }],
          configValues: {},
        },
      ],
    ])
    const tools = await buildPluginMcpToolSet([pluginId], manifests)
    expect(Object.keys(tools)).toHaveLength(0)
  })

  it('applies toolFilter from plugin mcp config', async () => {
    const pluginId = 'filtered-mcp'
    const manifests = new Map([
      [
        pluginId,
        {
          mcp: {
            transport: 'streamable-http' as const,
            url: 'https://example.com/mcp',
            toolFilter: ['search'],
          },
          configRequirements: [],
        },
      ],
    ])
    // listTools returns [search, other] — only search should be included
    const mockListToolsWithExtra = mock(() =>
      Promise.resolve({
        tools: [
          { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
          { name: 'other', description: 'Other', inputSchema: { type: 'object' } },
        ],
      }),
    )
    mockGetOrCreateFromPlugin.mockReturnValueOnce(
      Promise.resolve({
        client: { listTools: mockListToolsWithExtra, callTool: mock() },
        config: { toolFilter: ['search'] },
      }),
    )
    const tools = await buildPluginMcpToolSet([pluginId], manifests)
    expect(Object.keys(tools)).toEqual(['plugin_filtered-mcp__search'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/mcp/plugin-endpoints.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement plugin-endpoints**

```typescript
// src/mcp/plugin-endpoints.ts
import type { ToolSet } from 'ai'
import { logger } from '../logger.js'
import { mcpPool } from './client-pool.js'
import { convertMcpToolsToToolSet } from './tool-adapter.js'
import type { McpPluginConfig } from './types.js'

const log = logger.child({ scope: 'mcp:plugin-endpoints' })

export type PluginMcpDescriptor = {
  mcp: McpPluginConfig
  configRequirements: ReadonlyArray<{ key: string; required: boolean }>
  configValues?: Record<string, string>
}

/** Pattern for ${VAR} placeholders in header/env values. */
const PLACEHOLDER_RE = /\$\{([^}]+)\}/gu

/**
 * Resolve ${VAR} placeholders in a string record.
 * Returns null if any required placeholder has no value.
 */
function resolvePlaceholders(
  record: Record<string, string>,
  values: Record<string, string>,
): Record<string, string> | null {
  const resolved: Record<string, string> = {}
  for (const [key, template] of Object.entries(record)) {
    const result = template.replaceAll(PLACEHOLDER_RE, (_match, varName: string) => {
      const val = values[varName]
      if (val === undefined || val === '') return `\x00MISSING:${varName}\x00`
      return val
    })
    if (result.includes('\x00MISSING:')) {
      return null
    }
    resolved[key] = result
  }
  return resolved
}

/**
 * Build a ToolSet from plugins that declare an `mcp` field in their manifest.
 *
 * @param activePluginIds - Plugin IDs that are active and eligible for the current context.
 * @param pluginDescriptors - Map from plugin ID to its MCP descriptor (mcp config + config requirements/values).
 */
export async function buildPluginMcpToolSet(
  activePluginIds: string[],
  pluginDescriptors: Map<string, PluginMcpDescriptor>,
): Promise<ToolSet> {
  const merged: ToolSet = {}

  for (const pluginId of activePluginIds) {
    const descriptor = pluginDescriptors.get(pluginId)
    if (descriptor === undefined) continue

    const mcpConfig = descriptor.mcp
    const configValues = descriptor.configValues ?? {}

    // Resolve placeholders in headers
    let resolvedHeaders = mcpConfig.headers ?? {}
    if (Object.keys(resolvedHeaders).length > 0) {
      const result = resolvePlaceholders(resolvedHeaders, configValues)
      if (result === null) {
        log.warn({ pluginId }, 'MCP plugin has unresolved placeholder in headers — skipping')
        continue
      }
      resolvedHeaders = result
    }

    // Resolve placeholders in env
    let resolvedEnv = mcpConfig.env ?? {}
    if (Object.keys(resolvedEnv).length > 0) {
      const result = resolvePlaceholders(resolvedEnv, configValues)
      if (result === null) {
        log.warn({ pluginId }, 'MCP plugin has unresolved placeholder in env — skipping')
        continue
      }
      resolvedEnv = result
    }

    try {
      const resolvedConfig: McpPluginConfig = {
        ...mcpConfig,
        headers: Object.keys(resolvedHeaders).length > 0 ? resolvedHeaders : undefined,
        env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
      }

      const { client } = await mcpPool.getOrCreateFromPlugin(pluginId, resolvedConfig)
      const { tools: mcpTools } = await client.listTools()
      const toolSet = convertMcpToolsToToolSet(pluginId, mcpTools, client, mcpConfig.toolFilter)
      Object.assign(merged, toolSet)
      log.info({ pluginId, toolCount: Object.keys(toolSet).length }, 'MCP plugin tools loaded')
    } catch (error) {
      log.warn(
        { pluginId, error: error instanceof Error ? error.message : String(error) },
        'Failed to load MCP plugin — skipping',
      )
    }
  }

  return merged
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/mcp/plugin-endpoints.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/plugin-endpoints.ts tests/mcp/plugin-endpoints.test.ts
git commit -m "feat(mcp): add plugin-manifest endpoint resolution with placeholder support"
```

---

### Task 7: Wire Into makeTools

**Files:**

- Modify: `src/tools/index.ts`
- Create: `src/mcp/index.ts`

- [ ] **Step 1: Create the public re-export file**

```typescript
// src/mcp/index.ts
export { buildMcpToolSet } from './user-endpoints.js'
export { buildPluginMcpToolSet } from './plugin-endpoints.js'
export { McpConnectionPool, mcpPool } from './client-pool.js'
export { convertMcpToolsToToolSet } from './tool-adapter.js'
export type { McpEndpointConfig, McpPluginConfig, McpServerInfo, McpServerStatus } from './types.js'
```

- [ ] **Step 2: Wire MCP tool builders into makeTools**

In `src/tools/index.ts`, add imports and calls to the MCP tool builders:

```typescript
// Add imports
import { buildMcpToolSet } from '../mcp/user-endpoints.js'
import { buildPluginMcpToolSet, type PluginMcpDescriptor } from '../mcp/plugin-endpoints.js'
import { getPluginMcpDescriptors } from '../plugins/registry.js' // new helper needed

// In the makeTools function, after building built-in tools and before plugin tools:
// 1. Build user-configured MCP tools
// 2. Build plugin-declared MCP tools
// 3. Merge all together
```

The updated `makeTools` flow:

```typescript
export function makeTools(provider: TaskProvider, ...args): ToolSet {
  const options = args[0]
  const storageContextId = options?.storageContextId
  const chatUserId = options?.chatUserId
  const contextId = storageContextId
  const mode = options?.mode ?? 'normal'
  // ... existing destructuring ...

  const tools = buildTools(provider, chatUserId, contextId, mode, contextType, username, stagedDownloadFn)
  const wrappedBuiltins = wrapToolSet(tools)

  // User-configured MCP endpoints
  let mcpTools: ToolSet = {}
  if (contextId !== undefined) {
    mcpTools = await buildMcpToolSet(contextId) // needs to be async now
  }

  // Existing plugin tools
  let pluginTools: ToolSet = {}
  if (contextId !== undefined && chatUserId !== undefined) {
    const activePlugins = getPluginsForContext(contextId)
    if (activePlugins.length > 0) {
      const activePluginIds = activePlugins
        .map((p) => p.manifest.id)
        .filter((id) => contributionRegistry.getContributions(id) !== undefined)
      pluginTools = buildPluginToolSet(activePluginIds, new Set(Object.keys(wrappedBuiltins)), {
        provider,
        storageContextId: contextId,
        chatUserId,
      })

      // Plugin-declared MCP endpoints
      const mcpPluginIds = activePlugins.filter((p) => p.manifest.mcp !== undefined).map((p) => p.manifest.id)
      if (mcpPluginIds.length > 0) {
        const descriptors = getPluginMcpDescriptors(mcpPluginIds, contextId)
        const pluginMcpTools = await buildPluginMcpToolSet(mcpPluginIds, descriptors)
        Object.assign(mcpTools, pluginMcpTools)
      }
    }
  }

  return applyToolPreferences({ ...wrappedBuiltins, ...mcpTools, ...pluginTools }, contextId)
}
```

Note: `makeTools` may need to become async if the MCP tool builders are async. Check if the existing call sites can handle an async `makeTools`. If not, the MCP tools can be loaded eagerly (cached) or the function signature changes to return `Promise<ToolSet>`.

- [ ] **Step 3: Update the MakeToolsOptions type**

In `src/tools/types.ts`, ensure the options type is compatible with the async MCP loading.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/index.ts src/tools/index.ts src/tools/types.ts
git commit -m "feat(mcp): wire MCP tool builders into makeTools pipeline"
```

---

### Task 8: Tool Metadata and Preferences Integration

**Files:**

- Modify: `src/tools/tool-metadata.ts`
- Modify: `src/tools/tool-preferences.ts`

- [ ] **Step 1: Add 'mcp' domain to ToolDomain**

In `src/tools/tool-metadata.ts`:

```typescript
export type ToolDomain =
  | 'task'
  | 'project'
  | 'comment'
  | 'label'
  | 'status'
  | 'attachment'
  | 'work'
  | 'sprint'
  | 'query'
  | 'collaboration'
  | 'memo'
  | 'recurring'
  | 'deferred'
  | 'instruction'
  | 'history'
  | 'web'
  | 'identity'
  | 'time'
  | 'mcp' // NEW
```

- [ ] **Step 2: Add MCP tool metadata resolution**

MCP tools are dynamically discovered, so they won't have static entries in `TOOL_METADATA`. Update `getToolMetadata` to detect MCP-prefixed tools:

```typescript
export function getToolMetadata(toolName: string): ToolClassification | undefined {
  const staticMeta = TOOL_METADATA[toolName]
  if (staticMeta !== undefined) return staticMeta

  // MCP tools: mcp_<server-id>__<tool_name> or plugin_<plugin-id>__<tool_name>
  // These are classified as 'mcp' domain with 'open-world' risk
  if (toolName.startsWith('mcp_') || (toolName.startsWith('plugin_') && toolName.includes('__'))) {
    return { domain: 'mcp', operation: 'read', risk: 'open-world' }
  }

  return undefined
}
```

Note: The plugin tool classification needs care — regular plugin tools (non-MCP) should not be classified as 'mcp'. Consider checking if the tool name starts with `mcp_` specifically, and leaving `plugin_` tools as unclassified (existing behavior).

- [ ] **Step 3: Commit**

```bash
git add src/tools/tool-metadata.ts
git commit -m "feat(tools): add mcp domain for MCP tool classification and preferences"
```

---

### Task 9: Admin Read-Only View

**Files:**

- Create: `src/debug/mcp-routes.ts`
- Modify: `src/debug/server.ts`

- [ ] **Step 1: Implement MCP status route**

```typescript
// src/debug/mcp-routes.ts
import { mcpPool } from '../mcp/client-pool.js'
import { jsonResponse } from './json-response.js'

export function handleMcpStatus(): Response {
  const infos = mcpPool.getServerInfos()
  return jsonResponse(200, {
    servers: infos.map((info) => ({
      ...info,
      url: info.url !== null ? maskUrl(info.url) : null,
    })),
  })
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
  } catch {
    return '***'
  }
}
```

- [ ] **Step 2: Wire into debug server**

In `src/debug/server.ts`, add the route:

```typescript
// Add import
import { handleMcpStatus } from './mcp-routes.js'

// In routeAdminPaths or routeRequest:
if (url.pathname === '/mcp/status') {
  if (req.method === 'GET') return handleMcpStatus()
  return new Response('Method not allowed', { status: 405 })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/debug/mcp-routes.ts src/debug/server.ts
git commit -m "feat(debug): add read-only MCP status admin route at /mcp/status"
```

---

### Task 10: Integration Tests

**Files:**

- Create: `tests/mcp/integration.test.ts`

- [ ] **Step 1: Write integration tests with mock MCP server**

```typescript
// tests/mcp/integration.test.ts
import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test'
import { setupTestDb } from '../utils/test-db.js'
import { seedCommonTestPlatformInstances } from '../utils/test-seed.js'
import { clearUserCache } from '../../src/cache.js'
import { setConfig } from '../../src/config.js'

const TEST_USER = 'integration-mcp-user'

describe('MCP adapter integration', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(TEST_USER)
  })

  it('full flow: config → makeTools → tool call', async () => {
    // This test verifies the full pipeline from config storage
    // through makeTools to actual tool invocation.
    // Requires wiring from Task 7 to be complete.

    setConfig(
      TEST_USER,
      'mcp_endpoints',
      JSON.stringify([
        {
          id: 'test-server',
          url: 'https://test-mcp.example.com/mcp',
          label: 'Test MCP',
          enabled: true,
        },
      ]),
    )

    // The actual assertion depends on makeTools being wired up.
    // This test should be expanded after Task 7 is complete.
    expect(true).toBe(true) // placeholder — replace with real assertion
  })
})
```

- [ ] **Step 2: Expand with mock MCP SDK**

Mock the MCP SDK so `listTools()` returns a known tool and `callTool()` returns a known result. Then:

1. Configure an endpoint via `setConfig(TEST_USER, 'mcp_endpoints', ...)`
2. Call `makeTools(provider, { storageContextId: TEST_USER, chatUserId: TEST_USER, mode: 'normal' })`
3. Assert the ToolSet contains `mcp_test-server__<tool_name>`
4. Call `tools['mcp_test-server__<tool_name>'].execute({ ... })` and assert the result matches the mock
5. Assert `callTool` was invoked with the correct tool name and arguments

- [ ] **Step 3: Commit**

```bash
git add tests/mcp/integration.test.ts
git commit -m "test(mcp): add integration tests for full MCP adapter flow"
```

---

### Task 11: Config Editor UI (Optional — Future)

This task adds an interactive MCP configuration section to the config editor. It depends on the admin client patterns in `client/admin/` and is lower priority than the core functionality.

**Files:**

- Modify: `client/admin/admin.svelte.ts` (add MCP section)
- Create: `client/admin/sections/McpSection.svelte`
- Modify: `src/debug/server.ts` (add config CRUD routes)

- [ ] **Step 1: Add MCP section to admin section registry**

In `client/admin/admin.svelte.ts`, add `{ id: 'mcp', label: 'MCP Servers' }` to the `adminSections` array.

- [ ] **Step 2: Implement McpSection.svelte**

A Svelte 5 component that:

- Fetches MCP server status from `/mcp/status`
- Displays a table of configured servers with status, tool count, last activity
- Provides add/edit/remove forms for user-configured endpoints
- Shows test button that connects and lists discovered tools

- [ ] **Step 3: Add config CRUD routes**

Add `GET/POST/DELETE /api/mcp-endpoints` routes in `src/debug/server.ts` for managing user-configured MCP endpoints.

- [ ] **Step 4: Commit**

```bash
git add client/admin/admin.svelte.ts client/admin/sections/McpSection.svelte src/debug/server.ts
git commit -m "feat(admin): add MCP servers configuration section"
```

---

## Execution Order

Execute tasks in order. Tasks 1-6 are independent units that build on each other. Task 7 wires everything together. Tasks 8-9 can be done in parallel after Task 7. Task 10 validates the full flow. Task 11 is optional/future.

1. **Task 1:** Types and schemas (foundation)
2. **Task 2:** Connection pool
3. **Task 3:** Tool adapter
4. **Task 4:** User-configured endpoints + config key
5. **Task 5:** Plugin manifest schema extension
6. **Task 6:** Plugin-manifest endpoint resolution
7. **Task 7:** Wire into makeTools (integration point)
8. **Task 8:** Tool metadata + preferences
9. **Task 9:** Admin read-only view
10. **Task 10:** Integration tests
11. **Task 11:** Config editor UI (optional/future)
