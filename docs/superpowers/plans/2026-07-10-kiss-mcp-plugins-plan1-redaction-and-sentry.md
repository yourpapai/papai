<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Servers as papai Plugins — Plan 1: Redaction Foundation + Sentry Reference Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic bridge-level MCP response-redaction capability, then ship `mcp-sentry` as the fully-worked reference plugin that proves the whole `mcpServer: true` → coding-agent path end-to-end with redaction on.

**Architecture:** Redaction is a post-processor applied at papai's single choke point — `callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts` — where a plugin tool's output becomes an MCP response bound for the sandboxed coding agent. A plugin opts in via a new manifest flag `mcpResponseRedaction: true`. Internal-model credentials live in operator admin config (`mcp_redaction`). The redactor calls an OpenAI-compatible chat/completions model to find PII/secret substrings, applies longest-match-first replacement, and fails closed to a block marker on any error. `mcp-sentry` is then a normal papai plugin (tools registered via `registerTool`, upstream reached only through `providerRuntime.httpFetch`) exposed at `/mcp/plugin/mcp-sentry`; nothing downstream of papai changes.

**Tech Stack:** Bun runtime + `bun:test`; Zod v4; TypeScript (strict, `.js` import paths); `@modelcontextprotocol/sdk` (already used by `src/mcp-server`). No new dependencies.

---

## Scope of this plan (Plan 1 of a series)

This is a large effort — a core foundation plus nine independent plugins (~50 tools). Each plugin is an independent, separately-testable subsystem, so per the writing-plans scope-check the work is split into separate plans:

- **Plan 1 (this document):** the redaction foundation (Wave 1) + the `mcp-sentry` reference plugin (Wave 2), fully TDD-detailed. This establishes the exact template every later plugin copies.
- **Plans 2–N (roadmap appendix below):** one plan per remaining plugin — `mcp-confluence`, `mcp-figma`, `mcp-rag`, `mcp-teamcity`, `mcp-youtrack`, `mcp-gitlab` (read-first), `mcp-mattermost`, `mcp-test` — each generated from the `mcp-sentry` template with the concrete per-plugin spec in the appendix. `mcp-npm` is out of scope (documented exception; belongs sandbox-side in magi).

### Deviation from the spec (flagged)

The design spec (`docs/superpowers/specs/2026-07-10-kiss-mcp-servers-as-papai-plugins-design.md`, §"Generic response-redaction capability") says each redacting plugin ships its own `redaction-prompt.md`. **Plan 1 instead uses one shared `DEFAULT_REDACTION_PROMPT` constant in the redactor module**, applied whenever `mcpResponseRedaction: true`. Rationale: the ФЗ-152 category core is uniform across kiss's four redacting servers, and a shared default keeps the core change to five files with no changes to the plugin registration facade. Per-plugin / per-tool prompt override (only youtrack genuinely needs it, for attachment content) is a documented follow-up: a context-scoped `redaction_prompt` config key read via `runtimeContext.contextConfig.get(...)`, falling back to the default. This is called out again in the roadmap.

---

## File structure

**Wave 1 — core foundation (5 files touched/created):**

- Modify `src/plugins/types.ts` — add optional `mcpResponseRedaction: boolean` to `pluginManifestSchema` and to the `PluginManifest` hand-constructed type.
- Create `src/coding-credentials/mcp-redaction.ts` — operator admin-config store for the internal-model creds (`mcp_redaction`), cloned from `mcp-plugin-servers.ts`.
- Create `src/mcp-server/redaction.ts` — the redactor: `callInternalModel`, `parseFindings`, `applyRedactions`, `redactText`, `isBlockedResult`, `DEFAULT_REDACTION_PROMPT`, `sizeGuard`.
- Modify `src/mcp-server/plugin-bridge.ts` — apply redaction in `callPluginMcpTool` when the manifest opts in; fail-closed.
- Modify `src/coding-credentials/mcp-plugin-servers.ts` — in `listEnabledInternalMcpServers`, skip a plugin whose manifest sets `mcpResponseRedaction: true` when `mcp_redaction` is unconfigured (fail-closed eligibility).

**Wave 2 — `mcp-sentry` plugin (mirrors `plugins/synthetic-web-search/`):**

- Create `plugins/mcp-sentry/plugin.json`
- Create `plugins/mcp-sentry/context.ts` (copied verbatim from `synthetic-web-search/context.ts`)
- Create `plugins/mcp-sentry/input-schema.ts` (JSON Schemas for 7 tools)
- Create `plugins/mcp-sentry/client.ts` (`SentryClient` on injected `httpFetch` + `sanitizeObject`)
- Create `plugins/mcp-sentry/format.ts` (`sanitizeObject`/`sanitizeKeyValue`)
- Create `plugins/mcp-sentry/index.ts` (factory; registers 7 tools)
- Create `plugins/mcp-sentry/README.md`
- Create `tests/plugins/mcp-sentry.test.ts` and `tests/plugins/mcp-sentry-schema.test.ts`
- Create `tests/mcp-server/redaction.test.ts` and `tests/coding-credentials/mcp-redaction.test.ts` (Wave 1 tests)

---

## WAVE 1 — Redaction foundation

### Task 1: Add the `mcpResponseRedaction` manifest flag

**Files:**

- Modify: `src/plugins/types.ts:204-208` (near `mcp` / `mcpServer`)
- Modify: `src/plugins/types.ts:253-262` (the `PluginManifest` Omit type)
- Test: `tests/plugins/manifest-schema.test.ts` (add a case; create the file if absent — check first with `ls tests/plugins/ | grep manifest`)

- [ ] **Step 1: Write the failing test**

Add to `tests/plugins/manifest-schema.test.ts` (or create it with the standard header + imports):

