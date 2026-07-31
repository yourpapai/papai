<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0276: Sandbox MCP Broker — Phase 3b (papai: Catalog UI, Vault, Gating)

## Status

Implemented (with divergence)

## Date

2026-07-08

## Context

ADR-0274 shipped **Phase 3A** — the papai-side per-identity MCP vault and the operator-curated catalog skeleton — but with an **interim freeform vault** (`upstream_url`/`upstream_header`/token) as a stepping stone, and ADR-0275 shipped the **magi-side half of Phase 3B** (the per-tool gate enforced inside the `magi-main` mediator). This ADR's source plan (`docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3b-papai.md`) is the **papai-side half of Phase 3B**: make MCP-server access **operator-curated, user-selected** — an admin publishes a vetted catalog of MCP servers, a user picks an entry in their own "Coding MCP servers" settings section (URL/host/header/tool-policy come from the catalog, not the user), supplies only their own credential, and a catalog-authoritative resolver derives what a session actually gets. The resolver is fail-closed: a stale or removed catalog entry resolves to nothing, and the per-server `toolPolicy` the catalog defines flows into `projectSpec.mcp` and is enforced by the magi mediator (ADR-0275).

The plan scoped this as a **single-server** model: the `mcp` vault stores `{ server, upstream_token }`; `resolveMcp` returns one `{ url, host, header, allowedHosts, toolPolicy } | null`; `projectSpec.mcp` is that one object carrying `toolPolicy`; the catalog entry is `{ name, upstream_url, host, header?, default_tool_policy?, tool_policy? }`. It explicitly named the concurrent orchestrator `McpSection`/`mcp_endpoints` WIP and required the new user section to be named `CodingMcpSection` and left the orchestrator files untouched.

The shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D"; §3 tiered trust, §5.5 catalog + section + gating, §9 ownership) is the spec. **Depends on Phase 3B-magi** (`toolPolicy` on `ProjectSpec.mcp`, validated + enforced in magi — ADR-0275), which landed the multi-server generalization (`ProjectSpec.mcp[]`, each entry with its own `toolPolicy`); this plan populates that array from the papai side.

## Decision Drivers

- **Tiered trust, no self-serve arbitrary upstream.** A user may never enter an arbitrary upstream URL; they pick a vetted catalog entry and supply only a credential. The operator both vets which servers exist and sets the per-tool policy for each (spec §3, §9).
- **The catalog is authoritative; no drift.** URL/host/header/toolPolicy are derived from the operator's *current* catalog at resolve time, never read from the user's vault, so a session can never get a URL/host the operator did not intend or a policy the operator has since tightened.
- **Fail closed on a stale/removed selection.** A `server` no longer in the catalog (or disabled/removed) contributes nothing — the resolver returns a structured error naming the offender rather than silently dropping one entry of a multi-server set.
- **`toolPolicy` is populated end-to-end by the catalog.** The operator's `default_tool_policy`/`tool_policy` become the per-entry `toolPolicy` on `projectSpec.mcp`, enforced by the magi mediator (ADR-0275) — the user cannot self-grant tool access.
- **Naming distinct from the orchestrator.** The new user section is `CodingMcpSection` ("Coding MCP servers"), never confused with the unrelated orchestrator `McpSection`/`mcp_endpoints` feature (`src/mcp/`).
- **Pre-launch breaking change to the 3A vault is acceptable.** Nothing is deployed; the interim freeform vault is replaced, not migrated.
- **(Evolved beyond the plan) Multi-server, not single.** A session may select several vetted servers behind one mediator, bounded by an operator `maxMcpServers` guardrail — the multi-server shape the magi side (ADR-0275) already launches and gates per-entry.
- **(Evolved beyond the plan) First-party plugins as MCP upstreams.** An operator may expose an internal `plugin:`-prefixed papai-hosted plugin as another selectable upstream, reusing the same broker/gate infrastructure with no external server to vet and no user credential to supply.

## Considered Options

### Option 1 — operator catalog + user selection + catalog-authoritative fail-closed resolver; `toolPolicy` in `projectSpec.mcp` (chosen)

