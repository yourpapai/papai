<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5 — Admin Guardrails + Group-Session Identity + Hardening — Design

**Date:** 2026-06-27
**Status:** Draft (design + decomposition; spawns per-sub-phase plans)
**Parent roadmap:** `docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md` (§ Phase 5)
**Builds on:** Phases 1–4 (1, 2, 3, 4a, 4b, 4c all shipped)

## Scope

Phase 5 is the **safety envelope** around the now-complete self-serve stack
(Story 6). Three concerns, each shippable on its own:

1. **Operator guardrails** — a bot-admin can bound what users self-serve: which
   **agents** and **base images** are allowed, which **forge hosts** are
   permitted, **who may start** sessions, and an optional **force-shared-key**
   (operator-provided org key instead of BYO). magi **enforces** these on the
   inline `projectSpec`, adds the deferred **fail-fast egress-ceiling** rejection,
   and applies **per-user rate limits**.
2. **Group-session identity** — make a group session run under the **acting
   user's personal credentials** by default (their key, their forge identity),
   not the group-shared vault it uses today, with a per-group policy toggle.
3. **Redaction hardening** — audits/tests proving no secret reaches a store, log,
   or magi response, plus the reference-identical not-configured paths.

## Current state (grounded)

- **All coding-credential resolvers** (`src/coding-credentials/resolve-agent-secrets.ts`)
  resolve at `configContextOf(storageContextId)` =
  `getConfigContextIdFromStorageContextId` — which for a group is the
  **group-shared** config-context. **So a group session uses group-shared creds
  today**; the roadmap's stated "acting user's personal context" default is
  **not yet implemented** — that is 5b.
- `chatUserId` **is** available in the plugin runtime
  (`buildPluginToolRuntimeContext` carries `runtime.chatUserId`,
  `src/plugins/tool-runtime.ts`), but `buildCodingSecretsFacade(pluginId,
storageContextId, perm)` is **not** passed it. Threading `chatUserId` into the
  facade is the lever for per-initiator resolution.
- A user's **personal** config-context id is
  `toScopedContextId({ platformInstanceId, nativeContextId: <user DM id> })`
  (`src/chat/scoped-context.ts`); the `platformInstanceId` is parseable from the
  group context id via `parseScopedContextId`.
- magi already validates `repoUrl` host **and** forge `apiBaseUrl` host against
  `MAGI_ALLOWED_REPO_HOSTS` (`validateRepoSpec`, Phase 3/4b). Phase 5 extends
  policy enforcement to **agent/image** and adds the **egress-ceiling** fail-fast
  - **rate limits**.
- Admin config already exists for coding sessions: `magi_base_url`/`magi_token`
  (acp plugin admin config). Guardrail policy is new admin-scoped config.

## Decomposition

| Sub    | Title                  | papai                                                                                                                                                                                                             | magi                                                                                                                    |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **5a** | Operator guardrails    | admin "Coding Sessions guardrails" section (allowed agents/images, forge-host allowlist view, who-may-use, force-shared-key); enforce who-may-use + allowed-agent at session-start; inject shared key when forced | enforce allowed agent/image on inline `projectSpec` (reject); **`MAGI_EGRESS_CEILING` fail-fast**; per-user rate limits |
| **5b** | Group-session identity | thread `chatUserId` → resolve **initiator's personal** creds in a group; per-group identity policy (initiator vs designated member); refuse-when-unconfigured                                                     | none (papai chooses which context's secrets to inject)                                                                  |
| **5c** | Redaction hardening    | redaction audit tests (store/logs); not-configured reference paths                                                                                                                                                | secret-redaction tests (logs/responses); not-configured reference paths                                                 |

Each sub-phase produces working, testable software. Suggested order **5a → 5b →
5c** (guardrails bound the surface first; identity next; hardening last, though
5c is order-independent). Decomposition into per-sub-phase plans follows the
Phase-4 pattern.

## Key policy decisions (recommendations to confirm)

