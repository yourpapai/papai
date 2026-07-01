<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Per-Project Additional Egress Domains — Design

**Date:** 2026-07-01
**Status:** Draft (detailed spec; spawns a plan)
**Repos:** papai (this repo) + magi (`/Users/ki/Projects/yourpapai/magi`, companion commit)
**Builds on:** Phase 3 (user repos), Phase 4c (derived egress), Phase 5a (operator guardrails)

## Scope

Let a user add, **per coding project**, a list of extra egress domains that the
sandbox may reach — **unioned into** the per-session egress magi already derives,
never replacing it. Self-serve (set in settings, no admin gate). Bounded by the
existing external geofront org **ceiling**, which is unchanged and remains the
hard cap.

**Explicitly out of scope (deferred):**

- **Base/workspace image override.** Considered together with egress but deferred
  — an arbitrary base image is the real sandbox-escape risk and would require a
  new operator image allowlist. Not in this spec.
- Inline editing of repos (the settings UI stays add + delete; change domains by
  delete + re-add).
- Ceiling awareness / a fail-fast `MAGI_EGRESS_CEILING` env (the Phase-5 idea
  4c deferred). We stay optimistic: accept, send, let geofront clamp.
- Per-user or per-group egress. This is **per-project only**.

## Why this is safe (reversing the Phase-3/5a "operator-only egress" stance)

`2026-06-25-phase-3-user-repos-design.md` and `2026-06-27-phase-5a-operator-guardrails-design.md`
made image + egress **operator-only** as the sandbox boundary. This spec relaxes
that for egress only, and only in the additive direction, because:

- **The geofront org ceiling is untouched and is the hard bound.** geofront
  (external Rust binary) computes `effective = session allowlist ∩ ceiling` and
  rejects any attempt to raise `[egress.policy.ceiling]` from the project/user
  layers (`UntrustedPolicyCeilingLayer`). So a user can only ever _select within_
  the operator's ceiling — never widen it.
- **This is the exact trust posture `providerHost` already has.** Since Phase 4c,
  a user-chosen provider host (incl. a custom base URL) is unioned into egress
  with no magi-side allowlist, relying entirely on the ceiling to bound it. Adding
  a list of extra domains is the same mechanism, same bound.
- **Additive, never a replacement.** A user cannot remove the operator base set,
  the provider host, or the agent-infra host — only append candidates.

The residual risk an extra domain adds is _data-exfiltration surface within the
ceiling_. Operators who need a tighter bound narrow `[egress.policy.ceiling]`.

## Data flow

```
Settings UI (ReposSection.svelte)
  → POST /settings/api/coding-repos  { …, additionalEgressDomains: string[] }
  → store.upsertRepo  → coding_session_repos.additional_egress_domains (JSON text)
                                    │
        start_session / review_pr   ▼
  codingRepos.get(name) → RepoEntry{…, additionalEgressDomains}
  → buildProjectSpec() adds it to projectSpec (only when non-empty)
  → callMagi POST /sessions | /reviews  { projectSpec }
                                    │
   magi validateRepoSpec           ▼   (filter to bare hosts, cap count, drop malformed)
  → deriveEgress(spec, defaults) = defaults.egressAllowlistDomains
                                   ∪ {providerHost}
                                   ∪ agentInfraEgress(agent)
                                   ∪ spec.additionalEgressDomains        ← new union term
  → geofront.toml [egress.policy.allowlist]
  → geofront (Rust) clamps: effective = allowlist ∩ org ceiling   ← unchanged (may silently drop; documented)
```

**Naming:** `additionalEgressDomains` everywhere (papai repo field, magi
`ProjectSpec` field), to signal _additive_ and avoid colliding with magi's
operator-owned `egressAllowlistDomains` on `ProjectDefaults`/`ProvisioningConfig`.

## Validation rules (identical intent both sides)

- **Bare host:** each entry is a hostname with no scheme, path, port, or wildcard
  (reuse magi's `isBareHost`; mirror it in papai's `store.ts`).
- Trimmed + lowercased on save; blank/empty entries dropped; deduped.
- **Count cap:** max **20** domains per project.
- **Per-entry length:** max **253** chars (DNS limit).
- **papai rejects** invalid input at the route (422, clear message) so the user
  gets feedback. **magi filters silently** (drops malformed, caps) as
  defense-in-depth — it is the trust boundary and must not assume papai validated.

## Design — papai

**Data model & storage**

- `src/coding-repos/types.ts` — add `additionalEgressDomains: string[]` to
  `RepoInput` (flows into `RepoRecord`); default `[]`.
- `src/db/coding-repos-schema.ts` — add column `additionalEgressDomains`,
  JSON-encoded `text`, `NOT NULL DEFAULT '[]'`.
- `src/db/migrations/066_coding_repos_egress.ts` (new) —
  `ALTER TABLE coding_session_repos ADD COLUMN additional_egress_domains TEXT NOT NULL DEFAULT '[]'`.
  Register in `src/db/index.ts`; re-export in `src/db/schema.ts`. (Confirm the next
  free migration number at implementation time — `065_coding_identity.ts` is the
  latest observed.)
