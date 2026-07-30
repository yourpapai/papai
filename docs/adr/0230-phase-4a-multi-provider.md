<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0230: Phase 4a — Multi-Provider + Agent Picker

## Status

Implemented (with divergence)

## Date

2026-06-26

## Context

The acp coding-session track (Phases 1–3 shipped codex/opencode plumbing) left one gap: the sandboxed agent's **provider key was hardcoded to Anthropic**, so codex (which authenticates to OpenAI) and opencode (which could use either) had **no working credentials**. The user could not choose their coding agent or model provider at all — there was no `agent`/`provider` selection, no OpenAI key path, and magi's codex preset sourced its secret from the host (`~/.codex/auth.json`) rather than the per-session request bundle.

The parent decomposition (`docs/superpowers/specs/2026-06-26-phase-4-decomposition-design.md`) split Phase 4 into sub-phases. **4a's scope** (this ADR) is the provider/agent half: let a user pick a **coding agent** (`claude`/`codex`/`opencode`) and a **model provider** (`anthropic`/`openai`) in settings, hard-enforce a compatibility rule, map the provider key to the right sandbox env, carry the chosen agent through the `projectSpec`, and make codex/opencode request-sourced in magi so they authenticate for the first time. **Deliberately deferred** to later sub-phases: typed forge connections / self-hosted GitLab (4b), derived egress + custom base URLs + an `openai-compatible` provider (4c), and per-repo agent override.

The design premise was that `agent-provider` is an encrypted JSON vault namespace, so adding `provider`/`agent` needs **no DB migration** — only a field-registry extension, a provider→env mapping, and a compatibility predicate. Sibling phases: ADR-0227 (Phase 3, user-repos/inline project spec) and ADR-0228 (acp cleanup) immediately precede this; the multi-provider foundation is ADR-0129/ADR-0155.

## Decision Drivers

- **Make codex/opencode work for the first time** — the headline goal; it requires an OpenAI key path the hardcoded Anthropic mapping lacked.
- **Per-user (config-context) choice, one coding identity per context** — agent + provider live in the existing `agent-provider` vault alongside the key, like every other coding setting; no new persistence surface.
- **Hard-enforce compatibility at the boundary** — a key that cannot authenticate the chosen agent is a confusing failure; the route rejects an invalid `(agent, provider)` pair with 422 and the UI constrains the pickers.
- **Provider → env mapping (papai-owned)** — generalize the Phase-1 hardcoded Anthropic mapping into a `provider → {ANTHROPIC,OPENAI}_API_KEY` table so the sandbox receives the right env.
- **The agent travels in the `projectSpec`** — assembled from the per-user agent and sent on `/sessions`/`/reviews`; magi derives `provisioning.agent` from it to select the per-agent preset.
- **Request-sourced secrets only** — no host credential paths in magi; codex drops `~/.codex/auth.json` and stages `OPENAI_API_KEY` from the request bundle, matching the Phase-1 request-scoped model.
- **Anthropic/OpenAI with default hosts only (planned)** — a custom base URL's host is not reachable from the sandbox until 4c derives egress, so 4a ships only the two providers the existing preset egress already covers.
- **TDD, one self-contained task per file, explicit `git add` paths** — the plan knits into the repo's write-hook pipeline and parallel-WIP discipline.

## Considered Options

### Option 1: Extend the `agent-provider` vault with `provider`/`agent` + a compatibility rule; request-source all magi presets (chosen)

Add `provider`/`agent` fields to the JSON vault (no migration), a `compatible(agent, provider)` predicate, a provider→env mapping, a `resolveAgent` facade method, a select-field notion in the route + settings section, and request-source the codex/opencode presets in magi.

