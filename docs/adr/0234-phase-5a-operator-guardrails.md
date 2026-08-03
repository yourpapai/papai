<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0234: Phase 5a — Operator Guardrails

## Status

Implemented (with divergence)

## Date

2026-06-27

## Context

Phases 4a–4c (ADRs 0230–0232) made coding sessions self-serve end-to-end: a user picks an agent + provider (4a), connects a typed forge (4b), and the sandbox egress is derived per session (4c). But once a coding session runs, **nothing bounds what a user may self-serve** — every member of a platform instance could start any agent, on their own BYO key, against any allowed repo, with no operator-set ceiling on session churn. A bot-admin had no lever to say "on this instance, only `claude` is permitted," "only these two users may start sessions," or "all sessions run on the operator's key, not each user's." magi likewise enforced no operator allowlist on the agent and had **no rate limit** at all on `/sessions`/`/reviews`, so a runaway client could churn sessions unbounded.

The parent decomposition (`docs/superpowers/specs/2026-06-27-phase-5-guardrails-identity-design.md`) split Phase 5 into sub-phases. **5a's scope** (this ADR) is the operator/group-level guardrail half: a per-platform-instance guardrail policy (`allowedAgents` / `whoMayUse` / `forceSharedKey`) stored in papai admin config, enforced host-side (the agent-picker filters, the orchestrator tool-descriptor filter, and the secret resolver), with magi **re-enforcing** the safety floor server-side (allowed-agent on the inline `projectSpec`, an egress-ceiling fail-fast, and a per-context rate limit). **Deliberately deferred** to later sub-phases: group-session identity (5b), redaction audits (5c), and an `admins-only` `whoMayUse` mode (it needs a group-admin signal the current `actorRole` lacks).

The design premise was that the guardrail policy mirrors the existing `__admin_tool_defaults__:<platformInstanceId>` reserved-context precedent — a per-instance admin config key — so it needs **no DB migration**. The operator shared key reuses the encrypted `coding_session_credentials` store at that admin context (an `agent-provider` vault), and the who-may-use filter slots into `buildFullToolSet` alongside the existing guest read-only filter (`actorRole` is already in scope there). Guests are already excluded from session tools by the read-only filter, so who-may-use operates **among non-guests**.

## Decision Drivers

- **Bound coding-session self-serve** — the headline goal; an operator needs levers (which agents, who may use, whose key) the 4a–4c self-serve model lacked.
- **Per-platform-instance policy, default-allow / reference-identical when unset** — mirror `__admin_tool_defaults__`; a platform instance with no configured guardrail behaves exactly as before, so 5a is non-breaking.
- **Host-side enforcement reuses existing hooks** — the agent-picker and `buildFullToolSet` already run host-side; who-may-use slots in next to the guest filter, and `resolveAgentSecrets`/`resolveProviderHost` already own provider-key resolution, so force-shared-key lives there. No plugin change.
- **Server-authoritative re-enforcement** — papai-side filters (picker, descriptor filter) are UX/coarse gating; magi re-enforces allowed-agent on the inline `projectSpec` so a forged/stale client cannot exceed policy. Defense in depth.
- **force-shared-key forces the agent-provider key only, not the forge identity** — the forge token stays per-identity so PR/commit authorship is correct. (A shared forge identity, if ever wanted, is a separate later toggle.)
- **`allowedImages` dropped as redundant** — magi's workspace image is already operator-set (`defaults.workspaceImage`), not user-chosen, so a per-spec image allowlist adds nothing.
- **In-memory rate limit for v1** — matching magi's single-process deployment; a fixed-window counter keyed by `contextId` mirrors the simple `Map` state pattern already in use.
- **TDD, two repos, explicit `git add` paths** — the plan knits into the write-hook pipeline and the cross-repo (papai + magi) coordination discipline.

## Considered Options

### Option 1: Per-instance admin config + host-side enforcement + magi re-enforcement (chosen)

Store the policy at `__admin_coding_guardrails__:<platformInstanceId>` (config key `coding_guardrails`); read it host-side at the three enforcement points (orchestrator tool-filter, agent-picker, secret resolver); re-enforce allowed-agent + rate-limit in magi; the shared key is an `agent-provider` vault at the admin context.

