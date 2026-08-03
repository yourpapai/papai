<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0235: Phase 5b — Group-Session Identity

## Status

Implemented (with divergence)

## Date

2026-06-27

## Context

Phase 5a (ADR-0234) shipped operator-level guardrails — `allowedAgents` / `whoMayUse` / `forceSharedKey` — bounding **which** agents, **who** may start a session, and **whose provider key** an operator may force. But it left the identity model untouched: every resolver in `resolve-agent-secrets.ts` read at `configContextOf(storageContextId)`, which for a **group** is the **group config-context**. So a group coding session ran under whatever creds were stored at the group level — possibly **another member's** forge token. A coding session produces real-world artifacts (commits, PRs) under a human identity, so it must be the person who started it, not whoever happened to populate the group vault. That is a cross-user boundary violation, not merely mis-attribution.

The parent decomposition (`docs/superpowers/specs/2026-06-27-phase-5-guardrails-identity-design.md`) split Phase 5 into sub-phases. **5b's scope** (this ADR) is the group-session identity half: a per-group `coding_identity` policy (`initiator` default | `designated:<userId>` | `shared`) that selects whose credential vault a group coding session reads, so the session runs under the acting user's own key, forge token, and agent. **Deliberately deferred** to later sub-phases: redaction audits (5c), a shared forge identity under force-shared-key (5a kept forge per-identity; 5b keeps it the acting identity's), and cross-platform identity unification.

The design premise was that the acting user's personal context is already **deterministic** — `toScopedContextId({ platformInstanceId, nativeContextId: chatUserId })` — because the auth layer normalizes every platform to key personal contexts by **user id** (even Mattermost/Kontur Talk, where the DM *channel* id ≠ the user id). The settings UI already writes a user's coding creds there. So 5b needs **no new table or mapping**: a pure `identityContext(storageContextId, chatUserId)` helper, threaded via `chatUserId` (already present in the plugin runtime but not yet passed to `buildCodingSecretsFacade`), is the whole lever. `shared` reproduces today's group-vault behavior; DMs are byte-identical (`getGroupCodingIdentity` returns `'initiator'` for a DM's context, which resolves to the DM's own context). 5a's `forceSharedKey` still composes on top, overriding **only** the provider key/host. magi is unchanged — papai decides which context's secrets to inject.

## Decision Drivers

- **Scope every secret to the acting human** — the headline goal; a group session's commits/PRs must be authored by the starter, resolving the cross-user boundary violation where one member could push under another's group-shared forge token.
- **No new persistence surface** — the initiator's personal context is already derivable (`toScopedContextId({ pi, chatUserId })`), so 5b adds one `authorized_groups` column (a policy value), not a mapping table.
- **DM / `shared` paths byte-identical** — `identityContext` equals `configContextOf` for DMs and for `shared` groups, so 5b is non-breaking and those paths need no separate test matrix beyond a regression guard.
- **Refuse, don't fall back** — when the resolved identity has no creds, the acp tools return `not_configured`; they never silently substitute another vault. 5b only refines the *message* ("your credentials"), never the fallback logic.
- **5a composes on top, provider-key only** — `resolveAgentSecrets`/`resolveProviderHost` keep `sharedKeyContext(...) ?? identityContext(...)` so an operator-forced key still wins for the provider key, while forge + agent stay the acting identity's (correct PR authorship).
- **Designated requires group-admin authority + current membership** — the nominee must be a current group member (validated at save, 422 otherwise); a member cannot retarget group sessions at an outside identity.
- **Thread `chatUserId`, do not widen the plugin surface** — the acp `RuntimeContext` type is untouched; the secrets facade redirects internally, preserving the structural plugin contract.
- **TDD, papai-only, explicit `git add` paths** — the plan knits into the write-hook pipeline; magi is uninvolved.

## Considered Options

### Option 1: Per-group `coding_identity` policy + `identityContext` helper (chosen)

Store `coding_identity` on `authorized_groups` (default `'initiator'`); a pure `identityContext(storageContextId, chatUserId)` resolves the effective vault per the policy; thread `chatUserId` into `buildCodingSecretsFacade` and the resolvers; expose the policy in the settings-UI group section with member validation.

- **Pros:** no new mapping table; DM / `shared` paths are reference-identical; the per-identity base moves from `configContextOf` to `identityContext` with no change to magi; force-shared-key composes cleanly; designated is gated by group membership; refuse-don't-fall-back prevents silent substitution.
- **Cons:** threads a new `chatUserId` parameter through every resolver signature (a mechanical but pervasive change touching all call sites); the policy is read on every secret-resolve via the DB (no cache, but `authorized_groups` lookups are already cheap); a designated nominee who leaves the group is only caught at save, not at session start (see Consequences).

### Option 2: Cross-platform identity unification (deferred)

Resolve the initiator's creds across platforms (a user's Telegram vs Discord creds collapse to one identity).

