<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Synthetic Web Search Plugin Design

**Date:** 2026-05-27
**Status:** Draft
**Approach:** Focused core extensions + plugin (Approach A)

## Overview

Add web search capability to papai via a `synthetic-web-search` plugin that calls the Synthetic Search API (`https://api.synthetic.new/v2/search`). This requires three targeted extensions to the core plugin system: a new `http` permission, admin-scoped plugin config, and rate limiter exposure to plugin tools.

## Motivation

The bot currently has `web_fetch` (fetches a known URL) but no web search capability. The LLM cannot discover URLs on its own — it can only retrieve content from URLs the user provides. A web search tool closes this gap: the LLM can search for up-to-date information and then optionally deep-read results via `web_fetch`.

The Synthetic Search API is a zero-data-retention search API designed for coding agents. It has a simple POST interface returning `{ results: [{ url, title, text, published? }] }`.

## Design Decisions

| Decision                   | Choice                                             | Rationale                                       |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| API key management         | Admin-owned global config                          | Centralized billing, no per-user setup burden   |
| Config storage             | `system_config` with `plg:<pluginId>:<key>` prefix | Plugin-scoped isolation, reuses existing table  |
| Config UI                  | Extend `/admin` UI                                 | Consistent with LLM credentials management      |
| HTTP permission            | New `http` permission                              | Clean separation from `provider.task` semantics |
| Search + fetch integration | Independent tools                                  | LLM decides when to deep-read; simpler, faster  |
| Rate limiting              | Match `web_fetch` (20 req / 5 min per actor)       | Cost guardrails for usage-based billing         |

## Core Plugin System Extensions

### 1. New `http` Permission

Add `'http'` to `PLUGIN_PERMISSIONS` in `src/plugins/types.ts`. Plugins declaring this permission receive `ctx.providerRuntime` (with `httpFetch` and `allowedHosts`) during activation, without the `provider.task` task-provider semantics.

**Files changed:**

- `src/plugins/types.ts` — add `'http'` to `PLUGIN_PERMISSIONS` tuple
- `src/plugins/context.ts` — build `providerRuntime` when either `'provider.task'` or `'http'` permission is held

The existing manifest refine check (`taskProviderTypes requires provider.task`) stays unchanged. The `http` permission is independent — it grants HTTP access without task provider registration capability.

### 2. Admin-Scoped Plugin Config

Extend `configRequirements` in the plugin manifest schema with an optional `scope` field: `'context'` (default) or `'admin'`.

**Storage:** Admin-scoped values are stored in the `system_config` table with key `plg:<pluginId>:<configKey>`. Context-scoped values continue using `user_config` as today.

**Plugin access:** Add `adminConfig` to `PluginContext`:

```typescript
readonly adminConfig: {
  get(key: string): string | undefined
}
```

Only keys declared in the manifest's `configRequirements` with `scope: 'admin'` are readable. The plugin cannot read arbitrary `system_config` values.

**Eligibility:** Admin-scoped `required: true` keys make the plugin ineligible for all contexts if the key is missing (since the config is global, not per-context).

**Files changed:**

- `src/plugins/types.ts` — add `scope` field to `pluginConfigRequirementSchema` (optional, default `'context'`)
- `src/plugins/store.ts` — add `getPluginAdminConfig(pluginId, key)` and `setPluginAdminConfig(pluginId, key, value)` reading/writing `system_config`
- `src/plugins/context.ts` — build `adminConfig` facade filtered to declared admin-scoped keys
- `src/plugins/registry-context-eligibility.ts` — check admin-scoped required keys globally (not per-context)

### 3. Rate Limiter Exposure to Plugin Tools

Add `rateLimit` to `PluginToolRuntimeContext`:

```typescript
rateLimit: {
  check(actorId: string): { allowed: boolean; retryAfterSec?: number }
}
```

Reuses the existing SQLite sliding-window rate limiter from `src/web/rate-limit.ts` (20 requests per 5-minute window per actor).

**Files changed:**

- `src/plugins/types.ts` — add `rateLimit` to `PluginToolRuntimeContext`
- `src/plugins/tool-runtime.ts` — build `rateLimit` from existing `checkRateLimit()`
- `src/tools/index.ts` — pass rate limiter dependency when building plugin tool runtime

## Admin UI Changes

### Plugin Config Section in `/admin`

Add a new section to the existing `/admin` debug server UI for managing admin-scoped plugin config.

**Server-side** (`src/debug/admin-plugin-config.ts`, following the pattern of `admin-llm.ts`):

- `GET /admin/plugin-config` — reads discovered plugins from registry, filters to those with admin-scoped `configRequirements`, reads current values from `system_config`, masks sensitive values
- `POST /admin/plugin-config` — validates keys against manifest declarations, writes to `system_config` via `setSystemConfig()`
- Bearer token gated when `DEBUG_TOKEN` is set; POST returns 401 when `DEBUG_TOKEN` is unset (same pattern as `/admin/llm`)

**Client-side** (`client/admin/`):

- New section with a form component following the existing LLM credentials form pattern
- Sensitive fields use password-type inputs, show masked values
- One field per admin-scoped config key across all discovered plugins

## Plugin Design: `synthetic-web-search`

### Manifest (`plugins/synthetic-web-search/plugin.json`)

