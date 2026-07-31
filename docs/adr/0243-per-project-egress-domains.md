<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0243: Per-Project Additional Egress Domains

## Status

Implemented (with divergence)

## Date

2026-07-01

## Context

Since Phase 4c (ADR-0232), magi derives the per-session sandbox egress from the `projectSpec` (operator base ∪ `providerHost` ∪ agent-infra) and the external geofront org `[egress.policy.ceiling]` clamps it. A user could influence egress only indirectly — via a self-chosen provider host. Phase 3 (ADR-0227) introduced user-defined repositories, and Phase 5a (ADR-0234) made image + egress **operator-only** as the sandbox boundary.

The design (`docs/superpowers/specs/2026-07-01-per-project-egress-domains-design.md`) and plan (`docs/superpowers/plans/2026-07-01-per-project-egress-domains.md`) relax that stance for **egress only, and only additively**: let a user add, **per coding project**, a list of extra bare-host domains the sandbox may reach — **unioned into** the derived egress, never replacing it, and still bounded by the unchanged operator ceiling. The justification is that this is the exact trust posture `providerHost` already has: a user can only ever _select within_ the operator's ceiling, never widen it. Image override is explicitly deferred (an arbitrary base image is the real sandbox-escape risk).

The field rides the existing papai→magi seam that `providerHost`/`model` already use: papai persists it per repo (`coding_session_repos`), validates it at the store + HTTP boundary, forwards it inside `projectSpec`, and magi unions it into `deriveEgress`. papai **rejects** invalid input (422); magi **filters silently** (drops malformed, caps) as defense-in-depth.

## Decision Drivers

- **Additive union, never a replacement.** A user can only append candidate hosts to the derived set — never remove the operator base, the provider host, or the agent-infra host.
- **The geofront org ceiling is the unchanged hard bound.** geofront computes `effective = allowlist ∩ ceiling` and rejects ceiling raises from untrusted layers; an extra domain outside the ceiling is silently clamped. No new magi env or ceiling awareness — stay optimistic (accept, send, let geofront clamp).
- **Self-serve, per-project only.** Set in settings → Repositories, no admin gate; no per-user/per-group egress.
- **Reuse the `providerHost`/`model` seam.** The field forwards inside `projectSpec` exactly like those fields, conditional on non-empty.
- **papai rejects (422) for user feedback; magi filters silently as the trust boundary.** Identical validation intent both sides (bare host, trim/lowercase/dedupe, count cap 20, length ≤ 253).
- **No inline repo editing.** Keep the existing add + delete UI; change domains by delete + re-add.

## Considered Options

### Option 1 — Per-project additive `additionalEgressDomains` on `coding_session_repos`, forwarded in `projectSpec` (chosen)

A new `additionalEgressDomains: string[]` column (JSON text) on the repo row; validated in the store + route; threaded through the `codingRepos.get()` facade into `buildProjectSpec`; magi `deriveEgress` unions it. Naming `additionalEgressDomains` (not `egressAllowlistDomains`) signals _additive_ and avoids colliding with magi's operator-owned `ProjectDefaults` field.

- **Pros:** reuses the existing provider-host/model seam; additive-only preserves the trust model; the ceiling keeps the hard bound; one migration + a thin field threaded through well-trodden layers.
- **Cons:** a user-visible data-exfiltration surface within the ceiling; operator must widen the ceiling to admit a domain (documented, not enforced here); requires changes across DB, store, route, facade, acp seam, client schema/fetcher/UI.

### Option 2 — Per-user / per-group egress rather than per-project

Attach extra egress to the user or the authorized group instead of the repo row.

- **Pros:** one configuration point per actor.
- **Cons:** rejected — egress is a property of _what the session builds_, i.e. the project/repo, not the identity; magi's `projectSpec`/`deriveEgress` is project-scoped, so per-actor egress would not fit the seam and would widen blast radius across all of a user's projects.

### Option 3 — Keep egress strictly operator-only (do nothing)

Leave Phase 5a's operator-only stance unchanged for egress too.

- **Pros:** smallest change; no new user-facing surface.
- **Cons:** rejects the requirement — users running language-specific toolchains (e.g. a Python project needing `pypi.org`/`files.pythonhosted.org`) cannot reach their package hosts without operator intervention per project; the ceiling already makes additive egress safe to grant.

## Decision

Option 1 shipped in full across the DB, store, HTTP route, plugin facade, acp project-spec seam, and the settings SPA. What shipped:

