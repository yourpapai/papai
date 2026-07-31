<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0292: Knip Ignore-List Cleanup — Convert to `knip.config.ts` With a Svelte Compiler and the `*.testing.ts` Seam Convention

## Status

Implemented (with divergence)

## Date

2026-07-17

## Context

`knip.jsonc` carried ~80 `ignoreIssues` entries, 4 `ignoreDependencies`, and 3 `ignore` globs. A large ignore list defeats the purpose of running knip in `--strict` mode: dead code and unused exports hide behind stale or overly broad entries, so the tool reports green while the rot accumulates. The entries fell into five buckets — Svelte-invisible client exports (~35, knip could not parse `.svelte`), test-only `*ForTesting`/`ForTest` seams (~24, invisible because `project` is deliberately production-only), plugin dynamic-loading bridges (~15, `import.meta.require`/path-based loader), forward-compat code written ahead of its consumer (~8), and genuinely unexplained entries.

Research during planning re-rooted the whole approach on three findings: (1) an empirical audit with `ignoreIssues` emptied showed many entries were already **stale** and delete with zero code changes; (2) knip's built-in Svelte plugin **enables but never registers its compiler** — its `hasDependency('svelte')` probe fails under bun's node_modules-less global-cache install layout (verified in `dist/WorkspaceWorker.js`), so a custom `.svelte` compiler function must be supplied, which JSONC cannot hold — forcing the conversion to a `.ts` config; and (3) knip 6.14.1 does not register usage through a bare `export { x } from './m.js'` re-export when that re-export is itself unconsumed, so test-seam shims must be **alias-const** shims (`import { x as _x } from './m.js'; export const x = _x`), and the production modules keep the seam symbols (they mutate module-private state and cannot move) covered by a single `*.testing.ts` ignoreIssues glob. The design (`docs/superpowers/specs/2026-07-17-knip-ignore-cleanup-design.md`) and plan (`docs/superpowers/plans/2026-07-17-knip-ignore-cleanup.md`) chose a phased category-by-category cleanup — Svelte tracing first (no source changes, removes the most entries), then test seams, then wire-or-delete forward-compat code — ending with a minimal, inline-comment-justified ignore surface.

## Decision Drivers

- **Make knip report the truth; trace what it can.** A `.svelte` custom compiler and `client/**/*.svelte!` in `project` (the `!` production marker is load-bearing — without it the production graph ignores components) make ~35 client-export ignores evaporate with zero source churn.
- **Shrink the tool limitation, not just label it.** Each `*ForTesting` seam gets a co-located `*.testing.ts` alias-const shim that is a declared entry, so tests gain an explicit import site and production modules stay analytically pure; one glob covers the genuinely-unmovable module-private-state shims.
- **Wire-or-delete; nothing stays ignored "for a future task."** Forward-compat leftovers (`PROVIDER_TYPE_BASE_URLS`/`LlmRole`, the orphaned `client/debug/types.ts`) are deleted and let the owning task reintroduce them from git; genuinely dead client exports surfaced by the now-tracing audit are deleted.
- **Move dead code rather than ignore it.** Four UI components consumed only by stories move under the already-ignored `client/stories/**` Storybook harness instead of carrying an ignore line each.
- **Minimal, justified ignore surface as a guardrail.** New ignores require an inline comment naming the dynamic mechanism knip cannot trace; prefer code fixes over ignores. `--strict` stays on for every rule.
- **Per-phase commits.** knip output after each phase is the verification signal; batching destroys bisectability, so each phase commits independently.

## Considered Options

### Option 1 — Phased category cleanup: Svelte compiler in `knip.config.ts` + `*.testing.ts` shims + wire-or-delete + justified remainder (chosen)

Convert `knip.jsonc` → `knip.config.ts` carrying a regex `.svelte` script-body compiler and `client/**/*.svelte!` in `project`; add the now-needed `*.testing.ts` entries and alias-const shims; delete dead code; move story-only components; mark the public coding-sessions seam with `@public`. Each phase ends green under `bun run knip`.

- **Pros:** deletes the root cause of ~35 ignores (knip now sees Svelte consumers) rather than papering over them; the seam convention turns a scattered test-ignore problem into a uniform, self-documenting pattern; the `.ts` config lets the compiler be a real function; forward-compat code is removed from the live tree (git is the parking lot).
- **Cons:** a custom regex Svelte compiler is a maintenance surface that may need updating if Svelte's `<script>` grammar evolves; the conversion is a breaking change to the knip config shape; the ignore surface still cannot reach zero (plugin dynamic bridges, runtime-loaded deps).

