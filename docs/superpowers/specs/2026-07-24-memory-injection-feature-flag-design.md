<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory record-injection feature flag (thread A)

**Status:** design
**Date:** 2026-07-24
**Related:** `docs/research/agent-memory/01-current-state-audit.md` §"Unconditional turn injection",
`docs/research/prompt-optimization/07-memory-context.md`, `docs/superpowers/specs/2026-07-23-memory-hybrid-retrieval-design.md` (defect 6, deferred)

## Problem

Every turn, `buildMessagesWithMemory` (`src/conversation.ts:61-84`) prepends a single
low-trust system message at **position 0** of the model input. That message contains three
layers: compacted summary + facts (A), the long-term profile (B), and the three
most-recently-touched active records (C, via `listMemoryRecords({ status:'active', limit:3 })`).

Layer C is the most volatile part of the prompt prefix: its contents change as records'
`lastSeenAt` updates. Because it sits at position 0, ahead of the entire conversation
history, any change to it invalidates the cacheable prefix of the whole prompt. This is a
standing cost with no measured benefit — the record injection has been a placeholder since
the long-term-memory foundation shipped (`750e473ef`, 2026-06-12) and was never designed as
retrieval (the audit calls it "recency injection, not retrieval"). The frozen research
measured only retrieval rank (nDCG) with **no live reader**, so there is no evidence that
this per-turn injection improves answer quality at all.

Making record injection query-aware (defect 6) would make C change *every* turn, worsening
the cache picture, and its benefit is likewise unmeasured. Before investing in any injection
scheme, we want the record injection to be **off by default and explicitly opt-in**, so the
default prompt prefix is stable and cache-friendly. The decision about *how* memory should
reach the conversation is deferred to a separate deep-research effort (thread B).

## Goal

Gate layer C (record injection) behind a per-memory-scope boolean, defaulting **off**.
When off, the long-term-memory message still carries the profile (layer B); only the records
are suppressed. Layers A and B are otherwise untouched. Expose the flag as an opt-in toggle
in the settings `MemorySection`, mirroring the existing capture-enabled toggle.

## Non-goals

- Query-aware injection / `deriveInjectionQuery` (defect 6). Deferred to thread B.
- Any change to layer A (summary/facts) or layer B (profile) content or placement.
- Relocating the memory message out of position 0 (a cache mitigation thread B will evaluate).
- Changing capture, extraction, promotion, retrieval, or the `search_memory` tool.
- The deep-research doc itself (separate deliverable).

## Design

### Storage: a column on `memory_profiles`

The flag lives beside the existing capture flag (`enabled`) on `memory_profiles`
(`src/db/long-term-memory-schema.ts:9-23`), keyed by memory scope. This is chosen over a
`getCachedConfig` key because:

- `buildMessagesWithMemory` **already loads the profile** for this scope
  (`getMemoryProfile(scope)`), so reading the flag adds **zero extra reads** on the hot path.
- It is consistent with the sibling capture toggle: same table, same scope keying, same
  settings API router, same UI section.
- It is keyed by memory scope (personal/group), which is the correct scope for a memory
  behavior — not the config context.

Because the flag is read from the already-resolved memory scope, **`buildMessagesWithMemory`
needs no new parameter** and its three call sites
(`src/llm-orchestrator-tools.ts:250`, `src/deferred-prompts/proactive-llm-full.ts:65`,
`src/commands/context.ts:75`) are unchanged.

**Migration 070** adds:

```
inject_records  integer (boolean mode)  NOT NULL  DEFAULT false
```

Default `false` = opt-in. Contrast with `enabled` (capture), which defaults `true` (opt-out).

### Type and store layer (`src/long-term-memory/`)