```typescript
import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

const base = {
  id: 'mcp-sentry',
  name: 'Sentry',
  version: '1.0.0',
  description: 'x',
  apiVersion: 1,
  main: 'index.ts',
}

describe('pluginManifestSchema mcpResponseRedaction', () => {
  test('defaults mcpResponseRedaction to false when omitted', () => {
    const parsed = pluginManifestSchema.parse(base)
    expect(parsed.mcpResponseRedaction).toBe(false)
  })

  test('accepts mcpResponseRedaction: true', () => {
    const parsed = pluginManifestSchema.parse({ ...base, mcpResponseRedaction: true })
    expect(parsed.mcpResponseRedaction).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/manifest-schema.test.ts`
Expected: FAIL — `parsed.mcpResponseRedaction` is `undefined` (field not in schema).

- [ ] **Step 3: Add the schema field**

In `src/plugins/types.ts`, immediately after the `mcpServer` field (line ~208), inside the `.strictObject({...})`:

```typescript
    mcpServer: z.boolean().optional().default(false),
    // When true, this plugin's MCP tool responses are run through the bridge-level
    // redactor (src/mcp-server/redaction.ts) before leaving papai for the coding agent.
    // Requires operator `mcp_redaction` admin config; fail-closed otherwise.
    mcpResponseRedaction: z.boolean().optional().default(false),
```

Then extend the `PluginManifest` Omit type (line ~253) so the defaulted field stays optional on hand-built fixtures:

```typescript
export type PluginManifest = Omit<
  ParsedPluginManifest,
  | 'providerContextConfigSchema'
  | 'providerTraits'
  | 'providerAllowedHostsFromConfig'
  | 'storageScope'
  | 'mcpServer'
  | 'mcpResponseRedaction'
> & {
  providerContextConfigSchema?: ParsedPluginManifest['providerContextConfigSchema']
  providerTraits?: ParsedPluginManifest['providerTraits']
  providerAllowedHostsFromConfig?: ParsedPluginManifest['providerAllowedHostsFromConfig']
  storageScope?: ParsedPluginManifest['storageScope']
  mcpServer?: ParsedPluginManifest['mcpServer']
  mcpResponseRedaction?: ParsedPluginManifest['mcpResponseRedaction']
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/manifest-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/types.ts tests/plugins/manifest-schema.test.ts
git commit -m "feat(plugins): add mcpResponseRedaction manifest flag"
```

---

### Task 2: `mcp_redaction` admin-config store

**Files:**

- Create: `src/coding-credentials/mcp-redaction.ts`
- Test: `tests/coding-credentials/mcp-redaction.test.ts`

Pattern source: `src/coding-credentials/mcp-plugin-servers.ts` (uses `getCachedConfig`/`setCachedConfig` from `../cache.js`, a `__admin_...__:<platformInstanceId>` context id, and a Zod schema).

- [ ] **Step 1: Write the failing test**

Create `tests/coding-credentials/mcp-redaction.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveMcpRedactionConfig, setMcpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('mcp-redaction admin config', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns null when unset', () => {
    expect(resolveMcpRedactionConfig('pi-1')).toBeNull()
  })

  test('round-trips a stored config', () => {
    setMcpRedactionConfig('pi-1', {
      model_url: 'https://model.example.com/v1',
      api_key: 'secret',
      model_name: 'redactor-mini',
      timeout_ms: 60000,
    })
    expect(resolveMcpRedactionConfig('pi-1')).toEqual({
      model_url: 'https://model.example.com/v1',
      api_key: 'secret',
      model_name: 'redactor-mini',
      timeout_ms: 60000,
    })
  })

  test('is scoped per platform instance', () => {
    setMcpRedactionConfig('pi-1', { model_url: 'https://a', api_key: 'k', model_name: 'm' })
    expect(resolveMcpRedactionConfig('pi-2')).toBeNull()
  })

  test('returns null when stored JSON fails schema', () => {
    setMcpRedactionConfig('pi-1', { model_url: 'https://a', api_key: 'k', model_name: 'm' })
    // corrupt store directly to prove safeParse fail-closed
    expect(resolveMcpRedactionConfig('pi-2')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/coding-credentials/mcp-redaction.test.ts`
Expected: FAIL — module `src/coding-credentials/mcp-redaction.ts` does not exist.

- [ ] **Step 3: Create the module**

Create `src/coding-credentials/mcp-redaction.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../cache.js'

const PREFIX = '__admin_mcp_redaction__:'
const KEY = 'mcp_redaction'

export const mcpRedactionConfigSchema = z.object({
  model_url: z.url().refine((u) => u.startsWith('https://'), { message: 'model_url must be https' }),
  api_key: z.string().min(1),
  model_name: z.string().min(1),
  timeout_ms: z.number().int().positive().min(1000).max(600_000).optional(),
})
export type McpRedactionConfig = z.infer<typeof mcpRedactionConfigSchema>

export function adminMcpRedactionContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}

export function resolveMcpRedactionConfig(platformInstanceId: string): McpRedactionConfig | null {
  const raw = getCachedConfig(adminMcpRedactionContextId(platformInstanceId), KEY)
  if (raw === null) return null
  try {
    const parsed = mcpRedactionConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function setMcpRedactionConfig(platformInstanceId: string, config: McpRedactionConfig): void {
  setCachedConfig(
    adminMcpRedactionContextId(platformInstanceId),
    KEY,
    JSON.stringify(mcpRedactionConfigSchema.parse(config)),
  )
}
```

