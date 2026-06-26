<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4 — Multi-Provider, Multi-Agent, Typed Forge, Derived Egress — Decomposition Design

**Date:** 2026-06-26
**Status:** Draft (decomposition spec; spawns one detailed sub-phase spec + plan each for 4a / 4b / 4c)
**Parent:** `docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`
**Builds on:** Phases 1–3 (agent-credential vault, forge identity, user-defined repos)

## Why this is a decomposition spec

Phase 4 (parent-spec Stories 7/8/9) **unwinds four "single-X" assumptions** baked
into Phases 1–3:

| Assumption (Phases 1–3)                                                | Phase 4                                                                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Single provider — Anthropic, hardcoded `anthropic → ANTHROPIC_API_KEY` | provider picker: Anthropic / OpenAI / OpenAI-compatible (+ base URL)                           |
| Single agent — `claude-code-acp` (operator default)                    | agent picker: claude / codex / opencode                                                        |
| Single forge kind — GitHub (operator `forge.kind`/`apiBaseUrl`)        | typed forge connections: GitHub / GHE / GitLab SaaS / GitLab self-hosted (+ instance URL)      |
| Operator-default egress                                                | egress **derived** from the chosen provider + agent + forge, bounded by a geofront org-ceiling |

These are three **largely independent subsystems**. Per the writing-plans scope
rule (break multi-subsystem work into sub-project specs), Phase 4 is implemented
as three sub-phases, each with its own detailed spec + plan, shipped
incrementally:

- **4a — Multi-provider + agent picker** (makes codex/opencode actually work)
- **4b — Typed forge connections + self-hosted GitLab**
- **4c — Derived egress**

4a and 4b are orthogonal (provider/agent vs forge). 4c depends on both (it
derives egress from the provider host **and** the forge host). Recommended order:
**4a → 4b → 4c**.

## Current-state facts this builds on (verified)

- magi presets (`src/runtime/geofront/provisioning/presets.ts`) are **inconsistent**: `claude` is request-sourced (Phase 1), but `codex` is **host-sourced** (`~/.codex/auth.json`) and `opencode` has **empty `secretTargets`** — neither authenticates in the self-serve model. 4a fixes this.
- Phase 3's `ProjectDefaults`/`buildEphemeralProject` (`magi/src/project/config.ts`) take **agent / forge.kind / apiBaseUrl / egressAllowlistDomains from operator defaults**. 4a/4b/4c move each to user-derived.
- papai's `agent-provider` vault stores `{ provider_api_key, provider_base_url }`; the `forge` vault stores `{ forge_token }`; the `codingSecrets` facade hardcodes `anthropic → ANTHROPIC_API_KEY`. 4a/4b extend these.
- geofront's egress **ceiling** is org/built-in-layer only (`UntrustedPolicyCeilingLayer`); magi's per-session allowlist is a project-layer value bounded by it — so 4c is a magi change + an operator geofront-config doc, **no geofront code**.

---

## Sub-phase 4a — Multi-provider + agent picker

**Goal (Story 7):** a user picks their **agent** (claude / codex / opencode) and
their **model provider** (Anthropic / OpenAI / OpenAI-compatible + base URL), and
sessions authenticate accordingly — making codex and opencode work for the first
time.

**papai:**

- Extend the `agent-provider` vault with a `provider` field
  (`anthropic` | `openai` | `openai-compatible`); the "AI provider" settings
  section becomes a provider picker (+ key + optional base URL) **and** an agent
  picker (claude / codex / opencode), with compatibility hints (claude→Anthropic,
  codex→OpenAI, opencode→any).
- Generalize the `codingSecrets` mapping (the Phase-1 deferral): `(provider) →
{ ANTHROPIC_API_KEY | OPENAI_API_KEY (+ *_BASE_URL) }`. papai owns this map.
- Carry the chosen **agent** into the session: add `agent` to the projectSpec the
  acp plugin sends (or a per-user agent field), defaulting to claude for back-compat.

**magi:**

- Make **all three presets request-sourced**: `codex` → request `OPENAI_API_KEY`
  (drop the host `~/.codex/auth.json`); `opencode` → request the provider key
  (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) + keep `models.dev` egress.
- `buildEphemeralProject` selects `provisioning.agent` + entrypoint from the
  session's `agent` (not the operator default); `workspaceImage` stays operator
  default.

