<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User Self-Serve Coding-Session Credentials — Top-Level Multiphase Design

**Date:** 2026-06-25
**Status:** Draft (top-level spec; spawns one detailed spec + plan per phase)

## Problem

The ACP coding-session feature (`plugins/acp/`, driving the external **magi**
control service, which drives **geofront** sandboxes) currently requires the
**operator** to provision three things on the **magi host**:

1. the sandboxed agent's LLM credentials (magi reads `ANTHROPIC_API_KEY` etc.
   from its own `process.env` via a provisioning `SecretSource.env`, or from a
   host file/Keychain);
2. the forge token (`forge.tokenEnv` → `process.env[...]`) used for the PR/MR
   REST API; and
3. git transport auth for clone/push (magi's `runGit` shells out to bare `git`
   with the host's **ambient** credentials), plus the repo catalogue itself
   (a static `MAGI_PROJECTS` JSON registry loaded at magi startup).

Consequence: every user shares one operator-held key, one forge identity, and a
fixed repo list. There is no way for an end user to bring **their own** AI
provider key, **their own** code-host token/identity, or **their own** repos —
and no comfortable place to configure any of it.

We want users to self-serve all of this through the **settings web UI**, the
operator to wire the magi connection once and own only guardrails, and **magi to
hold no user secrets at rest**.

## Goal

Move the agent-credential plane and the forge/repo plane out of the magi host
environment and into **per-user, encrypted, settings-UI-managed** configuration
in papai, delivered incrementally so each phase is independently shippable.

This builds directly on the existing **BYOK self-serve** work for papai's own
chat LLM (`docs/superpowers/specs/2026-06-24-byok-self-serve-design.md`): same
encryption primitive, same per-config-context scope keying, same settings-UI
section pattern, same self-serve toggle philosophy — applied to a new class of
secrets (agent provider keys, forge tokens) and a new delivery channel (per
coding session, into the sandbox).

## Terminology — the three credential planes

| Plane                | What                                                    | Owner today                                                | Owner target                            |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| **1 — Chat LLM**     | papai's own conversation/tool-calling model             | system_config **or** per-context BYOK (already self-serve) | unchanged                               |
| **2 — Agent LLM**    | the model the sandboxed coding agent uses               | magi host env / file / Keychain                            | **per-user vault in papai**             |
| **3 — Forge + repo** | code-host token, git transport identity, repo catalogue | magi host env + static `MAGI_PROJECTS`                     | **per-user vault + catalogue in papai** |

This document covers Planes **2 and 3**. Plane 1 is out of scope (done).

## Invariants (hold across every phase)

1. **Secrets encrypted at rest in papai** via `src/secret-payload-crypto.ts`
   (AES-256-GCM, `INSTANCE_CONFIG_KEY`). Never stored as plaintext `user_config`
   or plugin-config rows — context-scoped plugin config is plaintext and the
   `sensitive` flag only masks the UI, so it is **not** an acceptable home for
   these secrets.
2. **magi never persists or logs user secrets.** They flow request → provisioning
   stager → `magi-init` (stage → `chmod 600` → `shred`), and are dropped from the
   in-memory session; never written to `SessionStore` or pino.
3. **geofront is unchanged.** Reuse the existing `magi-init` one-way injection
   and the org-layer egress **ceiling** (operator-set; project/user layers cannot
   raise it). No geofront schema change in any phase.
4. **One mechanism, extended.** Phases 2–4 widen the same `POST /sessions`
   request envelope and the same vault, not new transports.
5. **Operator can always cap.** A hard egress ceiling plus optional policy on
   allowed forge hosts / base images stays enforceable regardless of user config.
6. **Flag-off / not-configured is reference-identical** to today: a user with no
   vault entry falls back to existing operator-provisioned behavior; no regression
   to the current single-key path.

## Architecture

### Keystone — the per-session credential channel

The single new backbone. magi's `POST /sessions` request envelope evolves
additively (every new field optional; absent → today's behavior):

```jsonc
{
  "project": "demo", // Phase 1: named registry project
  "agent": "claude-code-acp",
  "contextId": "<storageContextId>",
  "prompt": "...",
  "secrets": {
    // Phase 1+: logical-name → value, request-scoped
    "ANTHROPIC_API_KEY": "…",
    "FORGE_TOKEN": "…", // Phase 2+
  },
  "forge": {
    /* per-session forge identity/token */
  }, // Phase 2+
  "projectSpec": {
    /* inline ephemeral project */
  }, // Phase 3+
}
```

magi maps `secrets` into the provisioning plan via a **new inline
`SecretSource`** variant (`{ inline: <value>, targetEnv | target }`) that feeds
the existing host-side stager (`secret-stager.ts`) — replacing today's
host-sourced `env` / `hostPath` / `keychain` sources for user-initiated runs.

### Data model (papai) — one generalized encrypted vault

A single namespaced vault, not one table per concern:

```
coding_session_credentials(
  context_id        TEXT,     -- config-context id (per-user in DM, group in group)
  namespace         TEXT,     -- 'agent-provider' | 'forge'
  enabled           INTEGER,  -- self-serve toggle (mirrors byok_llm)
  encrypted_config  TEXT,     -- AES-256-GCM blob of a Record<string,string>
  updated_at        INTEGER,
  updated_by        TEXT,
  PRIMARY KEY (context_id, namespace)
)
```

Reuses the `byok-llm` store shape: the `complete` / `missing` / `unreadable`
state machine and the `enabled` toggle. New migration. Repos (Phase 3) are
non-secret and live in a separate plain table.

### Plugin secret-injection mechanism

A new **host-built, first-party-only** plugin-runtime capability,
`runtimeContext.codingSecrets`, injected into the acp plugin's
`PluginToolRuntimeContext`. It resolves the **acting user's** vault (from
`chatUserId` → personal config context), decrypts in memory, and returns the
values for the plugin to place in the magi request body. Justification: the acp
plugin already owns the magi HTTP call and already handles the sensitive
`magi_token` via `adminConfig`; this keeps the request construction in one place.
Values never touch `kv`, logs, or chat history.

## Phases

| Phase                                                                | Delivers (stories)                                      | papai                                                                                                             | magi                                                                              | geofront                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| **1** Agent-cred vault + secret channel                              | 1, 4 (single provider; operator still owns repos/forge) | vault (ns `agent-provider`) + "AI provider" section + `codingSecrets` capability; inject on `start_session`       | `/sessions` accepts `secrets`; inline `SecretSource`; stage→shred; no persist/log | none                                               |
| **2** Per-user forge identity                                        | 2                                                       | vault (ns `forge`) + "Code host" section; pass token in start/finish                                              | per-session forge token into `ForgeProvider`; git transport token injection       | none                                               |
| **3** User-defined repositories                                      | 3                                                       | "Repositories" CRUD; send `projectSpec`; `list_projects` from papai                                               | `/sessions` accepts inline ephemeral project; validate vs operator policy         | none                                               |
| **4** Multi-provider + opencode + self-hosted forge + derived egress | 7, 8, 9                                                 | multi-vendor provider picker (+base URL), agent picker, typed forge connections (instance URL), egress derivation | opencode/codex secret+egress flow; gitlab self-hosted transport                   | operator sets egress org-ceiling (config/doc only) |
| **5** Admin guardrails + hardening                                   | 6                                                       | admin guardrails section, group-session identity policy, force-shared-key toggle, redaction audits                | enforce operator policy on inline projects; rate limits; redaction tests          | —                                                  |

### Phase 1 — Agent-cred vault + per-session secret channel

**Goal.** A user pastes their Anthropic key in the settings UI; sessions on
operator-defined projects authenticate with **their** key, with zero agent key
in magi's environment.

- **papai:** `coding_session_credentials` vault (namespace `agent-provider`);
  "Coding Sessions → AI provider" user settings section + read-only admin audit
  section (mirroring `AdminByokSection`); the `codingSecrets` plugin capability;
  `start_session` reads the vault and includes `secrets` in the magi request.
- **magi:** `POST /sessions` accepts `secrets`; new inline `SecretSource`; stager
  consumes request values; preset declares the logical secret name (claude →
  `ANTHROPIC_API_KEY`); **no persistence/logging** of secret values.
- **geofront:** none.
- **Acceptance:** a user with a stored key runs a real session on an
  operator-defined project; magi's `SessionStore` rows and pino logs contain no
  secret; not-configured users fall back to today's behavior unchanged.
- **Risks:** secret in HTTP body over LAN — mitigated by `magi_token` auth +
  loopback/firewall; TLS documented as the production hardening.

### Phase 2 — Per-user forge identity (token + git transport)

**Goal.** The agent clones, pushes, and opens a PR/MR as the **user's** forge
identity, using a token they stored in the settings UI; operator still defines
which repos exist.

- **papai:** vault namespace `forge`; "Coding Sessions → Code host" section;
  plugin passes the forge token in `start_session` / `finish_session`.
- **magi:** thread the per-session token into `ForgeProvider` (drop the
  `tokenEnv` host lookup for user runs); **git transport token injection** —
  extend `runGit` to accept an `env`, use `GIT_ASKPASS` + `GIT_TERMINAL_PROMPT=0`
  with the token passed via child env (**never** argv, URL, or stored remote) for
  clone/fetch/push.
- **geofront:** none.
- **Acceptance:** clone/push + PR open succeed under the user's identity with no
  host git creds and no `GITHUB_TOKEN` in magi's env; the token never appears in
  process args, stored remotes, or logs.
- **Risks:** git credential plumbing is the trickiest change; covered by a
  dedicated spec + transport tests.

### Phase 3 — User-defined repositories

**Goal.** Users add their own repos via the settings UI; no operator
`projects.json` edit.

- **papai:** "Coding Sessions → Repositories" CRUD per user (repoUrl, baseBranch,
  agent, permission preset); plugin sends an inline `projectSpec`; `list_projects`
  sourced from the papai catalogue.
- **magi:** `POST /sessions` accepts an inline ephemeral `projectSpec` (the static
  registry becomes optional/fallback); validate the spec against operator policy.
- **geofront:** none.
- **Acceptance:** a user adds a repo and runs a session with no operator step;
  operator policy can still reject disallowed forge hosts / base images.

### Phase 4 — Multi-provider + opencode + self-hosted forge + derived egress

**Goal.** Stories 7–9: opencode and other agents, multi-vendor providers,
self-hosted forges, and automatic egress.

- **papai:** multi-vendor provider picker (Anthropic / OpenAI / OpenAI-compatible
  - base URL) **decoupled** from the agent picker (claude / codex / opencode);
    typed forge connections (GitHub / GHE / GitLab SaaS / GitLab self-hosted +
    instance URL); egress **auto-derived** from the chosen forge host + provider
    host (+ `models.dev` for opencode); per-connection Test action.
- **magi:** opencode/codex secret + egress flow (presets already exist); GitLab
  self-hosted `apiBaseUrl` (supported) and git transport to the custom host.
- **geofront:** operator sets the egress **org-layer ceiling** (config/doc only).
- **Acceptance:** a user on `gitlab.example.com` + opencode + their own provider
  key runs a session reaching exactly {forge host, provider host, models.dev},
  bounded by the operator ceiling.

### Phase 5 — Admin guardrails + hardening

**Goal.** Story 6 and the safety envelope.

- **papai:** admin "Coding Sessions guardrails" section (allowed base images /
  forge-host allowlist / who-may-use / force-shared-key toggle); **group-session
  identity policy** (whose creds a group session uses); redaction audits.
- **magi:** enforce operator policy on inline projects; per-user rate limits;
  secret-redaction tests.
- **Acceptance:** operator constraints provably bound user self-serve; group
  sessions use the policy-selected identity.

## Cross-cutting concerns

- **Scope keying.** Vault rows are keyed on the **config-context id**
  (`getConfigContextIdFromStorageContextId`) like `byok_llm` — per-user for DMs,
  group-shared for groups. The default identity for a coding session is the
  **acting user's personal config context** (your key, your forge identity), even
  when the session starts inside a group; the group-vs-initiator policy is a
  Phase 5 decision.
- **Security / threat model.** Authored in detail in the Phase 1 spec: secret
  lifetime end-to-end, redaction points, the blast radius of the new
  `codingSecrets` plugin capability, and LAN-transport hardening.
- **Testing.** Each phase ships redaction assertions (no secret in store/logs)
  and a not-configured reference-identical path. Follow `tests/CLAUDE.md`; the
  settings routes mirror the existing `byok-routes` test suites.

## Locked decisions (from review)

1. **One generalized `coding_session_credentials` vault** with a `namespace`
   column — not per-concern tables.
2. **`codingSecrets` plugin capability** resolves + decrypts the acting user's
   vault inside the plugin tool runtime — the plugin owns the magi request, so
   injection stays there rather than in host interception code.
3. **Per-user scope by default**, keyed on the personal config context;
   group-session identity is a Phase 5 policy.

## Open decisions to confirm per phase

- **Phase 3/5:** repos fully open vs operator-allowlisted forge hosts.
- **Phase 5:** BYO-key per user vs operator-forced shared org key (the
  force-shared-key toggle).
- **Phase 5:** group-session identity — initiator's creds vs a designated
  group/service identity.

## References

- `docs/superpowers/specs/2026-06-24-byok-self-serve-design.md` — Plane 1
  self-serve; the pattern this extends.
- `docs/superpowers/specs/2026-06-16-acp-plugin-design.md` — the acp plugin.
- magi: `docs/superpowers/specs/2026-06-24-magi-dockerfile-generation-design.md`
  and `docs/geofront-limitations.md` — provisioning + the geofront constraints
  this design works within.
- Code anchors: `src/secret-payload-crypto.ts`, `src/byok-llm/store.ts`,
  `src/llm-config-resolver.ts`, `src/plugins/tool-runtime.ts`,
  `plugins/acp/{tools,client}.ts`; magi `src/server/router.ts`,
  `src/runtime/geofront/provisioning/*`, `src/forge/provider.ts`,
  `src/workspace/git-workspace.ts`.