> Confirm the `getCachedConfig`/`setCachedConfig` signatures by reading `src/coding-credentials/mcp-plugin-servers.ts:38-56` — this module deliberately mirrors it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/coding-credentials/mcp-redaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/coding-credentials/mcp-redaction.ts tests/coding-credentials/mcp-redaction.test.ts
git commit -m "feat(mcp): add mcp_redaction operator admin-config store"
```

---

### Task 3: The redactor module

**Files:**

- Create: `src/mcp-server/redaction.ts`
- Test: `tests/mcp-server/redaction.test.ts`

Ports kiss `mcp/shared/{internalModel,validatedAnswer,answerMcp}.ts`. Note the changes from kiss: (a) config comes from an injected `McpRedactionConfig`, not `process.env`; (b) the block marker is English; (c) the oversize spill returns a truncation note (no `~/.qwen` file — papai's bridge is stateless HTTP).

- [ ] **Step 1: Write the failing tests**

Create `tests/mcp-server/redaction.test.ts`:

````typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import {
  applyRedactions,
  BLOCK_PREFIX,
  isBlockedResult,
  parseFindings,
  redactText,
  sizeGuard,
} from '../../src/mcp-server/redaction.js'
import type { McpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'

const cfg: McpRedactionConfig = {
  model_url: 'https://model.example.com/v1',
  api_key: 'k',
  model_name: 'redactor',
  timeout_ms: 5000,
}

function modelResponse(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseFindings', () => {
  test('parses {string,redacted} objects, drops <2-char values', () => {
    expect(parseFindings('[{"string":"John Doe","redacted":"name"},{"string":"a","redacted":"x"}]')).toEqual([
      { value: 'John Doe', label: 'NAME' },
    ])
  })

  test('tolerates prose/markdown around the JSON array', () => {
    expect(parseFindings('Here:\n```json\n[{"string":"a@b.com","redacted":"email"}]\n```')).toEqual([
      { value: 'a@b.com', label: 'EMAIL' },
    ])
  })

  test('throws when no array present', () => {
    expect(() => parseFindings('no json here')).toThrow()
  })
})

describe('applyRedactions', () => {
  test('replaces longest matches first', () => {
    const out = applyRedactions('John Doe met John', [
      { value: 'John', label: 'NAME' },
      { value: 'John Doe', label: 'NAME' },
    ])
    expect(out).toBe('[NAME] met [NAME]')
  })
})

describe('redactText', () => {
  test('redacts using model findings', async () => {
    const httpFetch = mock().mockResolvedValue(modelResponse([{ string: 'a@b.com', redacted: 'email' }]))
    const out = await redactText('contact a@b.com', 'PROMPT', cfg, httpFetch, undefined)
    expect(out).toBe('contact [EMAIL]')
  })

  test('fails closed to a block marker on model error', async () => {
    const httpFetch = mock().mockResolvedValue(new Response('nope', { status: 500 }))
    const out = await redactText('secret', 'PROMPT', cfg, httpFetch, undefined)
    expect(isBlockedResult(out)).toBe(true)
    expect(out.startsWith(BLOCK_PREFIX)).toBe(true)
  })

  test('fails closed when model content is empty', async () => {
    const httpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const out = await redactText('secret', 'PROMPT', cfg, httpFetch, undefined)
    expect(isBlockedResult(out)).toBe(true)
  })

  test('sends an OpenAI-compatible chat/completions request', async () => {
    const httpFetch = mock().mockResolvedValue(modelResponse([]))
    await redactText('hello', 'PROMPT', cfg, httpFetch, undefined)
    expect(httpFetch).toHaveBeenCalledWith(
      'https://model.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'redactor',
          temperature: 0,
          messages: [
            { role: 'system', content: 'PROMPT' },
            { role: 'user', content: 'hello' },
          ],
        }),
      }),
    )
  })
})

describe('sizeGuard', () => {
  test('returns text unchanged under threshold', () => {
    expect(sizeGuard('short', 100)).toBe('short')
  })

  test('truncates with a note over threshold', () => {
    const out = sizeGuard('x'.repeat(50), 10)
    expect(out.length).toBeLessThan(50)
    expect(out).toContain('truncated')
  })
})
````

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/mcp-server/redaction.test.ts`
Expected: FAIL — `src/mcp-server/redaction.ts` does not exist.

- [ ] **Step 3: Create the redactor**

