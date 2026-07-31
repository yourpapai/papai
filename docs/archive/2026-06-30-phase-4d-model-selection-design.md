<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4d — Coding-session model selection + codex base-URL fix

> Spans two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`). Builds on Phase 4a (multi-provider), 4b (typed forge), 4c (derived egress).

## Problem & current state

A coding-session caller can pick the **agent** (`claude`/`codex`/`opencode`) and a **provider** with **API key** + **base URL**, but there is **no way to pick a specific model** (Opus vs Sonnet, GPT-5 vs o3, etc.). Each agent CLI silently uses its own default.

Verified end-to-end state today:

| Data                | Stored (papai vault `agent-provider`) | Sent to magi                                                               | Reaches the CLI?                     |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| `provider_api_key`  | yes                                   | `secrets.{ANTHROPIC,OPENAI}_API_KEY`                                       | yes                                  |
| `provider_base_url` | yes                                   | `secrets.{ANTHROPIC,OPENAI}_BASE_URL` + host in `projectSpec.providerHost` | **claude ✅, opencode ✅, codex ❌** |
| `agent`             | yes                                   | `projectSpec.agent`                                                        | yes                                  |
| **`model`**         | **absent**                            | —                                                                          | —                                    |

Two concrete gaps:

1. **Model selection does not exist** anywhere — not in the papai vault, resolvers, `secrets`/`projectSpec`, the settings UI, or magi's presets.
2. **Codex base URL is a silent no-op.** magi stages `OPENAI_BASE_URL` as an env var (`presets.ts` `codexPreset`), but the Codex CLI does **not** read `OPENAI_BASE_URL` (or any model env var). Codex sources its base URL from `~/.codex/config.toml` `[model_providers.*]` and its model from `config.toml`/`--model`. So a configured custom base URL for codex never takes effect.

A pre-existing minor gap: magi's `handleStart` (`src/server/router.ts:90`) reads a top-level `body.agent` that drives `runtime.launch` but is only null-checked, while `projectSpec.agent` is validated by `validateRepoSpec`. The two can diverge ("provision X, launch Y").

## Research finding: dynamic model discovery is possible (two mechanisms)

magi pins `@agentclientprotocol/sdk@0.28.1`, whose model selection flows through **session config options**:

- **`session/new`** returns `configOptions: SessionConfigOption[]`. A model selector is an option with `category: "model"`, `type: "select"`, carrying `currentValue` + `options[]` where each is `{ value, name, description? }` (optionally grouped). This list is authoritative and **per-agent** (reflects the configured provider/base-URL/key, because the agent connects to it).
- **`session/set_config_option({ sessionId, configId, { value } })`** applies the chosen model and returns the updated options.

Mechanisms to "fetch available models, base URL provided":

| Mechanism     | How                                                                 | Pros                                                                | Cons                                                              |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ACP-native    | launch agent, read `configOptions[category=model].options`          | authoritative per-agent; base-URL-aware; same channel applies model | needs a sandbox spin-up just to enumerate; needs caching          |
| Provider HTTP | `GET {base_url}/v1/models` (OpenAI/compat) / Anthropic `/v1/models` | cheap, instant, no sandbox                                          | provider-level (not agent-curated); needs per-agent id formatting |

**Decisions taken** (see "Decisions" below): apply the model **uniformly over ACP** (`set_config_option`); source the settings dropdown from **provider HTTP `/models`** with a **free-text fallback**.

## Decisions (locked)

1. **Scope:** model selection for all three agents **+** fix the codex base-URL gap **+** the router agent-source reconciliation (#5).
2. **Model application:** uniform via ACP `session/set_config_option` (magi-side). No model env var / `config.toml` model entry required for any agent.
3. **Model discovery (UI):** provider HTTP `/models` populates a combobox; free-text fallback always available.
4. **Codex base URL:** magi generates `~/.codex/config.toml` (`[model_providers.custom]` with `base_url` + `env_key = "OPENAI_API_KEY"`, `wire_api = "chat"`), staged via the manifest `file` kind. The dead `OPENAI_BASE_URL` env secretTarget for codex is removed.
5. **Model scope:** `resolveModel` reads the **identity context only** (per-user preference, like `resolveAgent`); **not** pinned by `forceSharedKey`. The admin shared-key vault keeps its `{provider, key, base_url}` shape (no `model`).
6. **Model is config, not a secret:** it travels in `projectSpec.model`, never in the `secrets` bundle.

## Architecture & data flow

```
SETTINGS (config time)
  Browser (AI provider section)
    → GET /settings/api/coding-credentials/models?agent=&provider=     [papai settings server]
        papai reads decrypted base_url+key from the acting-identity vault
        → GET {base_url}/v1/models (OpenAI/compat)  OR  Anthropic /v1/models
        → returns [{value,label}]  → combobox suggestions   (free-text always allowed)
    User saves agent/provider/key/base_url/MODEL → vault (whole-record PATCH)