```json
{
  "id": "synthetic-web-search",
  "name": "Synthetic Web Search",
  "version": "1.0.0",
  "description": "Web search via Synthetic Search API",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": ["search"],
    "promptFragments": ["web-search-hint"]
  },
  "permissions": ["http"],
  "providerAllowedHosts": ["api.synthetic.new"],
  "defaultEnabled": false,
  "configRequirements": [
    {
      "key": "api_key",
      "label": "Synthetic API Key",
      "required": true,
      "sensitive": true,
      "scope": "admin"
    }
  ],
  "activationTimeoutMs": 3000
}
```

### Entry Point (`plugins/synthetic-web-search/index.ts`)

**Activation:**

- Reads `ctx.adminConfig.get('api_key')` and captures in closure
- Captures `ctx.providerRuntime.httpFetch` in closure
- Registers `search` tool and `web-search-hint` prompt fragment

**Tool: `search`**

Input schema:

```typescript
z.object({
  query: z.string().max(400),
  max_length: z.number().int().min(0).max(10000).optional().default(0),
  index: z.number().int().min(0).optional(),
})
```

Execution flow:

1. Call `runtimeContext.rateLimit.check(runtimeContext.storageContextId)` — return structured failure if denied
2. POST to `https://api.synthetic.new/v2/search` with `{ query }` and `Authorization: Bearer <api_key>` via captured `httpFetch`
3. Parse response, validate with Zod schema
4. Apply `index` filter (return single result at 0-based index) and `max_length` truncation (distribute characters evenly across selected results)
5. Return `{ results: [{ title, url, text, published? }] }`

**Prompt fragment: `web-search-hint`**

Instructs the LLM to use the search tool when the user asks a question requiring up-to-date information not in training data, and to use `web_fetch` for deeper reading of promising results.

### Tool Naming

Exposed to LLM as `plugin_synthetic_web_search__search`.

### Error Handling

| Error               | Result                                                             |
| ------------------- | ------------------------------------------------------------------ |
| Missing API key     | Plugin ineligible for all contexts (required admin config missing) |
| Rate limited        | `{ error: 'rate_limited', retryAfterSec: N }`                      |
| API error (non-200) | `{ error: 'api_error', status: N, message: '...' }`                |
| Timeout             | `{ error: 'timeout', message: '...' }`                             |
| Network error       | `{ error: 'network_error', message: '...' }`                       |

All errors flow through the existing `wrapToolExecution` error-to-structured-result pipeline.

## Data Flow

```
User: "What's the latest on Bun 2.0?"
  -> ChatRouter -> bot.ts -> llm-orchestrator.ts
  -> LLM sees system prompt with web-search-hint fragment
  -> LLM calls plugin_synthetic_web_search__search({ query: "Bun 2.0 release" })
  -> makeTools() -> buildPluginToolSet() -> wrapped execute:
    1. rateLimit.check(storageContextId) -> allowed
    2. httpFetch POST https://api.synthetic.new/v2/search
    3. Parse response -> return { results: [...] }
  -> LLM receives results, may call web_fetch on a URL for deeper reading
  -> LLM composes reply to user
```

## Testing Strategy

### Core changes (unit tests)

- `http` permission: plugin context builder creates `providerRuntime` when `http` is declared
- Admin-scoped config: `getPluginAdminConfig()` reads from `system_config`, facade filters to declared keys, ineligible when required key missing
- Rate limiter on `PluginToolRuntimeContext`: check/deny behavior
- Admin routes: GET/POST `/admin/plugin-config` auth gating, validation, masking

### Plugin (unit tests)

- Tool execution: mock `httpFetch`, verify correct API call shape, response parsing
- Rate limiting: verify rate-limited calls return structured failure
- Error paths: API errors, timeouts, empty results
- Input validation: query max 400 chars, index out of range, max_length distribution

### Integration

- Plugin discovery -> approval -> activation flow with the new manifest
- Admin config set via POST -> plugin reads value on next tool execution

## Scope Summary

| Area                                          | Changes                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/plugins/types.ts`                        | Add `'http'` permission, `scope` on configRequirements, `rateLimit` on runtime context |
| `src/plugins/context.ts`                      | Build `providerRuntime` for `http` permission, build `adminConfig` facade              |
| `src/plugins/store.ts`                        | `getPluginAdminConfig()`, `setPluginAdminConfig()`                                     |
| `src/plugins/tool-runtime.ts`                 | Build `rateLimit` helper                                                               |
| `src/plugins/registry-context-eligibility.ts` | Check admin-scoped required keys                                                       |
| `src/tools/index.ts`                          | Pass rate limiter to plugin runtime                                                    |
| `src/debug/admin-plugin-config.ts`            | New: GET/POST routes                                                                   |
| `client/admin/`                               | New: plugin config form section                                                        |
| `plugins/synthetic-web-search/`               | New: plugin manifest + entry point                                                     |
| `tests/`                                      | Unit tests for all core changes + plugin                                               |

## Out of Scope

- Search result caching (can be added later if needed)
- Auto-fetching search result URLs (LLM independently calls `web_fetch`)
- Per-user API key override (admin-owned global only)
- Search result re-ranking or filtering beyond what the API returns
- Plugin config admin command (`/plugin config <id> <key> <value>`) — UI only for now