- **Pros:** a user configures once.
- **Cons:** explicitly out of 5b's scope; the per-platform-instance credential boundary is deliberate (separate keys, separate billing). Deferred.

### Option 3: Shared forge identity under force-shared-key

Let `forceSharedKey` also override the forge token, collapsing all PR authorship to one operator identity.

- **Pros:** simpler audit if all commits come from one bot identity.
- **Cons:** 5a deliberately kept forge per-identity; 5b keeps it the acting identity's. Collapsing authorship loses per-human attribution — the very thing 5b exists to fix. Out of scope.

## Decision

The chosen Option 1 shipped across three papai tasks. What shipped:

### Part A1 — schema/migration + policy reader + `identityContext` + resolver/facade threading

1. **A1 — policy model + identity resolution.** `src/db/schema.ts` adds `codingIdentity: text('coding_identity').notNull().default('initiator')` to `authorizedGroups`; migration `065_coding_identity.ts` runs `ALTER TABLE authorized_groups ADD COLUMN coding_identity TEXT NOT NULL DEFAULT 'initiator'` guarded by a `columnExists` idempotency check and is registered in `src/db/index.ts`. `getGroupCodingIdentity(groupId)` / `setGroupCodingIdentity(groupId, identity)` in `src/authorized-groups.ts` read/write it (default `'initiator'` when unset). `identityContext(storageContextId, chatUserId)` in `resolve-agent-secrets.ts` returns `configContextOf` for legacy/non-scoped contexts, the group config-context for `'shared'`, the nominated member's personal context for `'designated:<userId>'`, and `toScopedContextId({ pi, chatUserId })` for `'initiator'`. The five resolvers (`resolveAgentSecrets`, `resolveProviderHost`, `resolveForgeToken`, `resolveForge`, `resolveAgent`) each gain a `chatUserId` param; the provider-key/host pair resolves at `sharedKeyContext(...) ?? identityContext(...)` (5a still wins, provider-key only), the forge/agent pair reads `identityContext` only. `buildCodingSecretsFacade(...)` takes `chatUserId` and threads it to every resolver.

### Part A2 — per-group policy setter + route + settings UI

2. **A2 — group policy route + UI.** `GET/PATCH /settings/api/group/coding-identity` in `src/debug/settings/group-routes.ts`: GET is `requireGroup('read')` and returns `{ contextId, identity }`; PATCH is CSRF-protected + `requireGroup('write')`, validates `identity` ∈ `{ 'initiator', 'shared' }` (`VALID_PLAIN_IDENTITIES`) or `designated:<userId>` where `isGroupMember(groupId, userId)` (else 422), then `setGroupCodingIdentity`. The client `CodingIdentitySection.svelte` (wired into `SettingsApp.svelte` as the "Session identity" group section) renders an initiator / shared / designated control with a member `<select>` populated from a parallel members fetch, and round-trips via `fetchGroupCodingIdentity` / `patchGroupCodingIdentity` (`client/settings/fetchers.ts`).

### Part A3 — refusal wording + docs