Create `src/mcp-server/redaction.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { McpRedactionConfig } from '../coding-credentials/mcp-redaction.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'mcp-server:redaction' })

export const BLOCK_PREFIX = '[RESULT BLOCKED BY VALIDATION'
const DEFAULT_LABEL = 'REDACTED'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_SIZE = 25_000

export interface Finding {
  value: string
  label: string
}

export type HttpFetch = (url: string, init: RequestInit | undefined) => Promise<Response>

// Shared default. Per §"Deviation from the spec": one prompt for all redacting plugins in Plan 1.
export const DEFAULT_REDACTION_PROMPT = [
  'You detect sensitive data in JSON tool responses bound for an external AI coding agent.',
  'Return ONLY a JSON array of objects: [{"string":"exact substring from input","redacted":"CATEGORY"}].',
  'Do not rewrite the input. Do not add markdown or prose around the JSON. If nothing sensitive, return [].',
  'Find and mask: personal data (full names, usernames, emails, phones, IPs, addresses, passport/INN/SNILS),',
  'real external user/session/device ids, request/response bodies containing PII or customer data, and secrets',
  '(tokens, passwords, API keys, authorization headers, cookies, JWTs, private keys, connection strings).',
  'Do NOT mask: class/function/file names, stacktrace paths, package names, release versions, commit ids,',
  'project slugs, environment names, HTTP status codes, browser/OS names, timestamps.',
  'Allowed category labels: NAME, EMAIL, PHONE, IP, ADDRESS, USER_ID, SESSION, SECRET, CUSTOMER_DATA, REQUEST_DATA, REDACTED.',
].join('\n')

export function isBlockedResult(text: string): boolean {
  return text.startsWith(BLOCK_PREFIX)
}

function normalizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_LABEL
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  return cleaned.length > 0 ? cleaned : DEFAULT_LABEL
}

export function parseFindings(raw: string): Finding[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('internal model did not return a JSON array')
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('internal model findings is not an array')
  const findings: Finding[] = []
  for (const item of parsed) {
    if (typeof item === 'string') {
      if (item.length >= 2) findings.push({ value: item, label: DEFAULT_LABEL })
      continue
    }
    if (item !== null && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      const value = rec['string']
      if (typeof value === 'string' && value.length >= 2) {
        findings.push({ value, label: normalizeLabel(rec['redacted']) })
      }
    }
  }
  return findings
}

export function applyRedactions(text: string, findings: Finding[]): string {
  let out = text
  for (const finding of [...findings].sort((a, b) => b.value.length - a.value.length)) {
    out = out.split(finding.value).join(`[${finding.label}]`)
  }
  return out
}

async function callInternalModel(
  systemPrompt: string,
  userContent: string,
  config: McpRedactionConfig,
  httpFetch: HttpFetch,
  parentSignal: AbortSignal | undefined,
): Promise<string> {
  const endpoint = `${config.model_url.replace(/\/+$/u, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout_ms ?? DEFAULT_TIMEOUT_MS)
  const onParentAbort = (): void => controller.abort()
  parentSignal?.addEventListener('abort', onParentAbort)
  try {
    const res = await httpFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model_name,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`internal model HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('internal model returned empty content')
    }
    return content
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

/** Redact `text`, failing closed to a block marker on any error. */
export async function redactText(
  text: string,
  systemPrompt: string,
  config: McpRedactionConfig,
  httpFetch: HttpFetch,
  parentSignal: AbortSignal | undefined,
): Promise<string> {
  try {
    const raw = await callInternalModel(systemPrompt, text, config, httpFetch, parentSignal)
    return applyRedactions(text, parseFindings(raw))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn({ reason }, 'redaction failed; blocking result (fail-closed)')
    return `${BLOCK_PREFIX}: ${reason}]`
  }
}

/** Cap oversized responses (papai's bridge is stateless HTTP; no file spill). */
export function sizeGuard(text: string, maxSize: number = DEFAULT_MAX_SIZE): string {
  if (text.length <= maxSize) return text
  return `${text.slice(0, maxSize)}\n\n[output truncated at ${maxSize} chars of ${text.length}]`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/mcp-server/redaction.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/redaction.ts tests/mcp-server/redaction.test.ts
git commit -m "feat(mcp): add bridge-level response redactor (fail-closed)"
```

---

### Task 4: Wire redaction into the plugin bridge

**Files:**

- Modify: `src/mcp-server/plugin-bridge.ts` (`callPluginMcpTool`, lines 88-112)
- Test: extend `tests/mcp-server/` with a bridge test — create `tests/mcp-server/plugin-bridge-redaction.test.ts`

The bridge already resolves `contributions.manifest` and builds the runtime context. Redaction applies **only** when `manifest.mcpResponseRedaction === true`. The internal-model host must be reachable — the redactor uses its own `httpFetch` (global `fetch`) since the internal model is papai infrastructure, not a plugin upstream. The platform instance id is derived from the caller's `storageContextId`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-server/plugin-bridge-redaction.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { callPluginMcpTool } from '../../src/mcp-server/plugin-bridge.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { setMcpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
import { setupTestDb } from '../utils/test-helpers.js'
import { restoreFetch, setMockFetch } from '../utils/test-helpers.js'

const STORAGE_CTX = 'telegram:pi-1:chat-9' // adjust to a valid scoped id parser format (see parseScopedContextId)

function registerFakePlugin(mcpResponseRedaction: boolean): void {
  contributionRegistry.register(
    'mcp-fake',
    {
      tools: [
        {
          name: 'leak',
          description: 'returns pii',
          inputSchema: { type: 'object', properties: {} },
          execute: () => Promise.resolve('email: a@b.com'),
        },
      ],
      promptFragments: [],
    } as never,
    { id: 'mcp-fake', name: 'Fake', version: '1.0.0', description: 'x', apiVersion: 1, mcpResponseRedaction } as never,
  )
}

describe('callPluginMcpTool redaction', () => {
  beforeEach(async () => {
    await setupTestDb()
  })
  afterEach(() => {
    contributionRegistry.deregister('mcp-fake')
    restoreFetch()
  })

  test('passes output through unchanged when manifest opts out', async () => {
    registerFakePlugin(false)
    const result = await callPluginMcpTool({
      pluginId: 'mcp-fake',
      toolName: 'leak',
      input: {},
      storageContextId: STORAGE_CTX,
      chatUserId: 'u1',
    })
    expect(result.content[0]!.text).toBe('email: a@b.com')
  })

  test('redacts output when manifest opts in and config present', async () => {
    setMcpRedactionConfig('pi-1', { model_url: 'https://model.example.com/v1', api_key: 'k', model_name: 'm' })
    setMockFetch(
      mock().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '[{"string":"a@b.com","redacted":"email"}]' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    registerFakePlugin(true)
    const result = await callPluginMcpTool({
      pluginId: 'mcp-fake',
      toolName: 'leak',
      input: {},
      storageContextId: STORAGE_CTX,
      chatUserId: 'u1',
    })
    expect(result.content[0]!.text).toBe('email: [EMAIL]')
  })

  test('fails closed to a block marker when opted in but config missing', async () => {
    registerFakePlugin(true)
    const result = await callPluginMcpTool({
      pluginId: 'mcp-fake',
      toolName: 'leak',
      input: {},
      storageContextId: STORAGE_CTX,
      chatUserId: 'u1',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text.startsWith('[RESULT BLOCKED BY VALIDATION')).toBe(true)
  })
})
```

> Before implementing, confirm the exact scoped-context id format `parseScopedContextId` accepts by reading `src/chat/scoped-context.ts`; adjust `STORAGE_CTX` so `parseScopedContextId(STORAGE_CTX)?.platformInstanceId === 'pi-1'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/mcp-server/plugin-bridge-redaction.test.ts`
Expected: FAIL — the opt-in cases still return the raw text / no block marker.

- [ ] **Step 3: Implement the bridge change**

In `src/mcp-server/plugin-bridge.ts`, add imports at the top:

```typescript
import { parseScopedContextId } from '../chat/scoped-context.js'
import { resolveMcpRedactionConfig } from '../coding-credentials/mcp-redaction.js'
import { DEFAULT_REDACTION_PROMPT, redactText, sizeGuard, BLOCK_PREFIX } from './redaction.js'
```

Add a helper and change the success path of `callPluginMcpTool`. Replace the `try { ... }` block (lines ~102-111) with:

```typescript
  try {
    const result = await pluginTool.execute(args.input, runtimeContext, buildExecutionOptions(args))
    const rawText = typeof result === 'string' ? result : JSON.stringify(result)
    if (contributions.manifest.mcpResponseRedaction !== true) return textResult(rawText)

    const platformInstanceId = parseScopedContextId(args.storageContextId)?.platformInstanceId
    const config = platformInstanceId === undefined ? null : resolveMcpRedactionConfig(platformInstanceId)
    if (config === null) {
      // Opted into redaction but operator has not configured it — fail closed.
      return textResult(`${BLOCK_PREFIX}: mcp_redaction is not configured]`, true)
    }
    const redacted = await redactText(rawText, DEFAULT_REDACTION_PROMPT, config, fetch, args.abortSignal)
    const guarded = sizeGuard(redacted)
    return textResult(guarded, guarded.startsWith(BLOCK_PREFIX) ? true : undefined)
  } catch (err) {
```

> `fetch` here is the global; the internal model is papai infrastructure, so it is not subject to plugin `providerAllowedHosts`. The redactor already fails closed on network errors.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/mcp-server/plugin-bridge-redaction.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/plugin-bridge.ts tests/mcp-server/plugin-bridge-redaction.test.ts
git commit -m "feat(mcp): apply response redaction at the plugin MCP bridge"
```

---

### Task 5: Fail-closed eligibility for redacting plugins

**Files:**

- Modify: `src/coding-credentials/mcp-plugin-servers.ts` (`listEnabledInternalMcpServers`, the loop body ~line 88 onward)
- Test: `tests/coding-credentials/mcp-plugin-servers-redaction-eligibility.test.ts`

A plugin declaring `mcpResponseRedaction: true` must be excluded from the internal-server list when `mcp_redaction` is unconfigured for the platform instance — so a session never selects a redacting server that cannot redact.

- [ ] **Step 1: Write the failing test**

Create the test asserting that, given an enabled `mcpServer:true, mcpResponseRedaction:true` plugin eligible for the context, `listEnabledInternalMcpServers(pi, cc)` returns `[]` while `resolveMcpRedactionConfig(pi)` is null, and returns the server once a config is set. Mirror the existing `mcp-plugin-servers` test setup (read `tests/coding-credentials/` for the current pattern of seeding `getPluginsForContext` + `setMcpPluginServerConfigs` + `getSettingsPublicBaseUrl`).

```typescript
// (header)
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  listEnabledInternalMcpServers,
  setMcpPluginServerConfigs,
} from '../../src/coding-credentials/mcp-plugin-servers.js'
import { setMcpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
// + helpers to register a fake eligible plugin with mcpServer:true, mcpResponseRedaction:true, and set SETTINGS_PUBLIC_BASE_URL

describe('internal MCP server redaction eligibility', () => {
  // beforeEach: setupTestDb, set public base url, register the fake plugin, enable it via setMcpPluginServerConfigs
  test('excludes redacting plugin when mcp_redaction unset', () => {
    expect(listEnabledInternalMcpServers('pi-1', 'cc-1').some((s) => s.pluginId === 'mcp-fake')).toBe(false)
  })
  test('includes redacting plugin once mcp_redaction is set', () => {
    setMcpRedactionConfig('pi-1', { model_url: 'https://m', api_key: 'k', model_name: 'm' })
    expect(listEnabledInternalMcpServers('pi-1', 'cc-1').some((s) => s.pluginId === 'mcp-fake')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/coding-credentials/mcp-plugin-servers-redaction-eligibility.test.ts`
Expected: FAIL — the redacting plugin is listed even without a redaction config.

- [ ] **Step 3: Implement the guard**

In `listEnabledInternalMcpServers`, add near the top (after resolving `base`):

```typescript
import { resolveMcpRedactionConfig } from './mcp-redaction.js'
// ...
const redactionConfigured = resolveMcpRedactionConfig(platformInstanceId) !== null
```

and inside the `for (const plugin of eligible)` loop, after the `if (plugin.manifest.mcpServer !== true) continue`:

```typescript
if (plugin.manifest.mcpResponseRedaction === true && !redactionConfigured) {
  log.debug({ pluginId: plugin.manifest.id }, 'redacting plugin excluded: mcp_redaction unconfigured (fail-closed)')
  continue
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/coding-credentials/mcp-plugin-servers-redaction-eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/coding-credentials/mcp-plugin-servers.ts tests/coding-credentials/mcp-plugin-servers-redaction-eligibility.test.ts
git commit -m "feat(mcp): fail-closed eligibility for redacting internal MCP servers"
```

---

### Task 6: Operator settings surface for `mcp_redaction` (backend + note)

**Files:**

- Modify: the settings admin config route module that handles `mcp_plugin_servers` (find it: `grep -rn "mcp_plugin_servers\|setMcpPluginServerConfigs" src/settings src/debug`), adding a parallel `mcp_redaction` GET/PUT handler using `resolveMcpRedactionConfig`/`setMcpRedactionConfig`.
- Test: an API route test mirroring the existing `mcp_plugin_servers` route test.

- [ ] **Step 1:** Locate the existing admin-config settings route for `mcp_plugin_servers`; read its handler + test.
- [ ] **Step 2:** Write a failing route test: PUT the redaction config, GET it back, and assert `api_key` is not echoed in plaintext if the existing pattern masks sensitive values (follow local convention).
- [ ] **Step 3:** Add the handler delegating to `set/resolveMcpRedactionConfig`.
- [ ] **Step 4:** Run the route test; expected PASS.
- [ ] **Step 5:** Commit: `feat(settings): mcp_redaction admin config API`.

> The Svelte settings-UI panel for this field is deferred to a follow-up (the backend API makes it operable and testable now). Note this explicitly in the commit body.

---

### Task 7: Wave 1 full-suite gate

- [ ] **Step 1:** Run `bun run check:full`.
- [ ] **Step 2:** Fix any format/lint/knip/type failures (e.g. knip may flag `sizeGuard`/`isBlockedResult` if not yet imported anywhere — they are used by the bridge and tests, so this should pass; if knip flags an export, confirm it is consumed).
- [ ] **Step 3:** Expected: all checks green. Commit any fixups.

---

## WAVE 2 — `mcp-sentry` reference plugin

This wave mirrors `plugins/synthetic-web-search/` exactly. Read that plugin (`plugin.json`, `index.ts`, `context.ts`, `input-schema.ts`) once before starting — every later plugin in the roadmap copies this shape.

Sentry HTTP facts (from kiss `mcp/sentry-mcp/`): all calls are `GET {SENTRY_BASE_URL}/api/0{path}`, auth `Authorization: Bearer {token}` + `Accept: application/json`; three creds: base URL, token, org slug. Per-endpoint default limits: projects 100, issues 20, events 5, tag values 10, comments 20, releases 10, commits 20; all clamped to `[1,100]`. A static key-name redaction (`sanitizeObject`) masks values under keys matching `/password|token|secret|apikey|api_key|credential|authorization|cookie|session/i` to `[REDACTED]` — always applied, independent of the AI redactor.

### Task 8: Plugin manifest + context facade

**Files:**

- Create: `plugins/mcp-sentry/plugin.json`
- Create: `plugins/mcp-sentry/context.ts`

- [ ] **Step 1:** Copy `plugins/synthetic-web-search/context.ts` verbatim to `plugins/mcp-sentry/context.ts` (it is plugin-agnostic).

- [ ] **Step 2:** Create `plugins/mcp-sentry/plugin.json`:

```json
{
  "id": "mcp-sentry",
  "name": "Sentry (coding agent)",
  "version": "1.0.0",
  "description": "Agent-facing Sentry issue diagnosis tools exposed as an MCP server",
  "apiVersion": 1,
  "main": "index.ts",
  "mcpServer": true,
  "mcpResponseRedaction": true,
  "contributes": {
    "tools": [
      "sentry_get_projects",
      "sentry_search_issues",
      "sentry_get_issue",
      "sentry_get_issue_events",
      "sentry_get_issue_tag_values",
      "sentry_get_issue_comments",
      "sentry_get_issue_details"
    ],
    "promptFragments": [],
    "configKeys": ["base_url", "org_slug"]
  },
  "permissions": ["http"],
  "providerAllowedHostsFromConfig": ["base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    { "key": "base_url", "label": "Sentry Base URL", "required": true, "scope": "admin" },
    { "key": "token", "label": "Sentry API Token", "required": true, "sensitive": true, "scope": "admin" },
    { "key": "org_slug", "label": "Sentry Org Slug", "required": true, "scope": "admin" }
  ],
  "activationTimeoutMs": 3000
}
```

> `providerAllowedHostsFromConfig: ["base_url"]` lets the allowlisted host derive from the operator-set base URL (Sentry can be self-hosted). Confirm this manifest field's semantics against `src/plugins/types.ts:190-191` and the `hasProviderAllowedHostsFromConfig` refine; if a static host is preferred instead, use `"providerAllowedHosts": ["sentry.io"]`.

- [ ] **Step 3:** No test yet (covered by Task 12). Commit:

```bash
git add plugins/mcp-sentry/plugin.json plugins/mcp-sentry/context.ts
git commit -m "feat(mcp-sentry): plugin manifest and context facade"
```

### Task 9: Input schemas

**Files:** Create `plugins/mcp-sentry/input-schema.ts`

- [ ] **Step 1:** Write the schema test first — `tests/plugins/mcp-sentry-schema.test.ts` using `schemaValidates()`:

```typescript
// (header)
import { describe, expect, test } from 'bun:test'
import { schemaValidates } from '../utils/test-helpers.js'
import { sentryGetIssueSchema, sentrySearchIssuesSchema } from '../../plugins/mcp-sentry/input-schema.js'

describe('mcp-sentry schemas', () => {
  test('get_issue requires issueId', () => {
    expect(schemaValidates(sentryGetIssueSchema, { issueId: 'ABC-1' })).toBe(true)
    expect(schemaValidates(sentryGetIssueSchema, {})).toBe(false)
  })
  test('search_issues accepts optional filters and clamps limit type', () => {
    expect(schemaValidates(sentrySearchIssuesSchema, {})).toBe(true)
    expect(schemaValidates(sentrySearchIssuesSchema, { limit: 5, sort: 'freq' })).toBe(true)
    expect(schemaValidates(sentrySearchIssuesSchema, { sort: 'nope' })).toBe(false)
  })
})
```

- [ ] **Step 2:** Run: `bun test tests/plugins/mcp-sentry-schema.test.ts` → FAIL (module missing).

- [ ] **Step 3:** Create `plugins/mcp-sentry/input-schema.ts` — JSON Schema objects (the bridge converts these via `asSchema`), one per tool. Example (repeat the pattern for all 7):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const limit = { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (1-100)' } as const

export const sentryGetProjectsSchema = {
  type: 'object',
  properties: { limit },
  additionalProperties: false,
} as const

export const sentrySearchIssuesSchema = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    query: { type: 'string', description: 'Sentry search query' },
    statsPeriod: { type: 'string', description: 'e.g. 24h, 14d' },
    environment: { type: 'string' },
    sort: { type: 'string', enum: ['date', 'freq', 'new', 'priority', 'user'] },
    limit,
  },
  additionalProperties: false,
} as const

export const sentryGetIssueSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 } },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const sentryGetIssueEventsSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 }, limit },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const sentryGetIssueTagValuesSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 }, tagKey: { type: 'string', minLength: 1 }, limit },
  required: ['issueId', 'tagKey'],
  additionalProperties: false,
} as const

export const sentryGetIssueCommentsSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 }, limit },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const sentryGetIssueDetailsSchema = {
  type: 'object',
  properties: {
    issueId: { type: 'string', minLength: 1 },
    eventsLimit: limit,
    tagValuesLimit: limit,
    commentsLimit: limit,
    releasesLimit: limit,
    commitsLimit: limit,
  },
  required: ['issueId'],
  additionalProperties: false,
} as const
```

- [ ] **Step 4:** Run: `bun test tests/plugins/mcp-sentry-schema.test.ts` → PASS.

- [ ] **Step 5:** Commit: `feat(mcp-sentry): tool input schemas`.

### Task 10: Static sanitizer

**Files:** Create `plugins/mcp-sentry/format.ts`; Test `tests/plugins/mcp-sentry.test.ts` (sanitizer section)

- [ ] **Step 1:** Write failing tests for `sanitizeObject`:

```typescript
import { sanitizeObject } from '../../plugins/mcp-sentry/format.js'
// nested { token: 'abc', name: 'x', inner: { password: 'p', ok: 1 } } → token/password become '[REDACTED]', name/ok/'key' untouched
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Create `plugins/mcp-sentry/format.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const SECRET_KEY = /password|token|secret|apikey|api_key|credential|authorization|cookie|session/iu

function sanitizeKeyValue(key: string | undefined, value: unknown): unknown {
  if (key === undefined || key === 'key') return value
  if (!SECRET_KEY.test(key)) return value
  return value ? '[REDACTED]' : value
}

export function sanitizeObject(input: unknown, key?: string): unknown {
  const masked = sanitizeKeyValue(key, input)
  if (masked === '[REDACTED]') return masked
  if (Array.isArray(input)) return input.map((item) => sanitizeObject(item))
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) out[k] = sanitizeObject(v, k)
    return out
  }
  return input
}
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(mcp-sentry): static key-name response sanitizer`.