SESSION (run time)
  plugins/acp → POST /sessions (and /reviews) to magi
    secrets:     { ANTHROPIC_API_KEY|OPENAI_API_KEY, *_BASE_URL? }   (unchanged)
    projectSpec: { …, agent, providerHost?, forge?, model? }         (+model)
  magi:
    provisioning: claude/opencode → env (unchanged)
                  codex + custom base URL → generate config.toml (file-stage) [NEW]
    ACP session:  session/new → read configOptions[category=model]
                  projectSpec.model matches an option → session/set_config_option [NEW]
                  else → log warn, use agent default
    launch agent: derived from validated projectSpec.agent (drop unvalidated body.agent) [#5]
```

Key properties: one uniform model-apply path (future agents need no model-specific plumbing); the `/models` proxy holds the decrypted key server-side (browser never sees it); codex base URL is connection-level (config.toml) and distinct from the session model (ACP).

## papai changes

### Vault & types — `src/coding-credentials/types.ts`

- Add `'model'` to `AGENT_PROVIDER_FIELDS` (optional; **not** in `REQUIRED_AGENT_PROVIDER_FIELDS`; empty ⇒ agent default).
- `PROVIDERS`/`AGENTS`/`compatible()` unchanged.

### Resolvers — `src/coding-credentials/resolve-agent-secrets.ts`

- Add `resolveModel(storageContextId, chatUserId): string | null`, mirroring `resolveAgent`: reads `identityContext` only; trim-empty ⇒ `null`. Not subject to `sharedKeyContext`/`forceSharedKey`.
- `resolveAgentSecrets`/`resolveProviderHost` unchanged.

### Capability facade — `tool-runtime.ts` + `plugins/acp/tools.ts` interface

- Add `resolveModel(): string | null` to the `codingSecrets` facade, gated by `coding.secrets` like the other resolvers.

### projectSpec — `plugins/acp/tools.ts` (`buildSessionProjectSpec`) + `plugins/acp/session-tools.ts` (review path)

- Include `model` when non-null: `...(model === null ? {} : { model })`. Sent for both `start_session` and `review_pr`. Rides in `projectSpec`, not `secrets`.

### Settings route + UI — `src/debug/settings/coding-credentials-routes.ts`, `client/settings/sections/CodingCredentialsSection.svelte`

- New `control: 'combobox'` field kind (HTML `<input list>` + `<datalist>`): a text field with dynamic suggestions. Used for the `model` field metadata in `FIELDS_META['agent-provider']`.
- Whole-record save: `model` joins agent/provider/key/base_url in the single PATCH; reset the `model` draft when the agent changes (same pattern as the provider reset).
- Validation (in/after `checkCompatibility`): `model` optional; if present, trim + length cap + reject control chars/newlines. **No hard allowlist** (free-text must pass).

### `/models` proxy — `src/debug/settings/coding-credentials-routes.ts`

- `GET /settings/api/coding-credentials/models?agent=<agent>` (settings-scoped). The `agent` query param (the current UI draft) drives per-agent id formatting only; **`provider`, `base_url`, and `key` come from the saved acting-identity vault** (the key is sensitive and lives server-side only). If no key is saved yet, the endpoint returns `{ ok:false, models:[] }` and the UI stays on free-text until the user saves credentials. With the saved creds it calls:
  - OpenAI / openai-compatible: `GET {base_url||https://api.openai.com}/v1/models`, `Authorization: Bearer <key>`.
  - Anthropic: `GET {base_url||https://api.anthropic.com}/v1/models`, headers `x-api-key` + `anthropic-version`.
- Normalizes to `[{ value, label }]`. **Per-agent id formatting:** for `opencode`, prefix ids with the provider (`anthropic/…`, `openai/…`); for `claude`/`codex`, pass through.
- Never returns the key. On any failure (no `/models`, network error, non-200) ⇒ `{ ok:false, models:[] }`; the UI degrades to free-text.

### Security — SSRF on `/models`

- Use **only** the vault-stored base URL (not arbitrary request input); require `https://`.
- Route through papai's existing outbound-fetch guards (the web-fetch SSRF protections / `providerAllowedHosts` machinery): block loopback/private/link-local/metadata IPs; enforce timeout; cap response size.
- Endpoint reachable only via the single-use `/config`-bootstrapped settings session; key stays server-side; only `value`/`label` strings returned.

## magi changes

### Spec plumbing — `src/project/config.ts`, `src/session/store.ts`

- Add `model?: string` to `ProjectSpec`. `validateRepoSpec` parses it: optional string, trimmed, length-capped, reject control chars. Pass-through in `buildEphemeralProject`. Persist in `session/store.ts` (serialize/parse `model`), like `providerHost`.

### Codex `config.toml` generation — new `src/runtime/geofront/provisioning/codex-config.ts`

- Generated **only when codex has a custom base URL** (openai-compatible). Output:
  ```toml
  model_provider = "custom"
  [model_providers.custom]
  name = "custom"
  base_url = "<OPENAI_BASE_URL>"
  env_key = "OPENAI_API_KEY"
  wire_api = "chat"
  ```
- Staged as a `file` manifest entry targeting `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`). `OPENAI_API_KEY` stays staged as env (codex reads it via `env_key`).
- **Remove** codex's `OPENAI_BASE_URL` env secretTarget from `presets.ts`. Plain `openai` (no custom base URL) ⇒ no config.toml; default provider + `OPENAI_API_KEY`.
- Mechanics: generation runs in the staging step (`secret-stager.ts`/`plan.ts`) where both `requestSecrets` (for the base-URL value) and `projectSpec` are available. Staging gains the ability to emit a **generated** file, not only copy staged secrets.

### Uniform model apply — `src/acp/client.ts`

- After `session/new`, read `NewSessionResponse.configOptions`; find the entry with `category === 'model'` (`type:'select'`).
- If `projectSpec.model` matches an `option.value` (or `name`), call `session/set_config_option({ sessionId, configId, { value } })` before the first prompt. No match / no model ⇒ log `warn`, proceed with default.
- Thread `model` through `RunAcpSessionOptions` → `manager.ts`/`reviews` → `runtime.launch` → `runAcpSession`.
- **Risk:** today's `buildSession().withSession()` wrapper may not surface `configOptions`; may need a lower-level `cx.request(acp.methods.session.new, …)` call. SDK exposes both `session/new` and `session/set_config_option`. Spike first.

### Router reconciliation (#5) — `src/server/router.ts`

- Derive the launch agent from the validated `projectSpec.agent`; drop/ignore the unvalidated top-level `body.agent`. Closes the provision/launch mismatch.

### Egress — unchanged

- `deriveEgress` already unions `providerHost` (model host, incl. a custom codex endpoint) + agent-infra. Reachable within the operator's geofront ceiling (pre-existing constraint; documented).

## Testing strategy

- **papai** (DI-first per `tests/CLAUDE.md`): `resolveModel` (identity-scoped, empty⇒null, not forceSharedKey-pinned); facade `coding.secrets` gating; `buildSessionProjectSpec`/review path include `model`; route validation (length/charset, optional); `/models` proxy via `setMockFetch` — OpenAI shape, Anthropic shape, opencode prefixing, failure⇒degrade, SSRF rejection (loopback/non-https); whole-record PATCH preserves untouched `model`.
- **magi**: `validateRepoSpec` model parsing; `codex-config.ts` TOML output (custom base URL present vs absent); staging emits the `file` manifest line; ACP client apply logic (match ⇒ `set_config_option`, no-match/no-model ⇒ warn + default); router #5 reconciliation.
- **integration**: session-start with model set ⇒ `set_config_option` called with the resolved value; codex + custom base URL ⇒ `config.toml` staged at `$CODEX_HOME`.

## Risk register

1. **ACP client refactor** — accessing `configOptions` may need a lower-level call shape than today's `withSession` wrapper. _Mitigate:_ spike against the SDK first.
2. **Adapter coverage** — uncertain all three adapters emit a `category:'model'` option (claude-code-acp least certain). _Mitigate:_ graceful warn + default; verify each adapter during impl.
3. **opencode id format** — `/models` raw ids vs opencode's `provider/model`. _Mitigate:_ per-agent prefixing + free-text + apply-time warn.
4. **codex config.toml correctness** — `wire_api`/profile specifics. _Mitigate:_ unit test + manual verify against a real openai-compatible endpoint.
5. **SSRF** on `/models` (mitigations above).
6. **Egress ceiling** — custom base-URL host must be in the operator's geofront ceiling (pre-existing; document).

## Increment order (each TDD, cross-repo)

1. magi: `ProjectSpec.model` + validate + store (plumbing).
2. magi: ACP `set_config_option` apply path + router #5 reconciliation.
3. magi: codex `config.toml` generation + drop dead `OPENAI_BASE_URL` env.
4. papai: vault `model` field + `resolveModel` + facade + `projectSpec.model`.
5. papai: settings route validation + `combobox` control + whole-record save.
6. papai: `/models` proxy + SSRF guards + UI wiring.
7. Docs: update `docs/architecture/coding-sessions.md` (model selection + codex base-URL fix).

## Out of scope

- ACP-native (live) model discovery for the settings UI (HTTP `/models` chosen instead; ACP enumeration remains a possible future upgrade).
- Operator-forced model (`forceSharedKey` does not pin `model`).
- Advanced codex `wire_api`/profile configuration UI (`"chat"` hardcoded for compatibility).
- A maintained per-agent model allowlist (free-text + dynamic discovery instead).