An admin `mcp_catalog` config (mirroring the `coding_guardrails` admin idiom) lists vetted entries; the `mcp` vault stores only the user's selection + credential; `resolveMcpServers`/`resolveMcpTokens` look the selection up in the *current* catalog and derive `{ url, host, header, allowedHosts, toolPolicy }`; the resolver is fail-closed all-or-nothing; `projectSpec.mcp` carries the resolved `McpUpstream[]` (each with its own `toolPolicy`) and `mcpTokens` rides as a separate per-server map.

- **Pros:** realizes tiered trust; the catalog is the single source of truth (no drift, no host/URL mismatch); fail-closed prevents a stale selection reaching a credential; per-entry `toolPolicy` flows straight into the magi gate; the multi-server + internal-plugin generalization reuses one resolver and one broker path.
- **Cons:** substantial divergence from the plan's single-server shape (see Consequences); the all-or-nothing fail-closed means one bad selection disables all MCP for the session; the catalog + plugin-server + per-context eligibility surfaces make the GET response and the user section more complex than the plan's single `<select>`.

### Option 2 — keep 3A's interim freeform `upstream_url` vault

Leave the user-entered arbitrary upstream URL; only add `toolPolicy` somewhere.

- **Pros:** smaller diff; no second vault-shape break.
- **Cons:** rejects the tiered-trust driver — an arbitrary upstream URL is exactly the self-serve footgun the catalog removes; the host/URL mismatch class stays representable (magi rejects it fail-closed at launch, a confusing runtime failure later made unconstructable by ADR-0271); no central vetting and no operator-set per-server policy.

### Option 3 — the literal single-server plan (no multi-server, no internal plugin servers)

Implement exactly `{ server, upstream_token }`, singular `resolveMcp`/`resolveMcpToken`, and a single `projectSpec.mcp` object.

- **Pros:** the smallest realization of the plan; one upstream, one policy, one token.
- **Cons:** cannot satisfy the multi-server requirement that emerged across 3A/3B (the magi apparatus already launches and gates N upstreams per session — ADR-0275:173); leaves no place for first-party plugin MCP upstreams; the single-`server` vault field would have to be re-restructured again to go multi-server.

## Decision

The chosen Option 1 shipped in full across all seven plan tasks, but in the evolved multi-server + internal-plugin shape rather than the plan's literal single-server shape. What shipped:

