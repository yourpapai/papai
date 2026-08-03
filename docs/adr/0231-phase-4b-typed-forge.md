<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0231: Phase 4b — Typed Forge Connections + Self-Hosted GitLab

## Status

Implemented (with divergence)

## Date

2026-06-26

## Context

Phase 2 (ADR-0222) closed the per-user forge-identity gap: the user's code-host token rides each request, git transport receives it through a `GIT_ASKPASS` env helper, and no forge secret lives at rest on the magi host. But the `forge` vault stored **only** `forge_token`, so every connection was implicitly GitHub SaaS — magi's `forge.kind`/`apiBaseUrl` were operator defaults (`MAGI_PROJECT_DEFAULTS.forge`), and there was **no way** to connect a GitHub Enterprise host, a self-hosted GitLab, or even to tell papai "this token is a GitLab token." A user on `gitlab.corp.com` could not push/MR against their own host through papai.

Phase 4a (ADR-0230) shipped the agent/provider picker and — as a deliberate by-product — introduced the generic `control: 'select' + options` field metadata that this phase reuses for the forge-kind picker. The parent decomposition (`docs/superpowers/specs/2026-06-26-phase-4-decomposition-design.md`) split Phase 4 into sub-phases; **4b's scope** (this ADR) is: add a typed forge connection (`kind` ∈ GitHub / GitHub Enterprise / GitLab SaaS / GitLab self-hosted + optional `instance_url`) to the vault, derive the magi `apiBaseUrl` per kind (papai-owned), carry the resolved forge in the `projectSpec`, and tighten magi's SSRF gate so the forge API host is bounded by the operator allowlist — except the two fixed well-known SaaS API hosts. **Deliberately deferred** to 4c: derived **sandbox** egress (so an agent that runs `git` itself can reach the forge host) — 4b covers only the **host-side** forge surface on magi. Multiple simultaneous forge connections per context are also out of scope (one per config-context).

The design premise was that the `forge` vault is an encrypted JSON blob, so adding `kind`/`instance_url` needs **no DB migration** — only a field-registry extension, a papai-owned `kind → apiBaseUrl` derivation, and a stricter host check in magi's `validateRepoSpec`. magi's `GitLabForge` already accepted a self-hosted `apiBaseUrl` and the Phase-2 askpass git transport already worked against any HTTPS host, so there is **no forge-layer or git-transport change** in 4b.

## Decision Drivers

- **Self-hosted GitLab / GHE support** — the headline goal; requires the connection to declare its kind and, for enterprise/self-hosted, an instance URL.
- **papai owns `kind → apiBaseUrl`; magi's API host is never an arbitrary user string for SaaS** — the two fixed well-known SaaS API hosts (`api.github.com`, `gitlab.com`) are trusted; every other host must be operator-allowlisted.
- **The operator allowlist is the SSRF gate — no auto-allow of user instance hosts** — a user-supplied instance URL is a user-supplied host that magi will clone/push/API against; auto-allowing it would let a user point magi at any internal host. Self-hosted works only when the operator adds the company host to the repo-host allowlist.
- **One forge connection per config-context (back-compat)** — extend the existing `forge` vault in place; a legacy token-only vault (no `kind`) continues to mean GitHub SaaS, so Phase-2 connections keep working.
- **`deriveForgeRepo` unchanged** — its Phase-3 implementation already strips host/`.git` and returns the full path, which is correct for GitLab group/subgroup paths.
- **TDD, two repos, explicit `git add` paths** — the plan knits into the write-hook pipeline and the cross-repo (papai + magi) coordination discipline.

## Considered Options

### Option 1: Typed fields in the `forge` vault + papai-owned `kind → apiBaseUrl` + SSRF host gate on the forge API host (chosen)

Add `kind`/`instance_url` to the JSON vault (no migration), a papai-owned `deriveApiBaseUrl(kind, instanceUrl)` + `forgeMagiKind(kind)`, a `resolveForge` facade method, a select-field + conditional instance-URL in the route and settings section, and a magi `validateRepoSpec` host check that admits `allowlist ∪ {api.github.com, gitlab.com}`.

- **Pros:** no DB migration; reuses the vault/facade/route plumbing from Phases 2 + 4a; the SSRF gate is a natural extension of Phase-3's existing `repoUrl` host check; magi's forge layer needs no change (already self-host-capable); legacy token-only vaults keep working via the GitHub-SaaS default.
- **Cons:** touches two repos (papai + magi) in one coordinated change; the forge API host and the repo host are checked separately, so a misconfigured cross-host spec (repo on host A, forge API on host B) is not structurally prevented (only both-must-be-allowed); the operator must add each self-hosted host to the allowlist (more setup).

