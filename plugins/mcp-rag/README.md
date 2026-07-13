# RAG Search (coding agent)

> Plugin ID: `mcp-rag` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing corporate knowledge-base search. This plugin does **not**
register chat-visible tools for end users — it declares `mcpServer: true`,
so its single tool is exposed as an MCP server surface at
`/mcp/plugin/mcp-rag` for an external coding agent (via papai's sandbox MCP
broker) to call directly. It is the fifth first-party plugin migrated onto
the "MCP server as a papai plugin" pattern, after `mcp-sentry`,
`mcp-confluence`, `mcp-figma`, and `mcp-teamcity` (see
`docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool         | Notes                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| `rag_search` | Search the corporate knowledge base (RAG service) by natural-language query |

Input is a single required `query` string. See `plugins/mcp-rag/input-schema.ts`
for the exact JSON-schema input contract.

The tool's registered description is built at activation time
(`resolveDescription` in `index.ts`): it starts from a fixed base string and,
if the admin-scoped `source_description` config is set, appends it — letting
an operator tell the calling agent what this deployment's knowledge base
actually covers without touching code.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key                  | Scope | Required | Sensitive | Description                                                           |
| -------------------- | ----- | -------- | --------- | --------------------------------------------------------------------- |
| `base_url`           | admin | Yes      | No        | RAG service base URL                                                  |
| `api_key`            | admin | Yes      | Yes       | RAG service API key                                                   |
| `context_code`       | admin | Yes      | No        | Semicolon-separated list of RAG context codes to search               |
| `sources`            | admin | No       | No        | Comma-separated list of source filters passed to every context query  |
| `source_description` | admin | No       | No        | Free-text appended to the `rag_search` tool description at activation |

All five are deployment-wide (admin scope only); there is no per-context
override. `api_key` is sent as an `X-Kontur-ApiKey` header (`client.ts`) on
every request — there is no OAuth/Bearer mode.

## Multi-context search

`context_code` is parsed (`parseContextCodes` in `format.ts`) into a list of
one or more RAG context codes. `RagClient.search` (`client.ts`) fans a single
query out to every context **in parallel** via `Promise.allSettled`, each as
its own `POST /v1/rag_contexts/<context>/search-queries` request carrying the
shared `sources` filter. Results from all contexts are merged and
deduplicated by `document_id` (falling back to `url`) via `dedupeDocuments`.

A failure on one context does **not** fail the whole call: per-context
errors are collected separately and appended to the formatted result as an
inline `⚠️ Failed to query contexts: ...` note (`formatFailures` in
`format.ts`), alongside whatever documents the other contexts did return.

## No redaction

The manifest does **not** set `mcpResponseRedaction`, so `mcp-rag` tool
responses are returned to the calling coding agent as-is — they are not run
through papai's bridge-level redactor (`src/mcp-server/redaction.ts`/
`callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts`), unlike
`mcp-sentry`/`mcp-confluence`. Operators should scope `context_code` and
`sources` to knowledge-base content they're comfortable exposing verbatim to
the coding agent.

## Failure handling

Tool executions return structured errors rather than throwing: `not_configured`
(missing admin creds or no HTTP runtime), `rate_limited` (with
`retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`rag_error` (carries the upstream error message; includes non-2xx status).
Per-context search failures inside a successful call are reported inline in
the result text rather than as a top-level error (see "Multi-context search"
above).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the admin-scoped `base_url`/`api_key`/`context_code` (and optionally
`sources`/`source_description`) config values, then select `plugin:mcp-rag`
as a coding MCP server for the context.
