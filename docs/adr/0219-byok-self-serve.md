<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0219: BYOK Self-Serve

## Status

Implemented

## Date

2026-06-24

## Context

Bring-Your-Own-Key (BYOK) LLM credentials are gated behind a per-config-context `enabled` boolean in `byok_llm_credentials`. Until this change, the only caller that could flip that flag was the bot-admin route `PATCH /settings/api/admin/byok`, and the admin overview (`listByokAdminSummaries`) listed only contexts that already had a row. A context only receives a row once BYOK is enabled or credentials are saved.

The consequence: a brand-new group or personal DM that had never touched BYOK never appeared in the admin table, so the admin UI offered no affordance to enable BYOK for it. A bot admin therefore could not bootstrap BYOK for a specific group, and end users saw only the placeholder "BYOK is not enabled for this context. Ask a bot admin to enable it first." The gate added no real value: the stated goal was always that any personal or group context may opt into BYOK on its own.

The 2026-06-24 design (`docs/superpowers/specs/2026-06-24-byok-self-serve-design.md`) removed the bot-admin enable/disable gate and made BYOK self-serve for the context owner, keeping the bot-admin view as a read-only audit overview. This ADR records that decision.

## Decision Drivers

- **Self-serve, no admin bottleneck:** a context owner must be able to enable/disable BYOK without a bot admin in the loop, including for contexts that have never touched BYOK.
- **Reuse existing authorization:** group admins and bot admins already manage group settings via `resolveContextScope(..., 'write', ...)`; the personal branch already authorizes the DM owner. No new permission concept should be introduced.
- **Preserve resolver semantics:** `resolveEffectiveLlmConfig` must keep its branching verbatim — no silent fallback to central creds when BYOK is on but incomplete. Off = central (no error possible); on = BYOK with explicit missing-fields/unreadable errors.
- **Keep `enabled` as the toggle store:** no migration; the existing `enabled` column remains load-bearing as the backing store for the toggle.
- **Admin audit view retained:** operators still need to see which contexts use BYOK and their state, but no longer need to drive enablement.
- **Discriminated, strict request bodies:** the toggle action and the credential-save action share one endpoint and must be unambiguously distinguishable; ambiguous bodies must 422.

## Considered Options

### Option 1: Self-serve toggle on the user route (chosen)

Add a discriminated `action: 'enable' | 'disable'` body to the existing `PATCH /settings/api/byok`, authorized by the already-present `resolveContextScope(principal, 'write', contextId)`.

- **Pros:** removes the admin bottleneck entirely; reuses the existing write-scope authorization (DM owner / group admins + bot admins); store, schema, and resolver are untouched; the admin route simplifies to read-only.
- **Cons:** introduces a second `PATCH` body shape on one endpoint, requiring careful discrimination; the admin loses the ability to force-enable/disable a context (intentional).

### Option 2: Keep the admin gate, add a "name a context to enable" admin input

Leave enable/disable on the admin route but add an admin UI input to type a context id and enable BYOK for it.

- **Pros:** admin retains centralized control; minimal change to the user route.
- **Cons:** does not meet the self-serve goal; every context still requires a bot admin to bootstrap; more admin UI surface for a gate that adds no value; group admins still cannot self-serve.

### Option 3: Drop the `enabled` flag; treat credential presence as opt-in

Remove `enabled`; `resolveEffectiveLlmConfig` would treat any stored BYOK fields as active.

- **Pros:** simplest data model (no toggle column).
- **Cons:** loses the clean "off = central, no error possible" state; a single stray field could silently switch a context to BYOK and then hard-error on incomplete config; breaks the resolver's explicit branching and the audit "enabled by whom/when" columns; requires a migration and resolver rewrite. Rejected.

## Decision

Six coordinated, mostly-surface changes implement the architecture. The store, schema, and resolver are intentionally untouched.

### 1. Discriminated toggle action on the user BYOK route

`src/debug/settings/byok-routes.ts` replaces its single `PatchBodySchema` with two structurally distinguishable shapes united by `z.union`:

- `ToggleBodySchema = z.object({ contextId: z.string().optional(), action: z.enum(['enable', 'disable']) })`
- `SaveBodySchema = z.object({ contextId: z.string().optional(), values: z.record(z.string(), z.string()) })`
- `PatchBodySchema = z.union([ToggleBodySchema, SaveBodySchema])`

After `resolveContextScope(..., 'write', ...)` succeeds, the handler branches on `'action' in body.data`: `enable` calls `enableByokForContext(scope.contextId, principal.platformUserId)`, `disable` calls `disableByokForContext(...)`, and the route returns `{ ok: true, contextId, enabled }`. The existing credential-save branch keeps its `!enabled` → 403 guard below the toggle branch, so saving into a toggled-off context is still rejected.

> **Note on discrimination:** the design calls the two shapes "discriminated," but they are implemented with `z.union` plus a manual `'action' in body.data` runtime branch, not `z.discriminatedUnion`. Because the two shapes share no overlapping required keys (`action` vs `values`), the union plus the membership check discriminates correctly; an ambiguous body (neither key, or both) fails `safeParse` and returns `422`.

### 2. Authorization unchanged

No new permission concept. `resolveContextScope(principal, 'write', contextId)` already authorizes the DM owner for personal contexts and `manageableGroups` (group admins + bot admins) for groups. The toggle reuses it verbatim; a group the principal cannot manage yields 403.

### 3. Resolver unchanged

`resolveEffectiveLlmConfig` (`src/llm-config-resolver.ts`) keeps today's branching verbatim: `!enabled` → central creds; `enabled && unreadable` → hard error; `enabled && !complete` → missing-fields error; complete → BYOK creds. There is deliberately no silent fallback to central when BYOK is on but incomplete — the error surfaces only after an owner has explicitly toggled on.