- **Pros:** no DB migration; reuses the reserved-context + encrypted-vault plumbing; default-allow is a natural unset path; server-authoritative re-enforcement closes the client-forgery gap; the who-may-use filter composes with the existing guest filter for free; force-shared-key keeps PR authorship per-identity.
- **Cons:** touches two repos (papai + magi) in one coordinated change; the policy is read host-side on every tool-build / secret-resolve, so a stale cached config could briefly lag an admin edit (the config cache is the existing tradeoff); an `admins-only` mode is not expressible without a group-admin signal.

### Option 2: Enforce only in magi (server-authoritative only)

Drop the papai-side picker/descriptor filters; let magi reject at intake.

- **Pros:** single enforcement point; no host-side policy read.
- **Cons:** loses the UX (a user picks a disallowed agent and only learns at session start); the who-may-use tool-descriptor filter has no magi analogue (magi never sees the tool descriptors), so the coarse gating disappears entirely. Defense in depth is lost.

### Option 3: Per-group (config-context) policy instead of per-instance

Scope the policy to each group rather than the platform instance.

- **Pros:** finer granularity.
- **Cons:** the coding-identity model (5b) did not yet exist at 5a's design time, so per-group resolution was premature; the platform instance is the natural billing/key boundary for an operator shared key. Deferred.

## Decision

The chosen Option 1 shipped across both repos in three papai tasks + two magi tasks. What shipped:

### Part A — papai

1. **A1 — guardrail policy + reader + admin route + admin section + agent-picker filter.** `src/coding-credentials/guardrails.ts` defines a Zod `guardrailsSchema` (`allowedAgents`/`whoMayUse`/`forceSharedKey`) with an `adminCodingGuardrailsContextId(pi)` reserved-context id and a `resolveCodingGuardrails(pi)` reader that returns defaults (allow-all) when unset. The admin route `GET/POST /settings/api/admin/coding-guardrails` (`src/debug/settings/admin/coding-guardrails-routes.ts`) is admin-gated + CSRF-protected; the POST body is discriminated (`policy`/`shared-key`/`shared-key-clear`), the GET returns `{ guardrails, sharedKeySet }` and **never** the key value. The route is registered in `settings-api-router.ts`. The agent-picker in the coding-credentials settings route adds `allowedAgents` to its response, and `CodingCredentialsSection.svelte` filters its agent `<select>` to it.
2. **A2 — force-shared-key resolution.** A private `sharedKeyContext(storageContextId)` helper in `resolve-agent-secrets.ts` derives the platform instance from the storage context, reads the guardrail, and returns the admin context id when `forceSharedKey` is on (else null). `resolveAgentSecrets` and `resolveProviderHost` resolve against `sharedKeyContext(...) ?? identityContext(...)`; `resolveAgent`, `resolveForgeToken`, `resolveForge`, and `resolveModel` keep reading the identity context — so the shared key overrides only the provider key + host, never the agent or the forge identity.
3. **A3 — who-may-use tool-descriptor filter.** `applyWhoMayUseFilter(tools, whoMayUse, chatUserId)` in `src/llm-orchestrator-tools.ts` returns `tools` reference-identical when `whoMayUse === 'members'` (the default); for an allowlist it drops the ACP session-action tools (`start_session`/`continue_session`/`finish_session`/`cancel_session`/`answer_permission`) when the actor is off the list, leaving the read-only acp tools. Applied in `buildFullToolSet` after the guest/pref filter via `parseScopedContextId(contextId)?.platformInstanceId`.

### Part B — magi (separate repo)

4. **B1 — allowed-agent enforcement.** `RepoPolicy` gains `allowedAgents?: readonly string[]`; `validateRepoSpec` rejects with `agent not permitted: <agent>` when the policy is set and the spec agent is not in it. `buildPolicy()` in `main.ts` sources it from `MAGI_ALLOWED_AGENTS`.
5. **B2 — per-context rate limit on `/sessions` + `/reviews`.** A fixed-window `createRateLimiter(limit, windowMs)` (`src/server/rate-limit.ts`) keyed by `contextId`; injected via `ServerDeps.rateLimiter`; `handleStart`/`handleReview`/`handleFollowUp` return 429 when over limit. `main.ts` constructs it from `MAGI_SESSION_RATE_LIMIT` (default 20) and `MAGI_SESSION_RATE_WINDOW_MS` (default 3_600_000).