- **Pros:** no DB migration; reuses the existing vault/facade/route plumbing; compatibility enforcement prevents the mismatched-key failure mode; makes codex/opencode functional with the request-scoped model already proven for claude; the generic `control: 'select' + options` field metadata is reused later (4b's forge-kind picker).
- **Cons:** touches two repos (papai + magi) in one coordinated change; the select-field metadata is a new generic notion on the route/section; codex/opencode egress must be broad in 4a and narrowed later (4c).

### Option 2: Keep the hardcoded Anthropic mapping; add a parallel OpenAI-only path

Leave `resolveAgentSecrets` Anthropic-only and bolt on a separate OpenAI resolver/section rather than generalizing.

- **Pros:** smaller diff to the resolver.
- **Cons:** duplicates the secret-resolution path per provider; no single source of truth for the provider→env table; the agent choice has no home, so codex/opencode still can't be selected; grows a parallel stack for every future provider.

### Option 3: Defer codex/opencode until 4c ships derived egress

Ship only the agent picker against the existing Anthropic key; wait for 4c before enabling OpenAI.

- **Pros:** no broad-then-narrow egress churn.
- **Cons:** leaves the headline goal (working codex/opencode) unmet; 4a would not be independently useful; the provider→env mapping would still be needed eventually.

## Decision

The chosen Option 1 shipped across both repos in four TDD tasks. What shipped:

### Part A — papai

1. **A1 — vault fields + compatibility + provider-aware mapping + route.** `AGENT_PROVIDER_FIELDS` gains `provider`/`agent`; `PROVIDERS`/`AGENTS` enums and a `compatible(agent, provider)` predicate (claude→anthropic, codex→openai, opencode→anthropic|openai) are added. `resolveAgentSecrets` reads `provider` and maps via a `PROVIDER_ENV` table (`anthropic`→`ANTHROPIC_API_KEY`, `openai`→`OPENAI_API_KEY`), defaulting to anthropic for back-compat. The route gains select-field metadata and rejects an incompatible `(agent, provider)` pair with 422.
2. **A2 — `resolveAgent` facade + acp carries the agent.** A new `resolveAgent(storageContextId)` returns the stored agent; it is surfaced on the permission-gated `codingSecrets` facade. The acp plugin's `buildProjectSpec(repo, agent)` threads `agent` (from `resolveAgent()`, defaulting to `claude`) into the `projectSpec` sent on `/sessions` and `/reviews`.
3. **A3 — settings section renders agent/provider selects.** `CodingCredentialsSection` renders `agent`/`provider` as `<select>` dropdowns driven by the route's `control`/`options` metadata, client-side filtering the provider options to those compatible with the selected agent; the masked key + base URL render as before.

### Part B — magi (separate repo)

4. **B1 — request-sourced codex/opencode + `projectSpec.agent`.** The codex preset drops the host `~/.codex/auth.json` and stages `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) from the request; the opencode preset stages whichever provider key is present (both optional). `ProjectSpec` gains `agent: ProvisioningAgent`; `validateRepoSpec` accepts the agent enum (default `claude`); `buildEphemeralProject` sets `provisioning.agent` from the spec.

## Consequences

### Positive

- codex and opencode authenticate for the first time: an OpenAI key path exists, the chosen agent is honored end-to-end, and magi's per-agent preset requests the matching env.
- The provider→env mapping is a single `PROVIDER_ENV` table, not a hardcoded Anthropic path; adding a future provider is a one-entry change.
- Compatibility is hard-enforced at the route (422) and constrained in the UI, preventing the mismatched-key failure mode.
- The agent travels in the `projectSpec`, so magi selects the correct preset (entrypoint/install/egress) without a separate channel.
- codex/opencode are request-sourced, matching the Phase-1 request-scoped model — no host credential paths, consistent with the "secrets env-only, never argv/persisted/logged" invariant.
- The generic `control: 'select' + options` field metadata introduced here was reused by the 4b forge-kind picker, validating the open question in the spec.

### Negative

- **The codebase has evolved well beyond 4a**, so the current shape diverges from this plan's stated 4a scope (see Implementation Notes). The `openai-compatible` provider that 4a explicitly deferred to 4c was subsequently pulled forward; `AGENT_PROVIDER_FIELDS` gained `auth_method`/`model` (4d); and all resolver signatures gained a `chatUserId` parameter for per-identity resolution (5b).
- opencode's preset egress shipped broad in 4a (`models.dev` + both provider hosts) and was only narrowed per-provider in 4c — a deliberate broad-then-narrow that briefly admitted more hosts than strictly necessary.

### Risks

- **Cross-repo coordination.** The provider→env table is papai-owned and the secret request names are magi-owned; an env-name mismatch (e.g. a provider whose env name differs between the two repos) silently breaks a session. The plan's final-verification step (a reviewer confirms env names line up per agent) is the only guardrail.
- **Broad opencode egress (4a shape) admits both provider hosts** even when only one provider's key is configured — a minor over-permission narrowed only in 4c.

## Related Decisions

- **ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec** — the inline `projectSpec` this phase extends with `agent`.
- **ADR-0228: ACP Plugin Phase-3 Cleanup** — the acp surface this phase adds `resolveAgent`/`agent` onto.
- **ADR-0129: Multi-Provider Router (Unified Design)** — the multi-provider foundation; this is the coding-session provider-picker analogue.
- **ADR-0155: Multi-Provider Remediation** — the descriptor-driven/vault hygiene precedent this vault extension follows.
- **ADR-0009: Multi-Provider Task Tracker Support** — the original multi-provider abstraction.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`; papai commits match the plan's A1/A2/A3 commit messages verbatim, and the magi B1 commit message matches too.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/types.ts:9,19,30-35,37-45` | `PROVIDERS`/`AGENTS` enums, `compatible()` predicate, `AGENT_PROVIDER_FIELDS` incl. `provider`/`agent`. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:51-55,66-85` | `PROVIDER_ENV` table (anthropic/openai → env); `resolveAgentSecrets` provider-aware mapping. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:91-95` | `resolveAgent` returns the stored agent. | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:37`, `src/plugins/runtime-types.ts:59` | `resolveAgent` on the permission-gated `codingSecrets` facade + its type. | `grep` confirms. |
| `src/debug/settings/coding-credentials-fields-meta.ts:17-62` | `FIELDS_META` with `control: 'select'` + `options` for `agent`/`provider`. (Extracted to its own file — see notes.) | `read` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:124-143` | `checkCompatibility` → 422 `incompatible agent/provider` on a bad pair; `fieldResponse` emits `control`/`options`. | `read` confirms. |
| `plugins/acp/session-tools.ts:88,99`, `plugins/acp/tools.ts:148` | `buildProjectSpec(repo, agent)` threads `agent` into the `projectSpec` sent on `/sessions`/`/reviews`. | `grep` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:29-33,297-303` | `compatibleProviders` client-side filter; `<Select>` for `agent`/`provider` driven by `control === 'select'`. | `grep` confirms. |
| `tests/coding-credentials/resolve-agent-secrets.test.ts:46-109` | provider→env mapping tests (anthropic/openai/default/base-URL). | `grep` confirms. |
| magi `src/runtime/geofront/provisioning/presets.ts:31-60` | `codexPreset` request-sources `OPENAI_API_KEY`; `opencodePreset` stages either provider key. | `read` confirms. |
| magi `src/project/config.ts:40,215-219` | `ProjectSpec.agent: ProvisioningAgent`; `buildEphemeralProject` sets `provisioning.agent`. | `read` confirms. |
| magi `src/project/spec-validation.ts:200-232` | `validateRepoSpec` accepts the agent enum, defaults `claude`, rejects unknown. | `read` confirms. |
| papai commits `6d1d32143`, `2fd6d29c9`, `3225cf199` | A1/A2/A3 commit messages match the plan verbatim. | `git log -S` confirms. |
| magi commit `7ee7291` | B1 commit message `feat(provisioning): request-sourced codex/opencode; agent from projectSpec` matches the plan verbatim. | `git log -S` confirms. |

Plan-vs-implementation notes:

- **`PROVIDERS` later extended to `openai-compatible`.** The 4a plan/spec shipped exactly two providers (`anthropic`/`openai`) and explicitly deferred `openai-compatible` to 4c. The current `types.ts:9` includes `openai-compatible` and `compatible()` was widened to admit it — a 4c pull-forward, not a 4a divergence; 4a shipped as scoped.
- **`AGENT_PROVIDER_FIELDS` later gained `auth_method` + `model`.** The 4a field set was `['provider','agent','provider_api_key','provider_base_url']`. The current set (`types.ts:37-44`) adds `auth_method` (oauth-subscription, 4d) and `model` (4d) — both post-4a additions.
- **`FIELDS_META` extracted to its own file.** The plan placed select-field metadata inline in `coding-credentials-routes.ts`. It now lives in `src/debug/settings/coding-credentials-fields-meta.ts`, and `FieldMeta.control` is `'select' | 'combobox'` (the plan had only `'select'`; `combobox` is the 4d model picker). The route imports `FIELDS_META` from there.
- **All resolver signatures gained a `chatUserId` parameter.** The plan's signatures were single-arg (`resolveAgent(storageContextId)`, `resolveAgentSecrets(storageContextId)`). The current resolvers take `(storageContextId, chatUserId)` and resolve through `identityContext` for per-identity (group coding-identity) resolution — a 5b change layered on top of 4a. `resolveAgent` itself is present and functional.
- **`resolveAgentSecrets` handles an oauth-subscription path.** Beyond the plan's provider→env table, anthropic + `oauth-subscription` now returns `{ CLAUDE_CODE_OAUTH_TOKEN }` (4d).
- **magi `ProvisioningAgent` includes `'custom'`.** The plan left `custom` as "reject it or allow per your preference"; magi's `config.ts:17` allows it (out of 4a scope).
- **magi opencode/codex egress is now derived dynamically.** The plan specified a broad static opencode egress `['models.dev','api.anthropic.com','api.openai.com']`. The current magi derives egress from `providerHost` ∪ agent-infra via `agentInfraEgress` (`config.ts:108-121`), narrowing per-provider — the 4c evolution. 4a shipped the broad list as planned.
- **magi codex base URL now via generated `config.toml`.** The plan staged `OPENAI_BASE_URL` as a codex env secretTarget; 4d moved this to a generated `~/.codex/config.toml` (codex ignores `OPENAI_BASE_URL`), removing that env target.

The source plan `docs/superpowers/plans/2026-06-26-phase-4a-multi-provider.md` and design `docs/superpowers/specs/2026-06-26-phase-4a-multi-provider-design.md` are archived alongside this ADR to `docs/archive/`.
