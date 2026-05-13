# ADR-0085: Embedding Cache and Clustering Optimization

## Status

Accepted

## Context

The keyword consolidation and tuning workflows in the behavior audit scripts were experiencing significant performance bottlenecks:

1.  **Embedding Latency and Cost**: Every run of `tune-embedding.ts` or `consolidate-keywords.ts` required fetching embeddings for the entire vocabulary via LLM API calls. For large vocabularies, this is slow and incurs unnecessary costs.
2.  **Clustering Complexity**: The original `cosineSimilarity` implementation used three `.reduce()` calls per comparison (dot product + 2 magnitude calculations). For a vocabulary of ~7,700 slugs, this resulted in ~29.6 million comparisons, leading to approximately 91 billion JavaScript callback invocations. This made the "tuning" loop (testing different thresholds) extremely slow.

## Decision Drivers

- **Performance**: Drastically reduce the execution time of the clustering phase.
- **Cost and Efficiency**: Minimize redundant, expensive LLM API calls for stable vocabularies.
- **Developer Experience**: Enable a fast, iterative "tuning" loop for optimizing consolidation thresholds.

## Considered Options

### Option 1: Maintain current implementation (Naive)

- **Pros**: Minimal complexity; no extra storage needed.
- **Cons**: Extremely slow clustering; high API costs and latency on every run.

### Option 2: Implement Embedding Cache and Optimized Clustering

- **Pros**:
  - **Embedding Cache**: Persists raw and pre-normalized embeddings to disk, allowing near-instant retrieval on subsequent runs.
  - **Optimized Clustering**: Pre-normalizes embeddings to unit vectors once, reducing cosine similarity to a single high-performance typed-array dot product.
  - **Speed**: Removes the magnitude calculation bottleneck and the API latency bottleneck.
- **Cons**:
  - **Storage**: Requires additional disk space for the `.json` cache files.
  - **Complexity**: Requires cache invalidation logic (implemented via slug fingerprinting) to ensure the cache remains valid if the vocabulary or model changes.

## Decision

We will implement **Option 2**.

Specifically:

1.  Create `scripts/behavior-audit/embedding-cache.ts` to manage the lifecycle of embedding persistence.
2.  Use a "slug fingerprint" (hash of all slugs) to verify cache validity.
3.  Implement `toNormalizedFloat64Arrays` and `buildClustersNormalized` in the clustering helpers to utilize fast dot-product operations on pre-normalized unit vectors.

## Rationale

Option 2 addresses both the compute bottleneck (clustering) and the I/O/cost bottleneck (embeddings) simultaneously. By storing the _normalized_ vectors in the cache, we also eliminate the normalization step from the hot loop of subsequent runs. The added complexity of fingerprinting is a necessary and well-understood trade-off to ensure correctness.

## Consequences

### Positive

- **Significant Performance Gain**: Clustering speed improves by orders of magnitude.
- **Reduced Costs**: LLM API usage is minimized for repeated runs.
- **Faster Iteration**: The tuning workflow becomes interactive rather than batch-oriented.

### Negative

- **Increased Disk Usage**: Local `reports/audit-behavior/` directory will grow with cache files.
- **Cache Management**: We must ensure the fingerprinting is robust to prevent using stale embeddings if the vocabulary changes.

### Risks

- **Cache Invalidation**: If the fingerprinting logic is flawed, users might see inconsistent results.
- **Mitigation**: Use a strict fingerprint based on the sorted slugs and the specific model name used.

## Implementation Notes

- The cache is stored as a JSON file containing the model name, fingerprint, and entries (raw + normalized).
- `consolidate-keywords.ts` and `tune-embedding.ts` have been updated to consume this new module.
- Clustering now uses `Float64Array` for optimal performance in the dot-product loop.

## Related Decisions

- ADR-0084: Consolidate Behavior Audit Scripts (this implementation is part of that effort)

## References

- Plan: `docs/superpowers/plans/2026-04-28-embedding-cache.md`
