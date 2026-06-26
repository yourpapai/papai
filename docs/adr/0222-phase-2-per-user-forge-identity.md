<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0222: Phase 2 — Per-User Forge Identity

## Status

Implemented

## Date

2026-06-25

## Context

Phase 1 (ADR-0221) shipped the encrypted `coding_session_credentials` vault, the `codingSecrets` plugin capability, and the per-session request channel that let an ACP coding session run under a per-context LLM key supplied by the user. The vault was made namespace-generic during the Phase-1 A1 review (`FIELDS_BY_NAMESPACE` / `REQUIRED_BY_NAMESPACE` dispatch), anticipating a second namespace without a second table.

Phase 2 closes the remaining identity gap: git transport and forge (code-host) API calls. Before this change, magi cloned, pushed, and opened PRs/MRs using an operator-owned forge token read from `process.env[project.forge.tokenEnv]` on the magi host. That meant every user's push landed under a single shared operator identity, and a forge PAT lived on the magi host — both an auditability problem and a secret-surface problem. The 2026-06-25 Phase-2 design (`docs/superpowers/specs/2026-06-25-phase-2-forge-identity-design.md`, Plane 3 of the parent user-self-serve-credentials spec) specifies that the user stores **their own** code-host token in the settings UI and ACP sessions clone, push, and open the PR/MR under that identity, with **no forge token on the magi host**.

## Decision Drivers

- **Per-user attribution**: pushes and PRs must be attributable to the acting user's forge identity, not an operator service account.
- **No forge secret at rest on the magi host**: the token must live only in papai's encrypted vault and ride each request; magi must stop reading `process.env[forge.tokenEnv]`.
- **Reuse Phase-1 infrastructure**: the namespace-generic vault, the `codingSecrets` capability, and the per-session request channel are already in place; Phase 2 should extend them, not fork them.
- **Token never in argv, URL, or `.git/config`**: git transport must receive the credential through the child environment only, so it never appears in process listings, remote URLs, or repo metadata.
- **Lenient at start, strict at finish/review**: `start_session` must still work for public-repo exploration without a token; `finish_session` and `review_pr` definitively need one and should pre-flight refuse.
- **Config-context scope parity**: the forge token is keyed on the same config context as the agent key (per-user in DM, group-shared in a group).

## Considered Options

### Option A — Per-session request-sourced token via `GIT_ASKPASS` env helper (chosen)

The acp plugin resolves a per-context forge token through `codingSecrets.resolveForgeToken()`, forwards it on the start/finish/review request body, and magi injects it into the git child environment through a committed `git-askpass.sh` asset plus `forProject(project, token)` for the forge API.

- **Pros:** No forge token at rest on the magi host; per-user attribution; reuses Phase-1 vault and request channel; token confined to the child env (never argv/URL/`.git/config`); trivially extensible to Phase-4 self-hosted forges.
- **Cons:** Adds a cross-repo contract (papai sends `forgeToken`; magi parses it on three endpoints) that must be kept in sync; askpass asset must ship exec-bit-correct.

### Option B — Operator-owned forge token with per-user impersonation metadata

Keep the token on the magi host; pass a user display name and have the forge API attribute commits to that user.

- **Pros:** No new token in flight; magi-only change.
- **Cons:** Does not remove the secret from the magi host; attribution is cosmetic — the PAT still owns the push; cannot scope per-user permissions or rate limits; fails the "no forge token on the magi host" driver outright.

### Option C — SSH host-key transport instead of HTTPS token

Use per-user SSH keys deployed to the magi host and an SSH `repoUrl`.

- **Pros:** No token handling in git argv/env at all.
- **Cons:** Not a user-self-serve path (SSH key distribution is operator-heavy); out of the Phase-2 scope boundary (token transport assumes an HTTPS `repoUrl`); deferred to a later phase.

## Decision

Extend the Phase-1 keystone with one new namespace and one new git-transport mechanism. The papai-side changes are the subject of this ADR; the magi-side changes (request channel, per-session forge provider, askpass git transport) land in the magi repo against the same design and are referenced as the cross-repo contract.

### 1. `forge` namespace in the credential vault

