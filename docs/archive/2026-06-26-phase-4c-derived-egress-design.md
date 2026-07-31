<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4c — Derived Egress — Design

**Date:** 2026-06-26
**Status:** Draft (detailed spec; spawns a plan)
**Parent decomposition:** `docs/superpowers/specs/2026-06-26-phase-4-decomposition-design.md`
**Builds on:** Phases 1–3, 4a, 4b

## Scope

Make the sandbox's egress allowlist **derived per session** from the user's
actual choices — the model-provider host (incl. a custom base URL), the
agent-infrastructure host (`models.dev` for opencode, `chatgpt.com` for codex),
and an operator base set — instead of a static operator default, bounded by a
hard **geofront org-ceiling**.
This also closes the 4a deferral: a **custom provider base URL** /
`openai-compatible` provider becomes reachable from the sandbox for the first
time, because its host is now in the derived egress.

## Decisions locked

1. **The repo host is NOT in the sandbox egress.** magi clones/pushes host-side,
   and the **forge token is host-side — never staged into the sandbox** (Phase 2
   askpass), so the agent cannot authenticate to the forge from inside the
   container regardless. Including the repo host would only enable _anonymous_ git
   (public clone/fetch) while widening the exfiltration surface, so it is
   **excluded**. (If a future phase moves git into the sandbox — staging the forge
   token there — revisit this.)
2. **The operator base set is `MAGI_PROJECT_DEFAULTS.egressAllowlistDomains`,
   repurposed** from "the whole egress" to "always-included tooling hosts" (npm /
   pip / etc. the agent needs). It is unioned into every derived allowlist.
3. **papai owns the provider→host mapping** (consistent with owning provider→env):
   `resolveProviderHost()` derives the model host from the provider + base URL and
   sends it as `projectSpec.providerHost`. magi assembles the rest.
