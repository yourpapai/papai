<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0241: Coding Credentials Clear/Reset UI

## Status

Implemented (with divergence)

## Date

2026-07-01

## Context

The ACP coding-session feature stores per-context credentials under three namespaces — the **AI provider** key/agent/model (`agent-provider`), the **code host** connection/token (`forge`), and an **MCP** namespace — via `PATCH /settings/api/coding-credentials`. The operator already had an admin "Clear" for the shared key, but end users in Personal and Group contexts had **no UI to reset/remove their own stored credentials**: they could save but never clear.

The gap was client-side only. The backend already supported clearing end-to-end: `PATCH /settings/api/coding-credentials` accepts `{ clear: true, contextId?, namespace? }`, validated by `ClearBodySchema` (`clear: z.literal(true)`), scope-checked via `resolveContextScope(principal, 'write', contextId)` (403s a group-context clear without write scope), CSRF-protected, and calling `clearCodingCredentials(contextId, namespace, updatedBy)` — a real SQL `DELETE` keyed by `(contextId, namespace)`. This route branch was already covered by `tests/debug/settings/coding-credentials-routes.test.ts`.

The plan (`docs/superpowers/plans/2026-07-01-coding-credentials-clear-ui.md`) therefore added **no server, store, schema, or migration changes** — only client wiring: one fetcher and a confirm-guarded Clear button on each coding-credentials section. There is no dedicated design spec for this plan; it is a client-wiring follow-up. (The sibling `2026-06-25-user-self-serve-coding-credentials-design.md` and the later `2026-07-09-coding-credentials-ux-fixes-design.md` cover other phases and are referenced, not archived, below.)

## Decision Drivers

- **Reuse the existing `PATCH { clear: true }` contract, not a new `DELETE`.** The route already implements clear inside PATCH and is tested; a new method would only duplicate a covered path.
- **Confirmation is required.** Unlike the operator-only admin ghost "Clear", this deletes an end user's *own* working credentials, so both sections gate the action behind the shared `Confirm` dialog with `danger` styling.
- **Button visibility is gated on `currentData.configured`** so Clear only appears when something is actually stored (and `Empty` stories must not render it).
- **Permission safety is server-enforced.** The fetcher targets the same route save uses; `resolveContextScope(principal, 'write', contextId)` already authorizes — no new client-side permission logic.
- **CSRF reuses the existing `writeJson` helper** so the token is auto-attached, identical to `patchCodingCredentials`.

## Considered Options

### Option 1 — Reuse PATCH `{ clear: true }`; confirm-gated Clear; button gated on `configured` (chosen)

Add one `clearCodingCredentials({ contextId, namespace? })` fetcher that PATCHes `{ ...input, clear: true }` via the shared `writeJson` helper, and a Clear button (shown only when `configured`) on each section that opens a `danger`-styled `Confirm` dialog before calling it.

- **Pros:** stays on the already-tested route; one fetcher serves every namespace via the optional `namespace` arg; confirmation prevents an accidental wipe of working credentials; no new server surface.
- **Cons:** "clear via PATCH" is slightly unconventional vs. REST `DELETE`; a confirmation click is one extra step the operator-only Clear does not have (intentional).

### Option 2 — Add a `DELETE /settings/api/coding-credentials` route

Introduce a dedicated DELETE method and a matching fetcher.

- **Pros:** REST-conventional; clearer semantic separation from save.
- **Cons:** duplicates an already-covered code path; adds an untested route + a new schema branch for no behavioral gain; the existing `ClearBodySchema` union already discriminates clear from save inside PATCH. Rejected by the plan.

### Option 3 — Fire-and-forget Clear (no confirm dialog)

Make the button clear immediately, mirroring the admin ghost "Clear".

- **Pros:** one fewer click; smaller component surface.
- **Cons:** rejected — an end user destroying their own working AI-provider key / code-host token by accident is a high-cost, irreversible op. Confirmation is the deliberate divergence from the operator control.

### Option 4 — Always-visible Clear button (not gated on `configured`)

Show Clear regardless of stored state.

- **Pros:** simpler markup (no `{#if currentData.configured}`).
- **Cons:** presents a destructive no-op to the user when nothing is stored; the plan specifically wants the button absent in the `Empty` state.

## Decision

Option 1 shipped in full: one fetcher issuing the `{ clear: true }` PATCH, plus confirm-guarded Clear buttons on the AI-provider and code-host sections (and, beyond the plan, the MCP section). The backend clear contract is unchanged. What shipped:

1. **Fetcher** — `clearCodingCredentials({ contextId, namespace? })` PATCHes `{ ...input, clear: true }` through `writeJson` (CSRF auto-attached). The default-namespace body is `{ contextId, clear: true }` because `JSON.stringify` omits `undefined`.
2. **AI-provider section** — a Clear button (`testid="coding-credentials-clear"`, shown only when `currentData.configured`) opens a `danger` `Confirm` dialog; on confirm it clears and reloads.
3. **Code-host section** — identical pattern with `testid="code-host-clear"`, clearing with `namespace: 'forge'`.
4. **No server/store/schema/migration changes** — the fetcher targets the existing PATCH clear branch (`resolveContextScope('write')` + `clearCodingCredentials` SQL DELETE).

