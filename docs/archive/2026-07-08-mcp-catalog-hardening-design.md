<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP Catalog Hardening — host derivation + required tool-policy posture

**Status:** design (approved) — 2026-07-08

**Goal:** Close the two operator-config footguns the Phase 3B-papai final security review surfaced, so an operator cannot silently misconfigure a catalog entry into an unintended (over-permissive) posture. Neither footgun is user-exploitable today; this is defense-in-depth + operator-clarity hardening.

**Scope:** papai only. magi is unaffected — it already validates `projectSpec.mcp.toolPolicy` (`{ default, tools? }`) and enforces `host === new URL(url).hostname` + `host ∈ allowedHosts` fail-closed. This change makes papai's catalog _unable to emit_ the shapes that would trip those downstream checks, and removes the allow-all-by-omission default.

**Depends on:** Phases 3A, 3B-magi, 3B-papai (all shipped). No new magi work.

---

## Motivation

The 3B-papai final review flagged two non-blocking observations:

1. **Redundant `host` field.** `mcpCatalogEntrySchema` stores `host` separately from `upstream_url` and validates only that `upstream_url` is https. Nothing enforces `host === new URL(upstream_url).hostname`. magi rejects a mismatch fail-closed at launch, so the impact today is a _confusing runtime failure_, not a security hole — but the field is pure footgun surface: the only thing a separate `host` can do is be wrong.

2. **`tool_policy` without `default_tool_policy`.** `catalogToolPolicy` falls back to `default: entry.default_tool_policy ?? 'allow'`. An operator who writes per-tool rules but omits the default silently gets **allow-all** for unlisted tools — inverting an intended allow-list ("agent may only read") into a deny-list ("agent may do everything"). More broadly, an entry with _no_ policy at all also resolves to allow-all, so "operator forgot to think about policy" fails **open**.

Both share a root cause: a posture that the operator did not state is silently resolved to the _most permissive_ interpretation.

---

## Decision 1 — derive `host` from `upstream_url` (drop the field)

There is no legitimate case where a catalog entry's `host` differs from its `upstream_url` hostname — magi requires them equal. So the separate field is removed and the hostname is derived.

**Schema (`src/coding-credentials/mcp-catalog.ts`):** remove `host` from `mcpCatalogEntrySchema`. An entry becomes `{ name, upstream_url (https), header?, default_tool_policy, tool_policy? }`. (Zod strips unknown keys by default, so a stale payload still carrying `host` is silently dropped, not rejected — acceptable pre-launch.)

**Resolver (`src/coding-credentials/resolve-agent-secrets.ts` `resolveMcp`):** derive the host once from the entry's URL:

```ts
const hostname = new URL(entry.upstream_url).hostname
return {
  url: entry.upstream_url,
  host: hostname,
  header: entry.header ?? 'Authorization',
  allowedHosts: [hostname],
  toolPolicy: catalogToolPolicy(entry),
}
```

`new URL(...)` cannot throw here because `upstream_url` already passed the schema's `z.url()` + https refine at write time. The mismatch class becomes **unrepresentable**. magi's `host === hostname` check stays as defense-in-depth but can never fire on well-formed papai output. `allowedHosts` remains a single-element list (`[hostname]`) — identical behavior to today; multi-host upstreams remain out of scope (a future explicit `extraAllowedHosts` field if ever needed — YAGNI now).

**Admin UI (`AdminMcpCatalogSection` + its entry row):** remove the `host` input. The client schema mirror (`client/settings/fetcher-schemas-mcp-catalog.ts` `AdminMcpCatalogEntrySchema`) drops `host` too.

---

## Decision 2 — `default_tool_policy` required on every entry (no blank state)

"No policy = allow-all" was a backward-compat launch default (gating was additive; a blank policy preserved the pre-gating "agent uses the whole server" behavior). It is not a considered security stance, and in a secure-by-default frame it is fail-open. We eliminate the blank state: **every catalog entry must declare its default posture.**

Three layers, each with one job:

### Layer 1 — schema (posture is mandatory)

`default_tool_policy` becomes **required** (was optional):

```ts
export const mcpCatalogEntrySchema = z.object({
  name: z.string().min(1),
  upstream_url: z.url().refine((url) => url.startsWith('https://'), { message: 'must be https' }),
  header: z.string().optional(),
  default_tool_policy: z.enum(['allow', 'ask', 'deny']), // required — no longer .optional()
  tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
})
```

The admin route (`POST /settings/api/admin/mcp-catalog`) validates via `mcpCatalogSchema`, so an entry missing `default_tool_policy` is rejected **422** server-side — the constraint is fail-closed, not UI-only. No conditional refine is needed (this is simpler than requiring-default-only-when-tools-present): the default is _always_ required.

### Layer 2 — code fallback (secure-by-default)

`catalogToolPolicy` (`resolve-agent-secrets.ts`) always returns an explicit policy now, and its fallback flips from `allow` to `deny`:

```ts
function catalogToolPolicy(entry: McpCatalogEntry): ToolPolicy {
  return { default: entry.default_tool_policy ?? 'deny', tools: entry.tool_policy }
}
```

Because Layer 1 guarantees `default_tool_policy` is present, the `?? 'deny'` is unreachable belt-and-suspenders — but if the type is ever widened or validation bypassed, unlisted tools **deny**, never allow. The return type narrows from `ToolPolicy | undefined` to `ToolPolicy` (a configured entry always carries a posture). `resolveMcp` therefore always sets `toolPolicy` on a resolved config; magi's "absent toolPolicy → allow-all" path is now only reachable when _no MCP server is configured at all_ (correct — nothing to gate).

### Layer 3 — UI clarity (nothing is silent)

