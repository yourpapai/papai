<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0271: MCP Catalog Hardening

## Status

Implemented (with divergence)

## Date

2026-07-08

## Context

The Phase 3B-papai final security review surfaced two non-blocking operator-config footguns in the MCP catalog, both rooted in a posture the operator never explicitly stated being silently resolved to the *most permissive* interpretation:

1. **Redundant `host` field.** `mcpCatalogEntrySchema` stored `host` separately from `upstream_url` and validated only that `upstream_url` was https. Nothing enforced `host === new URL(upstream_url).hostname`. magi rejects a mismatch fail-closed at launch, so the impact was a confusing runtime failure, not a security hole — but the field was pure footgun surface: the only thing a separate `host` could do was be wrong.
2. **`tool_policy` without `default_tool_policy`.** `catalogToolPolicy` fell back to `default: entry.default_tool_policy ?? 'allow'`. An operator who wrote per-tool rules but omitted the default silently got **allow-all** for unlisted tools — inverting an intended allow-list ("agent may only read") into a deny-list ("agent may do everything"). An entry with *no* policy at all also resolved to allow-all, so "operator forgot to think about policy" failed **open**.

The design (`docs/superpowers/specs/2026-07-08-mcp-catalog-hardening-design.md`) and plan (`docs/superpowers/plans/2026-07-08-mcp-catalog-hardening.md`) closed both via defense-in-depth + operator clarity: (1) drop `host` and derive it from `upstream_url`, making the mismatch class unrepresentable; (2) make `default_tool_policy` required on every entry (422 server-side), flip the code fallback to `deny`, and make the admin UI always-visible / `deny`-pre-filled with a live plain-language posture summary. Scope is papai-only; magi is unchanged (it already validates/enforces `projectSpec.mcp.toolPolicy` and `host === url.hostname`).

## Decision Drivers

- **Eliminate representable-but-wrong operator inputs.** The mismatch class (`host ≠ upstream_url.hostname`) must become unconstructable, not merely detected downstream.
- **Fail closed on an unspoken posture.** "No policy" must never resolve to allow-all; unlisted tools deny by default, and the operator must consciously choose `allow`.
- **The constraint must be server-side, not UI-only.** A missing `default_tool_policy` is rejected at the admin POST route (422), so the catalog cannot be written into an over-permissive posture even via a non-UI client.
- **Make the resulting access unmistakable.** Regardless of allow-list vs deny-list pattern, the UI renders the *actual effect* of `default_tool_policy` + `tool_policy` as a plain-language sentence.
- **Secure starting point.** A new entry pre-selects `deny`; the operator consciously opens it up.
- **No ripple into plugin-context type mirrors.** `ResolvedMcp*.toolPolicy` stays optional-typed but is simply always populated now.
- **Additive-only where possible; pre-launch = no migration.** Nothing is deployed; a stored blob failing the new schema degrades to `[]` (fail-closed to "no catalog") via the existing `safeParse`-to-empty path.

## Considered Options

### Option 1 — derive `host`; require `default_tool_policy`; `?? 'deny'` fallback; live posture summary (chosen)

Drop `host` from the schema (Zod strips unknown keys, so stale payloads carrying `host` are silently dropped); derive `host`/`allowedHosts` from `new URL(upstream_url).hostname` in the resolver. Make `default_tool_policy` a required `z.enum`; flip `catalogToolPolicy`'s `?? 'allow'` to `?? 'deny'` (unreachable belt-and-suspenders). Admin UI removes the host input, drops the "Unset" option, pre-fills `deny`, and renders a `$derived` posture sentence.

- **Pros:** removes the mismatch class entirely; fail-closed at schema, code, and UI layers; posture is always visible; the deny fallback makes even a hypothetical type-bypass safe.
- **Cons:** schema is a breaking change to the `mcp_catalog` config shape (acceptable pre-launch); adds a posture helper + its tests and a new UI element.

### Option 2 — Enforce `host === hostname` via a schema refine; keep both fields

Leave `host` in the schema, add `z.refine` asserting `host === new URL(upstream_url).hostname`.

- **Pros:** no field removal; existing payloads keep round-tripping.
- **Cons:** keeps the footgun surface; the field can still be wrong and must be validated every write; rejects (rather than silently corrects) stale payloads; the redundant field has no legitimate use case (magi requires equality), so it is pure complexity for zero capability.

### Option 3 — UI-only: pre-fill `deny`, require non-empty in the form, leave the schema optional

Make `default_tool_policy` effectively mandatory only in the admin UI; keep the schema optional and the code `?? 'allow'`.