3. **A3 — per-identity `not_configured` wording.** `resolveStartSessionAccess` in `plugins/acp/session-tools.ts` and the continue-session resolver in `plugins/acp/continue-tool.ts` keep `error: 'not_configured'` but phrase the message as the acting identity's own missing creds ("You haven't set up your coding credentials. DM me and open settings → Coding sessions …"). The wording is intentionally generic ("your") since even a designated-identity refusal is that identity's missing creds. The behavior doc landed in `docs/architecture/coding-sessions.md` §"Group-session identity (Phase 5b)".

## Consequences

### Positive

- A group coding session runs under the **acting user's** provider key, forge token, and agent — the cross-user boundary violation (one member pushing under another's group-shared forge token) is closed. A second user in the same group resolves **their own** creds.
- DM sessions are **byte-identical** to pre-5b: `getGroupCodingIdentity` returns `'initiator'` for a DM context (no `authorized_groups` row), which resolves to the DM's own config-context. The `shared` group path is reference-identical to the legacy behavior.
- `forceSharedKey` composes cleanly: with `initiator` + `forceSharedKey` ON, the provider key = the operator shared key while the forge token stays the initiator's — so an operator-shared provider key does not collapse PR authorship.
- `designated` is gated by group-admin authority (`requireGroup('write')`) **and** current membership (`isGroupMember`, 422 otherwise), so a member cannot retarget group sessions at an outside identity.
- Refuse-don't-fall-back: a missing-creds identity yields `not_configured`, never a silent substitution. magi is entirely unchanged — papai simply injects a different context's secrets.
- The structural plugin contract is preserved: `chatUserId` is threaded through the secrets facade, not exposed on the acp `RuntimeContext` type.

### Negative

- **The behavior doc landed in `docs/architecture/coding-sessions.md`, not the root `CLAUDE.md`.** The plan's A3 step 3 named `CLAUDE.md` as the doc target; the implementation instead documented group-session identity in the coding-sessions architecture doc (the canonical home for this surface). The root `CLAUDE.md` carries no `coding_identity` mention.
- **Every resolver signature gained a `chatUserId` param** — a mechanical but pervasive change; every call site (tests, the facade, MCP resolvers) was updated. This is a wide blast radius for a one-concept change, though contained to the coding-credentials resolver family.
- **A designated nominee who leaves the group after being set is only re-validated at the next save**, not at each session start: their creds are still read (resolving to their personal context) until an admin re-nominates. The spec's open question ("refuse vs auto-revert to initiator on departure") was resolved toward *refuse* (a session whose designee has no creds gets `not_configured`), with no auto-revert and no live membership re-check.
- **`review_pr` no longer exists** (dropped in the ACP cleanup, ADR-0228), so A3's refusal wording covers `start_session` + `continue_session`, not the `start_session` + `review_pr` pair the plan named. (See Plan-vs-implementation notes.)

### Risks

