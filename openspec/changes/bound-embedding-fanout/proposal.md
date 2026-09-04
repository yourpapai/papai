# Proposal: bound-embedding-fanout

## Why

`search_tools` embeds every uncached tool brief in an unbounded concurrent `Promise.all` (`src/tools/disclosure/embedding-tool-retriever.ts:42`) with no timeout on the embed HTTP call (`src/embeddings.ts:113`). On a queueing/throttling endpoint this turns the first search after every process start into a multi-minute hang: a live incident showed ~75 embed calls fired in 19 ms, completions trickling in for 3+ minutes, a 195 s `search_tools` duration, provider batch rejections, concurrent searches stacking duplicate embeds (duplicate `recordUsage` event ids), and the `message-embedding-sweep` — which shares the same endpoint — starved (backlog 214 → 215). The turn holds the user's reply hostage the whole time; failure is unbounded latency, not an error, so no fallback ever triggers.

## What Changes

- Batch all uncached brief texts (plus the query) into chunked `embedMany` calls — one HTTP request per chunk instead of one per brief.
- Bound any residual per-item embed concurrency with `p-limit` (repo convention).
- Add a timeout and reduced `maxRetries` to embedding HTTP calls; on expiry/failure the retriever degrades to lexical ranking, so `search_tools` always answers in bounded time.
- Single-flight in-progress dedup: concurrent `rank()` calls share pending embed promises instead of re-fanning-out the same briefs.
- Negative-cache failed briefs with a short TTL so a throttling endpoint is not re-probed on every search.

No breaking changes. No config, schema, or migration changes. Platform/task instances: unaffected. Scope: the retriever resolves BYOK/central embedding credentials per config-context (group-shared); the new bounds apply uniformly to every context and mode.

## Capabilities

### New Capabilities

- `disclosure-embedding-retriever`: bounded, fallback-safe embedding retrieval for progressive tool disclosure — batching, concurrency limits, call timeout, single-flight dedup, failure TTL, and guaranteed lexical degradation. Without it, any throttled or slow embedding endpoint can stall chat turns unboundedly and starve the shared-embedding message sweep; nothing else covers this behavior (no existing spec addresses disclosure or embeddings).

### Modified Capabilities

(none)

## Impact

- `src/tools/disclosure/embedding-tool-retriever.ts` (fan-out → batch, single-flight, negative cache)
- `src/embeddings.ts` (timeout/maxRetries on `getEmbedding`/`tryGetEmbedding`; optional `embedMany` export for the retriever)
- `src/tools/disclosure/tool-retriever.ts` (types only, if the retriever interface gains batch deps)
- Tests: `tests/tools/disclosure/` (DI-first, per local pattern); affected suites via `bun run test:affected`, full suite before finish
- Docs: `docs/architecture/tools.md` (progressive-disclosure paragraph — bounded/fallback contract)

## Non-goals

- Startup background warm-up of the brief cache (batching reduces the cold path to ~1 request; declined as unnecessary complexity until proven otherwise).
- Persisting the brief-embedding cache across restarts.
- Changes to `message-embedding-sweep` itself (it already batches and bounds concurrency; it benefits indirectly from disclosure no longer saturating the endpoint).
- Fixing the `recordUsage` duplicate-event-id warns in the usage recorder (mostly disappears via single-flight; recorder dedup already prevents double-count).
- New settings/env knobs for the bounds (constants chosen in code; can be made configurable later if needed).
