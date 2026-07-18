<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4a — Multi-Provider + Agent Picker — Design

**Date:** 2026-06-26
**Status:** Draft (detailed spec; spawns a plan)
**Parent decomposition:** `docs/superpowers/specs/2026-06-26-phase-4-decomposition-design.md`
**Builds on:** Phases 1–3

## Scope

Let a user choose their **coding agent** (claude / codex / opencode) and their
**model provider** (Anthropic / OpenAI) in the settings UI, and have sessions
authenticate accordingly — which **makes codex and opencode work for the first
time** (today codex is host-sourced and opencode has no credentials). This is the
provider/agent half of Phase 4.

**Boundary (out of 4a — deferred to later sub-phases):**

- **Typed forge connections / self-hosted GitLab** → 4b.
- **Derived egress, custom base URLs, and `openai-compatible`** → 4c. A custom
  provider base URL (proxy or OpenAI-compatible endpoint) is **only reachable from
  the sandbox once 4c derives egress from it** — so 4a ships the two providers
  whose hosts the per-agent preset egress already covers (`api.anthropic.com`,
  `api.openai.com`). `provider_base_url` continues to exist in the vault (Phase 1)
  and is staged into the sandbox, but its host is not reachable until 4c.

## Decisions locked

1. **Agent + provider are a per-user (config-context) choice**, stored in the
   existing `agent-provider` vault alongside the key — one coding identity per
   config-context (per-user in DM, group-shared in group), like every other
   coding setting. Per-repo agent override is a possible future extension, **not**
   in 4a.
2. **Provider↔agent compatibility is hard-enforced** at the settings boundary
   (route + store reject an invalid pair; the UI constrains the pickers):
   `claude → anthropic`, `codex → openai`, `opencode → anthropic | openai`.