- **Pros:** no schema/route change; smallest diff.
- **Cons:** rejects the server-side driver — a non-UI client (script, manual `setMcpCatalog`) could still write a policy-less entry that resolves allow-all; "forgot to think about policy" would still fail open at the enforcement boundary; the constraint would be advisory, not structural.

## Decision

The chosen Option 1 shipped across the backend schema/resolver, the admin POST route, the client schema mirror, the admin UI row/section, the posture helper + its tests, the MSW fixtures, and the docs. What shipped:

1. **Schema: `host` dropped, `default_tool_policy` required** (`src/coding-credentials/mcp-catalog.ts`). `mcpCatalogEntrySchema` is `{ name, upstream_url (https refine), header?, default_tool_policy: z.enum(['allow','ask','deny']), tool_policy? }`; Zod strips the unknown `host` key.
2. **Resolver derives host** (`src/coding-credentials/resolve-mcp-servers.ts`). For an external catalog server, `hostname = new URL(entry.upstream_url).hostname` and `allowedHosts: [hostname]`; `header` defaults to `'Authorization'`. The mismatch class is unrepresentable.
3. **`catalogToolPolicy` returns non-optional `ToolPolicy` with `?? 'deny'`.** The return type narrows from `ToolPolicy | undefined` to `ToolPolicy`; the `?? 'deny'` is unreachable belt-and-suspenders (the schema guarantees a default), but if validation is ever bypassed, unlisted tools deny.
4. **Server-side 422.** The admin POST route (`src/debug/settings/admin/mcp-catalog-routes.ts`) validates the body via `mcpCatalogSchema`; an entry missing `default_tool_policy` fails `safeParse` → 422.
5. **Client schema mirror dropped `host`, required default** (`client/settings/fetcher-schemas-mcp-catalog.ts`).
6. **Admin UI: host input gone; default always present; `deny` pre-fill** (`AdminMcpCatalogEntryRow.svelte` + `AdminMcpCatalogSection.svelte`). `emptyDraftEntry()` returns `default_tool_policy: 'deny'`; the default-policy `<select>` has no "Unset" option (structural required); `toDraft`/`toEntry` carry no `host` and always set the default.
7. **Live plain-language posture summary** (`client/settings/sections/admin/mcp-posture.ts` `describeMcpPosture`). A `$derived` `<p>` under the per-tool policy block renders the actual effect for every entry.
8. **Posture unit tests** (`tests/client/settings/sections/admin/mcp-posture.test.ts`): allow/deny/ask + empty + blank-name cases.
9. **Schema/route tests:** host-less round-trip, non-https reject, missing-default reject, host-key-strip, and a 422-on-missing-default route test (`tests/coding-credentials/mcp-catalog.test.ts`, `tests/debug/settings/admin/mcp-catalog-routes.test.ts`).
10. **Resolver tests** (`tests/coding-credentials/resolve-mcp-servers.test.ts`) verify host/`allowedHosts` are derived from `upstream_url` (not any stored value), `header` defaults to `Authorization`, and `toolPolicy.default` is always present from the catalog entry.
11. **MSW fixtures + stories:** the `populated` fixture carries both a deny-list entry (`allow` + `delete_repo: deny`) and an allow-list entry (`deny` + `search`/`get_issue: allow`) so both posture strings render.
12. **Docs** (`docs/architecture/coding-sessions.md`): catalog entry shape updated (host dropped, default required, 422, `deny` fallback, live posture summary, `deny` pre-fill).

## Consequences

### Positive

- An operator can no longer construct a catalog entry where `host` disagrees with `upstream_url` — the field is gone and the hostname is derived, so the class of confusing magi launch-time rejection is eliminated at its source.
- "No policy = allow-all" is gone at three layers: schema (422), code (`?? 'deny'`), and UI (no Unset, `deny` pre-fill). Forgetting to think about policy now fails closed.
- The live posture summary makes an allow-list vs deny-list indistinguishable-by-glance posture unambiguous, surfacing the likely-misconfiguration case (deny + no exceptions → "⚠ No tools allowed on this server.") without blocking it.
- The changes are structurally additive to security posture without touching magi, the user `mcp` vault shape, or `CodingMcpSection`.

### Negative

- Breaking change to the `mcp_catalog` config shape (`host` removed, `default_tool_policy` required). Pre-launch this needs no migration; any dev-only entry must be re-saved through the updated admin UI.
- The schema also carries a name charset/reserved-prefix refine shipped alongside this work but out of this plan's scope — a stored entry with a now-invalid name degrades to `[]`.
- The docs still reference the pre-refactor file path for `resolveMcp` (see Implementation Notes) — accurate in intent, stale in location.