- `src/coding-repos/store.ts` — `assertValid` gains the egress check (bare host,
  cap, length); `rowToRecord` JSON-parses the column (tolerant: bad JSON → `[]`);
  `upsertRepo` JSON-stringifies.

**HTTP boundary**

- `src/debug/settings/coding-repos-routes.ts` — `PostBodySchema` (`.strict()`)
  gains `additionalEgressDomains: z.array(z.string()).max(20).optional()`; thread
  into the `upsertRepo(...)` call (default `[]` when absent).

**Settings SPA**

- `client/settings/sections/ReposSection.svelte` — add a domains input to the add
  form (newline/comma-separated textarea → `string[]`), helper text: _"Extra
  domains this project's sessions may reach, added to the defaults. A domain may
  still be blocked if your operator's egress policy doesn't include it."_
- `client/settings/repos-fetchers.ts` — add the field to the `addRepo` input type.
- `client/settings/fetcher-schemas-repos.ts` — add it to `RepoRecordSchema`.
- `client/stories/msw/settings-handlers.ts` — update the MSW fixture.

**Repo → projectSpec (acp seam)**

- `RepoEntry` — add `additionalEgressDomains: string[]` in all **three** copies
  (`plugins/acp/tools.ts`, `src/plugins/runtime-types.ts` ×2).
- `src/plugins/tool-runtime.ts` `buildCodingReposFacade` — add the field to the
  `get()` projection. `list()` does not need it.
- `plugins/acp/tools.ts` `buildProjectSpec` — include `additionalEgressDomains` in
  the returned spec **only when non-empty** (spread-guard, as `forge`/`providerHost`/`model`).

## Design — magi (companion commit)

**`src/project/config.ts`**

- `ProjectSpec` — add `additionalEgressDomains?: string[]` (optional; papai omits
  when empty).
- `deriveEgress(spec, defaults)` — add the union term:

  ```ts
  const extra = Array.isArray(spec.additionalEgressDomains) ? spec.additionalEgressDomains.filter(isBareHost) : []
  return [...new Set([...defaults.egressAllowlistDomains, ...provider, ...agentInfraEgress(spec.agent), ...extra])]
  ```

- `validateRepoSpec(body, policy)` — coerce `body.additionalEgressDomains` to a
  string array, filter to `isBareHost`, dedupe, cap at 20. Lenient (drop malformed
  rather than 400 the whole session), matching `providerHost` handling.

**Unchanged in magi (by design):**

- `buildEphemeralProject` — `deriveEgress` already flows through it.
- `resolvePlan` / `geofront-toml.ts` — consume `project.egressAllowlistDomains`,
  which now includes the extras.
- No new operator env, no ceiling awareness. The external geofront `[egress.policy.ceiling]`
  is the unchanged hard bound.

## Testing

**papai**

- `store` — round-trips JSON; `assertValid` rejects a non-bare-host entry; count
  cap enforced; tolerant parse on bad JSON → `[]`.
- `coding-repos-routes` — schema accepts the field; 422 on an invalid domain.
- `buildProjectSpec` — forwards when non-empty; omits when empty.
- `buildCodingReposFacade.get()` — includes the field.
- `ReposSection` story + MSW fixture updated.

**magi**

- `deriveEgress` — unions + dedupes extras; drops malformed; repo host still excluded.
- `validateRepoSpec` — filters to bare hosts, caps count.
- provisioning/plan — emitted geofront.toml allowlist contains the extras.

## Docs

- `docs/architecture/coding-sessions.md` — note the per-project additive egress
  field and the ceiling-clamp caveat.
- Operator note: extras beyond `[egress.policy.ceiling]` are silently clamped;
  widen the ceiling in `org.toml` to admit them.
- `CLAUDE.md` — no change (repo/project fields aren't enumerated there).

## Files touched

**papai:** `src/coding-repos/{types,store}.ts`, `src/db/coding-repos-schema.ts`,
`src/db/migrations/066_coding_repos_egress.ts` (new), `src/db/{index,schema}.ts`,
`src/debug/settings/coding-repos-routes.ts`, `src/plugins/{runtime-types,tool-runtime}.ts`,
`plugins/acp/tools.ts`, `client/settings/sections/ReposSection.svelte`,
`client/settings/{repos-fetchers,fetcher-schemas-repos}.ts`,
`client/stories/msw/settings-handlers.ts`, `docs/architecture/coding-sessions.md`,
tests.

**magi:** `src/project/config.ts`, tests.

## Resolved decisions (confirmed with user)

- **Egress self-serve; image deferred.** Only per-project egress; image override
  is out of scope.
- **Additive union**, never a replacement.
- **Document-only ceiling handling** — accept optimistically, no new magi env, no
  ceiling awareness; UI + docs warn that a domain may still be clamped.
- **No inline repo editing** — keep the existing add + delete UI.
