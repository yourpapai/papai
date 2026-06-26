<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0221: Phase 1 — Agent-Credential Vault + Per-Session Secret Channel

## Status

Implemented

## Date

2026-06-25

## Context

ACP coding sessions (ADR-0218) run a sandboxed agent (`claude-code-acp`) under
magi control. Until this change, the only way the sandboxed agent could receive
an Anthropic API key was for an operator to provision one on the magi host (via
host path or macOS Keychain `SecretSource` variants). That model breaks down for
a multi-user bot: every user's sessions share one operator key, no per-user
accountability exists, and a user with no relationship to the operator cannot
self-serve a key at all.

The parent spec (`docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`)
defines a phased roadmap. Phase 1 — recorded here — delivers **agent
authentication**: a user (or group admin) stores **their own** Anthropic API key
in the settings web UI, and ACP sessions run with that key, with **no agent
credential ever set on the magi host**. Forge (code-host) identity is Phase 2;
user-defined repos Phase 3; multi-provider Phase 4.

The design (`docs/superpowers/specs/2026-06-25-phase-1-agent-credential-vault-design.md`)
locks five decisions: no central/global fallback (so no `enabled` toggle); magi
takes the agent key from the request only and throws if a required secret is
missing; the vault is config-context scoped (like BYOK LLM, ADR-0185); papai
owns the provider→env-name mapping (magi stays provider-ignorant); and a
minimal masked settings section reuses the BYOK field/state patterns minus the
toggle.

## Decision Drivers

- **No host credential for the agent key.** The agent's API key must never live
  in `process.env` or on disk on the magi host; the only copy is the encrypted
  papai vault, released per request.
- **Self-serve, per-context.** A user sets their own key in the settings UI;
  group admins set a group-shared key. No operator action required.
- **Defense in depth.** papai pre-flights and refuses in chat when no complete
  credential exists; magi's throw-on-missing is the backstop, not the primary
  gate.
- **Provider-agnostic magi.** magi stages secrets by name and stays ignorant of
  Anthropic semantics; papai owns the `anthropic → ANTHROPIC_API_KEY` mapping so
  a future multi-provider Phase 4 changes papai only.
- **Reuse over reinvent.** The vault mirrors `byok_llm_credentials` (ADR-0185)
  minus the toggle, reusing `secret-payload-crypto.ts` and the BYOK settings
  field/mask/state UI.

## Considered Options

### Option A: Operator-provisioned host key (status quo)

- **Pros:** zero new papai surface; magi unchanged.
- **Cons:** shared key across all users; no per-user accountability; a user
  cannot self-serve; operator must rotate for everyone at once. Rejected.

### Option B: Per-context vault, request channel, no host fallback (chosen)

- **Pros:** per-user/group keys; self-serve; no host credential; reuses BYOK
  crypto + UI patterns; magi gains a generic `request` `SecretSource` usable
  beyond Anthropic.
- **Cons:** a context with no key is hard-refused (no graceful central
  fallback); adds a cross-repo change (papai vault + magi request channel) that
  must ship together for end-to-end; secret transits the magi hop in the request
  body (mitigated by the existing `magi_token`-authed, loopback/firewalled
  channel + redaction assertions).

### Option C: papai proxies the agent LLM call instead of forwarding the key

- **Pros:** the key never leaves papai; magi need not handle secrets.
- **Cons:** breaks the sandboxed-agent architecture (magi must run the agent
  in-container against the model); doubles token billing and latency; couples
  papai to the agent's transport. Rejected.

## Decision

Six coordinated changes implement the architecture, split across the papai and
magi repos.

### 1. Encrypted per-config-context vault (papai)

New table `coding_session_credentials(context_id, namespace, encrypted_config,
updated_at, updated_by)`, PK `(context_id, namespace)`, indexed on
`updated_at` (migration `061`). The `namespace` column generalizes the vault:
Phase 1 uses `agent-provider`; `forge` follows. The store
(`src/coding-credentials/store.ts`) reuses `encryptSecretPayload` /
`decryptSecretPayload` from `secret-payload-crypto.ts` — the same AES-256-GCM
envelope as `byok_llm_credentials`. State is `{ configured, complete, missing }`
plus an `unreadable` flag for decrypt failure; **no `enabled` toggle** (there is
no central fallback to switch to). Empty-string writes clear a field; merges
preserve untouched fields.

