<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Context-tools clarity & discoverability fixes

**Date:** 2026-07-23
**Branch:** context-tools-calculation
**Status:** Approved design

## Problem

The four always-on "context" tools — `get_current_time`, `search_tools`, `load_tool`,
`expand_result` — are individually terse but, taken as a set, leave the model without the
information it needs at three points of failure:

1. **`search_tools` returns `[]` on a wording miss** with no signal that the capability
   might still exist under different terms. A model can read an empty result as "not
   supported" and stop — before the `DISCLOSURE_STALL_STEPS` fallback (which needs a *next*
   step) can rescue it. There is also no disclosed map of the space: 102 tools across 21
   domains, searched by free text, with the `domain` facet returned but never offered as an
   input strategy.
2. **`load_tool` fails silently on bad names.** `markLoaded` returns `{ loaded, unknown,
   nowActive }` and never errors; a typo or hallucinated name lands in `unknown`, the model
   calls it anyway, and the confusing failure surfaces one step later.
3. **`get_current_time`'s description contradicts the system prompt.** `system-prompt.ts:21`
   declares the injected `<current_time>` line authoritative and this tool a *fallback*; the
   description frames the tool as *the* way to get the time.

Plus two hygiene defects:

- `expand_result`'s `offset` is an unbounded `z.number().int()`, so schema serialization
  emits `maximum: 9007199254740991` (`MAX_SAFE_INTEGER`) to the provider — meaningless noise.
- Two constants named `…_BYTES` are actually used as **character** counts (fed to string
  `.slice()`), inviting a future "fix" that would break paging.

## Principle

Guidance goes where it costs nothing on the happy path:

- **Result payloads** (conditional fields) — appear only in the failure case, exactly when
  the model is stuck; zero tokens otherwise.
- **Descriptions** — already always-on, so they get *reworded*, never *grown*.
- **No new standing prompt tokens.** This was the explicit constraint after two rounds of
  weighing a ~110-token always-on addition and rejecting it.

## Changes

### 1. `search_tools` — empty-result hint + dynamic domain map (A + C)

File: `src/tools/disclosure/search-tools.ts`

On a miss only, return a `hint` listing the domains **actually present** in the current
context's `discoverable` briefs (deduped, sorted). Dynamic derivation keeps it accurate as
the context-gated toolset changes and never lists a domain with no reachable tool. The
happy path is unchanged — no `hint` key when there are results.

```js
const results = ranked.map((b) => ({
  name: b.name,
  summary: b.summary,
  domain: b.domain,
  alreadyLoaded: loadedNow.has(b.name),
}))
if (results.length > 0) return { results }
const domains = [...new Set(discoverable.map((b) => b.domain))].sort()
return {
  results,
  hint: `No tool matched. Retry with different wording or a domain keyword: ${domains.join(', ')}.`,
}
```

Decisions:
- **Do not echo the query** into the hint — the model already has it; keeps the payload clean.
- **`alreadyLoaded` stays undocumented** — the cost of not knowing is one idempotent
  `load_tool` call, not worth prose.

### 2. `search_tools` — `limit` gets an actionable policy (F)

Same file. Replace the schema description that restates the field name:

- Before: `.describe('Maximum tools to return')`
- After: `.describe('Maximum tools to return (default 8). Raise it when a first search returns nothing relevant.')`

### 3. `load_tool` — unknown-name warning (B)

File: `src/tools/disclosure/load-tool.ts`

Happy path (`unknown: []`) stays byte-identical; a `warning` appears only when something
failed to activate.

```js
const result = { loaded, unknown, nowActive }
if (unknown.length === 0) return result
return {
  ...result,
  warning: `Not activated (unrecognized): ${unknown.join(', ')}. Use search_tools for exact names.`,
}
```

### 4. `get_current_time` — reframe as fallback, drop dead sentence (E + G)

File: `src/tools/get-current-time.ts`

Resolve the contradiction with `system-prompt.ts:21`. New description:

> `Fallback for the current date and time in the user's timezone. Each user message normally begins with an authoritative <current_time> line — prefer that when present. Call this only when it is absent, e.g. to resolve relative dates like "tomorrow" or "next Monday".`

Also drop `.describe('No arguments required.')` from the empty `z.object({})` — the empty
schema already conveys it.

**No output-shape change.** The returned `{ datetime, timezone, formatted }` is untouched, so
existing `tests/tools/get-current-time.test.ts` assertions (ISO pattern, no trailing `Z`)
remain valid.

### 5. `expand_result` — bound `offset` (D)

Files: `src/tools/compaction/expand-result.ts`, `src/tools/compaction/constants.ts`

Add a generous, readable upper bound so the schema stops emitting `MAX_SAFE_INTEGER`:

```js
// constants.ts
export const EXPAND_MAX_OFFSET_CHARS = 100_000_000
```

```js
// expand-result.ts
offset: z.number().int().min(0).max(EXPAND_MAX_OFFSET_CHARS).default(0).describe('Character offset to start from'),
```

Local to this tool. The other ~100 unbounded ints across the codebase are explicitly out of
scope; a systemic serializer fix was considered and rejected for this pass.

### 6. Constant renames (H)

File: `src/tools/compaction/constants.ts` (+ refs)

The two constants fed to string `.slice()` are character counts, not bytes:

- `EXPAND_DEFAULT_LIMIT_BYTES` → `EXPAND_DEFAULT_LIMIT_CHARS`
- `COMPACTION_PREVIEW_BYTES` → `COMPACTION_PREVIEW_CHARS`

Update references:
- `src/tools/compaction/expand-result.ts` (import + 2 uses)
- `src/tools/compaction/wrap-compaction.ts` (import + 1 use)
- `tests/tools/compaction/constants.test.ts` (import + assertions)

`COMPACTION_THRESHOLD_BYTES` is **kept** — it correctly gates on `Buffer.byteLength`.

## Testing

- **`search_tools`**: empty/no-match query → result carries `hint` containing the domains
  present in the test's discoverable set; non-empty result → no `hint` key.
- **`load_tool`**: input with an unrecognized name → result carries `warning` naming it; all
  names known → no `warning` key; already-active names still succeed without warning.
- **`expand_result`**: schema rejects `offset` above `EXPAND_MAX_OFFSET_CHARS`; serialized
  schema no longer contains `9007199254740991`.
- **Renames**: update identifiers in `constants.test.ts`; assertions otherwise unchanged.
- **Regression guard**: `get-current-time.test.ts` runs unchanged and green (proves the
  description reword introduced no shape change).

## Out of scope

- Renaming the live tools `expand_result` / `load_tool` (names imply narrower behavior than
  they have, but renaming a live tool surface isn't worth it here).
- A systemic schema-serializer fix for all unbounded ints.
- Any change to the other ~100 tools' descriptions.
- Any addition to the always-on system prompt.