## Consequences

### Positive

- An operator can bound coding-session self-serve per platform instance: restrict the agent set, gate who may start a session, and force all sessions onto an operator-provided key — the headline gap from 4a–4c is closed.
- All three guardrails are default-allow / reference-identical when unset, so a platform instance with no configured policy behaves exactly as before — 5a is non-breaking.
- magi re-enforces allowed-agent on the validated `projectSpec`, so a forged/stale client cannot exceed the picker filter; the router-agent reconciliation (see Implementation Notes) closes the bypass where the launch agent was once read from the unvalidated `body.agent`.
- force-shared-key keeps PR/commit authorship per-identity (the forge token + agent stay user-scoped), so an operator-shared provider key does not collapse audit identity.
- The who-may-use filter composes with the existing guest read-only filter at no extra threading cost — guests were already excluded, and members are now sub-gated by the allowlist.
- magi gains a per-context rate limit where none existed, bounding sandbox/key churn from a runaway client.
- The operator shared key is admin-owned and encrypted at rest; it never reaches a user-visible surface (the GET returns only `sharedKeySet: boolean`).

### Negative

- **The `MAGI_EGRESS_CEILING` fail-fast did not ship.** The plan specified a dedicated ceiling env (separate from `MAGI_ALLOWED_REPO_HOSTS`) that would 400-reject an over-ceiling derived host with a clear message. magi implemented it briefly then dropped it entirely ("geofront's org-layer ceiling remains the sole egress bound") — consistent with ADR-0232's final decision. The geofront clamp is still the sole bound; an over-ceiling provider host fails opaquely (the model call is unreachable), not with a friendly early error.
- **A `maxMcpServers` guardrail field was added beyond the plan** (default 3, max 8), enforced fail-closed in `resolve-mcp-servers.ts`. It is bundled with the later MCP multi-server feature, not part of the original 5a spec.
- **The policy is read host-side on every tool-build / secret-resolve** via the config cache; an admin edit can briefly lag until the cache invalidates. This is the existing `getCachedConfig` tradeoff, not new.
- **`admins-only` who-may-use is still not expressible** — it needs a group-admin signal the current `actorRole` (`guest | member`) lacks; deferred as planned.

### Risks