### 2. `codingSecrets` plugin capability (papai)

A new first-party-only permission `coding.secrets` is added to
`PLUGIN_PERMISSIONS` (`src/plugins/types.ts`). The `PluginToolRuntimeContext`
(`src/plugins/runtime-types.ts`) gains a `codingSecrets` facade. `buildCodingSecretsFacade`
(`src/plugins/tool-runtime.ts`) resolves the acting context's vault and maps it
to env-name-keyed secrets, **denying** when the plugin lacks the permission —
consistent with the other facades. Resolution uses
`getConfigContextIdFromStorageContextId` so the vault is per-user in a DM and
group-shared in a group (ADR-0185 scope model). Values never touch `kv`, logs,
or chat.

### 3. acp plugin pre-flight + injection (papai)

`plugins/acp/plugin.json` declares `coding.secrets`. `start_session` and
`review_pr` (`plugins/acp/tools.ts`) resolve `codingSecrets.resolve()` **before**
calling magi; if `null`, they return `{ error: 'not_configured' }` with a
chat-facing hint and never hit the network. When configured, `secrets` is
included in the `POST /sessions` and `POST /reviews` body. This makes the
common failure a fast, in-chat refusal rather than a deferred magi throw.

### 4. Settings route + UI (papai)

`GET`/`PATCH` on `/settings/api/coding-credentials`
(`src/debug/settings/coding-credentials-routes.ts`), registered in the
user-plane before admin checks. Authorization reuses the existing
`resolveContextScope` (personal = DM owner; group = group admins + bot admins)
and `requireCsrf` on `PATCH`. `GET` never returns raw secrets — sensitive
fields are masked via `maskSensitiveValue`; a `clear: true` body shape clears
the row. The Svelte section
(`client/settings/sections/CodingCredentialsSection.svelte`) renders a masked
Anthropic API key field plus an optional Base URL, with per-field Save and the
BYOK-style "not configured / missing / unreadable" states — **no enable
toggle**. Wired into `SettingsApp.svelte` under the Advanced group as
"Coding sessions".

### 5. Request `SecretSource` + throw-on-missing (magi)

A new `SecretSource` variant `{ request, targetEnv, required? }` is added to
`src/project/config.ts`. `stageSecrets` (`secret-stager.ts`) receives the
per-session `secrets` map; for a `request` source it reads
`secrets[source.request]`, **throws** `provisioning secret not provided: <name>`
when a required secret is absent, and skips optional ones. The claude preset
(`presets.ts`) replaces its host `hostPath`/`keychain` targets with
`request`-sourced `ANTHROPIC_API_KEY` (required) + `ANTHROPIC_BASE_URL`
(optional); default egress keeps `api.anthropic.com`. No `process.env` read for
the agent key.

### 6. `secrets` threaded through runtime/managers/router (magi)

`AgentRuntime.provision` gains a `secrets` parameter
(`src/runtime/runtime.ts`), threaded from `SessionManager.runLifecycle` and
`ReviewManager.runReview` through `GeofrontRuntime.provision` → `stageSecrets`.
`StartSessionInput`/`StartReviewInput` gain `secrets?`. The HTTP layer
(`src/server/router.ts`) parses `secrets` via `asStringRecord` (rejects
non-string values) and forwards it; secrets are **never** persisted to
`SessionStore` and **never** logged. The stub runtime ignores the param.

## Consequences

### Positive

- A user's ACP sessions authenticate with that user's own Anthropic key; no
  operator key is involved.
- No agent credential lives on the magi host; the only copy is the encrypted
  papai vault, released per request and `shred`-ed by `magi-init` in-sandbox.
- The fast in-chat pre-flight (`not_configured`) gives clear UX without a
  round-trip; magi's throw is defense-in-depth only.
- The vault's `namespace` column and magi's generic `request` `SecretSource`
  generalize beyond Anthropic — Phase 4 multi-provider and the Phase 2 forge
  token reuse the same channel.
- Reusing BYOK crypto + UI patterns kept the papai surface small.

### Negative

- **Hard refusal, no fallback.** A context with no key cannot start a session;
  there is no central key to fall back to (by design, but it is a behavior
  difference from chat BYOK).