`src/coding-credentials/types.ts` registers a second namespace alongside `agent-provider`: `CODING_NAMESPACES = ['agent-provider', 'forge']`, `FORGE_FIELDS = ['forge_token']`, `REQUIRED_FORGE_FIELDS = ['forge_token']`, wired into `FIELDS_BY_NAMESPACE` and `REQUIRED_BY_NAMESPACE`. `store.ts` needs no logic change — it is already namespace-parameterized.

### 2. Namespace-generalized settings route

`src/debug/settings/coding-credentials-routes.ts` replaces the hardcoded `NAMESPACE`/`CODING_FIELDS` with a per-namespace `FIELDS_META` registry (`agent-provider` → `[provider_api_key, provider_base_url]`; `forge` → `[forge_token]`, each with `{ label, required, sensitive }`) and a `parseNamespace` helper (defaults to `agent-provider`, rejects unknown → 400). `namespace` is a query param on GET and an optional body field on PATCH. Masking, `resolveContextScope`, and CSRF logic are unchanged; the agent-provider path is regression-preserved.

### 3. `resolveForgeToken` capability + facade

`src/coding-credentials/resolve-agent-secrets.ts` extracts a shared `configContextOf(storageContextId)` helper (used by both `resolveAgentSecrets` and the new `resolveForgeToken`) and adds `resolveForgeToken(storageContextId): string | null`, which reads the `forge` vault at the config context and returns the trimmed token or `null`. `src/plugins/runtime-types.ts` extends the `codingSecrets` facade type with `resolveForgeToken(): string | null`; `src/plugins/tool-runtime.ts` implements it permission-gated by `coding.secrets`, mirroring `resolve`.

### 4. acp plugin pre-flight + injection

`plugins/acp/tools.ts` extends its local `RuntimeContext.codingSecrets` type with `resolveForgeToken`. `start_session` includes `forgeToken` in the `/sessions` body only when non-null (no refusal). `finish_session` and `review_pr` **pre-flight refuse** with `{ error: 'not_configured', message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.' }` when `resolveForgeToken()` is `null`, and include `forgeToken` in the `/sessions/:id/finish` and `/reviews` bodies otherwise.

### 5. "Code host" settings section

`client/settings/sections/CodeHostSection.svelte` renders one masked **Code-host token** field with the same Save/Replace/masked-state patterns as the AI-provider section and **no enable toggle**. It calls `fetchCodingCredentials(contextId, 'forge')` and `patchCodingCredentials({ contextId, namespace: 'forge', values })`. `client/settings/fetchers.ts` gains a `namespace` arg (defaulting to `agent-provider` for the existing caller); `fetcher-schemas.ts` adds `namespace` to the PATCH schema. `client/settings/SettingsApp.svelte` imports the section, adds `'code-host'` to `ADVANCED_IDS`, and inserts a "Code host" sidebar item after `coding-credentials`.

### Cross-repo contract (magi)

magi parses `forgeToken` on `POST /sessions`, `/sessions/:id/finish`, and `/reviews`; `RequestForgeProvider.forProject(project, token)` builds the forge with the request token (throwing on empty, no env read); `runGit` injects the token via a committed `git-askpass.sh` asset through the child env only (`GIT_ASKPASS`, `GIT_TERMINAL_PROMPT=0`, `MAGI_GIT_USERNAME` per forge kind, `MAGI_GIT_TOKEN`); `GitWorkspaceManager` threads `auth` to network ops only (clone/fetch/push), leaving local ops unauthenticated. The field name `forgeToken` ↔ `forgeToken` is the contract seam, verified exactly like Phase 1's `ANTHROPIC_API_KEY`.

## Consequences

### Positive

- Pushes, PRs, and reviews are attributable to the acting user's forge identity, not an operator service account.
- No forge token at rest on the magi host; the token lives only in papai's AES-256-GCM vault and rides each request.
- The token is confined to the git child environment — never argv, never the remote URL, never `.git/config` — so it does not leak into process listings or repo metadata.
- The namespace-generic vault, `codingSecrets` capability, and per-session request channel are reused, not forked; Phase 4 self-hosted forges reuse the same `FIELDS_META` registry.
- `start_session` remains usable for public-repo exploration without a configured token; a private clone without a token fails at the git layer with a clear error rather than a silent fallback.