In `AdminMcpCatalogSection` / the entry-row subcomponent:

- The `default_tool_policy` `<select>` is **always visible** and **required** (no empty option). When the operator adds a _new_ entry it **pre-selects `deny`** (secure starting point); the operator consciously flips it to `allow` for a fully-trusted server. Save is disabled with an inline message if it is somehow unset.
- A **live plain-language posture summary** renders the actual effect of `default_tool_policy` + `tool_policy` together, so the resulting access is unmistakable regardless of pattern. Reference copy (final wording nailed in the plan):
  - `allow`, no exceptions → _"Sandbox may call **all** tools on this server."_
  - `allow` + N `deny` exceptions → _"Sandbox may call **all** tools **except** these N: a, b."_
  - `deny` + N `allow` exceptions → _"Sandbox may call **only** these N: a, b — all others blocked."_
  - `deny`, no exceptions → _"⚠ Sandbox may call **no** tools on this server."_ (likely misconfiguration — surfaced, not blocked)
  - `ask` involved → summarize generically: _"Unlisted tools: **ask** (confirm each call). Exceptions: a = allow, b = deny."_

The four stories the model must serve:

| Story             | Intent                           | Config                                                        | Posture summary          |
| ----------------- | -------------------------------- | ------------------------------------------------------------- | ------------------------ |
| Trusted server    | agent may use anything           | `default: allow`                                              | "all tools"              |
| Deny-list         | all but a few dangerous          | `default: allow`, `tool_policy: {delete_repo: deny}`          | "all except delete_repo" |
| Allow-list        | only a few safe                  | `default: deny`, `tool_policy: {search: allow}`               | "only search"            |
| (was the footgun) | meant allow-list, forgot default | — **unrepresentable**: save blocked until a default is chosen | —                        |

---

## Data flow (after)

```
operator (admin UI, posture required + pre-filled deny + live summary)
  → mcp_catalog entry { name, upstream_url, header?, default_tool_policy, tool_policy? }   [Layer 1: 422 if default missing]
  → user selects server (vault { server, upstream_token })
  → resolveMcp: host = new URL(upstream_url).hostname; allowedHosts = [host]; toolPolicy = { default, tools }   [always present]
  → projectSpec.mcp { url, host, header, allowedHosts, toolPolicy }
  → magi validates + enforces (host===hostname now always passes; per-tool gate fail-closed)
```

Every fail-closed property of 3B-papai is preserved (unknown/absent `server` → `null`; unscoped pi → `null`; the gate itself denies `tools/call` for anything the policy denies, rejects batch arrays, and is prototype-lookup-safe). This change only _removes representable-but-wrong_ operator inputs and tightens the default direction.

---

## Breaking changes / migration

- **Catalog schema is a breaking change** to the `mcp_catalog` admin config shape: `host` removed; `default_tool_policy` now required. Pre-launch, nothing is deployed, so there is **no migration** — any dev-only catalog entries must be re-saved through the updated admin UI (a stored blob that fails the new schema degrades to `[]` via the existing `safeParse`-to-empty path in `resolveMcpCatalog`, i.e. fail-closed to "no catalog", never fail-open).
- No change to the user `mcp` vault shape (`{ server, upstream_token }`), to `CodingMcpSection` (it never edited policy or host), or to any magi interface.

---

## Components touched (papai)

| File                                                                                    | Change                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/coding-credentials/mcp-catalog.ts`                                                 | schema: drop `host`; `default_tool_policy` required                                                                                                                                                                                                                 |
| `src/coding-credentials/resolve-agent-secrets.ts`                                       | `resolveMcp` derives host from `upstream_url`; `catalogToolPolicy` returns non-optional `ToolPolicy` with `?? 'deny'`                                                                                                                                               |
| `client/settings/fetcher-schemas-mcp-catalog.ts`                                        | client `AdminMcpCatalogEntrySchema` mirror: drop `host`, require `default_tool_policy`                                                                                                                                                                              |
| `client/settings/sections/admin/AdminMcpCatalogSection.svelte` + entry-row subcomponent | remove host input; default-policy select always-visible/required/pre-fill `deny`; live posture summary                                                                                                                                                              |
| `client/settings/sections/admin/AdminMcpCatalogSection.stories.svelte` + MSW handlers   | update fixtures to new shape (no host, explicit default); add a posture-summary story variant                                                                                                                                                                       |
| tests                                                                                   | `mcp-catalog.test.ts` (schema: host-absent, default-required, 422); `resolve-agent-secrets.test.ts` (host derivation, always-present toolPolicy, `deny` fallback); admin route test (422 on missing default); admin visual spec (posture summary + required select) |

## Non-goals

- No change to magi (validation/enforcement already correct).
- No `extraAllowedHosts` / multi-host upstream support (YAGNI).
- No interactive `'ask'` round-trip (still a separate documented follow-up; `'ask'` remains allow-with-warn in the mediator).

## Testing

- **Schema:** an entry with a `host` key is accepted but the key is stripped; an entry missing `default_tool_policy` fails `safeParse`; `mcpCatalogSchema` round-trips the new shape.
- **Route:** `POST` with an entry missing `default_tool_policy` → 422; a valid new-shape entry persists and GET reflects it.
- **Resolver:** `resolveMcp` returns `host` = the URL hostname (not any stored value) and `allowedHosts: [hostname]`; `toolPolicy` is always present with the entry's `default`; a (type-bypass) entry without a default resolves `default: 'deny'`.
- **UI (visual):** the default-policy select is required and pre-filled `deny` on a new row; the posture summary renders each of the four/five cases; the host input is gone.
- **Full-chain E2E** (operator posture → user pick → worker → denied tool blocked) remains the Linux handoff.
