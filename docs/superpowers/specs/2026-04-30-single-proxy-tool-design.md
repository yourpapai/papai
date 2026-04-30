# Single Proxy Tool For Papai Tools

**Date:** 2026-04-30
**Scope:** Replace the default LLM-facing tool surface with one proxy tool while preserving existing internal tool implementations
**Primary Goal:** Minimize prompt tokens spent on tool definitions
**Non-Goal:** Add external MCP server support or change provider business logic

---

## Context

Papai currently builds a Vercel AI SDK `ToolSet` for each user or chat context through `makeTools()`. The path is:

1. `src/llm-orchestrator.ts` calls `makeTools(provider, options)`.
2. `src/tools/index.ts` calls `buildTools()`.
3. `src/tools/tools-builder.ts` adds context-aware and capability-gated tools.
4. `src/tools/index.ts` wraps every tool executor with `wrapToolExecution()`.
5. The full wrapped `ToolSet` is sent to `generateText()`.

This keeps behavior explicit, but it exposes every tool name, description, and input schema to the model on every request. The `src/tools/` directory now contains many individual tools, so the tool-definition token cost grows as capabilities grow.

`pi-mcp-adapter` addresses the same class of problem for MCP servers by exposing one proxy tool. That proxy supports status, list/search, describe, and call modes. The model discovers tool details only when needed, and calls a selected underlying tool through the proxy. The same pattern can be adapted locally because papai already has a complete in-process tool registry after `buildTools()` runs.

---

## Decision

Expose one default LLM-facing tool, `papai_tool`, instead of exposing every individual papai tool. The full context-aware toolset still exists internally and remains the only execution source.

The proxy tool supports these modes:

- `papai_tool({})` returns compact status and usage guidance.
- `papai_tool({ search: "query" })` searches available internal tools by name and description.
- `papai_tool({ describe: "tool_name" })` returns one tool's description and input schema.
- `papai_tool({ tool: "tool_name", args: "{\"key\":\"value\"}" })` parses JSON-string arguments and calls the underlying wrapped tool.

The default runtime behavior is proxy-only. No individual tools remain directly exposed by default, including core task tools and `get_current_time`.

---

## Architecture

`buildTools()` remains the source of truth for tool availability. It continues to decide which tools exist for a provider, chat user, storage context, mode, and context type. This preserves existing rules for provider capabilities, identity tools, attachment upload context, group-history lookup, web fetch, proactive mode, memos, recurring tasks, and deferred prompts.

`makeTools()` changes its external output shape. It should:

1. Build the full internal toolset with `buildTools()`.
2. Wrap the full internal toolset with `wrapToolExecution()`.
3. Build metadata from the wrapped internal tools.
4. Return a `ToolSet` containing only `papai_tool`.

The proxy calls the wrapped internal executor, not the raw executor. This keeps structured failure normalization centralized in `wrapToolExecution()` and avoids duplicating failure behavior in proxy code.

---

## Components

Add a small proxy layer under `src/tools/`:

- `tool-proxy.ts`: creates the `papai_tool` AI SDK tool and defines its compact input schema.
- `tool-proxy-modes.ts`: implements status, search, describe, and call behavior.
- `tool-metadata.ts`: extracts stable metadata from the internal `ToolSet`.
- `tool-schema-format.ts`: formats schemas into concise LLM-readable text for search, describe, and repair hints.
- `index.ts`: builds and wraps internal tools, then exposes only the proxy tool by default.

The proxy layer should not contain provider logic. Existing tool files remain responsible for all business rules and provider calls.

No persistent metadata cache is required. Unlike MCP servers, papai tools are local factories. Metadata can be derived in memory from the current context's internal `ToolSet` whenever `makeTools()` builds tools. The existing session tool cache can continue caching the returned proxy `ToolSet` for the context.

---

## Proxy Input Schema

The proxy input schema is intentionally compact:

- `tool?: string` - underlying tool name to call.
- `args?: string` - JSON object encoded as a string for the underlying tool arguments.
- `describe?: string` - tool name to inspect.
- `search?: string` - search terms for tool discovery.
- `regex?: boolean` - optional regex search mode.
- `includeSchemas?: boolean` - include parameter schemas in search results; defaults to true.

Mode priority is:

1. `tool` means call mode.
2. `describe` means describe mode.
3. `search` means search mode.
4. No mode fields means status mode.

This mirrors the useful parts of `pi-mcp-adapter` while omitting MCP-specific concepts such as server connection and lifecycle management.

---

## Data Flow

Normal request flow stays unchanged until tool assembly:

1. `processMessage()` builds provider and context, then calls `makeTools()`.
2. `makeTools()` builds the full context-aware internal toolset through `buildTools()`.
3. `makeTools()` wraps every internal executable tool with `wrapToolExecution()`.
4. `makeTools()` returns `{ papai_tool }` to `generateText()`.
5. The model searches or describes tools through `papai_tool`.
6. The model calls `papai_tool({ tool, args })`.
7. The proxy parses `args`, resolves the internal tool name, invokes the wrapped internal executor, and returns the result.