- **Cross-repo coupling.** papai's pre-flight and magi's throw-on-missing must
  agree on the `secrets` contract; a mismatch surfaces only at session start.
- **Manifest change clears acp approval.** Adding `coding.secrets` to
  `plugins/acp/plugin.json` clears the plugin's approval hash by design; an
  operator must re-approve acp after deploying.
- **Secret transits the magi hop in the request body.** Mitigated by the
  existing `magi_token`-authed, loopback/firewalled channel and redaction
  assertions, but it is a new secret-in-flight path that did not exist before.

### Risks

- A missing required secret surfacing only at `provision()` (after papai's
  pre-flight) could confuse if papai and magi disagree on requiredness; the
  `failed` milestone via `/api/notify` is the user-visible backstop.
- The vault is keyed on the config-context id; a group key is shared across all
  group threads/members, so any member can start sessions billed to it. Group
  admin trust is the existing scope boundary (ADR-0185).

## Related Decisions

- ADR-0218: papai ACP Plugin — the plugin whose sessions this vault
  authenticates.
- ADR-0185: BYOK LLM Credentials — the per-context encrypted-credential pattern
  this vault mirrors (minus the toggle) and the config-context scope model it
  reuses.
- ADR-0134: Dashboard Session Authentication — the settings-session cookie and
  CSRF model the coding-credentials route inherits via `authenticate` /
  `requireCsrf`.
- ADR-0219: BYOK Self-Serve — the self-serve settings-UI flow this section
  follows.

## Implementation Notes

Key papai files confirming the implementation is present:

- `src/db/coding-credentials-schema.ts` — Drizzle table `codingSessionCredentials`.
- `src/db/migrations/061_coding_session_credentials.ts` — `CREATE TABLE` + index;
  registered in `src/db/index.ts` `MIGRATIONS`; re-exported from
  `src/db/schema.ts`.
- `src/coding-credentials/types.ts` — `CODING_NAMESPACES`, `AGENT_PROVIDER_FIELDS`,
  `REQUIRED_AGENT_PROVIDER_FIELDS`, `FIELDS_BY_NAMESPACE`,
  `REQUIRED_BY_NAMESPACE`, `CodingCredentialState`.
- `src/coding-credentials/store.ts` — `getCodingCredentialState` /
  `getCodingCredentials` / `updateCodingCredentials` /
  `clearCodingCredentials`; reuses `encryptSecretPayload`/`decryptSecretPayload`.
- `src/coding-credentials/resolve-agent-secrets.ts` — `resolveAgentSecrets`
  (vault → `{ ANTHROPIC_API_KEY[, ANTHROPIC_BASE_URL] }`); `configContextOf`
  helper.
- `src/plugins/types.ts` — `'coding.secrets'` in `PLUGIN_PERMISSIONS` (line 57).
- `src/plugins/runtime-types.ts` — `codingSecrets` on
  `PluginToolRuntimeContext` (line 47).
- `src/plugins/tool-runtime.ts` — `buildCodingSecretsFacade` (line 154) +
  wired into `buildPluginToolRuntimeContext` (line 246).
- `src/debug/settings/coding-credentials-routes.ts` — `GET`/`PATCH`
  handler; registered in `src/debug/settings-api-router.ts`.
- `plugins/acp/plugin.json` — `permissions` includes `coding.secrets`.
- `plugins/acp/tools.ts` — `RuntimeContext.codingSecrets`; `start_session`
  pre-flight refusal (line 79) + `secrets` injection (line 92); `review_pr`
  pre-flight refusal (line 234) + injection (line 250).

**Divergence from the Phase 1 plan/spec:** the implementation shipped the
`forge` namespace (Phase 2) alongside `agent-provider`, ahead of the plan's
phased schedule. Concretely: `types.ts` declares both `agent-provider` and
`forge` fields; `resolve-agent-secrets.ts` exports a `resolveForgeToken`
helper; the `codingSecrets` facade exposes both `resolve()` and
`resolveForgeToken()`; the settings route accepts a `namespace` query/body
parameter (defaulting to `agent-provider`); and `review_pr` refuses with
`not_configured` when the forge token is missing too. This is beyond the Phase 1
plan boundary (which scoped agent authentication only) but is consistent with
the parent spec's roadmap; the magi-side request channel is the same mechanism
for both namespaces. No Phase 1 functional requirement is unmet.