- `types.ts`: add `injectRecords: boolean` to `MemoryProfile`.
- `store.ts`:
  - `loadProfile` / `getMemoryProfile` include `injectRecords` from the row.
  - New setter `setMemoryRecordInjectionEnabled(scope, enabled, now): MemoryProfile`,
    mirroring `setMemoryCaptureEnabled` (upsert on `[scopeType, scopeId]`, bump `version`).
    The setter touches only `inject_records` (+ `version`, `updatedAt`); it must **not**
    disturb the capture flag. On insert of a fresh row it sets `inject_records: enabled` and
    omits `enabled` so the column default (`true`, capture on) applies; on conflict it updates
    only `inject_records`, `version`, `updatedAt`. Symmetrically, `setMemoryCaptureEnabled`
    on a fresh insert must let `inject_records` fall to its column default (`false`).

### Injection gate (`src/conversation.ts`)

`buildMessagesWithMemory` loads the full profile object once (it already calls
`getMemoryProfile(scope)`), then:

- `injectRecords === true`  → `records = listMemoryRecords({ ...scope, status:'active', limit:3 })` (today's behavior).
- otherwise (`false`, or **no profile row**) → `records = []`, and **`listMemoryRecords` is not called** (no wasted DB read).

The profile string still feeds `buildLongTermMemoryContextMessage`, so the `<long_term_memory>`
message renders with the profile and an empty record set when the flag is off.
`buildLongTermMemoryContextMessage` already returns a profile-only message when records are
empty (`src/long-term-memory/context.ts`), so no change is needed there.

### Settings API (`src/debug/settings/memory-routes.ts`)

Mirror the capture route:

- Add `RecordInjectionPatchBodySchema { contextId?: string, enabled: boolean }`.
- Add a `PATCH`/POST handler that resolves the scope (write permission) and calls
  `setMemoryRecordInjectionEnabled`.
- Include `injectRecords` in the memory GET response payload so the client can render the
  toggle's current state.

### Client (`client/settings/`)

Mirror the capture toggle:

- `fetcher-schemas.ts`: add `injectRecords: boolean` to `MemoryResponse`.
- `fetchers.ts`: add `setMemoryRecordInjection({ contextId, enabled })`.
- `MemorySection.svelte`: add a toggle (test id `memory-record-injection-toggle`) that reads
  `currentMemory.injectRecords` and calls the fetcher, following `toggleCapture`'s structure.
  Copy should make the trade-off legible: off = cache-friendly, records reachable via the
  `search_memory` tool; on = records pushed into every turn.

## Behavior change (call out in ADR note)

This is **not a no-op** for existing deployments. Today records are always injected; after
this ships, any scope that has not explicitly opted in stops receiving record injection.
Justification: the injection is unmeasured and cache-hostile, the profile (durable memory)
is retained, and the model can still pull records on demand via `search_memory`. Record this
in a short ADR note accompanying the change.

## Testing (TDD)

1. **Store**: `setMemoryRecordInjectionEnabled` upserts and bumps `version`; `getMemoryProfile`
   returns the persisted `injectRecords`; a fresh scope with no profile reports `injectRecords: false`.
2. **Injection off (default)**: `buildMessagesWithMemory` for a scope with no profile / flag
   off produces a memory message with the profile but **no `<record>` elements**, and
   `listMemoryRecords` is not called (assert via injected/spied store).
3. **Injection on**: flag on reproduces today's behavior — up to three active records injected.
4. **Settings API**: PATCH toggles the flag; GET reflects `injectRecords`; write-permission
   enforced.
5. **Client**: `MemorySection` renders the toggle from `injectRecords` and posts the change
   (Storybook story + interaction, matching the capture-toggle test).
6. **Migration**: 070 applies on an existing DB; pre-existing profiles read `injectRecords: false`.

## Follow-on (thread B, separate)

Deep-research doc: "how should long-term memory reach the conversation?" — comparing
position-0 injection vs. trailing/cache-friendly placement vs. tool-pull (JIT `lookup_*`)
vs. agentic multi-call selection, grounded in `07-memory-context.md` + external SOTA, ending
in a recommended architecture and a concrete measurement/data-collection plan (including the
offline reader-eval harness). This flag is the safety valve that makes the default stable
while that research runs.