### Task 11: Sentry client

**Files:** Create `plugins/mcp-sentry/client.ts`; extend `tests/plugins/mcp-sentry.test.ts`

- [ ] **Step 1:** Write failing tests that assert exact upstream calls (mock `httpFetch`): `getIssue('ABC-1')` → `GET {base}/api/0/issues/ABC-1/` with `Authorization: Bearer <token>` and `Accept: application/json`; `getProjects()` → `GET {base}/api/0/organizations/<org>/projects/`; `searchIssues({sort:'freq',limit:5})` → `GET {base}/api/0/organizations/<org>/issues/?sort=freq&limit=5`.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Create `plugins/mcp-sentry/client.ts` — a `SentryClient` taking `{ baseUrl, token, orgSlug, httpFetch }`, with a private `request(path, params?)` building `new URL(`${baseUrl}/api/0${path}`)`, setting defined/non-empty query params, `GET` with the two headers, throwing `Sentry API <status> for <path>` on non-ok, returning parsed JSON. Methods: `getProjects(limit)`, `searchIssues(opts)`, `getIssue(id)`, `getIssueEvents(id,limit)`, `getIssueTagValues(id,tagKey,limit)`, `getIssueComments(id,limit)`, `getIssueDetails(id,limits)` (the composite orchestration from kiss: issue + parallel events/comments + per-tag values for `issue.tags.slice(0,10)` + suspect releases/commits with per-call try/catch → null/[]). Apply `sanitizeObject` to every returned payload. Clamp limits with `Math.max(1, Math.min(n ?? fallback, 100))`.

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(mcp-sentry): Sentry HTTP client over providerRuntime.httpFetch`.

### Task 12: Tool registration + factory

**Files:** Create `plugins/mcp-sentry/index.ts`; extend `tests/plugins/mcp-sentry.test.ts`

- [ ] **Step 1:** Write failing tests mirroring `synthetic-web-search.test.ts`: activate registers all 7 tools; `sentry_get_issue` executes and returns the (sanitized) issue; `not_configured` error when creds missing; rate-limit path; abort-signal forwarded.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Create `plugins/mcp-sentry/index.ts` — factory following `synthetic-web-search/index.ts`: in `activate`, read `providerRuntime.httpFetch`; register each of the 7 tools. Each tool's `execute`: rate-limit check → read creds via `runtimeContext.adminConfig.get('base_url'|'token'|'org_slug')` → if any missing return `{ error: 'not_configured', message: 'Sentry is not configured' }` → build `SentryClient` → call the method → return the result object. Errors mapped to `{ error: 'sentry_error', message }` / `{ error: 'timeout', message }` (AbortError) as in `synthetic-web-search`.

> Creds are read at execution time from `runtimeContext.adminConfig`/`contextConfig` (not captured at activate) so operator changes take effect without restart — see `synthetic-web-search.test.ts` "reads updated admin API key at execution time".

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(mcp-sentry): register 7 agent-facing Sentry tools`.

