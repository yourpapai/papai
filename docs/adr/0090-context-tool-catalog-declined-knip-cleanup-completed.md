<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0090: Decline Full Tool Catalog Emission in `/context`; Complete KNIP Cleanup

## Status

Declined (partial — tool catalog feature declined, export cleanup accepted)

## Date

2026-05-16

## Context

A 2026-05-12 implementation plan (`docs/superpowers/plans/2026-05-12-tool-introspection-production-usage-and-knip-cleanup.md`) proposed two goals:

1. **Wire live tool introspection into `/context`**: After the existing visual token-summary response, the bot would emit follow-up pages built from the live `ToolSet`, displaying every tool's name, classification, description, and full parameter schema.
2. **Remove remaining KNIP ignores**: By deleting test-only exports (`clearBundleCache`, `emptyAgentUsage`, and clustering internals), the KNIP dead-code detector could analyze only production entrypoints without false positives from test imports.

The plan argued that these goals were coupled: once tests stopped counting as production entrypoints, the introspection helpers (`buildToolMetadata`, `formatToolSchema`) would be the only way to justify Keeping them exported. Without the tool-catalog feature, those helpers would appear as unused exports to KNIP.

## Considered Options

### Option A: Implement the tool catalog as planned

Emit paginated markdown pages after the `/context` summary, listing every active tool's metadata and schema. This validates the exported `buildToolMetadata`, `findToolMetadata`, and `formatToolSchema` helpers.

### Option B: Keep `/context` as a token-summary-only command; clean up exports and narrow KNIP scope separately

Decline the tool catalog feature. Keep `buildToolMetadata`, `formatToolSchema`, as private to `src/tools/` (they are not `export`-ed from index barrels). Rely on the existing `/context` summary's **Tools section** (token count only) as the production surface that validates those helpers' existence. Remove test-only exports, test helper files, and obsolete `ignoreIssues` entries.

## Decision

We take **Option B**.

The full tool catalog feature is **declined**. The KNIP cleanup (removing test-only exports, deleting `tests/providers/youtrack/test-helpers.ts`, narrowing `consolidate-keywords-helpers.ts` surface, and removing obsolete `ignoreIssues`) is **accepted and implemented**.

## Rationale

### Why the tool catalog was declined

The `/context` command's purpose is a **diagnostic snapshot** — a quick visual gauge of how the context window is consumed (system prompt, memory, history, tools). Adding a multi-page tool encyclopedia fundamentally changes the UX:

- **Chat spam**: A typical provider exposes ~60 tools. Rendering descriptions and full Zod schemas for each produces 3,000+ characters of output. On Telegram or Mattermost, this floods the chat.
- **Wrong abstraction**: `/context` answers "how much room is left?" not "what does every tool do?" Tool-by-tool detail belongs in documentation or a dedicated `/tools` command, not a context diagnostic.
- **Pagination complexity**: The proposed 3,500-character pagination, while technically sound, adds UI complexity (follow-up messages) for information users rarely need mid-conversation.
- **Leaky coupling**: The plan's argument that tool introspection "justifies" keeping helpers exported is circular. The helpers exist because the Tools token count in `/context` uses them internally. They do not need to be exposed to end users to be legitimate production code.

### What was accepted and implemented

The parts of the plan that **shrink the production surface** (the original cleanup intent) were completed:

1. **`src/providers/youtrack/bundle-cache.ts`**: `clearBundleCache` removed. Tests now use `createUniqueYouTrackConfig()` for per-test cache isolation — a superior pattern that avoids mutable global state.
2. **`tests/providers/youtrack/test-helpers.ts`**: Deleted entirely.
3. **`tests/providers/youtrack/bundle-cache.test.ts`, `index.test.ts`, `operations/statuses.test.ts`**: Migrated to unique-config fixtures from `fetch-mock-utils.ts`. No longer depend on cache reset.
4. **`scripts/behavior-audit/consolidate-keywords-clustering.ts`**: `buildClusters`, `cosineSimilarity`, `buildUnionFind`, `find`, `union` made module-local. Only `dotProduct`, `findWeakestInternalSimilarity`, `toIndexedSubEmbeddings`, `mapToGlobalClusters`, `toNormalizedFloat64Arrays`, `buildClustersNormalized`, and `LinkageMode` remain exported.
5. **`scripts/behavior-audit/consolidate-keywords-helpers.ts`**: Barrel no longer re-exports `buildClusters`, `LinkageMode`, `cosineSimilarity`, etc. Tests verify this by asserting those names are absent from the module surface.
6. **`scripts/behavior-audit/phase-stats.ts`**: `emptyAgentUsage` removed. Tests inline a local `zeroAgentUsage` fixture.
7. **`knip.jsonc`**: Removed `src/providers/youtrack/bundle-cache.ts`, `scripts/behavior-audit/consolidate-keywords-clustering.ts`, `scripts/behavior-audit/phase-stats.ts`, `src/tools/tool-metadata.ts`, and `src/tools/tool-schema-format.ts` from `ignoreIssues`.
8. **Full verification**: `bun run check:full` passes (12/12). `bun run knip` passes. All affected test suites pass.

The existing `/context` command already surfaces tool metadata accurately in the **summary** (token count, approximate flag, and model info). The `buildToolMetadata` and `formatToolSchema` helpers are used internally by the collector to compute that token count — they are legitimate production code with a real call site.

## Consequences

### Positive

- `/context` remains a focused, fast diagnostic. Users are not drowned in tool metadata.
- Production exports are reduced — fewer accidental public APIs.
- KNIP now reports true dead code without test-induced false positives.
- Test isolation improved: unique-config fixture replaces global cache reset.
- No new `src/commands/context-tool-catalog.ts` or test file to maintain.

### Negative

- Users cannot enumerate active tools inline via `/context`. If needed, a dedicated `/tools` command or provider documentation would be a future feature, not a diagnostic appendage.
- `formatToolSchema` and `buildToolMetadata` remain unexported from `src/tools/index.ts`. They are reachable by tools that compute token counts (`makeTools`, `buildInvocationToolSet`, `resolveContextToolSurface`) but are not directly importable from outside `src/tools/`. This is intentionally narrow scope.

### Risks

- Someone may re-propose the catalog feature later. Mitigation: this ADR documents the UX rationale (spam, wrong abstraction) for reference.
- `buildToolMetadata` / `formatToolSchema` could be incorrectly flagged by future linting if their only call sites are indirect. Mitigation: they are called from `buildInvocationToolSet` → `resolveContextToolSurface` → `handleContextCommand`, a clear production chain.

## Related Decisions

- ADR-0061: `/context` Command Redesign — established the token-summary visual design that this ADR preserves.
- ADR-0011: KNIP Dead-Code Detection — the original KNIP adoption decision whose scope this cleanup completes.

## References

- Implementation plan: `docs/archive/2026-05-12-tool-introspection-production-usage-and-knip-cleanup.md` (archived)
