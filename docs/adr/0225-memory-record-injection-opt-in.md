<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0225: Long-term Memory Record Injection Is Opt-In

## Status

Accepted

## Date

2026-07-24

## Context

Since the long-term-memory foundation (2026-06-12), `buildMessagesWithMemory` has injected
the three most-recently-touched active records into a position-0 system message every turn.
This is a placeholder "recency injection, not retrieval" (`docs/research/agent-memory/01-current-state-audit.md`).
It is the most volatile part of the prompt prefix — its contents change as `lastSeenAt`
updates — so it repeatedly invalidates the cacheable prefix, and the frozen research measured
only retrieval rank with no live reader, so its effect on answer quality is unmeasured.

## Decision

Gate record injection behind a per-memory-scope boolean `memory_profiles.inject_records`,
defaulting **off**. When off, the long-term-memory message still carries the profile; only
records are suppressed. The flag is an opt-in toggle in the settings MemorySection.

## Consequences

- **Behavior change:** existing scopes stop receiving record injection until they opt in.
  The durable profile is retained, and records remain reachable on demand via the
  `search_memory` tool.
- The default prompt prefix becomes more cache-stable.
- How memory *should* reach the conversation (push vs. trailing placement vs. tool-pull/JIT
  vs. agentic selection) is deferred to a separate deep-research effort; this flag is the
  safety valve that keeps the default stable while that research runs.