4. **The geofront org-ceiling is the hard bound; geofront clamps** (effective
   egress = derived ∩ ceiling). magi emits the derived per-session allowlist; the
   operator sets the ceiling in geofront's org config — **no geofront code, no
   magi ceiling code** (config/doc only, per the parent spec). A derived host
   outside the ceiling is simply unreachable (the agent's call fails) — the
   operator widens the ceiling to admit it.

## Provider→host table (papai-owned; completes 4a)

| provider                  | host when no base URL | host when base URL set       |
| ------------------------- | --------------------- | ---------------------------- |
| `anthropic`               | `api.anthropic.com`   | host of `ANTHROPIC_BASE_URL` |
| `openai`                  | `api.openai.com`      | host of `OPENAI_BASE_URL`    |
| `openai-compatible` (new) | — (base URL required) | host of `OPENAI_BASE_URL`    |

`openai-compatible` is added to `PROVIDERS` (the 4a deferral); compatibility:
`opencode → anthropic | openai | openai-compatible`,
`codex → openai | openai-compatible`, `claude → anthropic`.

## Design — papai

- **Vault/route (4a select infra):** add `openai-compatible` to `PROVIDERS` and the
  `compatible()` rule; the AI-provider section already renders base URL — for
  `openai-compatible`, base URL is **required** (route 422 if missing).
- **`resolveProviderHost(storageContextId): string | null`** (`resolve-agent-secrets.ts`)
  per the table; surfaced on the `codingSecrets` facade, permission-gated.
- **acp** (`session-tools.ts`): include `providerHost: resolveProviderHost()` in
  the projectSpec (omit when null).
- **(Optional) read-only egress summary:** the section can show "this session can
  reach: `<provider host>`, `models.dev`(opencode), `<base domains>`"
  for transparency. Nice-to-have; can ship in a follow-up.

## Design — magi

- `ProjectSpec` gains `providerHost?: string`. `buildEphemeralProject` **derives**
  `egressAllowlistDomains` instead of taking `defaults.egressAllowlistDomains`
  wholesale:

  ```
  deriveEgress(spec, defaults) = unique([
    ...defaults.egressAllowlistDomains,        // operator base (npm/pip/…)
    spec.providerHost,                          // model host (custom base URL ok)
    ...agentInfraEgress(spec.agent),            // opencode→models.dev; codex→chatgpt.com
  ].filter(Boolean))
  ```

  The **repo host is NOT included** (decision 1).

- **Split the preset egress: drop the _provider_ hosts, keep the _agent-infra_
  hosts.** Today `resolvePlan` merges `project + config + preset.defaultEgress`,
  and `preset.defaultEgress` mixes provider hosts (`api.anthropic.com`,
  `api.openai.com`) with agent-infrastructure hosts (`chatgpt.com` for codex,
  `models.dev` for opencode). In 4c the **derived `egressAllowlistDomains` is
  authoritative** for provider reachability, so the preset must **no longer
  contribute provider hosts** (else opencode's broad `[api.anthropic.com,
api.openai.com]` would defeat the per-provider narrowing). But the
  agent-infrastructure hosts are still needed for the agent itself to function —
  **dropping `chatgpt.com` would break codex.** So replace `preset.defaultEgress`
  with a `preset.agentInfraEgress` (codex→`[chatgpt.com]`, opencode→`[models.dev]`,
  claude→`[]`) that the derive unions in; the provider host comes only from
  `spec.providerHost`. Verify the emitted geofront.toml egress reflects only the
  derived set (base + provider + agent-infra).
- Validation: when `spec.providerHost` is present it must be a bare host (no
  scheme/path); `buildEphemeralProject` ignores a malformed one (falls back to the
  base set + agent-infra) rather than throwing.

## Design — geofront (config / doc only)

- The operator sets the egress **org-layer ceiling** (`egress.policy.ceiling`) in
  geofront's org config — the maximal set any session may reach. geofront already
  enforces it (`UntrustedPolicyCeilingLayer`): effective = project ∩ ceiling. A
  derived host outside the ceiling is dropped. **No geofront code change.**
- Deliverable: an operator doc (deployment guide) on choosing the ceiling — wide
  enough for the providers/forges users actually use, narrow enough to bound
  exfiltration.

## Security

- **Egress is the data-exfiltration boundary** for a potentially-untrusted agent.
  Deriving it _narrows_ the default (today's broad opencode egress) to exactly the
  session's hosts — a security improvement. The **operator ceiling remains the
  hard cap**; user choices can only select within it.
- The custom-base-URL reachability this adds is bounded by the ceiling — a user
  cannot reach an arbitrary host unless the operator's ceiling admits it.
- No new persisted secrets; `providerHost` is non-secret config.

## Out of scope (4c)

- A magi-side egress ceiling for early rejection (relies on geofront's clamp; a
  clearer early error is a Phase-5 hardening — see open questions).
- Per-tool/per-step dynamic egress; egress observability beyond the optional summary.

## Testing

**papai**

- `resolve-agent-secrets` / facade — `resolveProviderHost`: anthropic→`api.anthropic.com`,
  openai→`api.openai.com`, base-URL→its host, `openai-compatible`→base-URL host,
  null when unset.
- routes/types — `openai-compatible` provider accepted; base URL required for it
  (422 if missing); compatibility updated.
- acp — `projectSpec.providerHost` included.

**magi**

- `project/*` — `deriveEgress` unions base + providerHost + agent-infra
  (opencode→models.dev, codex→chatgpt.com); dedups; the repo host is NOT included;
  a malformed providerHost is ignored.
- provisioning/plan — the emitted geofront.toml egress equals the derived set
  (preset `defaultEgress` no longer widens it).

## Files touched

**papai:** `src/coding-credentials/{types,resolve-agent-secrets}.ts`,
`src/debug/settings/coding-credentials-routes.ts`, `src/plugins/{runtime-types,tool-runtime}.ts`,
`plugins/acp/session-tools.ts`, `client/settings/sections/CodingCredentialsSection.svelte`
(openai-compatible option + optional summary), `CLAUDE.md`, tests.

**magi:** `src/project/config.ts` (`ProjectSpec.providerHost`, `deriveEgress`,
`buildEphemeralProject`), `src/runtime/geofront/provisioning/plan.ts` (drop preset
`defaultEgress` from the merge), tests. Operator doc under `docs/deployment/`.

## Resolved decisions (confirmed)

- **Repo host — excluded** from the sandbox egress. The forge token is host-side
  (not in the sandbox), so the agent can't authenticate to the forge anyway;
  including the repo host would only buy anonymous git while widening exfiltration.
  Revisit only if git ever moves into the sandbox.
- **Preset egress — split.** Drop the _provider_ hosts from `preset.defaultEgress`
  (the derived `providerHost` supplies them), but keep the _agent-infrastructure_
  hosts (`preset.agentInfraEgress`: codex→`chatgpt.com`, opencode→`models.dev`) —
  dropping `chatgpt.com` would break codex.
- **Ceiling — geofront clamp only** (config/doc, no magi code); magi **logs** the
  derived egress so an over-ceiling custom-provider failure is diagnosable. A
  fail-fast `MAGI_EGRESS_CEILING` early rejection is deferred to **Phase 5**.
- **Base set — reuse `MAGI_PROJECT_DEFAULTS.egressAllowlistDomains`**, repurposed
  to "always-on tooling hosts" (documented). No new config field.
