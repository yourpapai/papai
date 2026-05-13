# ADR-0083: Enrich Codeindex Search Ergonomics for Agents

## Status

Accepted

## Context

Agents interacting with the codebase via the `codeindex` MCP server currently experience suboptimal search ergonomics. Specifically:

- `code_symbol` often provides broad results rather than prioritized exact matches, leading to unnecessary token usage and confusion.
- Search results lack rich previews; returning only the `qualifiedName` makes it difficult for agents to immediately understand the context of a symbol.
- The lack of structural ranking (e.g., distinguishing between an exact export match and a fuzzy FTS hit) forces agents to manually parse results to find the most relevant items.
- MCP tool outputs are currently text-only, requiring agents to perform complex regex or JSON parsing to extract structured search results.

## Decision Drivers

- **Agentic Efficiency**: Minimizing the cognitive load and token usage for LLMs when navigating the codebase.
- **Precision**: Ensuring `code_symbol` acts as an "exact-first" tool.
- **Richness**: Providing immediate context (snippets) without requiring additional tool calls.
- **Machine Readability**: Leveraging MCP `structuredContent` to allow host applications to consume search results natively.

## Considered Options

### Option 1: Enhance existing codeindex tool semantics and MCP output (Chosen)

Modify the existing `codeindex` implementation to support exact-first lookup, rich snippets from stored source text, and structured MCP outputs.

- **Pros**: Directly addresses all ergonomic gaps; leverages existing SQLite FTS5/storage; improves agent performance significantly.
- **Cons**: Requires updates to tool definitions and schema; requires updating repo guidance (`CLAUDE.md`).

### Option 2: Implement a new dedicated "exact search" tool

Create a completely separate tool specifically for exact matches.

- **Pros**: Simple to implement without changing existing tool logic.
- **Cons**: Increases tool surface area; doesn't solve the preview or structured output problems; agents might still prefer the "search" tool.

### Option 3: Move search logic to the LLM layer

Rely on the LLM to "figure out" the best way to use the current broad search tools.

- **Pros**: No changes to the codebase.
- **Cons**: Extremely inefficient; high error rate; high token cost; poor UX for the agent.

## Decision

We will proceed with **Option 1**: Enhancing the `codeindex` search semantics and MCP output capabilities.

## Rationale

Option 1 provides a holistic solution that improves both the accuracy (exact-first) and the usability (rich previews, structured output) of the search experience. By integrating these improvements into the existing tools, we maintain a clean tool interface while providing the high-fidelity data required for effective agentic navigation.

## Consequences

### Positive

- **Improved Agent Performance**: Agents can find symbols faster and with higher confidence.
- **Reduced Token Usage**: Better ranking and exact matches mean fewer search iterations.
- **Better Tool UX**: Structured MCP outputs allow for much cleaner integration with agentic workflows.
- **Self-Documenting Results**: Rich snippets provide immediate context.

### Negative

- **Increased Implementation Complexity**: Requires changes across the search pipeline, MCP server, and test suites.
- **Documentation Overhead**: Requires updating `CLAUDE.md` and `codeindex/CLAUDE.md` to reflect new tool behaviors.

### Risks

- **Search Quality Regression**: Changes to the ranking/filtering logic could inadvertently degrade fuzzy search quality.
- **Mitigation**: Rigorous testing using the new `tests/codeindex/` suite and comparison against baseline results.

## Implementation Notes

- Use `runExactSearch` as the first pass in `findSymbolCandidates`.
- Utilize existing `body_text` and `signature_text` columns in SQLite for snippets.
- Implement `buildStructuredToolResult` to return both `text` and `structuredContent` in MCP responses.
- Update `CLAUDE.md` search protocol to prioritize `code_symbol` for exact names.

## Related Decisions

- ADR-0014: Multi-chat provider abstraction (provides the context for how tools are used)
- ADR-0058: Provider capability architecture

## References

- [Model Context Protocol (MCP) Specification](https://modelcontextprotocol.io/)
- Internal: `docs/superpowers/plans/2026-04-27-codeindex-search-ergonomics.md`
