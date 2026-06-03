<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0160: Synthetic Web Search Plugin

## Status

Implemented

## Date

2026-05-27 – 2026-06-02

## Context

papai has `web_fetch` for retrieving known URLs, but no web search capability. The LLM cannot discover URLs on its own — it can only read content from URLs the user supplies. A web search tool closes this gap: the LLM searches for current information and optionally deep-reads promising results via `web_fetch`.

The Synthetic Search API (`https://api.synthetic.new/v2/search`) is a zero-data-retention search API designed for coding agents. It accepts a POST with a query and returns structured results `{ url, title, text, published? }`.

Making this a plugin rather than core functionality requires three targeted extensions to the existing plugin system (ADR-0123): an `http` permission for outbound HTTP, admin-scoped config for centrally-managed API keys, and rate limiter exposure so plugins can enforce usage guardrails.

## Decision Drivers

- **Plugin-first**: New capabilities that don't need raw provider/DB access should be plugins, not core code.
- **Centralized credential management**: The Synthetic API key is a single admin-owned secret with usage-based billing — per-user keys would burden every user and complicate billing.
- **Controlled HTTP access**: Plugins must not make arbitrary network requests; outbound HTTP must be permission-gated and host-restricted.
- **Cost guardrails**: Usage-based APIs need rate limiting identical to `web_fetch` (20 req / 5 min per actor) to prevent runaway costs.
- **Minimal core changes**: Extend the plugin system only where necessary; don't refactor existing plugin internals.

## Considered Options

### Option A: Core `web_search` tool in `src/tools/`

Add a built-in search tool alongside `web_fetch`, with the API key stored in `system_config` like LLM credentials.

- **Pros**: No plugin system changes needed; simpler initial implementation.
- **Cons**: Expands core surface; every new search provider would be another core tool; violates the plugin-first direction established in ADR-0123.

### Option B: Plugin with `http` permission and admin-scoped config (chosen)

Implement search as a `synthetic-web-search` plugin using new `http` permission, admin-scoped config in `system_config`, and rate limiter exposure on `PluginToolRuntimeContext`.

- **Pros**: Validates the plugin system for real outbound-HTTP use; admin-scoped config solves centralized API key management; rate limiting reuses existing infrastructure; keeps core clean.
- **Cons**: Requires three core plugin system extensions before the plugin can function; admin-scoped config is a new concept beyond existing per-context `user_config` storage.

### Option C: Plugin with `provider.task` permission and per-context API keys

Reuse the existing `provider.task` permission for HTTP access; store API keys per-context in `user_config`.

- **Pros**: No new permission or config scope needed.
- **Cons**: `provider.task` carries task-provider semantics that don't apply to pure HTTP; per-context keys duplicate a shared secret across every user context; billing is not per-user.

### Option D: Proxy all plugin HTTP through a core web-fetch helper

Instead of a new `http` permission, plugins call an existing `webFetch` utility from `src/web/`.

- **Pros**: Reuses existing fetch infrastructure and rate limiting without API surface changes.
- **Cons**: Plugins would need access to a core module not on the `PluginContext` facade; breaks the narrow-API principle; no host restriction enforcement at the plugin boundary.

## Decision

**Option B** — implement as a plugin with three targeted core extensions:

