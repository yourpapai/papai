# Codeindex Future Tiers and Layers

This note documents intentionally scoped-out features from the `codeindex` Tier 1 implementation, plus the forward-looking layers described in the archived Tier 1 design spec. None of this is scheduled work; these are candidate directions if and when structural search limitations become a bottleneck.

---

## Tier 1 Status

Tier 1 is **complete and functional** as of 2026-05-19. The implementation lives at `~/Projects/yourpapai/codeindex` (standalone repo), with papai using it via `scripts/codeindex-cli.ts` and `scripts/codeindex-cli-support.ts`. See **ADR-0118** for the completion record and **ADR-0089** for the extraction-to-standalone rationale.

---

## Tier 2: Extraction Gaps (Scoped Out)

Tier 1 was intentionally TS/JS-first, focused on named symbol extraction from `.ts`, `.tsx`, `.js`, and `.jsx` files. The following TypeScript features are known gaps:

| Feature                                                        | Impact                                                                | Why it was skipped                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Decorators** (`@Injectable`, `@Component`, etc.)             | May miss decorator-applied symbols or metadata that agents care about | Requires additional AST traversal beyond tree-sitter syntax nodes; no clear single representation for all frameworks |
| **Ambient declarations** (`declare function`, `declare class`) | Ambient symbols are not indexed as real module members                | Not in source files agents typically search                                                                          |
| **`declare module` augmentations**                             | Augmented third-party module shapes not tracked                       | Would require merging augmentation symbols into imported module views                                                |
| **Standalone `.d.ts` files**                                   | Declaration-only symbols unindexed                                    | Separate lifecycle from `.ts` source; would need `tsconfig` declaration emit awareness                               |
| **Type-only `export type` / `import type`**                    | Type-level re-exports not resolved                                    | Cross-file type-only graph is a different problem than value-level reference graph                                   |

These parse without throwing (tree-sitter-typescript handles the syntax), but extraction generally skips them or mis-classifies them. Before relying on the index for decorator-heavy code or declaration-file workflows, a Tier 2 follow-up should extend the symbol extraction and resolver layers.

---

## Layer 2: Embeddings (Semantic Search)

Future semantic search can be added **without rewriting Tier 1** by attaching embeddings to existing symbols.

### Candidate additions

- **`symbol_embeddings` table** keyed by `symbol_id`
  - One embedding per symbol (or per symbol + doc comment combination)
  - Dimensionality: 384 (jina-embeddings-v2-small-code), 768 (OpenAI text-embedding-3-small), or 1024 (OpenAI text-embedding-3-large)
- **Hybrid ranking** that fuses FTS and vector hits
  - Tier 1 exact + FTS remains the fast path
  - Embedding retrieval runs as a slower fallback for concept-like queries where FTS underperforms
  - Score fusion (e.g., reciprocal rank fusion or weighted sum) against existing `rankScore`
- **Reuse of papai-style embedding DI patterns**
  - The papai codebase already has embedding provider abstraction, batching, and rate-limiting via Vercel AI SDK. Borrow that pattern rather than reimplementing.

### When to consider

Not needed until agents consistently fail to find symbols using FTS-based concept queries. The current `identifier_terms`, `doc_text`, and `body_text` FTS fields are surprisingly effective for camelCase/PascalCase identifiers because the splitting logic bridges natural language to code tokens. Embeddings become useful when:

- Query phrasing has no token overlap with code vocabulary (e.g., "how do we authenticate users?" → `verifyIdentity`, `checkSession`)
- Cross-language indexing is needed (Tier 1 is TS/JS-first)

---

## Layer 3: Richer Dependency Graph

Future graph work should build on `symbol_references`, not replace it.

### Candidate additions

| Feature                             | Need                                                        | Approach                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-hop blast radius queries**  | "What breaks if I change this function?"                    | BFS or transitive closure over `symbol_references` from a seed symbol; cap hops to avoid explosion                                                                     |
| **Path search between symbols**     | "How does `web_fetch` eventually call into `send_message`?" | A\* or DFS with hop-count scoring; prefer `resolved` confidence edges; penalize `name_only`                                                                            |
| **Execution or ownership overlays** | "Show me the request-handling path"                         | Requires either manual tagging (annotations in code or config) or static analysis for entry-point detection (e.g., `Controller` classes, `router.get()` registrations) |
| **Graph visualization**             | Debugging index quality / agent understanding               | Export to GraphViz, Cytoscape.js, or D3; only useful once multi-hop queries are meaningful                                                                             |

### When to consider

Layer 3 is only useful once reference resolution quality is high enough that multi-hop paths are dominated by `resolved` edges, not `name_only` noise. Currently, unresolved references (especially cross-module calls where the module specifier is a package name, not a relative path) limit graph completeness. Improving resolution coverage (e.g., by expanding `tsconfig` alias coverage or adding `node_modules` indexing) is a prerequisite.

---

## Comparison of Tiers / Layers

|                            | Tier 2 (Extraction Gaps)                     | Layer 2 (Embeddings)                   | Layer 3 (Graph)                                   |
| -------------------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| **What it adds**           | Better coverage of TS metallanguage features | Semantic/vector search                 | Multi-hop queries and visualization               |
| **Scope**                  | Symbol extraction + resolver                 | Search subsystem + store               | Query engine + optional UI                        |
| **Depends on**             | Tier 1                                       | Tier 1                                 | Tier 1 + high reference resolution quality        |
| **Reuses existing infra?** | Yes (parser + schema)                        | Mostly (adds one table + fusion logic) | Yes (uses `symbol_references`)                    |
| **Risk**                   | Moderate (AST traversal complexity)          | Low (additive, reversible)             | Moderate (requires resolution completeness first) |

---

## References

- **ADR-0118**: Codeindex Tier 1 implementation completion
- **ADR-0089**: Codeindex portability and extraction
- **ADR-0083**: Search ergonomics improvements
- Archived Tier 1 spec: `docs/archive/2026-04-14-codeindex-tier1-design.md`
- Archived Tier 1 plan: `docs/archive/2026-04-14-codeindex-tier1-implementation.md`