### 4. Admin BYOK route read-only

`src/debug/settings/admin/byok-routes.ts` drops its `PATCH` branch entirely: `GET` still returns `{ contexts: listByokAdminSummaries() }` under `requireAdmin(..., 'read')`, and every other method (including `PATCH`) returns `405`. The `enableByokForContext`/`disableByokForContext` imports, the `PatchBodySchema`, and the JSON-parse/CSRF paths are removed from the admin route. This is the sole behavioral change that makes the admin enable/disable gate unreachable.

### 5. Client fetcher and user section

`client/settings/fetchers.ts` adds `toggleByok({ contextId, enabled })`, which PATCHes `/settings/api/byok` with `{ contextId, action: enabled ? 'enable' : 'disable' }`. `client/settings/sections/ByokSection.svelte` replaces the "ask a bot admin" placeholder with a `byok-toggle` button bound to `currentData.enabled`: off shows only the toggle ("Using the central LLM credentials"); on reveals the existing five-field editor and the missing-fields/unreadable warnings. Flipping the toggle calls `toggleByok` then reloads.

### 6. Admin section read-only

`client/settings/sections/admin/AdminByokSection.svelte` removes the Enable/Disable action column, the `toggle()` handler, the `toggling` state, and the `Btn` import. The table (context, status, missing, updated-at, updated-by, unreadable) remains as a read-only audit view; the `raw` field is retained for the unreadable/error branch.

## Consequences

### Positive

- Context owners self-serve BYOK enable/disable; no bot admin is required, including for never-touched contexts.
- Group admins (and bot admins) can enable BYOK group-wide, consistent with the group-shared config-context keying.
- The admin overview remains a useful read-only audit surface without the previous unbootstrappable gap.
- Resolver semantics are preserved verbatim — no silent fallback; explicit hard errors for incomplete/unreadable BYOK.
- No migration is needed: the `enabled` column stays load-bearing as the toggle store; `store.ts`, `types.ts`, the resolver, and the schema are untouched.

### Negative

- The admin route loses the enable/disable capability by design; operators can no longer force a context's BYOK state. This is the intended trade for self-serve.
- Two `PATCH` body shapes share one endpoint; correctness depends on the `z.union` + `'action' in` discriminant being maintained. A future contributor adding a third shape must keep the shapes structurally distinguishable or switch to `z.discriminatedUnion`.
- A context owner who toggles on without completing fields gets a hard config error (by design); the UI mitigates by revealing the field editor only when enabled.

### Risks

- The `enabled` column remains load-bearing and is not dropped; future tooling that ignores it could misread BYOK state. This is documented in the spec's out-of-scope list.
- `listByokAdminSummaries` still lists only contexts with a row; a context that has never touched BYOK remains absent from the audit view until its owner toggles it on. This is acceptable for an audit view but means the admin cannot see "eligible but not opted-in" contexts.
- A group admin enabling BYOK affects the whole group (group-shared keying). This is intended and matches the existing scope model, but means one group admin's toggle binds all group threads to BYOK until disabled.

## Related Decisions

- ADR-0185: BYOK LLM Credentials — the encrypted per-config-context store, `enabled` flag, and `resolveEffectiveLlmConfig` branching this change builds on (unchanged).
- ADR-0136: Settings Web UI Access Model — `resolveContextScope(..., 'write', ...)` authorization and the settings trust-domain separation the user route reuses.
- The `{ action: 'enable' | 'disable' }` discriminant mirrors the `{ action: 'unset' }` / `{ kind: 'unset' }` clear-action pattern used elsewhere on settings routes; both rely on structural body discrimination rather than `z.discriminatedUnion`.

## Implementation Notes

Confirmed present in the source tree:

- `src/debug/settings/byok-routes.ts` — `ToggleBodySchema`/`SaveBodySchema` (lines 32–43), `PatchBodySchema = z.union([...])` (line 44), the `'action' in body.data` branch calling `enableByokForContext`/`disableByokForContext` (lines 108–116), and the retained save-path `!enabled` → 403 guard (line 119).
- `src/debug/settings/admin/byok-routes.ts` — `GET` under `requireAdmin(..., 'read')` returning `listByokAdminSummaries()`; all other methods → `405`. The `enable/disable` imports and `PatchBodySchema` are gone (21 lines total).
- `client/settings/fetchers.ts` — `toggleByok({ contextId, enabled })` (line 132) PATCHes `{ contextId, action }`.
- `client/settings/sections/ByokSection.svelte` — `toggleByok` imported (line 16), `setEnabled` handler invoking `toggleByok` (line 115), `byok-toggle` button (line 147), conditional field editor.
- `client/settings/sections/admin/AdminByokSection.svelte` — no `toggle`/`toggling`/`Btn` references; read-only table with the unreadable/error branch retained.

Divergences from the plan/spec (minor, behavior-preserving):

- The admin route was specified as `async function`; the shipped implementation is a synchronous `export function` returning `Promise.resolve(...)` for the GET/405 paths. Functionally identical.
- The spec listed a possible `client/settings/fetcher-schemas.ts` extension; it was not needed — `toggleByok` builds the body inline via `writeJson`.
- The spec described the bodies as "discriminated"; the implementation uses `z.union` + a manual `'action' in body.data` branch rather than `z.discriminatedUnion` (see the note in Decision §1).

Untouched as specified: `src/byok-llm/store.ts`, `src/byok-llm/types.ts`, `src/llm-config-resolver.ts`, `src/db/byok-llm-schema.ts`. No migration was added; `byok_llm_credentials.enabled` remains the toggle backing store.