1. **Group-session identity default → the initiator's personal creds.**
   _Recommended._ A coding session produces real-world artifacts (commits, PRs)
   under a human identity; that should be the **acting user's**, not a shared
   group token (correct attribution, no accidental use of another member's PAT).
   Matches the roadmap's stated default. **Per-group override:** a group admin may
   nominate a **designated identity** (one member whose personal creds the group's
   sessions use — a "team bot" pattern). **Refusal:** when the initiator (or
   designated member) has no personal coding creds, refuse with a clear "configure
   your coding credentials in a DM with me" — never silently fall back to a
   different identity. _Alternative:_ keep group-shared-by-default (simpler, but
   mis-attributes and crosses user boundaries — rejected).
2. **`force-shared-key` toggle (per-instance, operator).** _Recommended:_ support
   it, default **off** (BYO). When **on**, the operator stores a shared
   agent-provider key (admin config) and **all** sessions use it instead of the
   user's — for orgs that want one billing/identity. Resolution precedence:
   `force-shared-key (operator)` → else the **identity policy** (5b: initiator /
   designated) → else error. Forge identity: the shared-key toggle covers the
   **agent-provider** key; whether it also forces a **shared forge** identity is
   decision 5 below.
3. **`MAGI_EGRESS_CEILING` fail-fast (the 4c deferral).** _Recommended._ magi
   gains an operator-config ceiling list; at session start it checks the derived
   egress against it and **rejects with a clear error** ("provider host X not
   permitted — ask your operator") instead of geofront's silent clamp. This is the
   admin-guardrail home for the 4c-deferred UX fix. The geofront org-ceiling
   remains the ultimate hard bound; this is an earlier, friendlier gate.
4. **who-may-use scope.** _Recommended:_ a per-instance/per-group setting gating
   **session start** to a role — `members` (default), `admins-only`, or an
   explicit allowlist. Enforced in papai at the acp tool layer (the
   `start_session`/`review_pr` tools refuse for disallowed actors) so it composes
   with the existing tool-permission model.
5. **Allowed agents / images + forge-host allowlist surfacing.** _Recommended:_
   an **allowed-agents** subset (of claude/codex/opencode) and **allowed base
   images** list in admin config; papai hides disallowed agents in the picker and
   refuses them at start; magi **re-enforces** on the inline `projectSpec`
   (defense in depth — the policy lives operator-side, not trust-the-client). The
   forge-host allowlist (`MAGI_ALLOWED_REPO_HOSTS`) is **surfaced read-only** in
   the admin section (it's owned by magi's env; papai shows it for transparency).

## Design — 5a (operator guardrails)

- **papai admin config** (super-admin, per platform instance) under a reserved
  key (e.g. `coding_guardrails`): `{ allowedAgents: string[], allowedImages?:
string[], whoMayUse: 'members'|'admins'|string[], forceSharedKey: boolean }`.
  Settings-UI admin **"Coding Sessions guardrails"** section + route
  (`GET/POST /settings/api/admin/coding-guardrails`). Forge-host allowlist shown
  read-only (fetched from magi or mirrored from operator config).
- **Enforcement (papai):** the acp `start_session`/`review_pr` tools consult the
  guardrails: refuse a disallowed agent / unauthorized actor; when
  `forceSharedKey`, inject the operator's shared agent-provider creds (a new
  admin-config secret namespace) instead of `resolveAgentSecrets`.
- **magi:** `validateRepoSpec`/intake enforces `allowedAgents`/`allowedImages`
  from operator config on the inline `projectSpec` (reject 400 on violation);
  `MAGI_EGRESS_CEILING` fail-fast (reject when a derived egress host is
  over-ceiling); **per-user rate limit** (keyed by the `contextId`/user the
  session runs under) on `/sessions` + `/reviews`.

## Design — 5b (group-session identity)

- Pass `chatUserId` into `buildCodingSecretsFacade`; add a resolution-scope
  decision: in a **group** context, resolve at the **initiator's personal**
  config-context (`personalConfigContextOf(platformInstanceId, chatUserId)`),
  subject to the per-group identity policy; in a **DM**, unchanged (already
  personal).
- **Per-group identity policy** (group-admin setting, e.g.
  `authorized_groups.coding_identity` = `initiator` | `designated:<userId>`):
  `initiator` resolves the acting user's creds; `designated` resolves the
  nominated member's. Stored group-side; read at resolution.
- **Refusal:** when the resolved identity has no agent-provider/forge creds,
  `start_session`/`review_pr` return `not_configured` naming whose creds are
  missing and how to set them — no silent cross-identity fallback.
- **Precedence with 5a:** `forceSharedKey` (operator) wins over the identity
  policy; otherwise the policy selects the personal context.

## Design — 5c (redaction hardening)

- **papai:** tests asserting no secret (provider key, forge token, shared key)
  is written to any store column unencrypted, nor logged (extend the Phase-1
  redaction assertions to the 4a/4b/4c/5a additions); confirm the
  not-configured paths are reference-identical.
- **magi:** tests asserting request secrets (provider keys, forge token) never
  appear in logs or `/sessions`/`/reviews` responses, the persisted
  `project_spec`, or error bodies; not-configured reference path.

## Security

- **Guardrails are operator-owned and server-enforced.** papai-side checks are
  UX; magi **re-enforces** agent/image/host/ceiling on the inline project so a
  forged or stale client cannot exceed policy. Consistent with the
  operator-owns-guardrails / magi-holds-no-user-secrets model.
- **Group identity removes a cross-user boundary violation:** today a group
  member's session can push under another member's group-shared forge token; 5b
  scopes it to the acting (or explicitly designated) human. Refuse-don't-fallback
  prevents silent identity substitution.
- **Rate limits** bound abuse of user-supplied keys/sandboxes. **Redaction
  audits** are release-gating like the `/stats` anonymity contract.
- No new long-lived secrets except the optional operator **shared key** (admin
  config, encrypted like other admin secrets).

## Out of scope (Phase 5)

- Raising the geofront org-ceiling from magi (forever geofront-owned).
- Billing/quota accounting beyond rate limits; multi-org tenancy.
- Moving git into the sandbox (would reopen the 4c repo-host-egress decision).

## Testing

- 5a: guardrail config round-trips; disallowed agent/actor refused (papai tool +
  magi intake); force-shared-key injects the shared creds; ceiling fail-fast
  returns a clear 4xx; rate-limit trips.
- 5b: group session resolves initiator creds (not group-shared); designated-member
  policy; refuse-when-unconfigured; DM path unchanged; precedence with
  force-shared-key.
- 5c: redaction assertions (papai store/logs; magi logs/responses/persisted spec);
  not-configured reference-identical paths.

## Files touched (anticipated)

**papai:** `src/coding-credentials/resolve-agent-secrets.ts` (personal-context
resolution + a `personalConfigContextOf` helper), `src/plugins/tool-runtime.ts`
(thread `chatUserId` into `buildCodingSecretsFacade`), `src/plugins/runtime-types.ts`,
`plugins/acp/{session-tools,tools}.ts` (guardrail + who-may-use checks), new
admin guardrails route + settings-UI section, group identity setting + migration,
`CLAUDE.md`, tests.

**magi:** `src/project/config.ts` / intake (`allowedAgents`/`allowedImages`
enforcement, egress-ceiling check), `src/server/router.ts` (rate limit), operator
config plumbing, tests.

## Open questions

- **Decision 1 (group identity default):** initiator (assumed) vs group-shared vs
  always-designated. Confirm the per-group override shape
  (`initiator`/`designated:<userId>`).
- **Decision 2/5 (force-shared-key scope):** does the shared key force only the
  **agent-provider** key, or also a **shared forge** identity? (Recommend
  agent-provider only; forge stays per-identity for correct PR attribution.)
- **Decision 3 (ceiling config):** a dedicated `MAGI_EGRESS_CEILING`, or reuse /
  derive from `MAGI_ALLOWED_REPO_HOSTS` ∪ a provider-host allowlist? (Recommend a
  dedicated egress ceiling — egress and repo-host are different surfaces.)
- **who-may-use storage:** per-platform-instance admin config vs per-group toggle
  vs both (DM = instance default; group = group setting).
- **Sub-phase sizing:** is 5a too large (admin UI + papai enforcement + 3 magi
  concerns)? Consider splitting magi rate-limit/redaction into 5c.