**Decisions to lock in the 4a spec:** agent scope (per-user default vs per-repo
override); provider↔agent compatibility enforcement (hard vs hint); the exact
`provider → env` table.

**Out of 4a:** forge typing (4b), egress derivation (4c).

---

## Sub-phase 4b — Typed forge connections + self-hosted GitLab

**Goal (Story 8):** a user connects a **typed** code host — GitHub / GitHub
Enterprise / GitLab SaaS / GitLab self-hosted — entering an **instance URL** for
the self-hosted/enterprise variants, so clone/push/MR work against their own host.

**papai:**

- The `forge` vault becomes a **typed connection**: `{ kind, instanceUrl?, token }`.
  The "Code host" section adds a kind picker + an instance-URL field (shown for
  GHE / self-hosted GitLab); derive `apiBaseUrl` from the instance URL
  (`https://gitlab.example.com` → `…/api/v4`; GHE → `…/api/v3`). Per-connection
  "Test".
- The acp plugin sends the forge connection (`kind`, `apiBaseUrl`, `instanceUrl`)
  in the projectSpec/forge fields, so magi no longer relies on an operator
  `forge.kind`/`apiBaseUrl` default.

**magi:**

- `buildEphemeralProject` takes `forge.kind`/`apiBaseUrl` from the request, not
  defaults; `deriveForgeRepo` handles GitLab group/subgroup paths. The existing
  `GitLabForge` already supports a self-hosted `apiBaseUrl`.
- The repo-host allowlist (Phase 3) must admit the user's forge **instance host**
  — derive it from the connection (bounded by the operator ceiling); git transport
  (Phase 2 askpass) already works against any HTTPS host.

**Decisions to lock in the 4b spec:** how the host allowlist incorporates a
self-hosted instance host (auto-allow the connection's host vs operator must
list it — the SSRF tension from Phase 3 #2 resurfaces, sharper); `instanceUrl →
apiBaseUrl` derivation per kind.

**Out of 4b:** egress derivation (4c).

---

## Sub-phase 4c — Derived egress

**Goal (Story 9):** the sandbox reaches **exactly** the hosts the session needs —
the chosen provider host + `models.dev` (opencode) + the forge host — and nothing
else, with no operator allowlist edit, bounded by a hard operator ceiling.

**papai:** none beyond surfacing a read-only "this session can reach: …" summary
(optional).

**magi:** `buildEphemeralProject` **derives** `egressAllowlistDomains` from
`{ provider host (from 4a), models.dev if opencode, forge host (from 4b),
operator base domains }` instead of an operator-default list.

**geofront (config/doc only):** the operator sets the egress **org-layer ceiling**
(`egress.policy.ceiling`) in geofront's org config — the hard bound the derived
per-session allowlist cannot exceed. No geofront code change.

**Decisions to lock in the 4c spec:** whether the forge host belongs in the
**sandbox** egress at all (the agent works in a host-cloned worktree; magi does
the push host-side — so the forge host may only be needed if the agent runs git
itself); the operator base-domain set (npm/pip registries the agent needs);
ceiling-overflow behavior (reject vs clamp).

---

## Cross-cutting

- **Provider→env mapping** (papai-owned) is the spine of 4a and feeds 4c (the
  provider host derivation).
- **The SSRF boundary widens** in 4b/4c (user-supplied forge instance host +
  provider host) — the geofront org-ceiling and the repo-host allowlist remain the
  operator's hard limits. This is where Phase 5's guardrail UI will plug in.
- **No new persisted secrets:** provider keys + forge tokens remain in the
  encrypted vault (papai) and request-scoped to magi (Phases 1–2 discipline holds).
- **No geofront code** in any sub-phase.

## Recommended next step

Write the **4a detailed spec** (`…phase-4a-multi-provider-design.md`) first — it
is the prerequisite for 4c and the one that makes codex/opencode functional. Then
4b, then 4c. Each follows the established spec → plan → subagent-driven-execution
flow.

## Open question for the decomposition

- **Sub-phase granularity:** 4a / 4b / 4c as above (recommended), vs. a single
  combined Phase 4 (larger blast radius, longer-lived branch), vs. a finer split
  (e.g. 4a-provider and 4a-agent separately). The 3-way split keeps each sub-phase
  to one subsystem and independently shippable.