| Topic               | Decision                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http` permission   | Add `'http'` to `PLUGIN_PERMISSIONS`. Plugins declaring `http` receive `providerRuntime` (with `httpFetch` and `allowedHosts`) without `provider.task` semantics.                                                                                          |
| Admin-scoped config | Extend `configRequirements` with optional `scope: 'context' \| 'admin'` (default `'context'`). Admin-scoped values stored in `system_config` as `plg:<pluginId>:<key>`. Plugin reads via `ctx.adminConfig.get(key)`, filtered to declared admin keys only. |
| Admin config UI     | New `Plugin Config` section in `/admin` with inline-edit form. GET/POST `/admin/plugin-config` routes, sensitive values masked, bearer-token gated.                                                                                                        |
| Rate limiter        | Add `rateLimit.check(actorId)` to `PluginToolRuntimeContext`, reusing the existing SQLite sliding-window limiter (20 req / 5 min per actor).                                                                                                               |
| Eligibility         | Admin-scoped `required: true` keys make the plugin ineligible for **all** contexts if the value is missing (global config, not per-context).                                                                                                               |
| Plugin manifest     | `permissions: ["http"]`, `providerAllowedHosts: ["api.synthetic.new"]`, `configRequirements` with `scope: "admin"`, `defaultEnabled: false`.                                                                                                               |
| Tool contract       | `plugin_synthetic_web_search__search` with `{ query, max_length?, index? }`. Returns `{ results }` or structured errors (`rate_limited`, `api_error`, `timeout`, `network_error`).                                                                         |
| Prompt fragment     | `web-search-hint` instructs the LLM to search for current information and follow up with `web_fetch` for deeper reading.                                                                                                                                   |

## Consequences

### Positive

- Validates the plugin system for real outbound-HTTP use with host restrictions.
- Centralized API key management removes per-user setup burden and aligns with LLM credentials pattern.
- Rate limiting reuses proven `web_fetch` infrastructure; no new limiter code.
- Plugin-first approach keeps `src/tools/` and `src/system-prompt.ts` clean.
- Admin-scoped config is reusable by future plugins that need operator-owned secrets (e.g., analytics APIs, notification services).

### Negative

- Three core plugin system changes (`http` permission, admin-scoped config, rate limiter exposure) are prerequisites — they must land before the plugin functions.
- Admin-scoped config makes a plugin globally ineligible when a required key is missing, unlike context-scoped config which only blocks the affected context.
- The `http` permission grants `providerRuntime` which also exposes the task provider facade path; the implementation must ensure `http` alone does not imply task-provider capabilities.
- No search result caching; repeated identical queries consume API quota.

### Risks

- The `http` permission allows any approved plugin to make outbound HTTP to declared allowed hosts. A compromised or buggy plugin could leak data via outbound requests. Mitigation: host allowlist is enforced at the `providerRuntime` level; only manifest-declared hosts are reachable.
- Rate limiting shares the `web_fetch` quota bucket. If a user exhausts the limit via search, `web_fetch` is also throttled. Acceptable for now; separate buckets can be added if needed.
- Admin-scoped secrets in `system_config` are stored unencrypted (matching LLM API keys). If `INSTANCE_CONFIG_KEY` encryption is extended to `system_config` in the future, plugin admin config inherits that protection automatically.

## Implementation Notes

Key artifacts:

| File                                               | Role                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/plugins/types.ts`                             | Added `'http'` permission, `scope` on `pluginConfigRequirementSchema`, `rateLimit` on `PluginToolRuntimeContext` |
| `src/plugins/context.ts`                           | Build `providerRuntime` for `http` permission, build `adminConfig` facade                                        |
| `src/plugins/store.ts`                             | `getPluginAdminConfig()`, `setPluginAdminConfig()` using `system_config` with `plg:` prefix                      |
| `src/plugins/tool-runtime.ts`                      | Build `rateLimit` helper from existing `consumeWebFetchQuota`                                                    |
| `src/plugins/registry-context-eligibility.ts`      | Check admin-scoped required keys globally                                                                        |
| `src/debug/admin-plugin-config.ts`                 | Snapshot + apply-update business logic for admin plugin config                                                   |
| `src/debug/plugin-config-routes.ts`                | GET/POST `/admin/plugin-config` HTTP handlers                                                                    |
| `client/admin/sections/PluginConfigSection.svelte` | Admin UI section for plugin config                                                                               |
| `plugins/synthetic-web-search/plugin.json`         | Plugin manifest                                                                                                  |
| `plugins/synthetic-web-search/index.ts`            | Plugin entry: `search` tool + `web-search-hint` prompt fragment                                                  |

No new database migration: admin-scoped config reuses the existing `system_config` table with a key prefix convention.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin runtime, permissions, and context facade that this work extends.
- ADR-0014: Multi-Chat Provider Abstraction — chat providers are not exposed to plugins; `http` permission is the controlled alternative.
- ADR-0009: Multi-Provider Task Tracker Support — the capability model that plugin eligibility evaluation builds on.