Search uses simple case-insensitive OR matching over space-separated terms, following `pi-mcp-adapter`. Search checks tool names and descriptions. Search results include schemas by default so the model can often call the tool without a separate describe step. `includeSchemas: false` is available for compact listings.

---

## Error Handling

The proxy returns clear, self-explanatory, LLM-readable errors for expected model mistakes. These errors should tell the model what went wrong and how to recover.

Expected proxy errors:

- `invalid_args_json`: `Invalid JSON in args. Provide args as a JSON object string like "{\"taskId\":\"...\"}".`
- `invalid_args_type`: `Invalid args type. The args string must parse to a JSON object, not an array, null, string, number, or boolean.`
- `tool_not_found`: `Tool "..." was not found in this context. Use search to find available tools before calling one.`
- `empty_query`: `Search query cannot be empty. Provide one or more words from the tool name or purpose.`
- `invalid_pattern`: `Invalid regex search pattern. Retry with a simpler search string or set regex to false.`
- `tool_not_executable`: `Tool "..." cannot be executed directly in this context.`

Underlying tool failures are handled by the already wrapped executor. If a wrapped tool returns the existing structured failure payload, the proxy passes it through. Schema hints may be included around model-recoverable call failures only if they do not obscure or replace the structured failure contract.

Destructive and confirmation-sensitive behavior stays inside the existing tools. The proxy does not bypass confidence fields, confirmation gates, or confirmation-required result shapes.

---

## Testing

Deterministic tests should cover proxy behavior without retesting every underlying tool:

1. Metadata extraction from representative tools.
2. `status`, `search`, and `describe` outputs are concise and useful for an LLM.
3. `call` parses JSON-string `args` and invokes a wrapped internal tool.
4. Error outputs are clear for invalid JSON, non-object args, unknown tools, empty search, invalid regex, and non-executable tools.
5. `makeTools()` default output contains only `papai_tool`.
6. Capability and context gating still applies internally. For example, group-only identity tools are searchable only when `buildTools()` would expose them.

Tests should use existing Bun test patterns and helpers. New implementation files under `src/` require tests first, following the repository TDD rules.

---

## Benchmarking

Add an advisory benchmark script to compare the current direct-tool approach with the new single-proxy approach against real LLMs and fake local tools.

Script shape:

- Add `scripts/tool-proxy-benchmark.ts`.
- Add the package script `benchmark:tool-proxy`.
- Use configurable models through CLI flags or environment variables.
- Use the existing OpenAI-compatible model configuration style: base URL, API key, and comma-separated model list.
- Write a concise markdown or JSON summary under `docs/superpowers/plans/` or another explicit output path passed by flag.

Benchmark fixtures:

- Fake tools should be local and deterministic.
- Include realistic tools such as create task, list tasks, search tasks, update task, add comment, assign user, get current time, web-fetch-like lookup, and confirmation-sensitive delete.
- Include enough fake tool descriptions and schemas to make direct mode meaningfully larger than proxy mode.

Prompt set:

- Straightforward single-tool calls.
- Multi-step discovery and execution requests.
- Requests that require search before tool selection.
- Requests prone to malformed argument construction.
- Destructive-action requests that should trigger or pass confirmation behavior.

Metrics:

- Success rate by model and mode.
- Tool-call count.
- Average step count.
- Failure category, such as wrong tool, bad args, missing call, confirmation error, or final answer mismatch.

This benchmark is not a required unit-test gate because it depends on external model behavior and credentials. It is used to validate whether the proxy preserves acceptable task success while materially reducing exposed tool definitions.

---

## Success Criteria

The implementation is successful when:

1. `makeTools()` exposes only `papai_tool` by default.
2. The full existing toolset remains internally available through the proxy.
3. Existing capability and context gating behavior is preserved.
4. Existing structured tool failure handling is preserved.
5. Proxy error messages are clear enough for the LLM to recover without user intervention when possible.
6. Unit and integration tests cover the proxy contract.
7. The benchmark script can compare direct and proxy modes across configurable models and report success metrics.

---

## Alternatives Considered

### Category Proxy Tools

Expose a few proxy tools such as `tasks`, `memos`, `admin`, and `web`.

Rejected because it costs more tokens than one proxy and duplicates routing concepts across categories.

### Hybrid Direct And Proxy Mode

Keep high-frequency tools direct and proxy uncommon tools.

Rejected for the default behavior because the primary goal is minimizing tokens. A hybrid mode can be considered later if benchmark results show unacceptable reliability loss.

### Compact Direct Metadata In Description

Put many common tool names in the proxy description so the model needs fewer searches.

Rejected for the default design because it slowly reintroduces context bloat. Search and describe are the intended discovery mechanisms.

---

## Open Decisions

There are no open design decisions. Implementation details such as exact helper names and benchmark fixture counts can be resolved during planning without changing the approved design.