1. **Migration 066 + schema.** `066_coding_repos_egress.ts` adds `coding_session_repos.additional_egress_domains TEXT NOT NULL DEFAULT '[]'`; the Drizzle column is in `coding-repos-schema.ts` and re-exported from `db/schema.ts`.
2. **Store (`src/coding-repos/store.ts`).** `assertValid` enforces bare-host (`isBareHost`), count cap 20, length ≤ 253; `normalizeEgress` trims/lowercases/dedupes; `parseEgress` JSON-parses the column tolerantly (bad JSON → `[]`); `upsertRepo` normalizes first, validates, and persists JSON in both insert + on-conflict set.
3. **HTTP route (`src/debug/settings/coding-repos-routes.ts`).** `PostBodySchema` (`.strict()`) gains `additionalEgressDomains: z.array(z.string()).max(20).optional()`; threaded into `upsertRepo` (default `[]`); store throws → 422.
4. **Plugin facade.** `codingRepos.get()` surfaces `additionalEgressDomains` via a shared `CodingRepoEntry` type.
5. **ACP seam (`plugins/acp/tools.ts`).** `RepoEntry` carries the field; `buildProjectSpec` includes it **only when non-empty** (spread-guard, like `forge`/`providerHost`/`model`); `buildSessionProjectSpec` forwards it automatically.
6. **Settings SPA.** `ReposSection.svelte` adds a newline/comma-separated textarea (`repos-add-egress`) with helper text + per-row egress meta; the fetcher input type and `RepoRecordSchema` (`.default([])`) carry the field; the MSW fixture is updated.
7. **Docs.** `docs/architecture/coding-sessions.md` records the additive field and the ceiling-clamp caveat.

## Consequences

### Positive

- A user can self-serve the extra hosts a project's sandboxed sessions need (e.g. language package registries) without operator intervention, as long as the operator ceiling admits them.
- Additive-only guarantees the operator base set, provider host, and agent-infra host can never be removed — only appended to.
- The unchanged geofront org ceiling remains the hard bound, so a user can only ever select within it; the trust posture is identical to the existing `providerHost` mechanism.
- papai gives immediate 422 feedback on malformed input; magi re-filters as defense-in-depth at the trust boundary.

### Negative

- The field is a user-facing data-exfiltration surface _within_ the ceiling; operators wanting a tighter bound must narrow `[egress.policy.ceiling]`.
- A domain outside the ceiling is silently dropped (documented, not surfaced to the user at add time) — the user can add it, but it silently won't be reachable.
- No inline repo editing: changing domains requires delete + re-add.

### Risks

- **Silent ceiling clamp is operator-dependent.** Whether a given added domain is actually reachable depends entirely on the operator's `org.toml` ceiling, which papai has no visibility into; a user may be surprised a domain they added is unreachable.
- **magi-side filtering is the real gate.** papai's 422 is advisory; magi's `validateRepoSpec`/`deriveEgress` (separate repo, companion commit) must re-validate as the trust boundary — papai must not be assumed to have validated.
- **Bare-host only, no wildcards.** A user cannot grant a subdomain wildcard; each concrete host must be listed (cap 20).

## Related Decisions