- **The policy is read on every secret-resolve directly from `authorized_groups`** (no config cache, unlike 5a's guardrail policy). Lookups are cheap (indexed by `groupId`), but a group with a stale `coding_identity` row vs. an admin's intent is only eventually consistent with a re-save.
- **`chatUserId` is the sole identity key.** A mis-keyed user id (platform normalization drift) would resolve the wrong personal context. The auth-layer normalization that makes DM/personal contexts keyable by user id is the load-bearing assumption; a platform that did not normalize would mis-resolve.
- **Designated absence is a save-time, not start-time, check.** A designee removed from `group_members` after nomination keeps resolving to their vault until an admin re-saves; a session started in that window runs under the departed designee's creds if they still exist.
- **The settings-UI member `<select>` can be empty** (a group with no listed members), which previously let the client submit `designated:` with an empty user id; the server still 422s via `isGroupMember`, but follow-up hardening (see notes) added a client-side disable + save-locking Selects to avoid the confusing round-trip.

## Related Decisions

- **ADR-0234: Phase 5a — Operator Guardrails** — the immediate sibling; 5b composes on top of 5a's `forceSharedKey` (`sharedKeyContext ?? identityContext`, provider-key only) and threads through the same secrets facade 5a's shared-key resolver lives in.
- **ADR-0231: Phase 4b — Typed Forge Connections + Self-Hosted GitLab** — the per-identity forge token 5b redirects to the acting identity's context (and force-shared-key deliberately does not override).
- **ADR-0230: Phase 4a — Multi-Provider + Agent Picker** — the per-identity agent/provider choice 5b's `resolveAgent`/`resolveAgentSecrets` now read per-initiator.
- **ADR-0221: Phase 1 — Agent-Credential Vault and Per-Session Secret Channel** — the encrypted vault + reserved-context model whose read site 5b retargets from `configContextOf` to `identityContext`.
- **ADR-0228: ACP Plugin Phase-3 Cleanup** — the cleanup that removed `review_pr`, which is why A3's refusal wording covers `start_session` + `continue_session` instead.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`; the papai A1/A2/A3 commit messages match the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `src/db/schema.ts:110` | `authorizedGroups.codingIdentity` column (`.notNull().default('initiator')`). | `read` confirms. |
| `src/db/migrations/065_coding_identity.ts:13-24,26` | `columnExists`-guarded `ALTER TABLE … ADD COLUMN coding_identity …`; `migration065CodingIdentity`. | `read` confirms. |
| `src/db/index.ts:78,184` | Migration registered (import + `MIGRATIONS` entry after `064`). | `grep` confirms. |
| `src/authorized-groups.ts:80-87,94-101` | `getGroupCodingIdentity` (default `'initiator'`) + `setGroupCodingIdentity`, mirroring the `guestMode` template. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:37-49` | `identityContext` — legacy/non-scoped → `configContextOf`; `shared` → group ctx; `designated:<u>` → u's personal ctx; `initiator` → `toScopedContextId({ pi, chatUserId })`. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:66-68,127-129` | `resolveAgentSecrets` + `resolveProviderHost` resolve at `sharedKeyContext(...) ?? identityContext(...)` (5a force-shared-key wins, provider-key only). | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:91-95,102-106,112-116,142-146` | `resolveAgent` / `resolveModel` / `resolveForgeToken` / `resolveForge` read at `identityContext` only (forge/agent/model stay per-identity). | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:21-44` | `buildCodingSecretsFacade(...)` takes `chatUserId` and threads it to all resolvers (extracted module — see notes). | `read` confirms. |
| `src/plugins/tool-runtime.ts:230-234` | Call site passes `runtime.chatUserId` into `buildCodingSecretsFacade`. | `grep` confirms. |
| `src/debug/settings/group-routes.ts:71,142-149,151-174,256-258` | `VALID_PLAIN_IDENTITIES = { initiator, shared }`; `GET` (`read`) + `PATCH` (CSRF + `write`) routes; `designated:<u>` validated via `isGroupMember` (422). | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:14,57,78,106,129,139,143` | Initiator/shared/designated control + member `<select>` (parallel members fetch); `designatedEmpty` save-disable. | `read` confirms. |
| `client/settings/fetchers.ts:250-256` | `fetchGroupCodingIdentity` / `patchGroupCodingIdentity`. | `grep` confirms. |
| `client/settings/fetcher-schemas.ts:222-223` | `GroupCodingIdentityResponseSchema` + type. | `grep` confirms. |
| `client/settings/SettingsApp.svelte:31,116,223` | Section imported; "Session identity" sidebar item; rendered in the `{#if isGroup}` block. | `grep` confirms. |
| `client/settings/sections/CodingIdentitySection.stories.svelte` | Storybook stories (Populated/Empty/Error/Loading) + MSW handlers in `client/stories/msw/settings-handlers-group.ts`. | `grep` confirms. |
| `plugins/acp/session-tools.ts:35-62` | `resolveStartSessionAccess` returns `not_configured` with "your coding credentials" wording (used by `start_session`). | `read` confirms. |
| `plugins/acp/continue-tool.ts:29-31` | `continue_session` carries the same per-identity `not_configured` wording. | `grep` confirms. |
| `docs/architecture/coding-sessions.md:82-92` | §"Group-session identity (Phase 5b)" — the three policy values, `identityContext` threading, force-shared-key composition, refuse-don't-fall-back. | `read` confirms. |
| `tests/coding-credentials/resolve-agent-secrets.test.ts`, `tests/debug/settings/group/coding-identity-routes.test.ts` | Group initiator/shared/designated resolution + DM identity guard; route read/write/422 (designated non-member)/403 round-trip. | `glob` confirms. |
| papai commits `7c3c2c5bb`, `29bf6eea6`, `13075f164` | A1/A2/A3 commit messages match the plan verbatim. | `git log` confirms. |

Plan-vs-implementation notes:

- **The behavior doc landed in `coding-sessions.md`, not `CLAUDE.md`.** The plan's A3 step 3 named the root `CLAUDE.md` as the doc target. The shipped documentation lives in `docs/architecture/coding-sessions.md` §"Group-session identity (Phase 5b)" — the canonical home for this surface, alongside the Phase-5a and follow-up-coding-sessions sections. The root `CLAUDE.md` has no `coding_identity` reference.
- **The secrets facade was extracted into its own module.** The plan said "Modify `src/plugins/tool-runtime.ts` — thread `chatUserId` into `buildCodingSecretsFacade`." The shipped `buildCodingSecretsFacade` lives in `src/plugins/coding-secrets-facade.ts` (its own module, alongside `buildCodingReposFacade`), wired from `tool-runtime.ts:230`. The threading behavior is exactly as planned; only the file home differs (a structural split that post-dates the plan).
- **`resolveModel` also gained `chatUserId`** beyond the plan's five resolvers. The plan listed `{ resolveAgentSecrets, resolveProviderHost, resolveForgeToken, resolveForge, resolveAgent }`. A sixth resolver, `resolveModel` (`resolve-agent-secrets.ts:102-106`), was added by a later change (`0a15bdbaf feat(coding-sessions): add per-identity model to agent-provider vault + projectSpec`) and reads at `identityContext` too — consistent with 5b's model, but not in the original plan. (The MCP resolvers `resolveMcpServers`/`resolveMcpTokens` likewise thread `chatUserId`, but those arrived with the Phase-3A MCP-broker feature, not 5b.)
- **`review_pr` is gone, so A3 covers `start_session` + `continue_session`.** The plan's A3 referenced "start_session + review_pr." `review_pr` was dropped in the ACP cleanup (ADR-0228, commit `58d84860d`), so the per-identity refusal wording now lives in `resolveStartSessionAccess` (used by `start_session`) and the continue-session resolver (`plugins/acp/continue-tool.ts`). `continue_session` itself post-dates 5b (it is the follow-up-coding-sessions feature); its `not_configured` wording mirrors 5b's phrasing.
- **The `CodingIdentitySection` was hardened in a follow-up.** A later UX review (`docs/ux-reviews/CodingIdentitySection.md`) found the client could submit `designated:` with an empty user id when the member list was empty (the server still 422s via `isGroupMember`, but the round-trip was confusing). A fixes plan (`docs/archive/2026-07-07-coding-identity-fixes-design.md`; ADR-0261) added a client-side `designatedEmpty` save-disable, Select-locking during save (`26a0d096c`), a stale-`contextId` load guard (`083e1e8d0`), refresh-failure resilience (`bfd8be06d`), and shared `t-label` styling (`d8fdbeba3`). These are post-5b hardening, not part of the original plan.
- **The designated-departure open question was resolved toward *refuse*.** The spec left open whether a designee who leaves the group should trigger refusal or auto-revert to `initiator`. The shipped behavior refuses (`not_configured` if the designee has no creds); membership is re-checked only at save, not at session start, matching the spec's recommendation.

The source plan `docs/superpowers/plans/2026-06-27-phase-5b-group-session-identity.md` and design `docs/superpowers/specs/2026-06-27-phase-5b-group-session-identity-design.md` are archived alongside this ADR to `docs/archive/`.
