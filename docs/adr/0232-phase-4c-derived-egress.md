<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0232: Phase 4c — Derived Egress

## Status

Implemented (with divergence)

## Date

2026-06-26

## Context

Phases 4a (ADR-0230) and 4b (ADR-0231) shipped the agent/provider picker and typed forge connections, but the sandbox's **egress allowlist was still a broad static operator default** assembled wholesale from a per-agent `preset.defaultEgress`. That preset mixed provider hosts (`api.anthropic.com`, `api.openai.com`) with agent-infrastructure hosts (`chatgpt.com` for codex, `models.dev` for opencode), so an opencode session admitted **both** provider hosts even when only one provider's key was configured — a minor over-permission. Worse, the 4a deferral meant a **custom provider base URL** (`openai-compatible` provider, or an `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` override) was **never reachable** from the sandbox: its host was absent from the static default, so strict egress silently dropped the model call. A user pointing codex at a self-hosted LLM proxy got an agent that started but could not phone home.

The parent decomposition (`docs/superpowers/specs/2026-06-26-phase-4-decomposition-design.md`) split Phase 4 into sub-phases. **4c's scope** (this ADR) is to **derive** the sandbox egress **per session** from the user's actual choices — the model-provider host (incl. a custom base URL), the agent-infrastructure host, and an operator base set — bounded by a hard **geofront org-ceiling** (effective egress = derived ∩ ceiling). It also closes the 4a `openai-compatible` deferral: add the provider to the picker and make its (custom) host reachable for the first time. **Deliberately deferred** (and ultimately not shipped here): a magi-side fail-fast `MAGI_EGRESS_CEILING` early-rejection env — the geofront clamp is the sole bound.

The design premise was that papai already owns provider→env, so it should own provider→host too (`resolveProviderHost`), sent as `projectSpec.providerHost`; magi assembles the rest (`deriveEgress` = operator base ∪ providerHost ∪ agent-infra). The repo host is **excluded** — the forge token is host-side (never staged into the sandbox), so the agent cannot authenticate to the forge anyway, and including the repo host would only buy anonymous git while widening the exfiltration surface.

## Decision Drivers

