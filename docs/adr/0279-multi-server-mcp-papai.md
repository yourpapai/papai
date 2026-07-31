<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0279: Multi-Server MCP Multiplexing — papai UX & Resolvers (Plan 2 of 2)

## Status

Implemented (with divergence)

## Date

2026-07-09

## Context

Through Phase 3B, papai's MCP model carried **exactly one** upstream per coding session: the `mcp` credential vault held a single selection, `resolveMcp`/`resolveMcpToken` returned one value, and `buildSessionProjectSpec` emitted a single `projectSpec.mcp` object plus one `mcpToken`. ADR-0274 (Phase 3A, papai vault + operator catalog) and ADR-0276 (Phase 3B-papai, catalog UI/vault/gating) established that single-server substrate; ADR-0275 (Phase 3B-magi) generalized the magi broker to launch and gate **N** upstreams per session. But the papai side still modeled one — a session that wanted two MCP servers (say, the `synthetic-web-search` plugin and a `github-mcp` catalog server) had no path: the vault held one, the resolver returned one, and the session spec carried one.

This ADR's source plan (`docs/superpowers/plans/2026-07-09-multi-server-mcp-papai.md`, "Plan 2 of 2") is the **papai-side half** of multi-server multiplexing: let a user select **multiple MCP servers** (any mix of internal plugin servers and external catalog servers), resolve them all-or-nothing (fail-closed, naming any culprit), send the `mcp: McpUpstream[]` array plus a `mcpTokens` map to magi, and bound the set by an operator-configurable `maxMcpServers` cap (default 3). The architecture the plan specifies: the `mcp` vault becomes a single `servers` JSON field holding an array of `{ server, upstream_token? }`; `resolveMcp`/`resolveMcpToken` become `resolveMcpServers` (validated list, or a structured error) and `resolveMcpTokens` (per-server token map; internal minted, external from the vault); `buildSessionProjectSpec` emits `mcp: McpUpstream[]`; the session-launch tools refuse the whole session (naming the bad server) if any selection doesn't resolve; and the settings UI becomes an add-row list. magi (Plan 1 / ADR-0278) consumes the array/map contract.

The plan is explicit that this is **Plan 2 of 2** — papai now *sends* the new array/map contract; magi (Plan 1) accepts it. There is **no backward compatibility**: the singular `mcp`/`mcpToken` shapes are replaced outright, and papai and magi must deploy together. The plan references the shared design `docs/superpowers/specs/2026-07-09-multi-server-mcp-multiplexing-design.md` (a cross-repo design spanning papai + magi + geofront); it is the spec for both halves. A papai-specific design spec was not written (`ls docs/superpowers/specs/ | grep multi-server-mcp-papai` is empty).

> **Attribution note.** ADR-0276 (Phase 3B-papai) already recorded the multi-server shape — the `servers` array vault, plural `resolveMcpServers`/`resolveMcpTokens`, the `maxMcpServers` guardrail, and the add-row `CodingMcpSection` — as an evolution *beyond its own single-server plan*, and its docs-drift risk section flagged exactly this. This ADR owns that multi-server substrate in depth, the way ADR-0278 owns the magi-side substrate that ADR-0275 had previously co-cited. The code is co-owned with ADR-0276; the *intent* and the dedicated plan belong here.

## Decision Drivers

