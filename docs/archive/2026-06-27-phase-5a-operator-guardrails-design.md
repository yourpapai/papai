<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5a — Operator Guardrails — Design

**Date:** 2026-06-27
**Status:** Draft (detailed spec; spawns a plan)
**Parent:** `docs/superpowers/specs/2026-06-27-phase-5-guardrails-identity-design.md` (§ 5a)
**Builds on:** Phases 1–4 (shipped)

## Scope

A bot-admin can **bound** what users self-serve in coding sessions:

- **allowed agents** — restrict the agent set (subset of claude/codex/opencode);
- **who-may-use** — gate who may _start_ a session;
- **force-shared-key** — optionally run all sessions on an operator-provided
  agent-provider key instead of each user's BYO key;

and **magi enforces** the safety floor server-side:

- **allowed-agent enforcement** on the inline `projectSpec` (defense in depth);
- **`MAGI_EGRESS_CEILING` fail-fast** (the deferred 4c item) — a clear rejection
  when a derived egress host is over-ceiling, instead of geofront's silent clamp;
- **per-user rate limits** on `/sessions` + `/reviews`.

## Current state (grounded)

- **Policy enforcement point for tool exposure** is `src/llm-orchestrator-tools.ts`:
  `actorRole` is in scope there and `applyGuestReadOnlyFilter(descriptors)` runs
  when `actorRole === 'guest'`. **who-may-use filters the acp session-tool
  descriptors at this same stage** — no need to thread role into the plugin.
- `actorRole` is currently **`guest | member`** (`bot.ts:204`); there is no
  `admin` role. **Guests already cannot start sessions** — the read-only filter
  strips write/open-world tools (which the acp session tools are). So who-may-use
  operates among **non-guests**.
- **Credential resolution is host code** (`resolveAgentSecrets` in
  `src/coding-credentials/resolve-agent-secrets.ts`), called by the plugin facade.
  **force-shared-key lives in the resolver**, not the plugin.
- magi's **image is operator-set** via `defaults.workspaceImage`
  (`src/project/config.ts`), **not user-chosen** — so "allowed images" is already
  enforced by the operator picking the image; **5a drops the allowedImages
  guardrail** as redundant.
- magi `validateRepoSpec(value, policy)` validates the agent only for **enum
  validity** (`isSpecAgent`), not against an operator allowlist; it already
  host-allowlists repo + forge hosts via `policy.allowedHosts`. **No rate-limit
  infra exists** in magi — 5a adds one.
- papai admin config precedent: `__admin_tool_defaults__:<platformInstanceId>`
  (a reserved per-instance context). Guardrails mirror this.

## Locked decisions

1. **allowedImages dropped** — the workspace image is operator-controlled
   (`defaults.workspaceImage`); a per-spec image allowlist is redundant.
2. **force-shared-key forces the agent-provider key only**, not a shared forge
   identity. The forge token stays per-identity so PR/commit authorship is
   correct. (Shared forge identity, if ever wanted, is a separate later toggle.)
3. **who-may-use v1 = `members` (default) | explicit user-id allowlist.**
   `admins-only` is deferred — it needs an admin signal the current `actorRole`
   lacks (would require the group-admin live/observation lookup). Guests are
   already excluded by the read-only filter.
4. **Dedicated `MAGI_EGRESS_CEILING`** (operator config), separate from
   `MAGI_ALLOWED_REPO_HOSTS` — egress and repo-host are different surfaces. The
   geofront org-ceiling remains the ultimate hard bound; this is an earlier,
   friendlier gate that returns a clear error.
5. **Guardrail policy lives in papai admin config**, per platform instance
   (reserved key `__admin_coding_guardrails__:<platformInstanceId>`,
   super-admin), read **host-side** at the two enforcement points (orchestrator
   tool-filter; resolver). The shared key is a sibling **sensitive** admin value.

## Design — papai

### Guardrail config + admin section

- Reserved per-instance config (super-admin) — shape:
  `{ allowedAgents: string[], whoMayUse: 'members' | string[], forceSharedKey:
boolean }`. The operator **shared agent-provider key** (used only when
  `forceSharedKey`) is stored encrypted as a sensitive sibling value
  (provider + key + base URL, like a user's `agent-provider` vault but
  admin-owned).
- Settings-UI admin **"Coding Sessions guardrails"** section + route
  `GET/POST /settings/api/admin/coding-guardrails` (mirrors
  `/settings/api/admin/tool-defaults`). The forge-host allowlist
  (`MAGI_ALLOWED_REPO_HOSTS`, magi-owned) is shown **read-only** for transparency.
- A `resolveCodingGuardrails(platformInstanceId)` reader (default-allow when
  unset: all agents, `members`, `forceSharedKey: false`).

### Enforcement

- **allowed agents (UX):** the AI-provider/agent settings section filters the
  **agent** `<select>` to `allowedAgents` for that instance. Authoritative
  enforcement is magi (below); the picker filter is UX only.
