<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0237: Phase 4d — Model Selection + Codex Base-URL Fix

## Status

Implemented (with divergence)

## Date

2026-06-30

## Context

Phases 4a–4c (ADRs 0230–0232) shipped the agent/provider picker, typed forge connections, and a per-session derived sandbox egress. A coding-session caller could pick the **agent** (`claude`/`codex`/`opencode`), the **provider** with API key + base URL, but **there was no way to pick a specific model** — each agent CLI silently used its own default (Opus vs Sonnet, GPT-5 vs o3). Two concrete gaps remained:

1. **Model selection did not exist** anywhere — not in the papai `agent-provider` vault, the resolvers, the `secrets`/`projectSpec` bundles, the settings UI, or magi's presets.
2. **The codex base URL was a silent no-op.** magi staged `OPENAI_BASE_URL` as an env var for codex, but the Codex CLI **does not read `OPENAI_BASE_URL`** (or any model env var) — it sources its base URL from `~/.codex/config.toml` `[model_providers.*]`. So a configured custom base URL for codex never reached the CLI (claude and opencode already honored their `*_BASE_URL` env).

A pre-existing minor gap closed in passing: magi's `handleStart` read a top-level unvalidated `body.agent` for the launch while `projectSpec.agent` was the validated one — the two could diverge ("provision X, launch Y").

Research (spec §"Research finding") established two model-discovery mechanisms: **ACP-native** (`session/new` returns `configOptions[category=model]`; `session/set_config_option` applies a choice — authoritative and per-agent, but needs a sandbox spin-up) and **provider HTTP** (`GET {base_url}/v1/models` — cheap, instant, no sandbox). The locked decisions were to **apply** the model uniformly over ACP (`set_config_option`, magi-side, no model env var for any agent) and to **source the settings dropdown** from provider HTTP `/models` with a free-text fallback. The model is **config, not a secret**: it rides `projectSpec.model`, never the `secrets` bundle; `resolveModel` reads the identity context only (per-user preference, like `resolveAgent`), deliberately **not** pinned by 5a's `forceSharedKey`.

## Decision Drivers