- **ADR-0232: Phase 4c — Derived Egress** — established the `deriveEgress` union (operator base ∪ `providerHost` ∪ agent-infra) and the `providerHost` trust posture this feature mirrors exactly for the additive extras.
- **ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec** — introduced `coding_session_repos` and the `projectSpec`/`buildProjectSpec` seam this field rides.
- **ADR-0234: Phase 5a — Operator Guardrails** — set the operator-only image + egress stance this spec relaxes (egress only, additive only).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/db/migrations/066_coding_repos_egress.ts:14` | `ALTER TABLE coding_session_repos ADD COLUMN additional_egress_domains TEXT NOT NULL DEFAULT '[]'`. | `read` confirms. |
| `src/db/index.ts:79,185` | Migration 066 imported + registered in the migrations array. | `grep` confirms. |
| `src/db/coding-repos-schema.ts:17` | `additionalEgressDomains` Drizzle column (`text('additional_egress_domains').notNull().default('[]')`). | `read` confirms. |
| `src/db/schema.ts:56` | `codingSessionRepos` re-exported from the barrel. | `grep` confirms. |
| `src/coding-repos/types.ts:9-19` | `RepoInput.additionalEgressDomains?: string[]` + `RepoRecord` (omits+re-adds the field as required `string[]`). | `read` confirms. |
| `src/coding-repos/store.ts:21-50` | `EGRESS_MAX`/`EGRESS_HOST_MAXLEN`, `isBareHost`, `normalizeEgress`, `parseEgress`, `assertValid` (cap 20, len ≤ 253). | `read` confirms. |
| `src/coding-repos/store.ts:89-125` | `upsertRepo` normalizes, validates, JSON-stringifies into insert + `onConflictDoUpdate.set`. | `read` confirms. |
| `src/debug/settings/coding-repos-routes.ts:19-28,48` | `PostBodySchema` gains `additionalEgressDomains: z.array(z.string()).max(20).optional()`; threaded with `?? []`; store throw → 422. | `read` confirms. |
| `src/plugins/runtime-types.ts:33-39,78-81` | Shared `CodingRepoEntry` type (+ the field) and the `codingRepos.get(name): CodingRepoEntry \| null` facade signature. | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:57-68` | `buildCodingReposFacade.get()` projects `additionalEgressDomains`. | `read` confirms. |
| `plugins/acp/tools.ts:43-53,75-81,111-131` | Inline facade type + `RepoEntry` carry the field; `buildProjectSpec` includes it only when non-empty. | `read` confirms. |
| `client/settings/fetcher-schemas-repos.ts:16` | `RepoRecordSchema.additionalEgressDomains: z.array(z.string()).default([])`. | `read` confirms. |
| `client/settings/repos-fetchers.ts:19-26` | `addRepo` input type carries `additionalEgressDomains?: string[]`. | `read` confirms. |
| `client/settings/sections/ReposSection.svelte:33-42,63-75,125-127,176-186` | `addEgress` state, `parseEgress` (newline/comma), threaded in `handleAdd`, per-row meta line, textarea + helper text + reset. | `read` confirms. |
| `client/stories/msw/settings-handlers.ts:29` | MSW fixture: first sample repo carries `additionalEgressDomains: ['pypi.org']`. | `read` confirms. |
| `docs/architecture/coding-sessions.md:22-28` | Doc note: additive field, ceiling-clamp caveat. | `read` confirms. |
| `docs/architecture/coding-stack-overview.md:463-466,173` | magi-side union documented: per-session allowlist = defaults ∪ provider ∪ agent-infra ∪ `additionalEgressDomains`; `projectSpec` example shows the field. | `grep` confirms. |

Plan-vs-implementation notes:

- **The field is optional (`?`) on `RepoInput`/`RepoEntry`/`CodingRepoEntry`/the acp inline facade type/`addRepo`, not required as the plan specified.** The plan made `RepoInput.additionalEgressDomains: string[]` required and updated every existing `upsertRepo`/`RepoEntry` fixture to add the field. The shipped tree instead makes it optional (`?: string[]`) and normalizes with `?? []` in the store (`store.ts:44,90`), facade, and `buildProjectSpec` (`tools.ts:122`). `RepoRecord` re-declares it as a required `string[]` via `Omit`+re-add (`types.ts:17-19`). Intent (round-trip, normalization, validation) is fully preserved; the optionality is a backward-compat accommodation so pre-existing repo fixtures/callers without the field still typecheck.
- **The facade was extracted to its own module.** The plan extended `buildCodingReposFacade` in `src/plugins/tool-runtime.ts`; the shipped tree moved `buildCodingReposFacade` (and `buildCodingSecretsFacade`) into a dedicated `src/plugins/coding-secrets-facade.ts` module (`:46-71`). A refactor that landed alongside this feature, not a behavior change.
- **A shared `CodingRepoEntry` type replaced the plan's three duplicated inline copies.** The plan duplicated the `codingRepos.get()` return type inline in `runtime-types.ts`, `tool-runtime.ts`, and `plugins/acp/tools.ts`. The shipped tree factors one `CodingRepoEntry` type in `runtime-types.ts:33-39` and the facade references it; `plugins/acp/tools.ts` keeps its own local `RepoEntry` (`:75-81`) and inline facade type (`:43-53`).
- **The doc note's wording differs slightly from the plan's prose** (e.g. "an added domain" vs "a domain", and the ceiling drop is phrased as a hard statement rather than "silently clamped — documented") but conveys the same additive + ceiling-clamp meaning (`coding-sessions.md:22-28`).
- **magi-side Tasks 8–9 live in a separate repo** (`/Users/ki/Projects/yourpapai/magi`) as a companion commit and could not be verified from this worktree. The papai docs (`coding-stack-overview.md:463-466`) document the magi `deriveEgress` union including `additionalEgressDomains`, consistent with the plan; the papai→magi wire (`buildProjectSpec`/`buildSessionProjectSpec`) forwards the field as designed.

The source plan `docs/superpowers/plans/2026-07-01-per-project-egress-domains.md` and design `docs/superpowers/specs/2026-07-01-per-project-egress-domains-design.md` are archived alongside this ADR to `docs/archive/`.