- **who-may-use:** in `llm-orchestrator-tools.ts`, alongside the guest filter,
  drop the acp session-action tool descriptors (`plugin_acp__start_session`,
  `…__review_pr`, and the other state-changing acp tools) when the actor is not
  permitted by the instance's `whoMayUse` (`members` → any non-guest; allowlist →
  `chatUserId ∈ list`). Read-only acp tools (list/status) may stay. Reference-
  identical when `whoMayUse === 'members'`.
- **force-shared-key:** in `resolveAgentSecrets` (and `resolveProviderHost`),
  derive `platformInstanceId` from the storage context, read the guardrail; when
  `forceSharedKey`, return the operator shared key's env-mapped secrets (and its
  provider host) instead of the user's vault. `resolveForgeToken`/`resolveForge`
  are **unchanged** (forge stays per-identity).

## Design — magi

- **allowed-agent enforcement:** extend `RepoPolicy` with `allowedAgents?:
string[]`; in `validateRepoSpec`, after the enum check, reject (400
  `agent not permitted: <agent>`) when `allowedAgents` is set and the spec agent
  is not in it. Operator config sources `allowedAgents`.
- **`MAGI_EGRESS_CEILING` fail-fast:** add `egressCeiling?: string[]` to the
  policy/config; after `deriveEgress` (in `buildEphemeralProject` or at intake),
  if any derived host ∉ `egressCeiling ∪ SAAS_API_HOSTS`, reject 400
  (`egress host not permitted by operator ceiling: <host>`). When `egressCeiling`
  is unset, behavior is unchanged (no fail-fast; geofront still clamps).
- **per-user rate limit:** an in-memory token-bucket/fixed-window keyed by the
  session's `contextId` (the user/group the session runs under), applied in
  `src/server/router.ts` for `POST /sessions` + `POST /reviews`; over-limit → 429
  with a retry hint. Operator-tunable window/limit via config; default generous.
  In-memory (single-process) is acceptable for v1, matching magi's deployment.

## Proposed task breakdown (for the plan)

- **A1 (papai):** guardrails admin config + reader + settings section + route;
  agent-picker filter. (`__admin_coding_guardrails__` + `/settings/api/admin/coding-guardrails`.)
- **A2 (papai):** force-shared-key — shared-key sensitive admin value +
  `resolveAgentSecrets`/`resolveProviderHost` injection (forge untouched).
- **A3 (papai):** who-may-use — descriptor filter in `llm-orchestrator-tools.ts`.
- **B1 (magi):** allowed-agent enforcement + `MAGI_EGRESS_CEILING` fail-fast.
- **B2 (magi):** per-user rate limit on `/sessions` + `/reviews`.

A1→A2→A3 (papai, shared files); B1∥B2 (magi) parallel to the A-tasks.

## Security

- **Server-authoritative:** papai-side checks (picker filter, tool-descriptor
  filter) are UX/coarse gating; **magi re-enforces** allowed-agent + egress
  ceiling on the inline project so a forged/stale client cannot exceed policy.
- **force-shared-key** keeps the operator key admin-owned and encrypted; it never
  reaches a user-visible surface and is redacted in logs like other secrets.
- **Rate limits** bound sandbox/key abuse. **No new user secrets**; the only new
  stored secret is the operator shared key (admin config, encrypted at rest).

## Out of scope (5a)

- Group-session identity (5b) and redaction audits (5c).
- `admins-only` who-may-use (needs the admin signal; later).
- Distributed/persistent rate limiting (in-memory v1).
- Raising the geofront ceiling from magi (forever geofront-owned).

## Testing

- Guardrail config round-trips (super-admin gated; 422 on bad shape); default-allow
  when unset.
- Agent picker filtered to `allowedAgents`; magi rejects a disallowed agent (400).
- who-may-use: allowlisted user keeps the acp session tools, non-allowlisted
  non-guest loses them; `members` is reference-identical.
- force-shared-key: ON injects the operator key (not the user's), forge token
  still the user's; OFF is reference-identical.
- `MAGI_EGRESS_CEILING`: an over-ceiling derived host → 400 with a clear message;
  unset ceiling → unchanged.
- Rate limit: N+1th call within the window → 429.

## Files touched (anticipated)

**papai:** new `src/coding-credentials/guardrails.ts` (reader) + admin store/route
(`src/debug/settings/admin/*`), `client/settings/sections/*` (admin guardrails
section + agent-picker filter), `src/coding-credentials/resolve-agent-secrets.ts`
(force-shared-key), `src/llm-orchestrator-tools.ts` (who-may-use filter),
`CLAUDE.md`, tests.

**magi:** `src/project/config.ts` (allowedAgents + egress-ceiling in policy),
`src/server/router.ts` (rate limit), operator config plumbing, tests.

## Open questions

- **who-may-use `admins-only`:** worth wiring the group-admin lookup now, or defer
  (assumed defer; v1 = members | allowlist)?
- **Shared-key provider:** does the operator shared key support a custom base URL /
  `openai-compatible` (assumed yes — reuse the agent-provider shape), and does
  forcing it also pin the **agent** (e.g. force claude) or only the provider key?
- **Rate-limit key:** per `contextId` (assumed) vs per acting user across contexts
  vs per provider key. And the default window/limit values.
- **B-task split:** B1 (agent+ceiling) ∥ B2 (rate-limit) as proposed, or one magi
  commit?