### Negative

- **Cross-repo contract.** papai sends `forgeToken` and magi parses it on three endpoints; a rename on either side breaks start/finish/review. The contract is small (one field name) but must be tracked alongside Phase 1's.
- **`forge.tokenEnv` is now vestigial.** The config type keeps the field (Phase 3/4 may restructure project config), but it is no longer read. Operators relying on the old env path must migrate to per-user tokens.
- **One forge per project.** Self-hosted GitLab and typed forge connections are Phase 4; projects with mixed forges cannot yet be served.

### Risks

- **Askpass exec-bit loss.** If the `git-askpass.sh` asset loses its exec bit on checkout (e.g., a tar export), the defensive `chmodSync` at startup restores it; a failure there degrades to a git auth error rather than a silent hang (`GIT_TERMINAL_PROMPT=0`).
- **Token in process env of the git child.** The token is in the child environment for the duration of the git call. A process-tree inspector on the magi host could observe it; mitigated by the short-lived child and no logging, but not eliminated.
- **Lenient start refusal asymmetry.** `start_session` does not refuse without a token, so a user expecting a private clone gets a git-layer failure rather than a pre-flight message. This is intentional (public-repo exploration stays valid) but is a UX seam to watch.

## Related Decisions

- ADR-0221: Phase 1 — Agent Credential Vault — the encrypted `coding_session_credentials` vault, `codingSecrets` capability, and per-session request channel this ADR extends.
- ADR-0218: papai-acp plugin — the ACP plugin whose `start_session`/`finish_session`/`review_pr` tools gain the forge-token pre-flight and injection.
- ADR-0185: BYOK LLM Credentials — the per-context credential override pattern that presaged the namespace-generic vault.
- ADR-0168: Attachment Transformer Plugin Hook — the `contributes.attachmentTransformers`/execute-time-config pattern reused for capability-gated plugin extensions.

## Implementation Notes

Key files confirming presence (papai):

- `src/coding-credentials/types.ts:6` — `CODING_NAMESPACES` includes `forge`; `FORGE_FIELDS`/`REQUIRED_FORGE_FIELDS`; registered in `FIELDS_BY_NAMESPACE`/`REQUIRED_BY_NAMESPACE`.
- `src/debug/settings/coding-credentials-routes.ts:21` — `FIELDS_META` registry with the `forge` entry; `parseNamespace` defaulting to `agent-provider` and rejecting unknown namespaces with 400.
- `src/coding-credentials/resolve-agent-secrets.ts:9` — shared `configContextOf`; `:32` — `resolveForgeToken` reading the `forge` vault.
- `src/plugins/runtime-types.ts:47` — `codingSecrets` facade type extended with `resolveForgeToken(): string | null`.
- `src/plugins/tool-runtime.ts:164` — `resolveForgeToken` on the facade, `coding.secrets`-permission-gated.
- `plugins/acp/tools.ts:85` — `start_session` optional `forgeToken` injection; `:147` / `:240` — `finish_session` / `review_pr` pre-flight refusal and `forgeToken` in the request body.
- `client/settings/sections/CodeHostSection.svelte` — the "Code host" section (id `code-host`), single masked `forge_token` field, `patchCodingCredentials({ contextId, namespace: 'forge', values })`.
- `client/settings/SettingsApp.svelte:23` — import + `ADVANCED_IDS` includes `'code-host'`; `:108` sidebar item; `:218` section render.
- `client/settings/fetchers.ts:144` — `namespace` arg (default `agent-provider`); `fetcher-schemas.ts:78` — `namespace` on the PATCH schema.

Cross-repo (magi, referenced): `src/git/assets/git-askpass.sh`, `src/git/git.ts` (`runGit` auth env injection), `src/forge/provider.ts` (`RequestForgeProvider.forProject(project, token)`), `src/workspace/git-workspace.ts` (auth threaded to network ops), and the input/manager/router threading of `forgeToken` on start/finish/review.