### Option 2 — Mechanically generate the ignore list from annotations (rejected)

Annotate each ignored symbol and emit `knip.jsonc` from the annotations.

- **Pros:** no structural changes; the ignore list documents itself.
- **Cons:** manages the symptom, not the disease — the list stays ~80 long; knip keeps reporting green on rot; no path toward a genuinely smaller surface.

### Option 3 — Big-bang single PR (rejected)

Rewrite the config and delete everything in one commit.

- **Pros:** one review; one change.
- **Cons:** destroys bisectability — if knip regresses there is no per-category revert; the per-phase green signal (knip output diff after each phase) is the whole point of the phased order.

## Decision

The chosen Option 1 shipped across the new TS config, the Svelte compiler, the seam convention, the dead-code deletions, the component moves, and the `@public` seam. What shipped:

1. **`knip.jsonc` → `knip.config.ts`.** A TypeScript config replaces the JSONC file; it carries a `svelteCompiler` regex function (`knip.config.ts:14-20`) that extracts each `<script>` body and joins them, wired via `compilers: { '.svelte': svelteCompiler }` (`knip.config.ts:28`).
2. **Svelte production tracing.** `project` includes `client/**/*.svelte!` (`knip.config.ts:67-73`); the `!` production marker is load-bearing so the production graph includes components, eliminating ~35 client-export ignores.
3. **`svelte` moved to `dependencies`.** `package.json:97` lists `"svelte": "^5.56.7"` under `dependencies` (not `devDependencies`) because the client production graph imports `svelte` in 26+ places; under `--strict` a devDependency placement reports every such import as `unlisted`.
4. **`*.testing.ts` seam convention.** 29 alias-const shim files (e.g. `src/debug/server.testing.ts`, `src/tools/tool-preferences.testing.ts`, `client/admin/fetchers.testing.ts`) re-export test-only symbols; `entry` declares `src/**/*.testing.ts!` and `client/**/*.testing.ts!` (`knip.config.ts:60-61`) so the shims are traceable entry points, and `ignoreIssues` covers them with a single glob per tree (`knip.config.ts:100-102`).
5. **Forward-compat leftovers deleted.** `PROVIDER_TYPE_BASE_URLS` and the standalone `LlmRole` are gone from `src/llm-providers/types.ts`; the orphaned `client/debug/types.ts` (only an identity test imported it) is deleted.
6. **Dead client exports deleted.** The now-tracing audit surfaced and removed `sectionLabel`/`AdminSection` (admin), `getKaneoCredentials` (settings fetchers), `ByokField`/`PluginEligibility` (fetcher-schemas), and the `TaskInstanceView`/`PlatformProviderTypeView`/`TaskProviderTypeView`/`AdminInstanceView` view types.
7. **Story-only UI components moved.** `PanelShell`, `StatusDot`, `FormRow`, and `Tag` (consumed only by stories/visual tests) moved from `client/shared/` into `client/stories/components/` (`PanelShell`/`StatusDot`) and `client/stories/components/ui/` (`FormRow`/`Tag`), i.e. under the already-ignored Storybook harness — deleting their ignore lines without touching production.
8. **Public coding-sessions seam marked `@public`.** `configureCodingSessionCapability` (`src/coding-sessions/configure.ts:55`) and `getCodingSessionRecord`/`setCodingSessionRecord` (`src/coding-sessions/store.ts:23,28`) carry `/** @public Intentional public seam for the plugin-core-separation refactor. */`, so knip treats them as public API without an ignore line (the design's primary path, Expected A).
9. **Guardrail header preserved.** `knip.config.ts:6-9` keeps the guardrail comment: new ignores require an inline justification naming the dynamic mechanism knip cannot trace and a linked task when the gap is temporary.

## Consequences

### Positive

- knip now reports the truth for the client: a real `.svelte` compiler makes ~35 client-export ignores evaporate with zero source churn, and the production marker `client/**/*.svelte!` keeps components in the graph so every client export is genuinely traced to a consumer (or flagged dead).
- The seam convention turned a scattered test-ignore problem into a uniform, self-documenting pattern: each `*ForTesting` symbol has a co-located `*.testing.ts` entry, tests import from it, and the production module stays analytically pure; one glob covers the genuinely-unmovable module-private-state shims.
- Forward-compat code that had no consumer is out of the live tree (git is the parking lot), so knip no longer greens over speculative or orphaned code.
- `--strict` stays on for every rule (`files`/`dependencies`/`exports`/`unlisted`/… all `error`), and every surviving ignore carries an inline comment naming the dynamic mechanism, so the surface is auditable.

### Negative

- **The ignore surface did not reach the plan's aggressive target.** The goal was `ignoreIssues` ≤ ~6 lines (4 glob lines + ≤2 justified); shipped carries 10 glob keys, because the audit surfaced additional justified gaps (behavior-audit tier-1 orchestration scripts, dynamic-import tool/route symbols) after the plan was written. Each carries an inline comment, and the plan's Self-Review explicitly permitted extra justified ignores — but the absolute count is higher than promised.
- **A custom regex Svelte compiler is a maintenance surface.** It mirrors knip's intended extraction but is hand-rolled; if Svelte's `<script>` block grammar evolves the compiler must be updated, or client exports start mis-tracing.
- **Breaking change to the knip config shape.** `knip.jsonc` is gone; any dev-local config overrides must move to the `.ts` shape.

### Risks

- **The regex compiler can mis-extract.** A malformed `<script>` block or an attribute form the regex does not cover would silently drop usages, making a live component look orphaned (false positive) or hiding a dead one (false negative). Mitigated by the `m`+`u` flag pair and a non-empty check, but it is not the real Svelte parser.
- **Surviving ignores encode untraceable dynamic mechanisms.** Plugin `import.meta.require` bridges, runtime-loaded deps, and dynamic-import tool/route symbols are still ignored by name; if a future change removes the dynamic mechanism, the ignore becomes stale and hides a real dead export. The guardrail header is the only guard.
- **`@public` trusts the maintainer.** The coding-sessions seam is public by annotation, not by a static consumer; if the plugin-core-separation refactor that motivates it does not land, those exports are public-but-unused by default.

## Related Decisions

- [ADR-0011](README.md) — Knip for Dead Code Detection and Enforced Export Hygiene: the original decision to run knip in `--strict` mode as the dead-code/export-hygiene gate. This ADR is a direct cleanup of the ignore surface that decision's enforcement had accumulated; it preserves the `--strict`-on-every-rule posture while shrinking what knip is told to ignore. (ADR-0011's source file was pruned with the 0001-0100 batch; referenced via the index.)
- [ADR-0090](README.md) — Decline Full Tool Catalog Emission in `/context`; Complete KNIP Cleanup: the prior partial knip-ignore cleanup. This ADR supersedes 0090's remainder by converting to the `.ts` config with a real Svelte compiler and the `*.testing.ts` seam convention, removing the entries 0090 had only labeled as tool limitations. (ADR-0090 is referenced via the index.)

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `knip.config.ts:14-20` | `svelteCompiler` — regex `<script>` body extractor (knip's built-in Svelte plugin never registers its compiler under bun's install layout). | `read` confirms. |
| `knip.config.ts:28` | `compilers: { '.svelte': svelteCompiler }` — the compiler that the JSONC file could not hold, forcing the TS conversion. | `read` confirms. |
| `knip.config.ts:56-57` | Plugin bridge entries — `plugins/audio-transcribe/runtime.ts!` and `plugins/task-provider-kaneo/auto-provision.ts!` (the `!` cascade-resolves their static imports). | `read` confirms. |
| `knip.config.ts:60-61` | `src/**/*.testing.ts!` and `client/**/*.testing.ts!` — declared test-seam entries. | `read` confirms. |
| `knip.config.ts:67-73` | `project` with `client/**/*.svelte!` — the load-bearing production marker that puts components in the production graph. | `read` confirms. |
| `knip.config.ts:75-90` | `rules` — every rule `error` (`--strict` posture preserved). | `read` confirms. |
| `knip.config.ts:96` | `ignoreDependencies` is `['msw', '@crvy/strybk']` — **2, not 3**; `@stryker-mutator/typescript-checker` was also dropped. | `read` confirms. |
| `knip.config.ts:98-130` | `ignoreIssues` — 10 glob keys (2 testing globs, widened plugin glob, task-provider client glob, `strybk.config.ts`, plus behavior-audit/tool/route symbols), each inline-commented. | `read` confirms. |
| `knip.config.ts:138` | `ignore` globs unchanged — `src/db/migrations/**`, `client/stories/**`, `tests/visual/**`. | `read` confirms. |
| `package.json:97` | `"svelte": "^5.56.7"` under `dependencies` (moved from `devDependencies`). | `read` confirms. |
| `glob **/knip.jsonc` | `knip.jsonc` deleted — **no files found**. | `glob` confirms. |
| `src/coding-sessions/configure.ts:55-56` | `/** @public Intentional public seam … */` above `configureCodingSessionCapability`. | `read` confirms. |
| `src/coding-sessions/store.ts:23,28` | `@public` tags above `getCodingSessionRecord`/`setCodingSessionRecord`. | `read` confirms. |
| `src/llm-providers/types.ts` | `PROVIDER_TYPE_BASE_URLS` and standalone `LlmRole` deleted — `grep` finds only the unrelated `LlmRoleBindings`. | `grep` confirms. |
| `client/debug/types.ts` | Orphaned file deleted — `glob` returns **no files found**. | `glob` confirms. |
| `client/stories/components/{PanelShell,StatusDot}.svelte`, `client/stories/components/ui/{FormRow,Tag}.svelte` | Four story-only components moved out of `client/shared/` under the ignored Storybook harness. | `glob` confirms. |
| `client/admin`, `client/settings`, `client/shared/api-types.ts` | `sectionLabel`/`AdminSection`/`getKaneoCredentials`/`ByokField`/`PluginEligibility`/`TaskInstanceView`/`PlatformProviderTypeView`/`TaskProviderTypeView`/`AdminInstanceView` deleted — `grep` finds only the unrelated internal `SubjectGrowthPointSchema` and derived `AdminSectionId`. | `grep` confirms. |
| `glob **/*.testing.ts` | 29 alias-const shim files present across `src/` and `client/` (plan's 27 plus 2 extra, see divergence). | `glob` confirms. |

Plan-vs-implementation notes:

- **`ignoreDependencies` came in at 2, not the plan's 3.** The plan's Task 1 listed `['@stryker-mutator/typescript-checker', 'msw', '@crvy/strybk']`; shipped (`knip.config.ts:96`) drops `@stryker-mutator/typescript-checker` too (knip now traces it), beating the design's "≤ 2" end-state target. The inline comment for the dropped entry was removed accordingly.
- **`ignoreIssues` is 10 glob keys, above the plan's "4–5 / ≤6" target.** Alongside the plan's 2 testing globs, the (widened) plugin glob, and `strybk.config.ts`, shipped adds `plugins/task-provider-*/client.ts`, plus 5 behavior-audit/tool/route ignores (`scripts/behavior-audit/{publish-snapshot,tools,consolidate-agent}.ts`, `src/tools/index.ts`, `src/debug/server-route-options.ts`) the audit surfaced after the plan was written. Each carries an inline justification comment; the plan's Self-Review explicitly permitted extra justified ignores, but the absolute count is higher than promised.
- **Two extra entry declarations were added.** `scripts/behavior-audit/preflight.ts!` and `scripts/behavior-audit/publish-snapshot.ts!` (`knip.config.ts:42-43`) are tier-1 nightly CI orchestration scripts not in `package.json`; declaring them entries lets knip trace their imports instead of ignoring them.
- **Two extra `*.testing.ts` shims exist beyond the plan.** `src/message-edit/edit-prompt-store.testing.ts` (re-exports `resetEditPromptStoreForTesting`) and `src/web/safe-fetch.testing.ts` (re-exports `setAssertPublicUrlForTesting`) follow the plan's alias-const shim pattern (`import { x as _x }; export const x = _x`) for seams the audit added concurrently.
- **Task 8 took the `@public` path (Expected A), not the ignoreIssues fallback.** The plan offered both ("keep whichever outcome works; do not keep both"); knip accepted the `@public` tags, so no `src/coding-sessions/{configure,store}.ts` ignore line was added. No divergence in intent — only one of the two sanctioned outcomes shipped.
- **The plugin glob was widened.** The plan's `plugins/*/{index,validate-config,provider,runtime,auto-provision,provision,client}.ts` was split: a general `plugins/*/{index,validate-config,provider,runtime,auto-provision,provision}.ts` glob plus a narrower `plugins/task-provider-*/client.ts` glob scoped to task-provider plugins so other plugins' clients stay checked. Same dynamic-loading justification; tighter blast radius.

The source plan `docs/superpowers/plans/2026-07-17-knip-ignore-cleanup.md` and design `docs/superpowers/specs/2026-07-17-knip-ignore-cleanup-design.md` are archived alongside this ADR to `docs/archive/`.