### Option 2: Auto-allow the connection's host bounded by an operator wildcard ceiling (e.g. `*.corp.com`)

Let the operator express a wildcard and auto-admit any user instance URL matching it, instead of requiring each host listed.

- **Pros:** less operator setup per host; smoother self-serve UX.
- **Cons:** a wildcard is a broader SSRF surface than an explicit host entry; deferred (the spec's headline open question) to the 4c spec + Phase-5 guardrails to revisit the ceiling shape. 4b ships the safe explicit-allowlist model.

### Option 3: Defer self-hosted entirely; ship only the typed-kind picker for the two SaaS forges

Add `kind` so a user can declare "this is a GitLab token," but drop `instance_url` and the enterprise/self-hosted kinds until a later phase.

- **Pros:** smaller diff; no instance-URL validation or SSRF ceiling question.
- **Cons:** leaves the headline goal (self-hosted GitLab / GHE) unmet; 4b would not be independently useful for the enterprise users it targets.

## Decision

The chosen Option 1 shipped across both repos. What shipped:

### Part A — papai

1. **A1 — typed vault fields + `kind → apiBaseUrl` + route validation.** `FORGE_FIELDS` becomes `['kind', 'instance_url', 'forge_token']` with `REQUIRED_FORGE_FIELDS = ['kind', 'forge_token']`. `FORGE_KINDS = ['github','github-enterprise','gitlab','gitlab-self-hosted']`, plus `isForgeKind`, `needsInstanceUrl`, `forgeMagiKind` (→ `'github'|'gitlab'`), and `deriveApiBaseUrl(kind, instanceUrl)` (SaaS → fixed well-known host; enterprise/self-hosted → `<instanceUrl>/api/v3` or `/api/v4`). The route's `forge` field metadata gains a `kind` **select** (options `FORGE_KINDS`) and an `instance_url` text field; a PATCH validates the merged vault: `kind ∈ FORGE_KINDS` (→ 422) and, when `needsInstanceUrl(kind)`, `instance_url` must be present + `https://` (→ 422).
2. **A2 — `resolveForge` facade + acp carries `projectSpec.forge`.** `resolveForge(storageContextId, chatUserId)` reads the `forge` vault and returns `{ kind: 'github'|'gitlab'; apiBaseUrl }`, defaulting a legacy token-only vault to GitHub SaaS (and refusing a partial vault that has `instance_url` but no `kind`). It is surfaced on the permission-gated `codingSecrets` facade. The acp plugin's `buildSessionProjectSpec` includes `forge: codingSecrets.resolveForge()` in the `projectSpec` (omitted when null); `forgeToken` is still sent separately (Phase 2).
3. **A3 — Code host section: kind select + conditional instance URL.** `CodeHostSection.svelte` renders the `kind` `<select>` (4 options) from the route's `control`/`options` metadata, computes `showInstanceUrl = needsInstanceUrl(currentKind)` client-side, and renders the `instance_url` field **only** for enterprise/self-hosted kinds; the token renders masked as before.

### Part B — magi (separate repo)

4. **B1 — `projectSpec.forge` + SSRF host validation.** `ProjectSpec` gains `forge?: { kind: ForgeKind; apiBaseUrl: string }`; `validateRepoSpec` parses `o['forge']` (falling back to deriving a SaaS forge from the `repoUrl` host), and a new `assertForgeApiHostAllowed` rejects (→ 400) any `apiBaseUrl` whose host is not in `policy.allowedHosts ∪ SAAS_API_HOSTS` (`['api.github.com','gitlab.com']`) or not `https:`. `buildEphemeralProject` uses the resolved forge for `forge.kind`/`apiBaseUrl` and `deriveForgeRepo(repoUrl, kind)` for `forge.repo`.

## Consequences

### Positive

- A user can connect GitHub / GitHub Enterprise / GitLab SaaS / GitLab self-hosted with an instance URL, and clone/push/MR work against their own host — the headline gap from Phase 2 is closed.
- papai owns the `kind → apiBaseUrl` table as a single source of truth; magi's API host is always either a fixed well-known SaaS host or the validated instance host, never an arbitrary user string for SaaS.
- The SSRF gate is symmetric: every host magi touches (git clone/push = repoUrl host; forge API = apiBaseUrl host) is bounded by the operator allowlist except the two fixed SaaS API hosts — a user cannot make magi reach an un-allowlisted host.
- Legacy token-only vaults keep working (GitHub-SaaS default), so Phase-2 connections are not broken by the migration.
- The generic `control: 'select' + options` field metadata introduced in 4a was reused here for the forge-kind picker, validating the 4a open question.
- magi derives a SaaS forge from the `repoUrl` host when `projectSpec.forge` is absent, so a SaaS repo still works without an explicit connection — back-compat for repos that predate typed forge.

### Negative

- **Cross-repo contract.** papai sends `projectSpec.forge = { kind, apiBaseUrl }` and magi parses/validates it; a shape drift (e.g. a kind magi doesn't recognize, or a renamed `apiBaseUrl`) breaks session start at the magi intake. The contract is small but must be tracked alongside Phase-1/2's.
- **The operator must allowlist each self-hosted host** — more setup than an auto-allow; a connection to a non-allowlisted host is rejected at session start (now with a pre-flight message, see Implementation Notes).
- **`forge.kind`/`instance_url`/`apiBaseUrl` are non-secret config but live in the encrypted vault** alongside the token — they are masked only by virtue of the vault's encryption, not a separate non-sensitive store.

### Risks

- **Cross-host misconfiguration is not structurally prevented.** The repo host and the forge API host are each checked against the allowlist independently; a spec with the repo on host A and the forge API on host B (both allowed) passes validation but would fail at the forge layer. The spec flagged this as optional to assert; it is not asserted.
- **Sandbox egress unchanged (4b boundary).** The agent's egress allowlist is not updated here — if the agent itself runs `git` (rather than magi's host-side transport), it cannot reach the forge host until 4c derives egress. 4b covers only the host-side forge surface.
- **Partial-vault refusal.** `resolveForge` returns `null` for a vault carrying `instance_url` but no `kind`, which surfaces to the user as "not configured" — correct but potentially confusing if the user partially saved.

## Related Decisions

- **ADR-0222: Phase 2 — Per-User Forge Identity** — the `forge` vault, `resolveForgeToken`, and the askpass git transport this phase extends with `kind`/`instance_url`/`resolveForge`.
- **ADR-0230: Phase 4a — Multi-Provider + Agent Picker** — the immediate predecessor; introduced the `control: 'select' + options` field metadata reused here, and the `projectSpec` this phase adds `forge` onto.
- **ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec** — the inline `projectSpec` and the operator repo-host allowlist (`MAGI_ALLOWED_REPO_HOSTS`) that 4b's forge-API host gate extends.
- **ADR-0221: Phase 1 — Agent-Credential Vault and Per-Session Secret Channel** — the namespace-generic encrypted vault this phase extends with a second typed field set.
- **ADR-0129: Multi-Provider Router (Unified Design)** — the descriptor-driven/vault hygiene precedent the vault extension follows.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`; the papai A1+A2 work landed in a single bundled commit (the plan expected two), and the magi B1 commit message matches the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `src/coding-credentials/types.ts:48-50` | `FORGE_FIELDS = ['kind','instance_url','forge_token']`, `REQUIRED_FORGE_FIELDS = ['kind','forge_token']`. | `read` confirms. |
| `src/coding-credentials/types.ts:56-79` | `FORGE_KINDS`, `isForgeKind`, `needsInstanceUrl`, `forgeMagiKind`, `deriveApiBaseUrl` (SaaS → fixed host; enterprise/self-hosted → `/api/v3`/`/api/v4`). | `read` confirms. |
| `src/debug/settings/coding-credentials-fields-meta.ts:63-84` | `forge` field metadata: `kind` select (`options: FORGE_KINDS`), `instance_url` text, masked `forge_token`. | `read` confirms. |
| `src/debug/settings/coding-credentials-routes.ts:105-122` | `checkForgeKind` → 422 on unknown kind; `instance_url` required + `https://` for enterprise/self-hosted. | `read` confirms. |
| `src/coding-credentials/resolve-agent-secrets.ts:142-162` | `resolveForge` returns `{kind,apiBaseUrl}`; legacy token-only → GitHub SaaS; partial vault (`instance_url` without `kind`) → `null`. | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:38`, `src/plugins/runtime-types.ts:60` | `resolveForge` on the permission-gated `codingSecrets` facade + its type. | `grep` confirms. |
| `plugins/acp/tools.ts:142-159` | `buildSessionProjectSpec` includes `forge: codingSecrets.resolveForge()` in the `projectSpec` (omitted when null). | `read` confirms. |
| `plugins/acp/tools.ts:102-108`, `plugins/acp/session-tools.ts:49-54` | `canDeriveForge(repoUrl)` (SaaS hosts only); `start_session` pre-flight refuses a self-hosted repo with no configured forge. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:23-25,48-51,102-105` | Client-side `needsInstanceUrl` mirror; `showInstanceUrl` derived; `shouldShowField` hides `instance_url` for SaaS. | `read` confirms. |
| `tests/coding-credentials/types.test.ts:75-120` | `FORGE_KINDS`, `deriveApiBaseUrl` per kind, `forgeMagiKind`. | `grep` confirms. |
| `tests/coding-credentials/resolve-agent-secrets.test.ts:150-185` | `resolveForge` per connection; legacy → github SaaS; partial vault → null. | `grep` confirms. |
| magi `src/project/config.ts:101,186,192-213,225-237` | `ProjectSpec.forge`; `SAAS_API_HOSTS`; `parseForge`; `deriveForgeFromRepo`; `buildEphemeralProject` uses resolved forge + `deriveForgeRepo`. | `read` confirms. |
| magi `src/project/spec-validation.ts:168-181,189-197,200-233` | `assertForgeApiHostAllowed` (https + `allowedHosts ∪ SAAS_API_HOSTS`); `resolveForge` parses `o['forge']`/derives from repoUrl; `validateRepoSpec` admits forge. | `read` confirms. |
| magi `tests/server/router.test.ts:216-230` | `POST /sessions` with a non-allowlisted forge `apiBaseUrl` returns 400. | `grep` confirms. |
| papai commit `99c8cdac5` | `feat(acp): resolveForge + deriveApiBaseUrl; carry projectSpec.forge; fix forge complete-state test` — A1 (types) + A2 (facade + acp) bundled into one commit (plan expected two). | `git show` confirms. |
| magi commit `54ecc32` | `feat(project): per-session typed forge from projectSpec + SSRF host validation` — B1 commit message matches the plan verbatim. | `git log -S` confirms. |

Plan-vs-implementation notes:

- **A1 + A2 were bundled into a single papai commit.** The plan's knip ordering (A1 self-consuming; A2 bundles `resolveForge`/`forgeMagiKind` with the acp consumer) foreshadowed this: with no standalone consumer for `deriveApiBaseUrl` until the acp plugin carries `projectSpec.forge`, the two tasks collapsed into one commit (`99c8cdac5`) rather than the plan's two. The route validation (`coding-credentials-routes.ts`/`coding-credentials-fields-meta.ts`) and the client section landed in adjacent commits.
- **All resolver signatures gained a `chatUserId` parameter.** The plan's `resolveForge(storageContextId)` is now `resolveForge(storageContextId, chatUserId)`, resolving through `identityContext` for per-identity (group coding-identity) resolution — a 5b change layered on top of 4b. `resolveForge` itself is present and functional.
- **`buildProjectSpec` was split into a base + `buildSessionProjectSpec`.** The plan added `forge` inside `buildProjectSpec`. The current code keeps `buildProjectSpec(repo, agent)` as the base and a richer `buildSessionProjectSpec(repo, agent, codingSecrets, mcpServers)` that also bundles `providerHost`/`model`/`mcp` (4c/4d additions) — the 4b `forge` carry is unchanged in intent.
- **The client section moved to whole-record save.** The plan called for per-field PATCH on the kind select (with optional `instance_url` blanking). The shipped `CodeHostSection.svelte` persists `kind`+`instance_url`+`forge_token` together in one PATCH (`collectValues`/`saveAll`), because saving the kind select alone (before `instance_url`) hits the route's cross-field 422 and silently dropped the field — leaving `kind` empty and mis-deriving GitHub SaaS. This is a deliberate fix for a race the plan did not anticipate.
- **acp added a `canDeriveForge` pre-flight.** The plan relied on magi's 400 at intake for a self-hosted repo without a connection. The shipped `start_session` refuses earlier (papai-side) with a "set your Code host" message when `resolveForge() === null` and the repo is not on a SaaS host — a stricter, earlier UX than the plan.
- **magi extracted validation into its own file and made `forge` effectively required.** The plan referenced `src/project/config.ts` for `validateRepoSpec`. magi now has a dedicated `src/project/spec-validation.ts` with `assertForgeApiHostAllowed` (extracted later for reuse by the MR-description stats writer) and `resolveForge(o, repoUrl, policy)` that derives a SaaS forge from the `repoUrl` when `projectSpec.forge` is absent — so a self-hosted repo without an explicit forge is rejected (not silently defaulted), which is stricter than the plan's "fall back to `defaults.forge`".
- **`FORGE_KINDS`/`FORGE_FIELDS` later gained an `mcp` namespace sibling** — unrelated to 4b; the vault now also carries an `mcp` namespace (`CODING_NAMESPACES = ['agent-provider','forge','mcp']`), a later addition.
- **Sandbox egress is still 4c.** As planned, 4b does not touch the agent's egress allowlist; the geofront/sandbox surface is unchanged here.

The source plan `docs/superpowers/plans/2026-06-26-phase-4b-typed-forge.md` and design `docs/superpowers/specs/2026-06-26-phase-4b-typed-forge-design.md` are archived alongside this ADR to `docs/archive/`.