- **Make custom/OpenAI-compatible endpoints reachable** — the headline goal; requires the custom base URL's host to enter the per-session egress.
- **Narrow the broad default** — today's opencode egress admitted both provider hosts; deriving per-session selects only the configured provider, a security improvement.
- **papai owns provider→host; magi assembles the union** — consistent with papai owning provider→env (4a); `resolveProviderHost` derives the model host, sent as `projectSpec.providerHost`.
- **Exclude the repo host from the sandbox egress** — the forge token is host-side (Phase 2 askpass, never staged), so the agent can't auth to the forge anyway; the repo host would only enable anonymous git while widening exfiltration.
- **Split the preset egress: drop provider hosts, keep agent-infra** — the derived `providerHost` must be authoritative for provider reachability (else opencode's broad preset would defeat the narrowing), but dropping `chatgpt.com` would break codex, so the agent-infra hosts move into the derive.
- **The geofront org-ceiling is the hard cap; geofront clamps** — effective = derived ∩ ceiling; the operator sets the ceiling in org config. No geofront code, no magi ceiling code (config/doc only).
- **TDD, two repos, explicit `git add` paths** — the plan knits into the write-hook pipeline and the cross-repo (papai + magi) coordination discipline.

## Considered Options

### Option 1: papai-owned `resolveProviderHost` → `projectSpec.providerHost`; magi `deriveEgress` unions base + provider + agent-infra; preset drops provider egress (chosen)

Add `openai-compatible` to `PROVIDERS` (+ base-URL-required 422), a `deriveProviderHost`/`resolveProviderHost` mapping surfaced on the permission-gated facade, the acp plugin carrying `projectSpec.providerHost`, and a magi `deriveEgress(spec, defaults)` that unions operator base ∪ providerHost ∪ `agentInfraEgress(agent)`, with `preset.defaultEgress` split (provider hosts dropped, agent-infra folded into the derive).

- **Pros:** narrows the default to exactly the session's hosts; closes the custom-endpoint reachability gap; papai-owned provider→host mirrors the 4a provider→env table; the repo-host exclusion tightens the exfiltration boundary; reuses the vault/facade/`projectSpec` plumbing from 4a/4b with no DB migration.
- **Cons:** touches two repos (papai + magi) in one coordinated change; the provider host and the agent-infra host are derived in two different places (papai vs magi), so a contract drift (e.g. a malformed/non-bare host) must degrade gracefully rather than throw; the operator must set the geofront ceiling wide enough for the providers users use.

### Option 2: Keep the broad static preset egress; add the custom host alongside it

Leave `preset.defaultEgress` wholesale and simply append `providerHost` to the derived set.

- **Pros:** smaller diff to magi; no preset split.
- **Cons:** leaves the over-permission (opencode admitting both provider hosts) un-narrowed — the headline security improvement is lost; the provider-host duplication (preset + `providerHost`) is incoherent.

### Option 3: Include the repo host in the sandbox egress

Add the repo/forge host to the derived set so an agent that runs `git` itself can clone/fetch.

- **Pros:** future-proofs a sandbox-side git flow.
- **Cons:** the forge token is never staged into the sandbox, so the agent still cannot push/authenticate; the repo host would only enable anonymous git while widening the exfiltration surface. Revisit only if git ever moves into the sandbox (then the token-staging model must change too).

## Decision

The chosen Option 1 shipped across both repos in three papai tasks + one atomic magi task. What shipped:

### Part A — papai

1. **A1 — `openai-compatible` provider + base-URL-required route validation.** `PROVIDERS` gains `openai-compatible`; `compatible()` widens to admit it (codex→openai|openai-compatible; opencode→anthropic|openai|openai-compatible; claude→anthropic). `resolveAgentSecrets`'s `PROVIDER_ENV` maps `openai-compatible`→`OPENAI_API_KEY`/`OPENAI_BASE_URL`. The route's `checkCompatibility` rejects `openai-compatible` with 422 when the merged `provider_base_url` is empty.
2. **A2 — `deriveProviderHost`/`resolveProviderHost` facade + acp carries `projectSpec.providerHost`.** `deriveProviderHost(provider, baseUrl)` returns the base-URL host when set, else the well-known host (`anthropic`→`api.anthropic.com`, `openai`→`api.openai.com`), else null (openai-compatible without a base URL). `resolveProviderHost(storageContextId, chatUserId)` reads the vault and is surfaced on the permission-gated `codingSecrets` facade. The acp plugin's `buildSessionProjectSpec` includes `providerHost` in the `projectSpec` (omitted when null).
3. **A3 — settings section `openai-compatible` option + base-URL hint.** `CodingCredentialsSection` client-side `compatibleProviders` mirrors the A1 rule; when `openai-compatible` is selected the base-URL field is shown as required (the route enforces the 422). `CLAUDE.md` documents the `openai-compatible` provider and the derived-egress model.

### Part B — magi (separate repo)

4. **B1 — derived egress (one atomic commit).** `ProjectSpec` gains `providerHost?: string`. `deriveEgress(spec, defaults)` = unique union of operator base (`defaults.egressAllowlistDomains`) ∪ `spec.providerHost` (when a bare host) ∪ `agentInfraEgress(agent)`; `buildEphemeralProject` sets `egressAllowlistDomains: deriveEgress(spec, defaults)`. `agentInfraEgress` codex→`chatgpt.com`, opencode→`models.dev`. `AgentPreset` loses `defaultEgress` (provider hosts gone); `resolvePlan`'s egress assembly drops `preset.defaultEgress` entirely, leaving `project.egressAllowlistDomains` (the derived set) ∪ any provisioning override. The repo host is **not** included.

## Consequences

### Positive

- Custom `openai-compatible` endpoints (and any `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` override) are reachable from the sandbox for the first time — their host enters the per-session egress, bounded by the geofront ceiling.
- The default is **narrowed**: an opencode session now reaches only its configured provider host + `models.dev` + base, not both provider hosts — a security improvement over the broad 4a preset.
- papai owns the provider→host mapping as a single source of truth (`deriveProviderHost`), mirroring the 4a provider→env table; magi's `deriveEgress` is the single assembly point.
- The agent-infra hosts (`chatgpt.com`, `models.dev`) survive the preset split, so codex/opencode keep functioning; only the provider hosts were moved to the derived `providerHost`.
- The repo host is excluded, tightening the exfiltration boundary without losing push/MR capability (git transport stays host-side via the Phase-2 askpass).
- The `openai-compatible` 4a deferral is closed: the picker admits a third provider, hard-validated to require a base URL.
- The operator deployment guide documents the ceiling-vs-allowlist model and the diagnostic for an over-ceiling custom provider.

### Negative

- **Cross-repo contract.** papai sends `projectSpec.providerHost` and magi derives from it; a malformed/non-bare host must degrade gracefully (magi ignores it) rather than throw — so a bad value silently falls back to base + agent-infra rather than surfacing an early error.
- **The codebase has evolved beyond 4c.** The `claude` agent-infra and a multi-repo `additionalEgressDomains` were added later; a `providerEgress` secret-derived egress path and a brief `MAGI_EGRESS_CEILING` env came and went (see Implementation Notes).
- **`providerHost`/`provider_base_url` are non-secret config but live in the encrypted vault** alongside the key — masked only by virtue of the vault's encryption, like the other coding-credential fields.

### Risks

- **Over-ceiling custom provider fails opaquely.** A derived host outside the geofront ceiling is simply unreachable (the agent's model call fails); the operator must widen the ceiling to admit it. The deployment guide documents this, but there is no magi-side fail-fast early rejection (it was briefly added then removed — see notes).
- **Provider-host and agent-infra derivation is split across repos.** `providerHost` is papai-owned; `agentInfraEgress` is magi-owned. A new agent whose infra host is added on only one side would be half-reachable; the cross-repo review is the guardrail.
- **Malformed `providerHost` is ignored, not rejected.** papai derives the host via `new URL(...).host`; magi re-validates with `isBareHost`. A value that parses on the papai side but is not a bare host on the magi side is silently dropped — diagnosable only via the (absent) egress log, not an error.

## Related Decisions

- **ADR-0230: Phase 4a — Multi-Provider + Agent Picker** — the immediate predecessor; added `PROVIDERS`/`compatible()` and the `projectSpec` this phase adds `providerHost` onto, and the broad preset egress this phase narrows.
- **ADR-0231: Phase 4b — Typed Forge Connections + Self-Hosted GitLab** — the coding-session sibling that preceded this; 4b explicitly deferred sandbox egress to 4c.
- **ADR-0222: Phase 2 — Per-User Forge Identity** — the host-side forge token / askpass git transport that makes excluding the repo host from the sandbox egress safe.
- **ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec** — the inline `projectSpec` this phase extends with `providerHost`.
- **ADR-0129: Multi-Provider Router (Unified Design)** — the descriptor-driven/vault hygiene precedent the vault extension follows.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`; the papai A1/A2/A3 commit messages match the plan verbatim, and the magi B1 commit message matches too.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/types.ts:9,30-35` | `PROVIDERS` includes `openai-compatible`; `compatible()` widened (codex/opencode admit it). | `read` confirms. |
| `src/coding-credentials/types.ts:81-94` | `deriveProviderHost(provider, baseUrl)` — base-URL host when set, else well-known, else null. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:54` | `PROVIDER_ENV` maps `openai-compatible`→`OPENAI_API_KEY`/`OPENAI_BASE_URL`. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:127-135` | `resolveProviderHost(storageContextId, chatUserId)` reads the vault + `deriveProviderHost`. | `read` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:145-147` | `checkCompatibility` → 422 `openai-compatible requires a base URL` when merged base URL empty. | `read` confirms. |
| `src/plugins/runtime-types.ts:61`, `src/plugins/coding-secrets-facade.ts:39` | `resolveProviderHost(): string \| null` on the permission-gated `codingSecrets` facade + its type. | `grep` confirms. |
| `plugins/acp/tools.ts:150-155` | `buildSessionProjectSpec` includes `providerHost` in the `projectSpec` (omitted when null). | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:29-33,70` | Client-side `compatibleProviders` mirror; `isOpenAiCompatible` base-URL-required hint. | `grep` confirms. |
| `CLAUDE.md` | "Agent/provider picker (Phase 4a/4c)" + "Derived sandbox egress (Phase 4c)" sections documenting `openai-compatible`, `resolveProviderHost`, and the derived egress model. | `git log` confirms. |
| magi `src/project/config.ts:102,108-122,230` | `ProjectSpec.providerHost`; `agentInfraEgress`; `deriveEgress` (base ∪ provider ∪ agent-infra); `buildEphemeralProject` sets `egressAllowlistDomains: deriveEgress(...)`. | `read` confirms. |
| magi `src/runtime/geofront/provisioning/presets.ts:3-8` | `AgentPreset` no longer has `defaultEgress` (provider hosts dropped). | `read` confirms. |
| magi `src/runtime/geofront/provisioning/plan.ts:72` | `resolvePlan` egress = `project.egressAllowlistDomains` ∪ provisioning override (no `preset.defaultEgress`). | `read` confirms. |
| magi `docs/deployment.md` §2 | Operator guide: allowlist-vs-ceiling model; `403 from strict-egress proxy` diagnostic for an over-ceiling provider host. | `grep` confirms. |
| papai commits `cb7a75869`, `dbfc1d6c0`, `94726dc54` | A1/A2/A3 commit messages match the plan verbatim. | `git log -S` confirms. |
| magi commit `2ad66ed` | B1 `feat(provisioning): derive per-session egress (provider host + agent-infra); drop preset provider egress` matches the plan verbatim. | `git log -S` confirms. |

Plan-vs-implementation notes:

- **`agentInfraEgress` for `claude` returns `['api.anthropic.com']`.** The plan/spec specified `claude → []` (claude's provider host was to come solely from `spec.providerHost`). The shipped `agentInfraEgress` (`config.ts:111`) returns `api.anthropic.com` for claude — a defensive widening so a claude session reaches Anthropic even when `providerHost` is absent (e.g. a legacy default-anthropic session that sends no host). Functionally a superset of the plan; it does not re-admit the over-permission the narrowing targeted (claude has only one provider).
- **`deriveEgress` also unions `additionalEgressDomains`.** The plan's `deriveEgress` unioned base + provider + agent-infra only. The shipped `deriveEgress` (`config.ts:120-121`) adds `spec.additionalEgressDomains` (filtered through `isBareHost`) — a multi-repo shared-workspace (SS-16) addition layered on top of 4c, surfaced on the papai side as `buildProjectSpec`'s `additionalEgressDomains` (`tools.ts:120-130`).
- **The `MAGI_EGRESS_CEILING` fail-fast env shipped then was removed.** The 4c spec deferred a magi-side fail-fast early-rejection env to Phase 5. magi briefly implemented it the next day (`3095470 feat(provisioning): enforce allowed-agent + fail-fast egress ceiling`, 2026-06-27), then dropped it entirely (`ace1782 refactor(policy): rework repo-host SSRF gate, drop egress-ceiling env`) — "Remove `MAGI_EGRESS_CEILING` entirely … geofront's org-layer ceiling remains the sole egress bound." The final state matches the 4c spec's primary decision: the geofront clamp is the sole bound, no magi ceiling code.
- **magi added a `providerEgress` secret-derived egress path.** Beyond the plan's `spec.providerHost`, magi's `config.ts:143-161` adds `providerEgress(secrets)` that derives egress hosts from `OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL` request secrets directly — a defensive belt-and-suspenders so a base-URL secret's host is reached even if `providerHost` were not sent. This is a post-4c evolution, not in the plan.
- **All resolver signatures take a `chatUserId` parameter.** The plan's `resolveProviderHost(storageContextId)` is now `resolveProviderHost(storageContextId, chatUserId)`, resolving through `identityContext` (and respecting 5a's force-shared-key) for per-identity (group coding-identity) resolution — a 5a/5b change layered on top of 4c. `resolveProviderHost` itself is present and functional.
- **`buildProjectSpec` was split into a base + `buildSessionProjectSpec`.** The plan added `providerHost` inside the session-spec builder. The current code keeps `buildProjectSpec(repo, agent)` as the base and a richer `buildSessionProjectSpec(repo, agent, codingSecrets, mcpServers)` that also bundles `forge`/`model`/`mcp` (4b/4d additions) — the 4c `providerHost` carry is unchanged in intent. The extraction (`7bab0caa0 refactor(acp): extract buildSessionProjectSpec (max-lines)`) was a follow-up max-lines refactor.
- **The papai A2 + a follow-up refactor + a later whole-record-save fix are adjacent.** The plan expected A1/A2/A3 as separate commits; they landed as three verbatim commits, plus a `refactor(acp): extract buildSessionProjectSpec` and a later `fix(acp): persist forge/provider config as a whole record` (the 4b cross-field 422 race, see ADR-0231 notes) — none alter the 4c carry.

The source plan `docs/superpowers/plans/2026-06-26-phase-4c-derived-egress.md` and design `docs/superpowers/specs/2026-06-26-phase-4c-derived-egress-design.md` are archived alongside this ADR to `docs/archive/`.