- **Let users pick a specific model per coding agent** — the headline gap; requires the model to flow vault → `projectSpec` → the running CLI for all three agents.
- **Uniform model-apply path** — one mechanism (ACP `session/set_config_option`) so future agents need no model-specific plumbing; no model env var / `config.toml` model entry required.
- **Codex base URL must actually take effect** — generate `~/.codex/config.toml` from the configured base URL; the dead `OPENAI_BASE_URL` env secretTarget is removed.
- **Model is config, not a secret** — travels in `projectSpec.model`; identity-context only; not `forceSharedKey`-pinned.
- **Cheap settings discovery with a free-text escape hatch** — provider HTTP `/models` populates a combobox; the user can always type any value; the proxy holds the decrypted key server-side (browser never sees it).
- **SSRF defense on `/models`** — use only the vault-stored base URL, route through papai's outbound-fetch guards, key stays server-side, only `value`/`label` strings returned.
- **Reconcile the launch-agent source (#5)** — the validated `projectSpec.agent` is the single source of truth; drop the unvalidated `body.agent`.
- **TDD, two repos, explicit `git add` paths** — the plan knits into the write-hook pipeline and the cross-repo (papai + magi) coordination discipline.

## Considered Options

### Option 1: ACP `set_config_option` apply (uniform) + provider HTTP `/models` discovery + codex `config.toml` generation (chosen)

papai stores a `model` in the per-identity `agent-provider` vault, carries it as `projectSpec.model`, surfaces a permission-gated `resolveModel`, and offers a settings combobox populated by a SSRF-guarded `/models` HTTP proxy with a free-text fallback. magi applies the model after `session/new` via `session/set_config_option` (uniform across agents), generates `~/.codex/config.toml` for codex's custom base URL (dropping the dead `OPENAI_BASE_URL` env), and derives the launch agent from the validated spec.

- **Pros:** one uniform model-apply path (future agents need no model-specific plumbing); the `/models` proxy keeps the key server-side; codex's base URL finally reaches the CLI; the model is config (rides `projectSpec`, not `secrets`); identity-scoped like the agent; reuses the 4a vault/facade/`projectSpec` plumbing with no DB migration; the `#5` reconciliation closes the provision/launch mismatch for free.
- **Cons:** touches two repos (papai + magi) in one coordinated change; the ACP apply depends on each adapter actually emitting a `configOptions[category=model]` selector (adapter coverage is the key runtime risk); the `/models` proxy is provider-level (not agent-curated), so per-agent id formatting (opencode's `provider/model`) must be handled.

### Option 2: ACP-native (live) model discovery for the settings UI

Spin up the agent sandbox just to enumerate `configOptions[category=model].options`, then cache.

- **Pros:** authoritative and per-agent; base-URL-aware; same channel applies the model.
- **Cons:** needs a sandbox spin-up just to enumerate (slow, costly); needs caching; far heavier than the settings dropdown warrants. Deferred (a possible future upgrade).

### Option 3: Apply the model per-agent via env vars / `config.toml` model entries

Stage a model env var or write the model into each agent's config file.

- **Pros:** no ACP-roundtrip; no adapter-config-option dependency.
- **Cons:** per-agent plumbing forever (the opposite of uniform); codex already ignores `OPENAI_BASE_URL`, so a model env var is unreliable; the agents' own `set_config_option` is the supported channel.

## Decision

The chosen Option 1 shipped across both repos. What shipped:

### Part A — papai

1. **A1 — vault `model` field + `resolveModel` + facade.** `'model'` joins `AGENT_PROVIDER_FIELDS` (optional; not in `REQUIRED_AGENT_PROVIDER_FIELDS`). `resolveModel(storageContextId, chatUserId)` reads the identity context only (trim-empty ⇒ `null`), surfaced on the permission-gated `codingSecrets` facade alongside the other resolvers.
2. **A2 — `projectSpec.model` carry.** `buildSessionProjectSpec` includes `model` when `resolveModel()` is non-null (omitted when null). Both `start_session` and `review_pr` call `buildSessionProjectSpec`, so both carry the model.
3. **A3 — settings route: `combobox` control + `model` field + validation.** A new `combobox` field-control kind; the `model` field metadata; validation (max 200 chars, no control characters ⇒ 422) in the compatibility check.
4. **A4 — `/models` provider proxy (SSRF-guarded) + fetcher + UI combobox.** `GET /settings/api/coding-credentials/models?agent=<agent>` reads the stored key/base URL from the vault (key never returned), calls the provider's `/v1/models` (OpenAI/Anthropic shapes), normalizes to `[{value,label}]` with opencode `provider/model` prefixing, and degrades to `{ok:false, models:[]}` on any failure. SSRF: `assertPublicUrl` on the initial URL + `redirect:'error'` (prevents open-redirect to private addresses) + a 5s timeout. The settings section renders the model as a free-text combobox populated by this proxy, resetting the draft when the agent changes.

### Part B — magi (separate repo)

5. **B1 — `ProjectSpec.model` plumbing.** `ProjectSpec` gains `model?: string`; the validator parses it (optional, trimmed, length-capped, rejects control chars); the session store round-trips it; it is threaded `runLifecycle → runTurn → runAcpSession`.
6. **B2 — uniform ACP model apply + `#5` reconciliation.** After `session/new`, `selectModelConfig` finds the `configOptions[category=model]` selector and matches the requested value (by value, then display name); on a match `session/set_config_option` applies it before the first prompt; on no match/no model it logs a warning and uses the agent default (never hard-fails). `handleStart` derives the launch agent from the validated `projectSpec.agent` (the unvalidated `body.agent` is no longer read).
7. **B3 — codex `config.toml` generation + drop dead `OPENAI_BASE_URL` env.** `generateCodexConfigToml(baseUrl)` emits a `[model_providers.custom]` block (`env_key="OPENAI_API_KEY"`, `wire_api="chat"`); a new `generateCodexConfig` `SecretSource` variant stages it through the manifest `file` kind; the codex preset's dead `OPENAI_BASE_URL` env target is removed (codex still stages `OPENAI_API_KEY` as env).

## Consequences

### Positive

- Users can pick a specific model per coding agent for the first time; the choice flows vault → `projectSpec` → the running CLI for all three agents.
- One uniform ACP model-apply path for claude/codex (and a parallel config-generation path for opencode — see notes) means new agents need no model env-var plumbing; an unknown model degrades to a warn + the agent default rather than failing the session.
- Codex's custom base URL finally reaches the CLI (generated `config.toml`); the no-op `OPENAI_BASE_URL` env target for codex is gone, removing a misleading "configured but ineffective" state.
- The model is config (rides `projectSpec`, not `secrets`), identity-scoped, and not overridable by an operator's forced shared key — a user's model preference stays their own.
- The `/models` proxy keeps the decrypted key server-side; the browser only ever sees `value`/`label` strings; SSRF is defended at two layers (initial `assertPublicUrl` + `redirect:'error'`).
- The `#5` reconciliation makes the validated `projectSpec.agent` the single source of truth for the launch, closing the provision/launch mismatch.

### Negative

- **The "uniform ACP apply" decision did not hold for opencode.** opencode receives its model via a generated `opencode.json` at provision time (not ACP), so the model-apply path is now split: ACP for claude/codex, config-generation for opencode (see Implementation Notes). This is a coherent evolution, but it is a divergence from the locked "uniform via ACP" decision.
- **Cross-repo contract.** papai sends `projectSpec.model` and magi applies it; the ACP apply depends on each adapter emitting a `configOptions[category=model]` selector — the key runtime risk. An adapter that does not offer a model selector silently falls back to the default (warn-logged), not an error.
- **`provider_base_url`/`model` are non-secret config but live in the encrypted vault** alongside the key — masked only by virtue of the vault's encryption, like the other coding-credential fields.

### Risks

- **Adapter coverage.** Not all adapter versions are guaranteed to emit a `category:'model'` selector; a missing selector means the model cannot be applied over ACP and the session runs the agent default. The graceful warn + default is the mitigation; the warn log is the only diagnostic (supplemented by capability/config-options logging).
- **opencode id format.** `/models` raw ids vs opencode's `provider/model` routing — mitigated by per-agent prefixing at discovery time, a provider-prefix-stripping fallback at apply time, the free-text escape hatch, and the apply-time warn.
- **codex `config.toml` correctness.** `wire_api`/profile specifics — `wire_api="chat"` is hardcoded for broad compatibility with OpenAI-compatible proxies; advanced profile configuration is out of scope.
- **Resumed turns.** A model change does not apply on a resumed turn (documented post-hoc) — the model is applied once after `session/new`.
- **SSRF** on `/models` — mitigated by `assertPublicUrl` + `redirect:'error'` + timeout + vault-only base URL.

## Related Decisions

- **ADR-0230: Phase 4a — Multi-Provider + Agent Picker** — the immediate predecessor; added `PROVIDERS`/`compatible()` and the `agent-provider` vault this phase extends with `model`.
- **ADR-0231: Phase 4b — Typed Forge Connections + Self-Hosted GitLab** — the coding-session sibling that preceded 4c.
- **ADR-0232: Phase 4c — Derived Egress** — added `projectSpec.providerHost` and the derived egress this phase's custom codex base-URL host rides; the immediate predecessor in the phase-4 series (this is phase 4d).
- **ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec** — the inline `projectSpec` this phase extends with `model`.
- **ADR-0234: Phase 5a — Operator Guardrails** — the `forceSharedKey` model that `resolveModel` deliberately does **not** honor (model is identity-scoped).
- **ADR-0235: Phase 5b — Group-Session Identity** — the `identityContext` resolution `resolveModel` relies on.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`; the papai A1–A4 and magi B1–B3 commit messages match the plan verbatim, plus a hardening/follow-up series.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/types.ts:43` | `'model'` in `AGENT_PROVIDER_FIELDS` (optional; not in `REQUIRED_AGENT_PROVIDER_FIELDS`). | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:102-106` | `resolveModel(storageContextId, chatUserId)` reads `identityContext` only (not `forceSharedKey`-pinned); trim-empty ⇒ `null`. | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:12,40` | `resolveModel` on the `coding.secrets`-gated facade. | `read` confirms. |
| `src/plugins/runtime-types.ts:62` | `resolveModel(): string \| null` on the facade type. | `grep` confirms. |
| `plugins/acp/tools.ts:27,142,151,156` | `resolveModel` in the interface; `buildSessionProjectSpec` includes `model` when non-null. | `read` confirms. |
| `plugins/acp/session-tools.ts:96` | `review_pr` shares `buildSessionProjectSpec`, so the model rides both start and review. | `grep` confirms. |
| `src/coding-credentials/provider-models.ts:64-81` | `fetchProviderModels` — SSRF `assertPublicUrl` (initial) + `redirect:'error'` + 5s timeout; opencode `provider/model` prefixing; injectable `assertPublicUrl` deps for tests. | `read` confirms. |
| `src/debug/settings/coding-credentials-models-route.ts:17-46` | `handleModels` + route (extracted to its own file — see notes); reads key/base URL from the vault, degrades to `{ok:false, models:[]}`. | `read` confirms. |
| `src/debug/settings-api-router.ts:96` | `/settings/api/coding-credentials/models` route mount. | `grep` confirms. |
| `src/debug/settings/coding-credentials-fields-meta.ts:13,56-60` | `control?: 'select' \| 'combobox'`; the `model` field metadata with `control: 'combobox'` (extracted from the route file — see notes). | `grep` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:148-155` | Model validation in the compatibility check (max 200, no control chars ⇒ 422). | `grep` confirms. |
| `client/settings/fetcher-schemas-shared.ts:16` | `control` enum widened to `['text','select','combobox']`. | `grep` confirms. |
| `client/settings/fetcher-schemas-coding-models.ts:8-12` | `CodingModelsResponseSchema`/`CodingModelsResponse`. | `grep` confirms. |
| `client/settings/coding-credentials-fetchers.ts:27` | `fetchCodingModels(contextId, agent)`. | `grep` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:43,237-245,304-311` | `modelOptions` state; the load-on-context/agent/key `$effect`; the `combobox` render branch + reset-on-agent-change. | `grep` confirms. |
| `docs/architecture/coding-sessions.md:62-68` | "Model selection + codex base-URL fix (Phase 4d)" section documenting `resolveModel`, `projectSpec.model`, the `/models` proxy, and the codex `config.toml` fix. | `grep` confirms. |
| magi `src/project/spec-validation.ts:48-59,224,235` | `parseModel` + `validateRepoSpec` model parsing (extracted from `config.ts` — see notes). | `grep` confirms. |
| magi `src/project/config.ts:30,41-43,103` | `SecretSource` `generateCodexConfig` variant; `ProjectSpec.model` (comment notes opencode gets it at provision time, ACP agents ignore the secrets-side carry). | `read` confirms. |
| magi `src/session/store-row.ts:53-57` | `parseProjectSpec` round-trips `model` (extracted from `store.ts` — see notes). | `grep` confirms. |
| magi `src/session/{turn-tracking,lifecycle,helpers}.ts` | `model` threaded `runLifecycle → runTurn → runAcpSession`. | `grep` confirms. |
| magi `src/acp/select-model.ts:29-72` | `selectModelConfig` (value, then display name, then provider-prefix-stripped) + diagnostic `listModelOptions`. | `read` confirms. |
| magi `src/acp/client.ts:12,94-108` | After `session/new`, apply the model via `agent.session.setConfigOption` (warn + default on no match); logs offered options. | `grep` confirms. |
| magi `src/runtime/geofront/provisioning/codex-config.ts:35-45` | `generateCodexConfigToml(baseUrl)` with `tomlBasicString` escaping (hardened — see notes). | `read` confirms. |
| magi `src/runtime/geofront/provisioning/presets.ts:31-41` | `codexPreset` = `OPENAI_API_KEY` env + `{ generateCodexConfig: true }`; dead `OPENAI_BASE_URL` env target removed (it survives only in the **opencode** preset, which sources the base URL for opencode-config generation). | `read` confirms. |
| magi `src/runtime/geofront/provisioning/secret-stager.ts:5,34-37` | `generateCodexConfig` branch stages the generated TOML when `OPENAI_BASE_URL` is present. | `grep` confirms. |
| magi `src/server/router.ts:91,106,116` | Launch agent derived from the validated spec (`agent: validated.agent`); unvalidated `body.agent` no longer read. | `grep` confirms. |
| papai commits `0a15bdbaf`, `4f373345d`, `24de2729d`→(revert `ac78158b1`)→`94095cd5c` | A1/A2, A3, A4 (re-applied after a revert) commit messages match the plan verbatim; plus `a46a9dd0c`/`e0fa547d9` follow-ups. | `git log -S` confirms. |
| magi commits `c75add7`, `e8be6c1`, `0cb4c91` | B1 (plumbing), B2 (ACP apply + `#5`), B3 (codex `config.toml` + drop dead env) commit messages match the plan verbatim. | `git log -S` confirms. |

Plan-vs-implementation notes:

- **opencode applies the model at provision time, not via ACP (divergence from the "uniform ACP" decision).** The locked decision was "uniform via ACP `set_config_option`; no model env var / `config.toml` model entry required for any agent." magi instead added `generateOpencodeConfig(baseUrl, model, mcpServers)` (`a0a6dbd feat(coding-sessions): generate opencode.json with custom provider + model`, `d4176cd fix(coding-sessions): deliver opencode config via OPENCODE_CONFIG_CONTENT env`) so opencode's custom provider **and model** are declared in its generated config (delivered inline via the `OPENCODE_CONFIG_CONTENT` env var, because the non-root runtime uid has no writable home). Accordingly `ProjectSpec.model`'s sibling secret-side comment now reads "threaded to agents whose provider config is generated at provision time (opencode). Agents that apply the model over ACP ignore this." claude/codex still apply via ACP. So "uniform ACP" became "ACP for claude/codex, config-generation for opencode" — coherent, but a divergence.
- **CODEX_HOME relocated (divergence from the hardcoded target constant).** The plan hardcoded `CODEX_CONFIG_TARGET = '/home/dev/.codex/config.toml'` on the `generateCodexConfig` secret (`{ generateCodexConfig: true, target: CODEX_CONFIG_TARGET }`). The shipped secret is bare `{ generateCodexConfig: true }` (no `target`); magi-init writes the file into a **relocated CODEX_HOME** workspace dir (`691615a fix(coding-sessions): relocate codex CODEX_HOME to a writable workspace dir`) because the runtime uid has no writable home for `~/.codex`. The target resolution moved out of the plan's literal constant into magi-init.
- **TOML escaping hardened.** The plan's `generateCodexConfigToml` used naive `${baseUrl}` interpolation. The shipped generator wraps the base URL in `tomlBasicString` (escapes backslash/quote/tab/newline/DEL + remaining C0 control chars via a dynamic RegExp to avoid `no-control-regex`) — `33c6433 harden(coding-sessions): escape codex config.toml base_url against injection`, `879ab26 fix(coding-sessions): apply model on review path + complete codex config.toml control-char escaping`. The papai-side validator already rejects control chars, so this is defense-in-depth at the magi boundary.
- **Provider-prefixed model matching + diagnostics.** The plan's `selectModelConfig` matched by value then display name. The shipped version adds an `afterProviderPrefix` fallback (`d054b7e fix(acp): match provider-prefixed model options`) so a bare requested model matches opencode's `custom/<model>` prefixed option values, plus a diagnostic `listModelOptions` helper and capability/config-options/stop-reason logging (`820f636 feat(acp): log agent capabilities, offered config options, and turn stop reason`).
- **papai max-lines extractions.** The plan put `handleModels` + `FIELDS_META` inside `coding-credentials-routes.ts`. The shipped code extracted `handleModels` to `coding-credentials-models-route.ts` and `FIELDS_META` to `coding-credentials-fields-meta.ts`, and split the client into `fetcher-schemas-shared.ts` / `fetcher-schemas-coding-models.ts` / `coding-credentials-fetchers.ts` — max-lines-driven extractions consistent with the repo's split-on-design-signal policy (the same extraction noted in ADR-0232's `buildSessionProjectSpec` follow-up). The `combobox` control enum widened to `['text','select','combobox']` and renders via a shared `Combobox` component rather than the plan's inline `<input list>` + `<datalist>`. magi analogously split `config.ts` validation into `spec-validation.ts`/`repo-spec-validation.ts` and `store.ts` parse into `store-row.ts`, and grew a multi-repo `repoSpec` validation path (`repo-spec-validation.ts`) layered on top of the single-repo plan.
- **`auth_method` field + OAuth (later evolution, not 4d).** `AGENT_PROVIDER_FIELDS` now also carries `auth_method`, and the magi claude preset stages `CLAUDE_CODE_OAUTH_TOKEN` — a later auth evolution beyond 4d's vault shape; the `model` field itself is unchanged.
- **`/models` reverted then re-applied.** The Task 6 papai commit (`24de2729d`) was reverted (`ac78158b1`) and re-applied (`94095cd5c`) — the final shipped state matches the plan; `7bd868f90 fix(coding-credentials): make provider-model tests independent of DNS` made the `assertPublicUrl` dependency injectable so tests don't depend on the developer's DNS resolver.
- **Resumed-turn limitation (documented post-hoc).** magi notes that a model change does not apply on a resumed turn (`5e40cd3 docs: note model changes do not apply on a resumed turn`) — the model is applied once after `session/new`, not re-applied on resume.

The source plan `docs/superpowers/plans/2026-06-30-phase-4d-model-selection.md` and design `docs/superpowers/specs/2026-06-30-phase-4d-model-selection-design.md` are archived alongside this ADR to `docs/archive/`.