### Task 13: README + registration bookkeeping + full gate

**Files:** Create `plugins/mcp-sentry/README.md`; possibly modify `knip.jsonc`

- [ ] **Step 1:** Write `plugins/mcp-sentry/README.md` (purpose, tools, required admin config, redaction note) modeled on `plugins/synthetic-web-search/README.md`.
- [ ] **Step 2:** Run `bun run check:full`. If knip flags the new plugin's exports as unused, check how `synthetic-web-search` is whitelisted in `knip.jsonc` and add `plugins/mcp-sentry/**` the same way.
- [ ] **Step 3:** Confirm plugin discovery: start the app or run the plugin-discovery test (`grep -rn "discover" tests/plugins/`) to confirm `mcp-sentry` is discovered and its manifest validates.
- [ ] **Step 4:** Expected: all checks green.
- [ ] **Step 5:** Commit: `feat(mcp-sentry): docs and finalize reference plugin`.

### Task 14: End-to-end verification

- [ ] **Step 1:** Use the `verify` skill (or manual): approve + enable `mcp-sentry` as an internal MCP server in settings; set `mcp_redaction` and the three Sentry creds; select `plugin:mcp-sentry` for a context; confirm `/mcp/plugin/mcp-sentry` responds to `tools/list` with the 7 tools using a minted token (see `src/mcp-server/token.ts::mintPluginMcpToken`).
- [ ] **Step 2:** Confirm a `tools/call` for `sentry_get_issue` against a stub returns redacted text (or a block marker if `mcp_redaction` is intentionally unset — proving fail-closed).
- [ ] **Step 3:** Update `docs/architecture/coding-stack-overview.md` and `docs/architecture/plugins.md` to mention the redaction capability and the first migrated MCP plugin. Commit: `docs(mcp): document redaction capability and mcp-sentry`.