- **Cross-repo contract for allowed-agent.** papai's `allowedAgents` picker filter is UX-only; the authoritative check is magi's `validateRepoSpec`. A drift (e.g. an agent name valid on the papai side but not in magi's `ProvisioningAgent` enum) would let the picker offer an agent magi then rejects at session start.
- **Over-ceiling provider host fails opaquely** (the deferred egress ceiling's downside) — the operator must widen the geofront ceiling to admit it; the deployment guide documents this, but there is no magi-side fail-fast early rejection.
- **In-memory rate limit is single-process.** A multi-replica magi deployment would need a shared store; v1 assumes single-process, matching the current deployment.
- **`whoMayUse` is keyed by `chatUserId` strings.** An allowlist is only as correct as the operator's knowledge of the user ids; a typo silently excludes. There is no user-picker UX (a textarea of ids), matching the plan's v1.

## Related Decisions

- **ADR-0230: Phase 4a — Multi-Provider + Agent Picker** — the agent/provider picker this phase's `allowedAgents` filter constrains, and the `projectSpec.agent` magi re-validates.
- **ADR-0231: Phase 4b — Typed Forge Connections + Self-Hosted GitLab** — the coding-session sibling that precedes this; 5a's force-shared-key deliberately leaves the forge identity (4b) per-user.
- **ADR-0232: Phase 4c — Derived Egress** — the per-session egress model; the dropped `MAGI_EGRESS_CEILING` fail-fast was originally a deferred 4c item that 5a picked up, re-attempted, and re-dropped.
- **ADR-0222: Phase 2 — Per-User Forge Identity** — the per-identity forge token that force-shared-key explicitly does **not** override.
- **ADR-0221: Phase 1 — Agent-Credential Vault and Per-Session Secret Channel** — the encrypted vault + reserved-context model the guardrail policy + shared key reuse.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`; the papai A1/A2/A3 commit messages match the plan verbatim, and the magi B1/B2 commit messages match too.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/guardrails.ts:14-19,22-24,33-45` | `guardrailsSchema` (`allowedAgents`/`whoMayUse`/`forceSharedKey`/`maxMcpServers`); `adminCodingGuardrailsContextId`; `resolveCodingGuardrails` (default-allow when unset); `setCodingGuardrails`. | `read` confirms. |
| `src/debug/settings/admin/coding-guardrails-routes.ts:27-36,38-43,65-83,88-96` | Admin route: discriminated POST (`policy`/`shared-key`/`shared-key-clear`); GET returns `{ guardrails, sharedKeySet }` (never the key); admin-gated + CSRF. | `read` confirms. |
| `src/debug/settings-api-router.ts:8,63` | Route registered: `/settings/api/admin/coding-guardrails` → `handleAdminCodingGuardrailsRoutes`. | `grep` confirms. |
| `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte` | Admin section (relocated/renamed from the plan's `CodingGuardrailsSection.svelte`): allowed-agents checkboxes, who-may-use radio + textarea, force-shared-key toggle, maxMcpServers control, shared-key credential fields. | `grep` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:201,215` | Agent-picker response includes `allowedAgents: resolveCodingGuardrails(pi).allowedAgents`; route also enforces `maxMcpServers`. | `grep` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:93` | Client filters the agent `<select>` options to `allowedAgents`. | `grep` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:23-28,66-70,127-135` | `sharedKeyContext` helper; `resolveAgentSecrets` + `resolveProviderHost` resolve via `sharedKeyContext(...) ?? identityContext(...)` (forge/agent/model untouched). | `read` confirms. |
| `src/llm-orchestrator-tools.ts:40-60,219-221` | `ACP_SESSION_ACTION_TOOLS` + `applyWhoMayUseFilter` (reference-identical for `members`); applied in `buildFullToolSet` via `parseScopedContextId`. | `read` confirms. |
| `src/coding-credentials/resolve-mcp-servers.ts:113-117` | `maxMcpServers` fail-closed enforcement ("mcp selection exceeds maxMcpServers guardrail; refusing"). | `grep` confirms. |
| `tests/coding-credentials/guardrails.test.ts`, `tests/debug/settings/admin/coding-guardrails-routes.test.ts` | Reader defaults + round-trip; route 401/422/policy round-trip incl. non-default `maxMcpServers`. | `grep` confirms. |
| magi `src/project/config.ts:172` | `RepoPolicy.allowedAgents?: readonly string[]`. | `read` confirms. |
| magi `src/project/repo-spec-validation.ts:168`, `src/project/spec-validation.ts:219` | `validateRepoSpec` rejects `agent not permitted: <agent>` when `allowedAgents` set and agent not in it. | `grep` confirms. |
| magi `src/server/rate-limit.ts:1-20` | `RateLimiter` interface + `createRateLimiter(limit, windowMs)` fixed-window counter. | `read` confirms. |
| magi `src/server/router.ts:23,86,224,255` | `ServerDeps.rateLimiter`; 429 on `/sessions`/`/reviews`/follow-up over-limit. | `read` confirms. |
| magi `src/main.ts:171-173,192,252-255` | `createRateLimiter(MAGI_SESSION_RATE_LIMIT ?? 20, MAGI_SESSION_RATE_WINDOW_MS ?? 3_600_000)`; `buildPolicy()` sources `MAGI_ALLOWED_AGENTS`. | `read` confirms. |
| `docs/architecture/coding-sessions.md` §"Operator guardrails (Phase 5a)" | Documents the three fields, the admin section/route, and magi re-enforcement. | `grep` confirms. |
| papai commits `2db371760`, `ff165e194`, `111461ef1` | A1/A2/A3 commit messages match the plan verbatim. | `git log -S` confirms. |
| magi commits `3095470`, `06717a3` | B1 `feat(provisioning): enforce allowed-agent + fail-fast egress ceiling`; B2 `feat(server): per-context rate limit on sessions and reviews` match the plan. | `git log -S` confirms. |

Plan-vs-implementation notes:

- **The `MAGI_EGRESS_CEILING` fail-fast shipped then was removed.** The 5a B1 plan specified it as a dedicated ceiling env returning a clear 400. magi implemented it the same day (`3095470 feat(provisioning): enforce allowed-agent + fail-fast egress ceiling`), then dropped it entirely (`ace1782 refactor(policy): rework repo-host SSRF gate, drop egress-ceiling env`) — "Remove `MAGI_EGRESS_CEILING` entirely … geofront's org-layer ceiling remains the sole egress bound." This matches ADR-0232's final decision: the geofront clamp is the sole bound, no magi ceiling code. The allowed-agent half of B1 was kept.
- **A `maxMcpServers` guardrail field was added beyond the plan.** The 5a schema was `{ allowedAgents, whoMayUse, forceSharedKey }`. The shipped `guardrailsSchema` adds `maxMcpServers: z.number().int().min(1).max(8).default(3)` (`guardrails.ts:18`), enforced fail-closed in `resolve-mcp-servers.ts:113-117`. It arrived with the MCP multi-server feature (`8cfb245b6 feat(mcp): … maxMcpServers cap`), not in the original 5a plan; the admin section gained a control for it (`7a4dcb0bd`).
- **The who-may-use ACP tool set diverged.** The plan's `ACP_SESSION_ACTION_TOOLS` listed `{ start_session, review_pr, finish_session, cancel_session, answer_permission }`. The shipped set (`llm-orchestrator-tools.ts:40-46`) is `{ start_session, continue_session, finish_session, cancel_session, answer_permission }` — `review_pr` was dropped (`58d84860d refactor: drop review_pr from ACP session-action guardrail set`) and `continue_session` added (`15f69f9b8 feat(acp): gate continue_session behind the whoMayUse guardrail`), reflecting acp tool additions/renames layered on top of 5a. (Note: `docs/architecture/coding-sessions.md:102` still references `review_pr` in this set — a stale doc line.)
- **The admin section was relocated and renamed.** The plan placed it at `client/settings/sections/CodingGuardrailsSection.svelte`. The shipped section is `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte` — the admin sections were moved into an `admin/` subfolder and given the `Admin` prefix in a later settings-UI reorganization. It is wired into `SettingsApp.svelte` under the "Coding guardrails" admin nav entry.
- **The admin route sources `sharedKeySet` from a non-empty key check, not vault presence.** The plan's GET returned `sharedKeySet: getCodingCredentials(...) !== null`. The shipped `view()` (`coding-guardrails-routes.ts:40-41`) returns `sharedKeySet: creds !== null && (creds.provider_api_key?.trim() ?? '').length > 0` — so an empty-string key in the vault does not count as set. A stricter correctness fix.
- **The router-agent reconciliation closed a guardrail bypass.** magi's `/sessions` router once derived the launch agent from the unvalidated top-level `body.agent`, bypassing `validateRepoSpec`'s `allowedAgents` check; it now derives from the validated `projectSpec.agent` (documented in `docs/architecture/coding-sessions.md:70`), making 5a's allowed-agent guardrail effective at the launch layer. This fix post-dates the B1 commit.
- **A `hasCodingGuardrails` unset-detection helper was added later** (`659ad12a1 feat(guardrails): add hasCodingGuardrails for unset-detection`) — distinguishable from the default-allow `resolveCodingGuardrails` for callers that need to know whether a policy was ever set. Not in the plan.
- **The orchestrator who-may-use gate was later refactored to a port.** `bc4cd477c refactor(orchestrator): drive who-may-use filter from ToolGatePort, remove acp allowlist` reworked the filter behind a port abstraction; the `applyWhoMayUseFilter` pure helper remains and the acp allowlist constant moved with it.

The source plan `docs/superpowers/plans/2026-06-27-phase-5a-operator-guardrails.md` and design `docs/superpowers/specs/2026-06-27-phase-5a-operator-guardrails-design.md` are archived alongside this ADR to `docs/archive/`.