### Implementation Notes evidence table

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/coding-credentials-fetchers.ts:24-25` | `clearCodingCredentials` fetcher: `writeJson('/settings/api/coding-credentials', 'PATCH', { ...input, clear: true }, (b) => b)`. | `read` confirms. |
| `tests/client/settings/coding-credentials-fetchers.test.ts:109-125` | Two tests: default-namespace PATCH body `{contextId, clear:true}` and forge-namespace body `{contextId, namespace:'forge', clear:true}`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:195-218` | `pendingClear`/`clearing`/`clearError` state + `confirmClear()` → `clearCodingCredentials({ contextId })`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:341-354,368-379` | Clear button (`testid="coding-credentials-clear"`, gated on `currentData.configured`) + `danger` `Confirm` dialog. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:137-160` | Same state + `confirmClear()` → `clearCodingCredentials({ contextId, namespace: 'forge' })`. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:231-244,257-269` | Clear button (`testid="code-host-clear`) + `danger` `Confirm` dialog. | `read` confirms. |
| `client/settings/sections/CodingMcpSection.svelte:18,149` | **Third consumer beyond the plan** — clears with `namespace: 'mcp'` (`const NAMESPACE = 'mcp'`). | `grep` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:53-60,241,247,250-253,281` | Backend contract: `ClearBodySchema` (`clear: z.literal(true)`) in `PatchBodySchema` union; PATCH dispatch; `resolveContextScope(principal,'write',contextId)`; clear branch calls `clearCodingCredentials(...)`. | `read` confirms. |
| `src/coding-credentials/store.ts:113` | `clearCodingCredentials(contextId, namespace, updatedBy)` — the real SQL DELETE the route calls. | `grep` confirms. |

## Consequences

### Positive

- End users can self-serve reset their own AI-provider, code-host, and MCP credentials in both Personal and Group contexts, without operator intervention — mirroring the admin Clear but with a confirmation gate appropriate to deleting one's own working secrets.
- Reusing the existing PATCH clear branch means zero new server surface and the route's existing test coverage carries over.
- A single optional-`namespace` fetcher serves every coding-credential section, so adding the MCP consumer required no new fetcher.
- Gating the button on `currentData.configured` keeps the destructive control out of empty states.

### Negative

- **The fetcher moved out of `client/settings/fetchers.ts`.** The plan added `clearCodingCredentials` next to `patchCodingCredentials` in `fetchers.ts`; shipped extracts all three coding-credential fetchers into a dedicated `client/settings/coding-credentials-fetchers.ts` module (mirroring the `release-fetchers.ts` extraction in ADR-0233). Intent unchanged; the plan's line references are stale.
- **The clear handler was hardened beyond the plan.** The plan's `clearAll()` reused the shared `error`/`status` state and closed the dialog unconditionally; shipped uses a dedicated `confirmClear()` with a separate `clearError` state, renders the error **inside** the `Confirm` body, adds `busy={clearing}` to the dialog, and only closes + reloads on success. More robust but a larger surface than planned.

### Risks

- **`clear` via PATCH, not `DELETE`.** A future contributor expecting REST semantics could miss the clear branch; mitigated by the discriminated `ClearBodySchema` and the route test.
- **Irreversible deletion** of working credentials is one confirmed click away; the `Confirm` gate + `danger` styling is the sole guard (by design).
- **Permission safety rests entirely on the server.** A client bug passing the wrong `contextId`/`namespace` would clear the resolved scope's row; `resolveContextScope('write')` is the authoritative gate, not the client.

## Related Decisions

- **ADR-0185: BYOK LLM Credentials** — established the per-context encrypted credential storage this feature clears.
- **ADR-0219: BYOK Self-Serve** — established the personal/group self-serve credential sections (AI provider + code host) into which these Clear controls were wired.
- **`docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`** — the top-level multiphase design whose client sections this plan completed (not archived here; separate phase).
- **`docs/superpowers/specs/2026-07-09-coding-credentials-ux-fixes-design.md`** — a later, separate UX-fixes design (select/combobox control redesign) that also spreads across the coding-cluster sections; not archived here.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

Plan-vs-implementation divergences:

- **Fetcher relocated to a dedicated module.** Plan: add to `client/settings/fetchers.ts` (~line 157). Shipped: extracted into `client/settings/coding-credentials-fetchers.ts:24-25` alongside `fetchCodingCredentials`/`patchCodingCredentials`, and the test imports from the new module (`coding-credentials-fetchers.test.ts:8-12`). Intent identical; matches the ADR-0233 `release-fetchers.ts` extraction precedent.
- **A third consumer shipped that the plan never mentioned.** `CodingMcpSection.svelte` also wires `clearCodingCredentials` with `namespace: 'mcp'` (`CodingMcpSection.svelte:18,149`) — extending the clear UX to the MCP coding section in addition to the planned AI-provider and code-host sections.
- **Clear handler renamed and hardened.** Plan named it `clearAll()` and reused shared `error`/`status`; shipped is `confirmClear()` (`CodingCredentialsSection.svelte:199`, `CodeHostSection.svelte:141`) with a dedicated `clearError` state, in-dialog error rendering, `Confirm busy={clearing}`, and close+reload only on success.
- **Save button gating added.** Both sections' Save button gained `disabled={!formDirty || ...}` (not in the plan); unrelated to clear but landed in the same components.

The source plan `docs/superpowers/plans/2026-07-01-coding-credentials-clear-ui.md` is archived alongside this ADR to `docs/archive/`.
