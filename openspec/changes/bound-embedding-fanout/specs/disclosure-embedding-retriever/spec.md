# Spec Delta: disclosure-embedding-retriever

## Purpose

Bounds the embedding work the progressive tool-discovery search (`search_tools`) performs per call, and guarantees it degrades to lexical ranking instead of hanging when the embedding endpoint is slow, throttled, or unavailable.

## ADDED Requirements

### Requirement: Batched cold-start embedding

On a cache miss, the discovery search SHALL embed all currently uncached tool briefs using batched embedding requests (a bounded number of requests carrying multiple texts each) instead of one request per brief.

#### Scenario: First search after process start

- **WHEN** a discovery search runs against a cold brief cache with 75 discoverable tools and the embedding role is configured
- **THEN** the search issues at most a small bounded number of embedding requests (batch chunks), never 75 individual requests

#### Scenario: Warm cache

- **WHEN** a discovery search runs and every brief is already embedded for the current endpoint+model
- **THEN** no brief-embedding requests are issued; only the query may be embedded

### Requirement: Bounded latency with lexical fallback

Every embedding request the discovery search makes SHALL be bounded by a timeout, and the search SHALL return lexically ranked results when the embedding path fails, times out, or returns no usable vectors. The `search_tools` call SHALL always complete within bounded time rather than blocking on an unresponsive endpoint.

#### Scenario: Endpoint hangs

- **WHEN** the embedding endpoint accepts connections but never responds, and a discovery search runs
- **THEN** each embedding request is abandoned after the timeout and the search returns lexical results

#### Scenario: Provider rejects the batch

- **WHEN** the embedding endpoint rejects the batch request (rate limit or error)
- **THEN** the search returns lexical results and reports no error to the caller

### Requirement: No duplicate in-flight embedding work

Concurrent discovery searches running in the same process SHALL share in-flight embedding work for the same briefs: the same brief text MUST NOT be sent for embedding more than once at a time.

#### Scenario: Overlapping searches on a cold cache

- **WHEN** two discovery searches start while the brief cache is cold and the first is still awaiting embeddings
- **THEN** both searches use the same in-flight results; no brief text is embedded twice concurrently

### Requirement: Failure backoff for briefs

A brief whose embedding failed SHALL NOT be re-sent for embedding on every subsequent search; it SHALL be retried only after a failure TTL has elapsed. Successfully embedded briefs remain cached per endpoint+model as before.

#### Scenario: Search immediately after a failure

- **WHEN** a discovery search runs within the failure TTL of a prior search whose brief embeddings failed
- **THEN** no new embedding requests are issued for those briefs; the search ranks over the available vectors and lexical results

#### Scenario: Embedding model change

- **WHEN** the configured embedding model or endpoint changes between searches
- **THEN** the brief cache for the new endpoint+model starts cold and briefs are re-embedded under the new key

### Requirement: No secret exposure in retrieval logging

Logs emitted by the embedding retrieval path SHALL carry only metadata (counts, durations, model ids, outcome classes), never API keys, tokens, or credential-bearing configuration.

#### Scenario: Embedding failure is logged

- **WHEN** a batch embedding request fails and the failure is logged
- **THEN** the log entry contains the error class and model id but no credentials or auth material