### Risks

- **`?? 'deny'` is unreachable through the public API.** If a future change widens `default_tool_policy` back to optional or bypasses `resolveMcpCatalog`'s `safeParse`, the deny fallback is the only backstop; there is no dedicated test for the unreachable branch (by design — it cannot be reached).
- **Posture wording tracks current `ask` semantics.** `describeMcpPosture` renders `ask` as "flagged for review" / "allowed but flagged," matching the mediator's current allow-with-warn treatment of `ask`. If a true interactive `ask` round-trip ships later, the wording must be revisited so the summary does not overstate gating.
- **Single-element `allowedHosts`.** Multi-host upstreams remain unsupported (`allowedHosts` is `[hostname]`); a future `extraAllowedHosts` field would be additive but is YAGNI now.

## Related Decisions

- **Phase 3B-papai** — shipped the catalog model, the per-tool gate, and the fail-closed resolver this hardens. The host-derivation makes magi's `host === hostname` check a defense-in-depth no-op on well-formed papai output.
- **The `'ask'` allow-with-warn mediator behavior** (`docs/architecture/coding-sessions.md`) — constrains the posture summary's wording; true interactive `ask` is a documented future feature.
- **The `resolve-mcp-servers.ts` refactor** — the single-server `resolveMcp` was folded into a fail-closed set resolver `resolveMcpServers` + private `resolveOneMcpServer`; this plan's host-derivation and policy work landed inside that module.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/mcp-catalog.ts:14-28` | `mcpCatalogEntrySchema` — no `host`; `default_tool_policy: z.enum(['allow','ask','deny'])` (required); `upstream_url` https refine. | `read` confirms. |
| `src/coding-credentials/mcp-catalog.ts:41-42` | `resolveMcpCatalog` `safeParse` → `[]` on schema failure (fail-closed to "no catalog"). | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:37-39` | `catalogToolPolicy` returns non-optional `ToolPolicy`, `?? 'deny'` fallback. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:74-87` | External catalog server: `hostname = new URL(entry.upstream_url).hostname`; `host`/`allowedHosts: [hostname]`; `header ?? 'Authorization'`; `toolPolicy: catalogToolPolicy(entry)`. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:32` | `ResolvedMcpServer.toolPolicy?: ToolPolicy` stays optional-typed (no plugin-mirror ripple) but is always populated. | `read` confirms. |
| `src/debug/settings/admin/mcp-catalog-routes.ts:16` | `PostBodySchema` validates `entries` via `mcpCatalogSchema` (missing default → safeParse fail). |
| `src/debug/settings/admin/mcp-catalog-routes.ts:36-37` | `body.success` false → `settingsJson(422, ...)` — server-side required constraint. | `read` confirms. |
| `client/settings/fetcher-schemas-mcp-catalog.ts:10-16` | `AdminMcpCatalogEntrySchema` mirror — `host` dropped; `default_tool_policy: ToolPolicySchema` (required). | `read` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte:12-18` | `DraftMcpCatalogEntry` — no `host`; `default_tool_policy: 'allow'\|'ask'\|'deny'`. | `read` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte:20-22` | `emptyDraftEntry()` pre-fills `default_tool_policy: 'deny'`. | `read` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte:87-100` | Default-policy `<select>` with no "Unset" option (`{#each POLICIES}`); host input absent. | `read` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte:28,39,144` | `describeMcpPosture` import; `posture = $derived(...)`; posture `<p>` rendered with `data-testid`. | `read` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogSection.svelte:26-51` | `toDraft`/`toEntry` — no `host`; `default_tool_policy` always set (no conditional). | `read` confirms. |
| `client/settings/sections/admin/mcp-posture.ts:16-41` | `describeMcpPosture` — allow/deny/ask branches; blank-name filtering via `named()`. | `read` confirms. |
| `tests/coding-credentials/mcp-catalog.test.ts:27-34` | Host-less round-trip (`no host field, default required`). | `read` confirms. |
| `tests/coding-credentials/mcp-catalog.test.ts:50-58` | Non-https reject + missing-`default_tool_policy` reject. | `read` confirms. |
| `tests/coding-credentials/mcp-catalog.test.ts:85-91` | `strips an unknown host key` (Zod drops stale `host`). | `read` confirms. |
| `tests/debug/settings/admin/mcp-catalog-routes.test.ts:16-26` | `CatalogResponseSchema` — no `host`, `default_tool_policy` required. | `read` confirms. |
| `tests/debug/settings/admin/mcp-catalog-routes.test.ts:135-144` | `POST with an entry missing default_tool_policy returns 422`. | `read` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:96-116` | Host/`allowedHosts` derived from catalog `upstream_url`; `header` defaults to `Authorization`; `toolPolicy.default` present from entry. | `read` confirms. |
| `tests/client/settings/sections/admin/mcp-posture.test.ts:11-42` | 7 posture cases (allow/deny/ask + empty + blank-name + ask-exception-in-allow). | `read` confirms. |
| `client/stories/msw/settings-handlers-admin-2.ts:74-87` | Fixture drops `host`; deny-list entry (`allow`+`delete_repo:deny`) **and** allow-list entry (`deny`+`search`/`get_issue:allow`) — both posture patterns visible. | `read` confirms. |
| `docs/architecture/coding-sessions.md:40` | Catalog shape documented (host not stored/derived; default required + 422; `deny` fallback; UI no-Unset/`deny`-prefill/posture summary). | `grep` confirms. |
| `docs/architecture/coding-stack-overview.md:232-233` | Companion doc also updated: entry shape + "host/allowedHosts derived … mismatch can't exist". | `grep` confirms. |

Plan-vs-implementation notes:

- **The resolver moved files and was reshaped.** The plan edited `resolve-agent-secrets.ts` (`resolveMcp` + `catalogToolPolicy`). Shipped: MCP resolution lives in a dedicated `src/coding-credentials/resolve-mcp-servers.ts`; `catalogToolPolicy` is there (lines 37-39) and the single-server logic is the private `resolveOneMcpServer` (lines 46-88) consumed by a public fail-closed set resolver `resolveMcpServers` (lines 99-137). `resolve-agent-secrets.ts:16-17` now only carries a pointer comment. Intent (host derivation + `?? 'deny'` + always-present `toolPolicy`) is preserved verbatim; the surrounding refactor (internal plugin servers, `maxMcpServers` cap, duplicate/malformed-selection fail-closed) is concurrent WIP outside this plan.
- **The resolver tests moved with the code.** The plan edited `tests/coding-credentials/resolve-agent-secrets.test.ts:191-258`; shipped, the MCP tests live in `tests/coding-credentials/resolve-mcp-servers.test.ts`, and `resolve-agent-secrets.test.ts:188-189` just carries a pointer comment. The host-derivation + always-present-`toolPolicy` assertions are present (lines 110-116) inside the mixed-set test rather than as the plan's standalone `resolveMcp` tests, because there is no longer a single-server public `resolveMcp`.
- **Posture wording diverged to match real `ask` semantics.** The plan's helper emitted `ask first:` and `Every tool call must be confirmed (ask).` Shipped emits `flagged:` (allow/deny branches) and `Every tool call is allowed but flagged for review (ask).` — accurate to the mediator's current allow-with-warn treatment of `ask` (a documented non-goal: no interactive `ask` round-trip yet). The test was updated to assert the shipped strings.
- **The posture test lives under `tests/client/…`, not `tests/coding-credentials/…`.** The plan explicitly allowed adjusting the folder to match a sibling client-helper test; it shipped at `tests/client/settings/sections/admin/mcp-posture.test.ts` and gained a seventh case (`allow` + an `ask` exception → `flagged`) beyond the plan's six.
- **No dedicated "posture" Storybook story variant.** The plan envisioned a separate posture story + interaction shots. Shipped folds both posture patterns into the existing `Populated` fixture (a second `adminMcpCatalogEntryAllowList` entry was added) so the Populated story shows both sentences; the visual spec (`AdminMcpCatalogSection.spec.ts`) story count is unchanged (Populated/Empty/Error/Loading).
- **Schema name hardening shipped alongside but is out of scope.** `mcpCatalogEntrySchema` also carries a name charset regex + reserved-`plugin:`-prefix refine and two extra schema tests (`mcp-catalog.test.ts:60-83`) that are concurrent hardening, not this plan's host/policy work.
- **Docs updated in a second file.** The plan named only `docs/architecture/coding-sessions.md`; `docs/architecture/coding-stack-overview.md:232-233` was also updated to the new shape. Residual staleness: `coding-sessions.md:40` still says `resolveMcp`/`resolveMcpToken` live in `resolve-agent-secrets.ts` (they moved to `resolve-mcp-servers.ts`); the hardening description itself is accurate.

The source plan `docs/superpowers/plans/2026-07-08-mcp-catalog-hardening.md` and design `docs/superpowers/specs/2026-07-08-mcp-catalog-hardening-design.md` are archived alongside this ADR to `docs/archive/`.