1. **Operator `mcp_catalog` config (`src/coding-credentials/mcp-catalog.ts`).** `mcpCatalogEntrySchema` = `{ name (charset-validated, not `plugin:`-prefixed), upstream_url (https), header?, default_tool_policy (required), tool_policy? }`; `mcpCatalogSchema`; `resolveMcpCatalog(pi)` degrades to `[]` on missing/invalid (fail-open to empty); `setMcpCatalog(pi, entries)`; `adminMcpCatalogContextId(pi)` under `__admin_mcp_catalog__:<pi>`. (No `host` field and required `default_tool_policy` are the ADR-0271 hardening, layered onto this plan's schema.)
2. **Admin catalog route (`src/debug/settings/admin/mcp-catalog-routes.ts`).** `GET/POST /settings/api/admin/mcp-catalog` mirroring the guardrails route: `requireAdmin('read'/'write')`, `requireCsrf` on POST, `PostBodySchema = { kind: 'catalog', entries }`, `setMcpCatalog` + `log.info`; registered in `src/debug/settings-api-router.ts`.
3. **`AdminMcpCatalogSection.svelte` + `AdminMcpCatalogEntryRow.svelte`.** Operator CRUD over catalog entries, with a live plain-language posture summary per entry (ADR-0271); fetchers in `client/settings/admin-fetchers.ts`; registered in `SettingsApp.svelte`.
4. **`mcp` vault restructured to a selection.** `MCP_FIELDS = ['servers']` (a single JSON field holding a `[{ server, upstream_token? }]` array), `REQUIRED_MCP_FIELDS = []`; field meta renders it as one sensitive `servers` field; the GET `coding-credentials?namespace=mcp` response surfaces `catalog`, `pluginServers`, `maxMcpServers`, and a token-redacted `selections` list (`{ server, hasToken }`, never the token value).
5. **Selection serialization + token-preserving merge (`src/coding-credentials/mcp-selections.ts`).** `codingMcpSelectionsSchema`, `serializeMcpSelections`/`parseMcpSelections`/`hasMalformedMcpSelections`, and `mergeMcpTokens` — a PATCH to `servers` carries forward a kept external row's stored token (the client never receives tokens back) and never persists a token for `plugin:`-prefixed internal rows.
6. **Catalog-authoritative, fail-closed resolver (`src/coding-credentials/resolve-mcp-servers.ts`).** `resolveMcpServers(ctx)` returns a discriminated `{ ok, servers: ResolvedMcpServer[] } | { ok:false, error }`; it parses the vault selection, enforces the `maxMcpServers` guardrail, rejects duplicates, and resolves each entry against the *current* catalog (external) or enabled internal plugin servers — deriving `{ url, host (from upstream_url), header, allowedHosts, toolPolicy }` from the catalog, never the vault. Any unresolvable/missing-token/over-cap/duplicate selection fails the whole call closed with an error naming the offender. `resolveMcpTokens(ctx)` is derived strictly from the validated set (never independently re-parses the vault): external servers use their vault token; internal `plugin:` servers get a signed binding token minted by papai.
7. **`projectSpec.mcp: McpUpstream[]` + `mcpTokens` (`plugins/acp/tools.ts`).** `McpUpstream` carries an optional per-entry `toolPolicy`; `buildSessionProjectSpec(..., mcpServers)` emits `projectSpec.mcp = mcpServers` (omitted when empty) and the session/continue tools attach `mcpTokens` (per-server map) as a separate top-level body field, omitted when empty.
8. **`CodingMcpSection.svelte` — the user "Coding MCP servers" section.** Multi-row: each row is a `<select>` populated from `catalog` + `pluginServers` (the `serverOptions`), with a credential field shown only for external rows (with a "blank keeps the stored credential" affordance for rows that already had one), an `atCap`/`hasEmptyServer`-gated Save, a Clear behind a danger confirm, and a "No MCP servers available — ask your operator." placeholder. Registered in `SettingsApp.svelte` distinct from the orchestrator `McpSection`.
9. **Internal plugin MCP servers (scope added beyond the plan).** `src/coding-credentials/mcp-plugin-servers.ts` (`INTERNAL_SERVER_PREFIX = 'plugin:'`, `mcpPluginServerConfigSchema`, `listEnabledInternalMcpServers` — operator-enabled AND plugin active+eligible AND `SETTINGS_PUBLIC_BASE_URL` set); an admin route (`mcp-plugin-servers-routes.ts`) + `AdminMcpPluginServersSection.svelte`; the `/mcp/plugin/<pluginId>` route; and signed token mint/verify (`src/mcp-server/token.ts`). An internal selection stores `server = 'plugin:<id>'` with no credential.
10. **`maxMcpServers` guardrail.** New field on `guardrailsSchema` (`z.number().int().min(1).max(8).default(3)`), enforced both at the PATCH route (422) and inside `resolveMcpServers` (fail-closed).
11. **Docs (`docs/architecture/coding-sessions.md`).** The MCP-broker section documents the operator-curated catalog + user-selection model, fail-closed resolution, and the first-party plugin upstream.

## Consequences

### Positive

- MCP-server access is tiered-trust: a user picks a vetted entry and supplies only a credential — there is no path to an arbitrary upstream URL or a self-granted tool permission.
- The catalog is the single source of truth: URL/host/header/toolPolicy are derived at resolve time from the operator's *current* catalog, so a session can never drift from what the operator intends; the host/URL mismatch class is unconstructable (host is derived from `upstream_url`).
- Fail-closed all-or-nothing resolution means a removed/renamed/disabled server, a missing credential, a duplicate, or an over-cap selection disables MCP for the session with a named error rather than silently reaching a stale upstream or spending a credential on a denied tool.
- Per-entry `toolPolicy` flows end-to-end from the operator catalog into `projectSpec.mcp`, enforced by the magi mediator (ADR-0275) — the operator vets servers *and* sets per-tool policy.
- Internal `plugin:` servers reuse the entire broker + gate infrastructure with no external server to vet and no user credential to manage; papai mints a signed binding token at resolve time.
- `resolveMcpTokens` derives strictly from the validated set, so it can never emit a token for a server outside the fail-closed-validated selection.
- The token-preserving merge lets a user edit one row of a multi-server selection without re-entering the other rows' credentials (the client never receives token values back).

### Negative

- The implementation diverged substantially from the single-server plan: the vault became a single `servers` JSON array field (not two fields `server`/`upstream_token`), the resolvers are plural in a new file (`resolve-mcp-servers.ts`, not `resolveMcp`/`resolveMcpToken` in `resolve-agent-secrets.ts`), and `projectSpec.mcp` is an array with a separate `mcpTokens` map (not one object with `toolPolicy`). This is the second vault-shape break after 3A.
- Scope grew beyond the plan: internal plugin servers, the `maxMcpServers` guardrail, token-preserving merge, and the ADR-0271 catalog hardening all landed alongside the plan's tasks.
- The all-or-nothing fail-closed is coarse: one stale selection disables *all* MCP for the session (by design — a partial set could leak which servers are configured — but unforgiving for a user with one expired credential among several valid servers).
- The `coding-sessions.md` update (Task 7) shipped describing the *plan's* single-server model (vault `{ server, upstream_token }`, singular `resolveMcp`/`resolveMcpToken` in `resolve-agent-secrets.ts`, "never several — multi-server multiplexing is future work"), which no longer matches the shipped multi-server code.

### Risks

- **Coarse fail-closed blast radius.** A single unresolvable selection voids the whole MCP set; operators with large catalogs should communicate that users must keep their selections current.
- **Internal-server token TTL vs. live exposure.** A minted `plugin:` token has a 30-day signature, but disabling a plugin server must take effect immediately — the redemption path re-checks exposure on every request (`isExposedInternalServer`), so the exposure check (not the TTL) gates a live request. Any future change must preserve that re-check.
- **`plugin:` namespace reservation.** The catalog schema rejects `plugin:`-prefixed names and `mergeMcpTokens` strips tokens from `plugin:` rows; a future catalog feature must not collide with this prefix.
- **Concurrent-`McpSection` confusion.** Both `CodingMcpSection` (this plan) and the orchestrator `McpSection` (`mcp_endpoints`) are registered in `SettingsApp.svelte`; they are unrelated features and must not be conflated in future edits.
- **Docs drift.** The stale single-server paragraph in `coding-sessions.md` could mislead a future reader; it should be rewritten to the multi-server + plugin-server reality.

## Related Decisions

- **ADR-0274: Sandbox MCP Broker — Phase 3A** — shipped the interim freeform vault + catalog skeleton this plan replaces/extends; co-owns the multi-server vault shape.
- **ADR-0275: Sandbox MCP Broker — Phase 3b (magi)** — the magi-side half of Phase 3B; validates + enforces the per-entry `toolPolicy` this plan populates, and already launches/gates the multi-server `ProjectSpec.mcp[]` shape.
- **ADR-0271: MCP Catalog Hardening** — layered the `host` removal + required `default_tool_policy` + `?? 'deny'` fallback + live posture summary onto this plan's catalog schema and admin UI.
- **ADR-0272: MCPSection UX Fixes** — concerns the *other*, orchestrator `McpSection` (`mcp_endpoints`), explicitly out of scope here; the two `Mcp*Section` components are unrelated.
- **ADR-0260 / ADR-0264** — Phase 1 (stdio transport) and Phase 2 (kernel-isolated credential-holding worker enclosure) this broker path is built on.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/mcp-catalog.ts:11-12` | `PREFIX`/`KEY` admin-config idiom (mirrors `guardrails.ts`). | `read` confirms. |
| `src/coding-credentials/mcp-catalog.ts:14-28` | `mcpCatalogEntrySchema` — name charset regex + `plugin:`-prefix guard (`:15-21`), `upstream_url` https (`:22-24`), `default_tool_policy` **required** (`:26`), optional `tool_policy` (`:27`); no `host` field. | `read` confirms. |
| `src/coding-credentials/mcp-catalog.ts:31` | `mcpCatalogSchema = z.array(...)`. | `read` confirms. |
| `src/coding-credentials/mcp-catalog.ts:37-49` | `resolveMcpCatalog` (fail-open to `[]`) + `setMcpCatalog` + `adminMcpCatalogContextId`. | `read` confirms. |
| `tests/coding-credentials/mcp-catalog.test.ts:23-90` | defaults empty; round-trips (no `host`, default required); rejects non-https; rejects missing `default_tool_policy`; rejects `plugin:` prefix + bad charset; strips a stray `host` key. | `read` confirms. |
| `src/debug/settings/admin/mcp-catalog-routes.ts:16-44` | `PostBodySchema { kind:'catalog', entries }`; `view`; `handleGet` (`requireAdmin('read')`); `handlePost` (`requireAdmin('write')` + `requireCsrf` + `setMcpCatalog` + `log.info`). | `read` confirms. |
| `src/debug/settings/admin/mcp-catalog-routes.ts:46-55` | `handleAdminMcpCatalogRoutes` for `/settings/api/admin/mcp-catalog`. | `read` confirms. |
| `src/debug/settings-api-router.ts:64` | Route registered: `if (p === '/settings/api/admin/mcp-catalog') return handleAdminMcpCatalogRoutes(...)`. | `grep` confirms. |
| `tests/debug/settings/admin/mcp-catalog-routes.test.ts` | Admin route test (GET default `{entries:[]}`, POST persists, non-admin 403). | `glob` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogSection.svelte:1-141` | Operator CRUD over catalog entries via `AdminMcpCatalogEntryRow`; `load`/`save` + `untrack` mount. | `read` confirms. |
| `client/settings/sections/admin/AdminMcpCatalogEntryRow.svelte:12-94` | Per-entry row (`DraftMcpCatalogEntry`, `emptyDraftEntry`, posture summary). | `grep` confirms. |
| `client/settings/admin-fetchers.ts:236-241` | `fetchAdminMcpCatalog` / `postAdminMcpCatalog`. | `grep` confirms. |
| `client/settings/fetcher-schemas-mcp-catalog.ts:10-20` | `AdminMcpCatalogEntrySchema` / `AdminMcpCatalogResponseSchema`. | `grep` confirms. |
| `client/settings/SettingsApp.svelte:47,266` | `AdminMcpCatalogSection` imported + registered. | `grep` confirms. |
| `tests/visual/settings/sections/admin/AdminMcpCatalogSection.spec.ts` | Playwright visual spec for the admin section. | `glob` confirms. |
| `src/coding-credentials/types.ts:52-53` | `MCP_FIELDS = ['servers']`, `REQUIRED_MCP_FIELDS = []` (single JSON array field, not `['server','upstream_token']`). | `read` confirms. |
| `src/debug/settings/coding-credentials-fields-meta.ts:85-92` | `mcp` field meta: one sensitive `servers` field labeled "MCP servers". | `read` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:218-232` | GET `namespace==='mcp'` surfaces `catalog`, `pluginServers`, `maxMcpServers`, and token-redacted `selections` (`{ server, hasToken }`). | `read` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:189-206` | PATCH `checkMcpServers`: `mergeMcpTokens` + tokenless→422 + over-`maxMcpServers`→422. | `read` confirms. |
| `src/coding-credentials/mcp-selections.ts:11-66` | `codingMcpSelectionsSchema`; `serialize`/`parse`/`hasMalformed`; `mergeMcpTokens` (token-preserving, strips `plugin:` tokens). | `read` confirms. |
| `tests/coding-credentials/mcp-selections.test.ts:16-26` | Round-trips the array through the `servers` field; rejects empty server name. | `grep` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:20-35` | `ToolPolicy` / `ResolvedMcpServer` / `ResolveMcpResult` (discriminated union, not `null`). | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:37-39` | `catalogToolPolicy` — `default: entry.default_tool_policy ?? 'deny'`. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:46-88` | `resolveOneMcpServer` — `plugin:` branch (`:52-69`, derives URL from `listEnabledInternalMcpServers`); external branch (`:70-88`, catalog lookup + `host` from `new URL(...).hostname`). | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:99-137` | `resolveMcpServers` — malformed→fail-closed; empty→`{ok,servers:[]}`; `maxMcpServers` cap (`:113-120`); duplicate detection (`:124-127`); per-entry fail-closed naming the offender. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:147-167` | `resolveMcpTokens` — derived from the validated set; mints `plugin:` tokens (`:154-158`); external tokens from the vault. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:16-21` | Comment noting the move to `./resolve-mcp-servers.js`; `configContextOf` export the resolver imports. | `read` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:130-196` | fail-closed: disabled internal server, missing external token, over-`maxMcpServers`; each also short-circuits `resolveMcpTokens` to `{}`; empty→`{ok,servers:[]}`. | `read` confirms. |
| `plugins/acp/tools.ts:133-140` | `McpUpstream` type with optional per-entry `toolPolicy`. | `read` confirms. |
| `plugins/acp/tools.ts:142-159` | `buildSessionProjectSpec(..., mcpServers: McpUpstream[])` → `projectSpec.mcp = mcpServers` (omitted when empty). | `read` confirms. |
| `plugins/acp/session-tools.ts:92-107` | `resolveMcpServers()`→`projectSpec` (fail-closed `mcp_unavailable` on `!ok`); `resolveMcpTokens()`→top-level `mcpTokens` (omitted when empty). | `read` confirms. |
| `plugins/acp/continue-tool.ts:42-44,129` | Continue path mirrors: `resolveMcpServers()` (fail-closed) + `resolveMcpTokens()`→`mcpTokens`. | `grep` confirms. |
| `tests/plugins/acp/tools.test.ts:90-122` | `projectSpec.mcp[]` carries `toolPolicy` when present, omits it when absent, omits `mcp` entirely when the array is empty. | `read` confirms. |
| `tests/plugins/acp/start-session.test.ts:333-390` | POST body includes `projectSpec.mcp[]` + `mcpTokens` when resolvers return values; omits both when empty. | `grep` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:49-52` | `serverOptions` = catalog entries + plugin servers. | `read` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:189-190` | "No MCP servers available — ask your operator." placeholder. | `read` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:210-226` | External-row credential field with "Blank keeps the stored credential" affordance (`:215-217`); hidden for internal rows. | `read` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:118-136,276-288` | `saveAll` PATCH + Clear behind a danger `Confirm`. | `read` confirms. |
| `client/settings/SettingsApp.svelte:23,247` | `CodingMcpSection` imported + registered (distinct from orchestrator `McpSection` at `:26,250`). | `grep` confirms. |
| `tests/visual/settings/sections/CodingMcpSection.spec.ts` | Playwright visual spec for the user section. | `glob` confirms. |
| `src/coding-credentials/mcp-plugin-servers.ts:19,23-31,76-101` | `INTERNAL_SERVER_PREFIX='plugin:'`; `mcpPluginServerConfigSchema`; `listEnabledInternalMcpServers` (operator-enabled + active/eligible + base URL). | `read` confirms. |
| `src/debug/settings/admin/mcp-plugin-servers-routes.ts:71` | Admin route for `mcp_plugin_servers`. | `grep` confirms. |
| `client/settings/sections/admin/AdminMcpPluginServersSection.svelte` | Operator UI to enable/configure plugin MCP servers. | `glob` confirms. |
| `src/debug/server.ts:205-206` | `/mcp/plugin/<id>` mounted via `routePluginMcpPaths` before the settings auth gate. | `grep` confirms. |
| `src/coding-credentials/guardrails.ts:18,30` | `maxMcpServers` guardrail (`min(1).max(8).default(3)`). | `read` confirms. |
| `src/plugins/runtime-types.ts:63-76` | `codingSecrets.resolveMcpServers()`/`resolveMcpTokens()` gate signatures (discriminated result). | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:15,41-42` | Facade gates `resolveMcpServers`/`resolveMcpTokens` with the storage/chat identity. | `grep` confirms. |
| `docs/architecture/coding-sessions.md:40-56` | MCP-broker section updated for operator catalog + user selection + fail-closed + plugin upstreams (single-server wording is stale — see notes). | `grep` confirms. |

Plan-vs-implementation notes:

- **Multi-server, not single-server.** The plan's vault was `{ server, upstream_token }` with a singular `resolveMcp`/`resolveMcpToken` in `resolve-agent-secrets.ts` and a single `projectSpec.mcp` object carrying `toolPolicy`. Shipped is multi-server throughout: the vault is one `servers` JSON array field (`types.ts:52`), the resolvers are plural `resolveMcpServers`/`resolveMcpTokens` in a new `resolve-mcp-servers.ts` returning a discriminated `{ ok, servers } | { ok:false, error }` (never `null`), and `projectSpec.mcp` is a `McpUpstream[]` with `mcpTokens` as a separate per-server map. This matches the multi-server shape the magi side (ADR-0275:173-174) already launches and gates per-entry; the plan's single-server model was superseded during implementation.
- **All-or-nothing fail-closed.** The plan's resolver returned `null` for a single unresolvable selection. Shipped `resolveMcpServers` resolves the *whole* set or fails closed naming the offending server — over-cap, duplicate, missing-token, and disabled-internal-server each void the entire MCP set (and short-circuit `resolveMcpTokens` to `{}`). This is stricter than "one entry → `null`" because a partial set could leak which servers are configured.
- **`host` is derived, not stored; `default_tool_policy` is required.** The plan's catalog entry had a stored `host` and an optional `default_tool_policy ?? 'allow'`. Shipped derives `host` from `new URL(upstream_url).hostname` (no `host` field), requires `default_tool_policy`, and falls back to `'deny'` — the ADR-0271 hardening layered onto this plan's schema. The plan's "stored host + allow fallback" footguns are therefore not present.
- **Internal `plugin:` MCP servers shipped (scope added beyond the plan).** The plan mentions no first-party plugin upstreams. Shipped adds `mcp-plugin-servers.ts` (`INTERNAL_SERVER_PREFIX = 'plugin:'`), an admin route + `AdminMcpPluginServersSection`, the `/mcp/plugin/<id>` route, signed token mint/verify, and a `plugin:` branch inside `resolveOneMcpServer`. An internal selection stores `server = 'plugin:<id>'` with no credential; papai mints the token at resolve time.
- **`maxMcpServers` guardrail (added beyond the plan).** A new `guardrailsSchema` field (`1..8`, default `3`) is enforced both at the PATCH route (422) and inside `resolveMcpServers` (fail-closed). The plan's only cap was the implicit single-server constraint.
- **Token-preserving merge (`mergeMcpTokens`).** Not in the plan. Because the GET response never returns token values (only `hasToken`), a multi-row PATCH needs to carry forward kept rows' stored tokens; `mergeMcpTokens` does this and strips tokens from `plugin:` rows. The plan's single-row replace did not need it.
- **The admin section was split into a row component.** The plan's `AdminMcpCatalogSection.svelte` is accompanied by `AdminMcpCatalogEntryRow.svelte` (with the live posture summary from ADR-0271); the fetcher schemas live in a dedicated `fetcher-schemas-mcp-catalog.ts`.
- **The docs note (Task 7) shipped but describes the plan's single-server model.** `coding-sessions.md:40` says the vault holds `{ server, upstream_token }` and `:40`/`:54` reference singular `resolveMcp`/`resolveMcpToken` in `resolve-agent-secrets.ts`, and `:56` states "a session gets one upstream … never several — multi-server multiplexing is future work". The shipped code is multi-server (`servers` array, plural resolvers in `resolve-mcp-servers.ts`, `maxMcpServers` up to 8). The paragraph was not updated when the implementation outpaced the plan's single-server scope (the same docs-drift pattern noted in ADR-0275 for the magi-side `'ask'` sentence).
- **The orchestrator `McpSection` was left untouched, as required.** `McpSection.svelte` (`mcp_endpoints`, the concurrent WIP the plan warned against) is unchanged in scope and remains registered at `SettingsApp.svelte:26,250`; this plan's `CodingMcpSection` is a separate section at `:23,247`. (ADR-0272 covers `McpSection` UX fixes separately.)

The source plan `docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3b-papai.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
