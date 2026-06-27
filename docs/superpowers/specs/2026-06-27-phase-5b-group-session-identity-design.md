<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5b — Group-Session Identity — Design

**Date:** 2026-06-27
**Status:** Draft (detailed spec; spawns a plan)
**Parent:** `docs/superpowers/specs/2026-06-27-phase-5-guardrails-identity-design.md` (§ 5b)
**Builds on:** Phases 1–4, 5a (all shipped)

## Scope

Make a **group** coding session run under the **acting user's own identity** — their
provider key, their forge token, their agent — instead of the **group-shared**
vault it uses today. A coding session produces real-world artifacts (commits, PRs)
under a human identity; that must be the person who started it, not whoever
happened to set the group's shared credentials. A per-group policy lets a team
instead nominate a **designated** identity, or explicitly keep the legacy
**shared** behavior.

## Current state (grounded)

- **Today a group session resolves group-shared creds.** Every resolver
  (`resolve-agent-secrets.ts`) reads at `configContextOf(storageContextId)` — the
  **group** config-context in a group. So user A's session in a group uses
  whatever creds were stored at the group level (possibly user B's forge token).
  This is a **cross-user boundary issue**, not just mis-attribution.
- **The acting user's personal context is deterministic:**
  `toScopedContextId({ platformInstanceId, nativeContextId: chatUserId })`. The
  auth layer (`getDmUserAuth`, `src/auth.ts`) **normalizes all platforms** to
  key DM/personal contexts by **user id** — even Mattermost/Kontur Talk, where the
  DM _channel_ id ≠ the user id, are keyed by the user id. The settings UI writes
  a user's personal coding creds to exactly this context
  (`resolveSettingsPrincipal(...).personalConfigContextId`, `src/settings/principal.ts`).
  **→ No new table or mapping is needed** to find the initiator's creds.
- **`chatUserId` is available** in the plugin runtime
  (`buildPluginToolRuntimeContext` carries `runtime.chatUserId`) but is **not**
  passed to `buildCodingSecretsFacade`. Threading it is the whole lever.
- The acp plugin's local `RuntimeContext` type does **not** expose `chatUserId` —
  and **need not**: the facade redirects internally, so the acp tools stay
  unchanged (structural plugin preserved).

## Locked decisions

1. **Initiator's personal context, derived (no new storage).** The acting
   identity's context for a group is
   `toScopedContextId({ platformInstanceId, nativeContextId: <identityUserId> })`,
   where `platformInstanceId` comes from `parseScopedContextId(storageContextId)`.
2. **5b redirects ALL per-identity resolvers** (`resolveForgeToken`,
   `resolveForge`, `resolveAgent`, `resolveAgentSecrets`, `resolveProviderHost`)
   to the acting-identity context — the session runs _entirely_ as that human.
   **5a's `force-shared-key` still composes on top**, overriding **only** the
   provider key/host (`resolveAgentSecrets`/`resolveProviderHost`) with the
   operator key; forge + agent stay the acting identity's (correct PR authorship).
3. **Per-group policy `coding_identity`:** `initiator` (default) |
   `designated:<userId>` | `shared`. Stored on `authorized_groups` (new column,
   migration). Set by **bot or group admins** in the settings-UI group section.
   `shared` preserves today's group-shared behavior for teams that want it.
4. **Refuse, don't fall back.** When the resolved identity has **no** creds, the
   acp tools already return `not_configured` (resolvers return null); 5b only
   refines the **message** to name whose creds are missing ("you haven't set up
   your coding credentials — DM me to configure them"). **Never** silently fall
   back to the group or another user's identity.

## Resolution model (composing 5a + 5b)

Define the **acting-identity context** for a session:

```
identityContext(storageContextId, chatUserId):
  if contextType is DM:            return configContextOf(storageContextId)        // unchanged (already personal)
  group → policy = resolveGroupCodingIdentity(pi, groupId):
    'shared':            return configContextOf(storageContextId)                   // group config-context (legacy)
    'initiator':         return toScopedContextId(pi, chatUserId)                    // the acting user
    'designated:<u>':    return toScopedContextId(pi, u)                             // the nominated member
```

Then:

- `resolveForgeToken` / `resolveForge` / `resolveAgent` → read at `identityContext`.
- `resolveAgentSecrets` / `resolveProviderHost` → read at
  `sharedKeyContext(storageContextId) ?? identityContext(...)` (5a force-shared-key
  still wins for the provider key only).

`sharedKeyContext` (5a) is unchanged. The only change is the per-identity base
moves from `configContextOf` to `identityContext` (which equals `configContextOf`
for DMs and for `shared` groups — so **those paths are reference-identical**).

## Design — papai

- **Thread `chatUserId`** into `buildCodingSecretsFacade(pluginId, storageContextId,
hasPermission, chatUserId)` (one call-site update in
  `buildPluginToolRuntimeContext`). The acp `RuntimeContext` type is untouched.
- **`identityContext` helper** in `resolve-agent-secrets.ts` (or a sibling), using
  `parseScopedContextId` + a group-policy reader. The five resolvers gain a
  `chatUserId` parameter (or the facade passes the precomputed context). Keep the
  DM / `shared` path byte-identical.
- **Group policy store + settings UI:** `authorized_groups.coding_identity`
  (migration; default `'initiator'`); a `resolveGroupCodingIdentity(pi, groupId)`
  reader; the settings-UI **group** section gains a "Coding session identity"
  control (initiator / a member picker for designated / shared), authorized by the
  group-write scope (bot or group admin). A designated user must be a current
  group member (validate against `group_members`).
- **Refusal message:** the acp `start_session`/`review_pr` `not_configured`
  response distinguishes "your" creds (initiator) vs "the configured identity's"
  (designated) — read-only message text; no logic change beyond which context was
  consulted.

## Design — magi

None. papai decides which context's secrets to inject; magi receives the same
`secrets`/`forgeToken`/`projectSpec` shape as today. The session simply carries the
initiator's identity instead of the group's.

## Security

- **Removes a cross-user boundary violation:** today a group member's session can
  push under another member's group-shared forge token; 5b scopes every secret to
  the acting (or explicitly group-admin-designated) human.
- **Refuse-don't-fall-back** prevents silent identity substitution — a missing
  initiator key never quietly becomes someone else's.
- **`designated` requires group-admin authority** to set, and the nominee must be a
  member — a member cannot point group sessions at an outside identity.
- No new secrets at rest; `coding_identity` is non-secret group config.

## Back-compat / migration

- Coding sessions in groups are **new** (the self-serve stack just shipped), so the
  blast radius of switching the default to `initiator` is small. Any early group
  that stored creds at the group level can set `coding_identity: 'shared'` to keep
  them. The migration backfills existing `authorized_groups` rows with the chosen
  default (see open question on default).
- DM sessions are **completely unchanged** (`identityContext` = `configContextOf`
  for DMs). The `shared` group path is reference-identical to today.

## Out of scope (5b)

- Redaction hardening (5c).
- A shared **forge** identity under force-shared-key (5a kept forge per-identity;
  5b keeps it the acting identity's).
- Cross-platform identity unification (a user's Telegram vs Discord creds remain
  separate per platform instance — unchanged).

## Testing

- `identityContext`: DM → `configContextOf` (unchanged); group + `shared` →
  group config-context (unchanged); group + `initiator` → the initiator's personal
  context; group + `designated:<u>` → u's personal context.
- A group session resolves the **initiator's** key/forge/agent (not the group's);
  a second user in the same group resolves **their own**.
- `force-shared-key` ON + group `initiator`: provider key = operator shared, forge =
  initiator's (compose check).
- Refuse-when-unconfigured: initiator with no creds → `not_configured` naming the
  user; no fallback to group creds.
- Group-policy store round-trip; designated nominee must be a member (422 otherwise);
  group-admin scope enforced.
- DM path + `shared` path reference-identical (regression guard).

## Files touched (anticipated)

**papai:** `src/coding-credentials/resolve-agent-secrets.ts` (`identityContext` +
`chatUserId` params), `src/plugins/tool-runtime.ts` (thread `chatUserId` into
`buildCodingSecretsFacade`), a group-policy reader + `authorized_groups` migration,
the settings-UI group section + route, `plugins/acp/session-tools.ts` (refusal
message wording), `CLAUDE.md`, tests.

**magi:** none.

## Open questions

- **Default policy:** `initiator` (assumed — secure, matches the roadmap's stated
  default) vs `shared` (conservative back-compat). Given group coding is new, the
  blast radius is small → recommend `initiator`, with `shared` as the opt-out.
- **Designated nominee leaves the group:** refuse (`not_configured`) vs auto-revert
  to `initiator`. Recommend refuse + surface it in the group settings (stale
  designee shown), so the admin re-nominates deliberately.
- **Who counts as the initiator** for a run started by a steer/proactive path:
  the run owner's `chatUserId` (the message that began the turn). Proactive runs
  have no acting user → fall back to `shared`/group context (proactive sessions
  are operator-driven). Confirm proactive coding sessions are out of scope or
  use the group context.
- **Resolver signature vs facade-precomputed context:** pass `chatUserId` through
  to each resolver, or have the facade compute `identityContext` once and pass the
  context id? (Recommend the facade computes it once and the resolvers keep taking
  a context id — smaller blast radius, but the resolvers are currently called with
  `storageContextId`; needs a small refactor either way.)
