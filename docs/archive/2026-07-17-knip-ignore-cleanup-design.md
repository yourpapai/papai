<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Knip ignore-list cleanup — design

Date: 2026-07-17
Status: approved (design), pending implementation plan

## Problem

`knip.jsonc` carries ~80 `ignoreIssues` entries, 4 `ignoreDependencies`, and 3 `ignore` globs.
A large ignore list defeats the purpose of running knip in `--strict` mode: dead code and
unused exports can hide behind stale or overly broad entries. Goal: reduce the ignore list
to the minimum that genuine tooling limitations require — ideally empty, in practice a small
justified remainder.

## Categorization of current entries

1. **Test-only seams (~24 entries)** — `resetXForTesting` / `ForTest`-style exports consumed
   only by tests. Flagged because `project` is deliberately production-only, so test consumers
   are invisible to knip. Includes 4 `tests/scripts/behavior-audit-*` helper files knip can't
   trace test-to-test.
2. **Svelte-consumed client exports (~35 entries)** — knip can't parse `.svelte`, so legit
   consumers in components are invisible.
3. **Plugin dynamic loading (~15 entries)** — plugin entry points, `validate-config`
   resolvers, and `import.meta.require` bridges loaded dynamically by the plugin loader.
4. **Forward-compat / not-yet-wired (~8 entries)** — code written ahead of its consumer
   (mattermost action signing/callbacks, `PROVIDER_TYPE_BASE_URLS`/`LlmRole`,
   `fetcher-schemas-llm-providers.ts`, `byok-provider-fetchers.ts`, `getTaskProviderProvision`),
   plus two unaudited entries (`src/cache.ts`, `src/types/config.ts`).
5. **Config-level** — `ignoreDependencies`: `@stryker-mutator/typescript-checker`, `svelte`,
   `msw`, `@crvy/strybk`. `ignore` globs: `src/db/migrations/**`, `client/stories/**`,
   `tests/visual/**` (legitimately non-analyzable; stay).

## Accepted approach: phased category-by-category cleanup

Alternatives considered and rejected: mechanically generating the ignore list from
annotations (manages the symptom, doesn't shrink it); big-bang single PR (knip output after
each phase is the verification signal — batching destroys bisectability).

### Architecture / verification loop

- Each phase ends with `bun run knip` at zero errors.
- Source-touching phases also run `bun run typecheck && bun run test` (+ `bun run test:client`
  for client changes).
- One commit per phase so regressions bisect cleanly and any phase can be reverted
  independently.
- Phase order is deliberate: phase 1 needs no source changes and removes the most entries,
  de-risking the rest.

### Phase 1 — Svelte tracing (~35 entries, no source changes)

- Add `client/**/*.svelte` to `project` (knip auto-enables its svelte compiler support since
  `svelte@5` is installed).
- Remove `svelte` from `ignoreDependencies`.
- Re-run knip; delete every `client/*` ignore entry that no longer reports — verified
  entry-by-entry against actual output, not assumed.
- Fallback if knip-bun mishandles svelte: keep the affected entries with a limitation note,
  move on.

### Phase 2 — Test seams (~24 entries)

- For each `*ForTesting`/`ForTest` seam, create a co-located `<module>.testing.ts` that
  imports internals and re-exports the seam; tests import from the `.testing.ts` module.
- Production modules drop the seam exports entirely, preserving production-only analysis
  purity.
- Add `src/**/*.testing.ts!` to `entry`.
- The 4 `tests/scripts/behavior-audit-*` helper files become `entry` declarations instead
  of ignores.
- Delete `applyVisibility` from `src/debug/state-collector.ts` (already noted as unused in
  the existing ignore comment).

### Phase 3 — Forward-compat: wire it or delete it (~8 entries)

Per item, exactly one outcome — nothing stays ignored "for a future task" (git history is
the parking lot):

- **Wire now** if the consumer is close: mattermost `action-signing.ts` /
  `action-callbacks.ts` → register the callback route in the web server.
- **Delete** and let the owning task reintroduce: `PROVIDER_TYPE_BASE_URLS` + `LlmRole`
  (`src/llm-providers/types.ts`), `client/settings/fetcher-schemas-llm-providers.ts`,
  `client/settings/byok-provider-fetchers.ts`, `getTaskProviderProvision`
  (`src/providers/registry.ts`).
- **Audit and trim** the unexplained entries: `src/cache.ts`, `src/types/config.ts`.

### Phase 4 — Plugins + stragglers (~15 entries → justified remainder)

Try in order:

1. Drop ignores already covered by the `plugins/*/index.ts!` entry (test empirically —
   `includeEntryExports: true` may still flag default exports).
2. Restructure `validate-config` resolution and the `import.meta.require` bridges so knip
   can trace them statically (e.g. explicit side-effect import in the plugin index), where
   this doesn't compromise the discovery scanner's static-entry-graph constraint.
3. Whatever survives stays as the justified remainder, one comment each naming the dynamic
   mechanism.

- `strybk.config.ts` is already an entry — its ignore likely just deletes.
- Re-test all 4 `ignoreDependencies` after phase 1 (`msw` may resolve once stories config
  is settled; `@stryker-mutator/typescript-checker` and `@crvy/strybk` are runtime-loaded
  and may need to stay).

## End state & guardrail

- Target: `ignoreIssues` ≤ ~15 entries (plugin dynamic loading only), `ignoreDependencies`
  ≤ 2, `ignore` globs unchanged.
- Add a header comment to `knip.jsonc`: new ignores require an inline justification comment
  and a linked task; prefer code fixes over ignores.

## Error handling

- Per-phase commits + knip-output-diff verification: any phase reverts independently.
- If a phase-3 deletion turns out wrong, the owning task restores the code from git.
- knip-bun svelte/compiler quirks: fall back to keeping the specific entries with a noted
  limitation rather than forcing source churn for the tool's sake.

## Testing

- `bun run knip` — zero errors after every phase (primary acceptance signal).
- `bun run typecheck`, `bun run test` — after source-touching phases (2, 3, 4).
- `bun run test:client` — after client-affecting changes (phase 3 deletions).
- `bun run lint` / `format:check` — via the normal write-hook pipeline.