- **N upstreams per session, any mix of internal + external.** A user may select several vetted catalog servers and several first-party `plugin:` servers together; the resolver handles each by its own rule (catalog lookup + vault token vs. enabled-plugin check + minted token) and unions them into one `mcp[]`.
- **Fail-closed, all-or-nothing, naming the culprit.** Any single unresolvable selection (disabled/removed internal server, missing/blank external token, unknown catalog entry, duplicate selection, over-cap set) refuses the **whole** session with a structured error identifying the offending server — never a silently-incomplete toolset. A partial set could leak which servers are configured.
- **Catalog/plugin-authoritative; no drift.** URL/host/header/toolPolicy are derived at resolve time from the operator's *current* catalog (external) or enabled internal plugin servers, never read back from the user's vault, so a session can never drift from what the operator intends.
- **Operator soft cap, independent of magi's hard ceiling.** papai enforces a configurable `maxMcpServers` (default 3, clamped 1..8) at the PATCH route, in the resolver, and in the UI row count; magi enforces its own `MAX_MCP_UPSTREAMS` (8) at the trust boundary regardless of caller config.
- **Secrets stay out of `projectSpec`; `mcpTokens` is a separate map.** `projectSpec.mcp` never carries tokens; magi pairs each spec entry to its token by `id`. Internal `plugin:` servers mint a signed binding token; external servers use their vault token.
- **The token never round-trips through the client.** The GET response exposes only `selections: { server, hasToken }` (never the value); a kept external row is PATCHed tokenless and the server carries its stored token forward, so editing one row never requires re-entering the others' credentials.
- **Backward-incompatible contract; deploy together.** The singular shape is gone; papai and magi ship in lockstep (the plan's self-review note).

## Considered Options

### Option 1 — array `servers` vault + `resolveMcpServers`/`resolveMcpTokens` + `mcp: McpUpstream[]` + `mcpTokens` map + add-row UI + `maxMcpServers` cap (chosen)

The `mcp` vault stores a single JSON `servers` array field (`[{ server, upstream_token? }]`); `resolveMcpServers` returns a discriminated `{ ok, servers: ResolvedMcpServer[] } | { ok:false, error }`; `resolveMcpTokens` returns a per-`serverId` map; `buildSessionProjectSpec(..., mcpServers)` emits `projectSpec.mcp = mcpServers` (omitted when empty); the session tools attach `mcpTokens` (omitted when empty); the UI is an add-row list capped by `maxMcpServers`.

- **Pros:** realizes any-mix multi-server behind one fail-closed resolver; secrets stay out of `projectSpec`; the per-entry `toolPolicy` flows straight into the magi gate (ADR-0275/0278); the soft cap is one operator knob enforced at three layers; the array shape matches the magi contract exactly.
- **Cons:** a breaking change to the `mcp` vault shape (the third after 3A); the all-or-nothing fail-closed is coarse (one stale selection voids all MCP); the GET response + add-row section are more complex than a single `<select>`.

### Option 2 — keep the single-server vault; re-restructure later

Leave `{ server, upstream_token }` singular and a single `projectSpec.mcp` object; defer multi-server.

- **Pros:** no second vault-shape break; smallest diff.
- **Cons:** **rejected** — the magi broker (ADR-0275/0278) already launches and gates N upstreams per session; a single-server papai side could not populate that array, stranding the magi capability. The single-`server` vault field would have to be re-restructured again to go multi-server, paying the break twice.

### Option 3 — per-server independent resolution (drop the bad one, keep the rest)

Keep the array but have the resolver skip an unresolvable selection and launch with the survivors.

- **Pros:** more forgiving; one expired credential doesn't void the whole set.
- **Cons:** **rejected** — silently launching with fewer servers than selected leaks which servers are configured (a side channel) and can spend a credential on a toolset the user did not intend. The plan and the shared design mandate all-or-nothing fail-closed; a named refusal is the contract.

## Decision

The chosen Option 1 shipped across all eight plan tasks, with the resolver living in a dedicated module (not `resolve-agent-secrets.ts`) and two additive defenses the plan did not specify. What shipped:

1. **Array vault shape (`src/coding-credentials/types.ts`).** `MCP_FIELDS = ['servers']` (a single JSON field holding the array), `REQUIRED_MCP_FIELDS = []`; the whole `servers` payload stays AES-encrypted as one sensitive field (`types.ts:52-54`).
2. **Selection serialization (`src/coding-credentials/mcp-selections.ts`).** `codingMcpSelectionsSchema`, `serializeMcpSelections`/`parseMcpSelections` (fail-safe → `[]`), `hasMalformedMcpSelections`, and `mergeMcpTokens` — a token-preserving PATCH merge that carries forward a kept external row's stored token (the client never receives token values) and strips tokens from `plugin:`-prefixed internal rows (`mcp-selections.ts:11-66`).
3. **Catalog-authoritative, fail-closed resolver (`src/coding-credentials/resolve-mcp-servers.ts`).** `resolveMcpServers(ctx)` returns a discriminated `{ ok, servers } | { ok:false, error }`: it rejects a malformed payload, parses the selection, enforces the `maxMcpServers` cap, rejects duplicates, and resolves each entry against the *current* catalog (external) or enabled internal plugin servers (deriving `host` from `upstream_url`, never the vault) — any unresolvable/missing-token/over-cap/duplicate selection fails the whole call closed naming the offender (`resolve-mcp-servers.ts:99-137`). The private `resolveOneMcpServer` carries the per-kind logic (`:46-88`).
4. **`resolveMcpTokens` derived from the validated set.** `resolveMcpTokens` calls `resolveMcpServers` internally and iterates `result.servers`, so it can never emit a token for a server outside the fail-closed-validated selection; internal `plugin:` servers get a signed binding token, external servers use their vault token (`resolve-mcp-servers.ts:147-167`).
5. **Facade + type mirrors.** `buildCodingSecretsFacade` gates `resolveMcpServers`/`resolveMcpTokens` behind the `coding.secrets` permission (`coding-secrets-facade.ts:15,41-42`); the `codingSecrets` facade type mirrors the discriminated result (`runtime-types.ts:63-76`) and the acp-local `RuntimeContext['codingSecrets']` mirror matches it (`plugins/acp/tools.ts:28-37`).
6. **`McpUpstream` + `buildSessionProjectSpec` emits the array (`plugins/acp/tools.ts`).** `McpUpstream` carries an optional per-entry `toolPolicy`; `buildSessionProjectSpec(repo, agent, codingSecrets, mcpServers: McpUpstream[])` emits `projectSpec.mcp = mcpServers` (omitted when the array is empty) (`tools.ts:133-159`).
7. **Fail-closed session start (`plugins/acp/session-tools.ts`).** `startSessionTool` resolves the set fail-closed (`mcp_unavailable` naming the culprit on `!ok`, before calling magi), passes `mcpResult.servers` into `buildSessionProjectSpec`, and attaches the top-level `mcpTokens` map (omitted when empty) (`session-tools.ts:92-107`).
8. **Fail-closed continue path (`plugins/acp/continue-tool.ts`).** `continueSessionTool` runs `resolveMcpServers()` purely as a fail-closed gate (the follow-up endpoint never resends `mcp[]`; its `.servers` is intentionally unused) and attaches `mcpTokens` (`continue-tool.ts:39-44,129`).
9. **`maxMcpServers` operator guardrail (`src/coding-credentials/guardrails.ts`).** New `guardrailsSchema` field `z.number().int().min(1).max(8).default(3)` (`:18`) + `DEFAULTS` (`:30`), enforced at the PATCH route (422), inside `resolveMcpServers` (fail-closed), and in the UI row count.
10. **Route validation + GET surface (`src/debug/settings/coding-credentials-routes.ts`).** The `mcp` PATCH parses + schema-validates the `servers` JSON, runs `mergeMcpTokens`, rejects a tokenless external row (422) and an over-cap set (422) (`:180-206`); the GET surfaces `catalog`, `pluginServers`, `maxMcpServers`, and a token-redacted `selections: { server, hasToken }` view (`:218-231`).
11. **Add-row selection UI (`client/settings/sections/CodingMcpSection.svelte`).** Each row is a server `<select>` populated from `catalog` + `pluginServers` (`serverOptions`), with a credential field shown only for external rows (internal rows are tokenless); "Add server" is disabled at `maxMcpServers`; per-row remove; Clear behind a danger confirm; "No MCP servers available — ask your operator." placeholder (`CodingMcpSection.svelte:38-68`).
12. **Admin guardrail control + fetcher schemas.** `AdminCodingGuardrailsSection.svelte` exposes `maxMcpServers` (1..8) in the whole-record POST (`:25,44,82`); the client response schema carries `maxMcpServers` (`fetcher-schemas.ts:94`); MSW fixtures seed it (`client/stories/msw/`).
13. **Tests.** Mixed-set resolution + token minting/verify (`resolve-mcp-servers.test.ts:93-128`); fail-closed disabled-internal, missing-token, over-cap each naming the offender and short-circuiting `resolveMcpTokens` to `{}` (`:130-160`+); PATCH valid/over-cap-422/malformed-422/schema-invalid-422 + GET `maxMcpServers` + token-not-in-response (`coding-credentials-mcp-servers-array.test.ts`); `start_session` POST body carries `projectSpec.mcp[]` + `mcpTokens` when resolvers return values, omits both when empty, and refuses `mcp_unavailable` naming the culprit without calling magi (`start-session.test.ts:333-392,394-418`); a Playwright visual spec for the add-row section (`tests/visual/settings/sections/CodingMcpSection.spec.ts`).

## Consequences

### Positive

- A coding session can reach **N MCP upstreams** (up to the operator soft cap / magi hard ceiling) in any mix of internal plugin servers and external catalog servers, populating the array/map contract magi (ADR-0278) consumes.
- Fail-closed all-or-nothing resolution means a removed/renamed/disabled server, a missing credential, a duplicate, or an over-cap selection disables MCP for the session with a named error rather than silently reaching a stale upstream or spending a credential on an unintended toolset.
- `resolveMcpTokens` derives strictly from the validated set, so it can never drift from — or emit tokens for servers outside — the fail-closed-validated selection.
- The catalog/plugin is the single source of truth: URL/host/header/toolPolicy are derived at resolve time, so the host/URL mismatch class is unconstructable (host is derived from `upstream_url`); the operator vets servers *and* sets per-tool policy.
- Secrets stay out of `projectSpec`; the token never round-trips through the client (a multi-row edit never requires re-entering other rows' credentials).
- The operator soft cap is one knob enforced at three layers (route, resolver, UI), independent of magi's hard ceiling.

### Negative

- **Breaking contract change with no backward compatibility.** The singular `mcp`/`mcpToken` shapes are replaced outright; any caller still sending the singular shape is rejected. papai and magi must deploy together (the plan's explicit lockstep note). Mid-plan, the shared-type change makes the facade/acp typecheck red until the threading tasks land — the plan flags this and allows combining the Task 1+2 commits.
- **The resolver moved to its own module, not `resolve-agent-secrets.ts`.** The plan (Task 2) edited `resolveMcp`/`resolveMcpToken` in `resolve-agent-secrets.ts`; shipped MCP resolution lives in a dedicated `src/coding-credentials/resolve-mcp-servers.ts` (the same relocation ADR-0271/0276 recorded). Intent (array, all-or-nothing, fail-closed, cap) preserved verbatim; location diverged.
- **The continue path does not resend `mcp[]`.** The plan (Task 4) said to pass `mcpResult.servers` into `buildSessionProjectSpec` on the continue/review paths. Shipped `continueSessionTool` uses `resolveMcpServers()` purely as a fail-closed gate (`.servers` unused) because magi's follow-up endpoint never re-accepts a project spec — only `mcpTokens` rides along. Intent (fail-closed on every session-launch path) preserved; the resend is intentionally absent.
- **No separate `review_pr` tool exists.** The plan's Task 4 referenced a "review_pr path (grep `buildSessionProjectSpec`/`resolveMcpToken` across `plugins/acp/`)". In papai, PR review is `start_session` with a `prNumber`, which already runs the fail-closed resolve at `session-tools.ts:92-107`; there is no distinct `review_pr` tool to wire.
- **`mergeMcpTokens` and `hasMalformedMcpSelections` are additive defenses the plan did not specify.** Because the GET never returns token values, a multi-row PATCH must carry forward kept rows' stored tokens (`mergeMcpTokens`); and a non-empty but unparseable `servers` payload fails the whole session closed (`hasMalformedMcpSelections` → `resolveMcpServers` returns `{ ok:false }`). Both are within the plan's fail-closed intent.
- **Coarse fail-closed blast radius.** A single unresolvable selection voids the whole MCP set (by design — a partial set could leak which servers are configured); unforgiving for a user with one expired credential among several valid servers.

### Risks

- **All-or-nothing fail-closed blast radius.** Operators with large catalogs should communicate that users must keep their selections current; one stale entry disables all MCP for the session.
- **`resolveMcpTokens` derives from `resolveMcpServers`, so a disabled internal server voids all tokens.** This is the desired invariant (no token outside the validated set) but means a transient resolver failure takes down the whole token map, not just one entry.
- **`plugin:` namespace reservation.** The catalog schema rejects `plugin:`-prefixed names and `mergeMcpTokens` strips tokens from `plugin:` rows; a future catalog feature must not collide with this prefix.
- **Concurrent-`McpSection` confusion.** Both `CodingMcpSection` (this plan) and the unrelated orchestrator `McpSection` (`mcp_endpoints`, ADR-0272) are registered in `SettingsApp.svelte`; they must not be conflated in future edits.
- **Docs drift.** ADR-0276 flagged that `coding-sessions.md` still describes the *single-server* model (`{ server, upstream_token }`, singular `resolveMcp`/`resolveMcpToken` in `resolve-agent-secrets.ts`); the shipped code here is multi-server, so that paragraph remains stale.

## Related Decisions

- **ADR-0278: Multi-Server MCP Multiplexing — magi Broker (Plan 1 of 2)** — the magi-side half of this plan; accepts and runs the `projectSpec.mcp[]` + `mcpTokens` map contract this plan populates. magi and papai deploy together on the new contract (no backward compatibility).
- **ADR-0276: Sandbox MCP Broker — Phase 3b (papai: Catalog UI, Vault, Gating)** — the single-server papai substrate this plan generalizes to multi-server; ADR-0276 already recorded the multi-server shape as an evolution beyond its own plan and co-owns the resolver/vault/UI code this ADR attributes in depth.
- **ADR-0275: Sandbox MCP Broker — Phase 3b (magi: Multi-Server & Operator Catalog)** — the per-tool gate each `mcp[]` entry's `toolPolicy` is enforced by; already launches/gates the multi-server `ProjectSpec.mcp[]` shape on the magi side.
- **ADR-0274: Sandbox MCP Broker — Phase 3a (papai Vault & Catalog)** — shipped the interim vault + catalog skeleton the multi-server vault replaces/extends.
- **ADR-0271: MCP Catalog Hardening** — the `host`-derivation + required `default_tool_policy` + `?? 'deny'` fallback this plan's resolver inherits (`catalogToolPolicy`, derived `host`).
- **ADR-0264 / ADR-0260** — Phase 2 (worker enclosure) and Phase 1 (stdio transport) of the broker path this plan feeds.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/types.ts:52-54` | `MCP_FIELDS = ['servers']`, `REQUIRED_MCP_FIELDS = []` — the vault is one JSON array field (not `['server','upstream_token']`). | `read` confirms. |
| `src/coding-credentials/mcp-selections.ts:11-22` | `codingMcpSelectionSchema`/`codingMcpSelectionsSchema`; `serializeMcpSelections`/`parseMcpSelections` (fail-safe → `[]`). | `read` confirms. |
| `src/coding-credentials/mcp-selections.ts:37-45` | `hasMalformedMcpSelections` — non-empty unparseable payload is malformed (additive defense the plan did not specify). | `read` confirms. |
| `src/coding-credentials/mcp-selections.ts:55-66` | `mergeMcpTokens` — token-preserving PATCH merge; strips `plugin:` tokens; carries forward a kept external row's stored token (additive; not in the plan). | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:25-39` | `ResolvedMcpServer` (id/url/host/header/allowedHosts/toolPolicy?); `ResolveMcpResult` discriminated union (never `null`); `catalogToolPolicy` `?? 'deny'`. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:46-88` | `resolveOneMcpServer` — `plugin:` branch (enabled-plugin lookup + derived host); external branch (catalog lookup + token-required + `host` from `new URL(...).hostname` + `header ?? 'Authorization'`). | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:99-137` | `resolveMcpServers` — malformed→fail-closed; empty→`{ok,servers:[]}`; `maxMcpServers` cap; duplicate detection; per-entry fail-closed naming the offender. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:147-167` | `resolveMcpTokens` — derives from the validated set (calls `resolveMcpServers`); mints `plugin:` tokens; external tokens from the vault. | `read` confirms (divergence: derived, not independent re-parse). |
| `src/coding-credentials/guardrails.ts:18,30` | `maxMcpServers: z.number().int().min(1).max(8).default(3)` + `DEFAULTS`. | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:15,41-42` | Facade gates `resolveMcpServers`/`resolveMcpTokens` with the storage/chat identity (replaces the singular pair). | `read` confirms. |
| `src/plugins/runtime-types.ts:63-76` | `codingSecrets.resolveMcpServers()` discriminated result + `resolveMcpTokens(): Record<string,string>` gate signatures. | `read` confirms. |
| `plugins/acp/tools.ts:28-37,133-159` | `RuntimeContext['codingSecrets']` mirror; `McpUpstream` (optional per-entry `toolPolicy`); `buildSessionProjectSpec(..., mcpServers)` → `projectSpec.mcp = mcpServers` (omitted when empty). | `read` confirms. |
| `plugins/acp/session-tools.ts:92-107` | `start_session`: `resolveMcpServers()`→fail-closed `mcp_unavailable`; `buildSessionProjectSpec(..., mcpResult.servers)`; `resolveMcpTokens()`→top-level `mcpTokens` (omitted when empty). | `read` confirms. |
| `plugins/acp/continue-tool.ts:39-44,129` | `continue_session`: `resolveMcpServers()` purely as fail-closed gate (`.servers` unused — follow-up never resends `mcp[]`); `mcpTokens` rides along. | `read` confirms (divergence: gate-only, no resend). |
| `src/debug/settings/coding-credentials-routes.ts:180-206` | PATCH `checkMcpServers`: parse + schema-validate; `mergeMcpTokens`; tokenless-external→422; over-`maxMcpServers`→422. | `read` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:218-231` | GET `namespace==='mcp'` surfaces `catalog`, `pluginServers`, `maxMcpServers`, and token-redacted `selections: { server, hasToken }`. | `read` confirms. |
| `client/settings/fetcher-schemas.ts:94` | Coding-credentials response schema carries `maxMcpServers: z.number().optional()`. | `grep` confirms. |
| `client/settings/fetcher-schemas-coding-guardrails.ts:12` | Admin guardrails mirror carries `maxMcpServers` (1..8, default 3). | `grep` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:38-68` | Add-row list: `rows`; `serverOptions` = catalog + plugin servers; `maxMcpServers`/`atCap`; `hadToken`/`hasToken` seed; per-row remove. | `read` confirms. |
| `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte:25,44,82` | `draftMaxMcpServers`; load from `guardrails.maxMcpServers`; saved in the whole-record POST. | `read` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:93-128` | Mixed internal+external set resolves; `resolveMcpTokens` mints a verifiable internal token + returns the vault token for the external. | `read` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:130-160` | Fail-closed: disabled internal server, missing external token — each names the offender and short-circuits `resolveMcpTokens` to `{}`. | `read` confirms. |
| `tests/coding-credentials/resolve-mcp-servers.test.ts:162-174` | Over-`maxMcpServers` (guardrail set to 1) fails closed. | `read` confirms. |
| `tests/debug/settings/coding-credentials-mcp-servers-array.test.ts:68-165` | GET includes `maxMcpServers`; PATCH valid (count ≤ cap) persists + canonicalizes + keeps token server-side; over-cap→422; malformed→422; schema-invalid→422. | `read` confirms. |
| `tests/plugins/acp/start-session.test.ts:333-392` | POST body carries `projectSpec.mcp[]` + `mcpTokens` when resolvers return values; omits both when the selection is empty. | `read` confirms. |
| `tests/plugins/acp/start-session.test.ts:394-418` | `start_session` refuses `mcp_unavailable` (naming the culprit) when `resolveMcpServers` fails, without calling magi. | `grep` confirms. |
| `tests/visual/settings/sections/CodingMcpSection.spec.ts` | Playwright visual spec for the add-row section. | `glob` confirms. |

Plan-vs-implementation notes:

- **The resolver moved to `resolve-mcp-servers.ts`, not `resolve-agent-secrets.ts`.** The plan (Task 2) replaced `resolveMcp`/`resolveMcpToken` inside `resolve-agent-secrets.ts`. Shipped MCP resolution lives in a dedicated `src/coding-credentials/resolve-mcp-servers.ts` (`resolveMcpServers`, `resolveMcpTokens`, the private `resolveOneMcpServer`, `catalogToolPolicy`); `resolve-agent-secrets.ts` only exports the `configContextOf`/`identityContext` helpers the resolver imports. ADR-0271 and ADR-0276 already recorded this same relocation. Intent (array, all-or-nothing, fail-closed, cap) preserved verbatim; location diverged.
- **`resolveMcpTokens` derives from the validated set, not an independent re-parse.** The plan's Task 2 `resolveMcpTokens` re-parsed the vault into an id list and minted/looked-up tokens independently. Shipped calls `resolveMcpServers` internally and iterates `result.servers` (`resolve-mcp-servers.ts:147-149`), so it can never emit a token for a server outside the fail-closed-validated selection — when `resolveMcpServers` refuses, `resolveMcpTokens` returns `{}`. Stricter than the plan; the disabled-internal and missing-token tests (`resolve-mcp-servers.test.ts:147,159`) assert the short-circuit.
- **The continue path is gate-only; it does not resend `mcp[]`.** The plan (Task 4) said to pass `mcpResult.servers` into `buildSessionProjectSpec` on the continue/review paths. Shipped `continueSessionTool` runs `resolveMcpServers()` purely as a fail-closed gate — its `.servers` is intentionally unused — because magi's follow-up endpoint never re-accepts a project spec; only `mcpTokens` is attached (`continue-tool.ts:39-44,129`, with an inline rationale comment). Intent (every session-launch path is fail-closed) preserved; the resend is intentionally absent.
- **There is no separate `review_pr` tool.** The plan's Task 4 referenced "the `review_pr` path (grep `buildSessionProjectSpec`/`resolveMcpToken` across `plugins/acp/`)". In papai, reviewing a PR is `start_session` with a `prNumber`, which already runs the fail-closed resolve at `session-tools.ts:92-107`; no distinct `review_pr` tool exists to wire (confirmed: `grep review plugins/acp/` returns only description prose).
- **`mergeMcpTokens` and `hasMalformedMcpSelections` are additive defenses the plan did not specify.** `mergeMcpTokens` (`mcp-selections.ts:55-66`) is required because the GET response never returns token values (only `hasToken`): a kept external row is PATCHed tokenless and the server carries its stored token forward, and `plugin:` rows never carry a token. `hasMalformedMcpSelections` (`:37-45`) makes a non-empty but unparseable `servers` payload fail the whole session closed (`resolve-mcp-servers.ts:102-105`) rather than silently degrade to `[]`. Both are within the plan's fail-closed intent.
- **GET `selections` is a token-redacted view, plus `maxMcpServers`.** The plan (Task 6) added `maxMcpServers` to the GET response; shipped also exposes `selections: { server, hasToken }` (never the token value) so the add-row UI can seed its list and offer a "keep existing credential" affordance without ever receiving the secret back (`coding-credentials-routes.ts:224-231`). Additive, consistent with the token-never-round-trips invariant.
- **The substrate is co-owned with ADR-0276.** ADR-0276 (Phase 3B-papai) already recorded the `servers` array vault, plural resolvers, `maxMcpServers`, and the add-row `CodingMcpSection` as an evolution beyond its own single-server plan, and flagged the resulting `coding-sessions.md` docs drift. This ADR owns the dedicated multi-server plan's intent and attribution in depth (the same pattern ADR-0278 used for the magi-side substrate ADR-0275 had co-cited). The code is shared; the docs-drift risk remains open from ADR-0276.
- **No papai-specific design spec exists; the shared design is archived.** The plan references the cross-repo design `docs/superpowers/specs/2026-07-09-multi-server-mcp-multiplexing-design.md` (shared with the magi half / ADR-0278). `ls docs/superpowers/specs/ | grep multi-server-mcp-papai` is empty, so no papai-specific design was written; the shared design is archived to `docs/archive/` alongside this batch.

The source plan `docs/superpowers/plans/2026-07-09-multi-server-mcp-papai.md` is archived alongside this ADR to `docs/archive/`. No separate papai-specific design spec was written for this plan; the plan references the shared cross-repo design `docs/archive/2026-07-09-multi-server-mcp-multiplexing-design.md` (co-shared with ADR-0278), also archived to `docs/archive/`.