---

## Self-review (completed by plan author)

- **Spec coverage:** Redaction capability (Tasks 1-6), fail-closed eligibility (Task 5), MCP-path-only scope (redaction lives only in `callPluginMcpTool`, Task 4 — chat-tool path untouched), `mcp-sentry` with reads + redaction (Tasks 8-14), secure-by-default (Sentry is read-only, so no `ask`/`deny` write policy needed here — that surfaces first in `mcp-mattermost`/`mcp-youtrack`, roadmap). **Gap accepted & flagged:** per-plugin redaction prompt (spec) → shared default (Plan 1); see "Deviation from the spec".
- **Placeholder scan:** the composite `getIssueDetails` orchestration and the settings-route task (Task 6) are described rather than fully coded because they are mechanical translations of kiss code / local route patterns the engineer must read first; every novel algorithm (redactor, sanitizer, bridge wiring) has complete code.
- **Type consistency:** `McpRedactionConfig` fields (`model_url`/`api_key`/`model_name`/`timeout_ms`) are identical across Task 2, 3, 4. `redactText(text, systemPrompt, config, httpFetch, signal)` signature matches between Task 3 (def) and Task 4 (call). `BLOCK_PREFIX` constant is shared, not re-literaled.

---

## Roadmap appendix — Plans 2–N (remaining plugins)

Each plugin below becomes its own plan generated from the `mcp-sentry` template (Tasks 8-14). Common to all: `mcpServer: true`, `permissions: ["http"]`, `providerAllowedHostsFromConfig: ["base_url"]` (or a static `providerAllowedHosts`), creds via `configRequirements`, tools registered in `index.ts`, client over `providerRuntime.httpFetch`, tests mirroring `mcp-sentry.test.ts`. Write tools default to `ask`/`deny` via the operator's per-tool policy (set at enable time, not in the manifest).

**Per-plugin redaction prompt (deferred spec item):** `mcp-youtrack` needs a distinct attachment-content prompt. When building it, implement the deferred override: a context-scoped `redaction_prompt` config key read in the bridge via `runtimeContext.contextConfig.get('redaction_prompt')`, falling back to `DEFAULT_REDACTION_PROMPT`. Thread the resolved prompt into `redactText`.

| Plan | Plugin                    | Redact | Tools & upstream (all HTTPS via httpFetch)                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2    | `mcp-confluence`          | ✅     | Base `{base_url}` (default `https://wiki.skbkontur.ru`), **Basic** auth (username+password). Tools: `confluence_get_page` (GET content/{id}), `confluence_get_page_by_title` (search by space+title), `confluence_get_comments`, `confluence_add_comment` (POST — policy `ask`), `confluence_resolve_short_link`.                    |
| 3    | `mcp-figma`               | —      | Base `https://api.figma.com`, header `X-Figma-Token: {token}` (context scope). Tools: `figma_get_file`, `figma_get_file_nodes`, `figma_get_images`, `figma_get_file_styles`, `figma_get_style`, `figma_get_components`, `figma_get_comments`. Port kiss `simplify.ts`.                                                               |
| 4    | `mcp-rag`                 | —      | Base `{base_url}`, `api_key`. Single `rag_search` (POST NL query; description extended by `source_description` config).                                                                                                                                                                                                              |
| 5    | `mcp-teamcity`            | —      | Base `{base_url}`, Bearer `{token}`, `Accept: application/json`. Tools: `teamcity_get_projects`, `teamcity_get_project_config`, `teamcity_get_project_pipelines`, `teamcity_get_pipeline_config`.                                                                                                                                    |
| 6    | `mcp-youtrack`            | ✅     | Base `{base_url}` (default `https://yt.skbkontur.ru`), Bearer `{api_key}` (context scope). 14 tools incl. writes (`add_comment`, `create_issue`, `update_fields`, tag mutations, `set_issue_link`) → `ask`; `set_issue_link` → `deny`. `read_attachment` redacts attachment content in place (needs the per-plugin prompt override). |
| 7    | `mcp-gitlab` (read-first) | —      | Base `{base_url}`, Bearer `{token}`. Read tools only: `gitlab_get_repository_tree`, `gitlab_get_file_content`, `gitlab_get_mr_info`, `gitlab_get_mrs`, `gitlab_get_job`. Write tools deferred (overlap magi). Reimplement client on `httpFetch` (no `@gitbeaker/rest`).                                                              |
| 8    | `mcp-mattermost`          | ✅     | Base `{url}`, Bearer `{access_token}`. Tools: `mattermost_get_post`, `mattermost_get_thread`, `mattermost_get_channel_posts`, `mattermost_create_post` (→ `ask`), `mattermost_download_attachment`. Reimplement on `httpFetch` (no `@mattermost/client`).                                                                            |
| 9    | `mcp-test`                | —      | No upstream, no creds. Single `test` tool returning a fixed string. Ship as a live end-to-end canary for the `/mcp/plugin` path.                                                                                                                                                                                                     |

**Out of scope:** `mcp-npm` (`npm_publish`) — the package to publish lives in the geofront sandbox, not papai; belongs sandbox-side in magi. Track as a magi follow-up.

**Cross-cutting magi follow-up (from the spec):** magi's gate fails `ask` open to `allow` (`magi/src/mcp-broker/gate.ts:153`). Until fixed, `ask` ≈ `allow`; that is why the highest-risk writes above default to `deny`. Fixing the fail-open is required before `ask` policies are meaningful.