3. **provider → env table (papai-owned)**, the generalization of the Phase-1
   deferral:
   | provider | env staged into the sandbox |
   | -------- | --------------------------- |
   | `anthropic` | `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL` if set) |
   | `openai` | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL` if set) |
4. **The agent travels in the projectSpec** the acp plugin sends (assembled from
   the per-repo catalogue entry + the per-user agent). magi derives
   `provisioning.agent` from it.

## Design — papai

### 1. Vault — provider + agent fields

The `agent-provider` namespace is an encrypted JSON blob, so **no DB migration** —
extend the field registry (`src/coding-credentials/types.ts`):

- `AGENT_PROVIDER_FIELDS = ['provider', 'agent', 'provider_api_key', 'provider_base_url']`
- `REQUIRED_AGENT_PROVIDER_FIELDS = ['provider', 'agent', 'provider_api_key']`
- `PROVIDERS = ['anthropic', 'openai'] as const`, `AGENTS = ['claude', 'codex', 'opencode'] as const`
- A `compatible(agent, provider)` predicate enforcing decision 2.

### 2. Settings section + route — select fields + compatibility

- The route's per-namespace field metadata (`coding-credentials-routes.ts`,
  `FIELDS_META`) gains, for `agent-provider`, two **select** fields (`provider`,
  `agent`) with options, plus the existing key/base-url. Add a `control: 'select'`
  - `options` notion to the field-meta (text fields keep today's behavior). On
    `PATCH`, validate the `(agent, provider)` pair via `compatible(...)` → `422` if
    invalid.
- The "AI provider" section (`CodingCredentialsSection.svelte`) renders the agent
  - provider `<select>`s (constraining the provider options to those compatible
    with the chosen agent), the masked key, and the optional base URL (with a note
    that custom hosts need a later phase). Section stays `coding-credentials`.

### 3. `codingSecrets` facade — provider-aware mapping + agent

`src/coding-credentials/resolve-agent-secrets.ts`:

- `resolveAgentSecrets(storageContextId)` reads `provider` from the vault and maps
  per the table in decision 3 (replacing the hardcoded Anthropic mapping).
  Returns `null` (pre-flight refuse) when the key is missing — unchanged.
- Add `resolveAgent(storageContextId): string | null` returning the chosen agent
  (`claude`/`codex`/`opencode`), surfaced on the `codingSecrets` facade
  (`runtime-types.ts` + `tool-runtime.ts`), permission-gated as today.

### 4. acp plugin — carry the agent

`plugins/acp/session-tools.ts`: `buildProjectSpec(repo, agent)` adds `agent`
(from `runtimeContext.codingSecrets.resolveAgent()`, defaulting to `claude` for
back-compat) to the `projectSpec` sent on `/sessions` and `/reviews`. The
existing agent-key pre-flight (`resolve()` → `not_configured`) already covers a
missing provider key.

## Design — magi (separate repo)

### 5. All three presets request-sourced (`src/runtime/geofront/provisioning/presets.ts`)

- **codex**: `secretTargets: [{ request: 'OPENAI_API_KEY', targetEnv: 'OPENAI_API_KEY', required: true }, { request: 'OPENAI_BASE_URL', targetEnv: 'OPENAI_BASE_URL', required: false }]` — **drop** the host `~/.codex/auth.json`. `defaultEgress: ['api.openai.com', 'chatgpt.com']` (unchanged).
- **opencode**: `secretTargets: [{ request: 'ANTHROPIC_API_KEY', …, required: false }, { request: 'OPENAI_API_KEY', …, required: false }, + their base-url pairs]` — both optional; papai sends the one matching the provider; the stager stages whichever is present (Phase 1 skips absent optionals). `defaultEgress: ['models.dev', 'api.anthropic.com', 'api.openai.com']` (broad in 4a; **narrowed to the chosen provider in 4c**).
- **claude**: unchanged (already request-sourced, Phase 1).

### 6. `projectSpec.agent` → `provisioning.agent` (`src/project/config.ts`)

- `ProjectSpec` gains `agent: ProvisioningAgent`; `validateRepoSpec` validates it
  against the agent enum (default `claude` when absent, for back-compat).
- `buildEphemeralProject` sets `provisioning = { ...defaults.provisioning, agent:
spec.agent }` (the agent overrides; `workspaceImage`/`baseImage` and other
  provisioning fields stay operator defaults). The per-agent preset (entrypoint,
  install, request-secrets, egress) is then selected by `resolvePlan` as today.

## Security

- No new persisted secret surface: provider keys stay in papai's encrypted vault
  and request-scoped to magi (Phases 1–2). The new `provider`/`agent` fields are
  non-secret config (stored in the same blob; not logged as values).
- `OPENAI_API_KEY` (new) gets the same handling as `ANTHROPIC_API_KEY`: env-only
  in the sandbox via `magi-init`, never argv/persisted/logged.
- Compatibility enforcement prevents the confusing failure mode of a key that
  can't authenticate the chosen agent.

## Out of scope (4a)

- Typed forge connections / self-hosted GitLab (4b).
- Derived egress, custom-base-URL reachability, `openai-compatible` provider (4c).
- Per-repo agent override.

## Testing

**papai**

- `tests/coding-credentials/store.test.ts` — provider/agent fields round-trip;
  `compatible()` rejects bad pairs.
- `tests/coding-credentials/resolve-agent-secrets.test.ts` — `anthropic` →
  `ANTHROPIC_API_KEY`, `openai` → `OPENAI_API_KEY`; `resolveAgent` returns the choice.
- `tests/debug/settings/coding-credentials-routes.test.ts` — select fields
  surfaced; invalid `(agent, provider)` pair → `422`; agent-provider GET shape.
- `tests/plugins/acp/*` — `projectSpec.agent` is included; defaults to `claude`.
- Client: section renders agent + provider selects with constrained options.

**magi**

- `tests/runtime/geofront/provisioning/presets.test.ts` — codex request-sourced
  (no host path); opencode stages whichever provider key is present.
- `tests/project/*` — `validateRepoSpec` accepts the agent enum; `buildEphemeralProject`
  sets `provisioning.agent` from the spec.
- `tests/runtime/geofront/provisioning/secret-stager.test.ts` — OpenAI request
  secret staged; missing required (codex without `OPENAI_API_KEY`) throws.

## Files touched

**papai:** `src/coding-credentials/{types,store}.ts`, `resolve-agent-secrets.ts`,
`src/plugins/{runtime-types,tool-runtime}.ts`, `src/debug/settings/coding-credentials-routes.ts`,
`plugins/acp/session-tools.ts`, `client/settings/sections/CodingCredentialsSection.svelte`
(+ fetcher schema for the new fields), `CLAUDE.md`, tests.

**magi:** `src/runtime/geofront/provisioning/presets.ts`, `src/project/config.ts`
(`ProjectSpec.agent`, `validateRepoSpec`, `buildEphemeralProject`), tests.

## Open questions

- **Select-field plumbing in the settings route/section:** add a generic
  `control: 'select' + options` to the coding-credentials field metadata (assumed)
  vs. a bespoke handling for these two fields. The generic approach is reused by
  4b's forge-kind picker.
- **`opencode` egress in 4a:** ship the broad `['models.dev', 'api.anthropic.com',
'api.openai.com']` (assumed — functional now, narrowed in 4c) vs. wait for 4c to
  ship opencode at all. Shipping broad-then-narrow keeps 4a independently useful.
- **Default agent for an unconfigured/legacy vault:** `claude` (assumed,
  back-compat) — confirm.
