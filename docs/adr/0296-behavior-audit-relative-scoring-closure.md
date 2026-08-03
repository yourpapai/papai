<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0296: Behavior Audit — Relative Scoring + Codeindex Closure Check (Tier 3)

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The behavior-audit pipeline (`scripts/behavior-audit/`, `bun audit:behavior`) produces per-story persona scores (Maria/Dani/Viktor × discover/use/retain, 1–5 each) and consolidated user stories, but as of 2026-07-19 three honesty gaps remained in the Phase 3 output:

1. **Scores are absolute grades with no context.** A story scoring "Maria: use 3/5" is uninterpretable without the domain's distribution — the same 3/5 may be top-quartile in one domain and bottom-decile in another. `report-index-helpers.ts` computed only per-domain means and top flaws/improvements by frequency; no percentile, no rank, no trend.
2. **Personas are LLM self-reports, not measurements.** Phase 3 asks the LLM to roleplay each persona and assign numbers; two runs on the same input produce different numbers. As *absolute* grades these are scientifically weak; as *relative* signals (rank within domain, trend across snapshots) they carry usable information.
3. **Stories are not grounded in code.** Nothing verifies that a consolidated "user story" describes a feature with an actual reachable entry point. The LLM may emit a plausible story with no corresponding command, tool, handler, or route, and readers cannot tell which stories are grounded.

A separate, dormant codeindex integration (`extract-evidence.ts`, `extract-evidence-loader.ts`) had been scaffolded for a Phase 1 trust design but was never wired into the live pipeline. The design (`docs/superpowers/specs/2026-07-19-behavior-audit-relative-scoring-closure-design.md`) and plan (`docs/superpowers/plans/2026-07-19-behavior-audit-relative-scoring-closure-implementation.md`) chose to ship two changes together: **Part A** — reorient Phase 3 scores as relative signals within each domain (percentile rank, bottom-decile flag, trend across nightly snapshots) plus a machine-readable `stories/scores.json` sidecar; and **Part B** — extend the Phase 2b schema with `entryPointHints`, run a new no-LLM **Phase 2c** closure verifier that resolves each hint to real reachable code (commands/tools/routes via static maps, handlers via codeindex), and surface the results in the reports.

## Decision Drivers

- **Reorient absolute scores as relative signals.** Phase 3's persona numbers stay as the LLM emits them; relativization happens at report-write time as percentile rank within domain and a bottom-decile flag, so a reader can tell whether 3/5 is good or bad *for that domain*.
- **Add a trend column that degrades gracefully.** Composite-score delta vs the previous nightly snapshot, read via `git show audit-output-latest:stories/scores.json` (the tag Tier 1 moves on each publish); when Tier 1 is absent or no prior exists, the column reports "no prior snapshot" rather than failing.
- **Ground each story in reachable code.** A new Phase 2c verifier resolves each story's `entryPointHints` to real symbols: commands via `listCommandCatalogEntries`, tools via `listToolNames`, routes via `listRoutes`, handlers via codeindex's `findSymbolCandidates`. Each story gets a `closureStatus` of `resolved`/`partial`/`unresolved`/`unverified`.
- **Emit a machine-readable sidecar.** `stories/scores.json` (composite, percentile, bottomDecile, persona triples, flaws/improvements, trendDelta, closureStatus, entryPoints) so downstream tooling and trend computation don't have to parse markdown.
- **Reuse existing codeindex infrastructure; no LLM in the verifier.** Phase 2c revives `loadCodeindexDeps` for a different purpose (closure verification at Phase 2b output, not evidence collection at Phase 1 input). It is pure deterministic resolution, idempotent, completes in seconds, and needs no checkpointing.
- **Graceful degradation everywhere.** Codeindex unavailable → handler hints unresolved + one warning; `src/commands`/`src/tools`/`src/debug` map empty → that kind's hints unresolved; pre-Tier-3 consolidated artifacts lacking `entryPointHints`/`closure` → `closureStatus: 'unverified'`. The audit never fails on a missing optional input.
- **Preserve backward compatibility via schema defaults.** `entryPointHints` uses `.default([])` and `closure` uses `.nullable().default(null)` so pre-Tier-3 `consolidated/*.json` files still load.

## Considered Options

### Option 1 — Percentile rank + trend sidecar + codeindex-grounded Phase 2c closure verifier (chosen)

Add `computePercentiles`/`isBottomDecile` to `report-index-helpers.ts`, `loadPriorSnapshot`/`computeTrendDeltas`/`roundToOneDecimal` to `report-rebuild-helpers.ts`, emit `stories/scores.json`, extend the Phase 2b schema with `entryPointHints`, add a no-LLM `closure-verifier.ts` + `closure-verifier-pipeline.ts` wired as Phase 2c between Phase 2b's manifest save and Phase 3, and surface percentile/trend/closure in the markdown.

- **Pros:** makes the LLM self-grades honest by context (rank, trend) without changing the LLM prompt or personas; grounds stories in real code with per-hint evidence; the sidecar is architecture-independent and survives any later Tier 4 rewrite; the verifier is pure and idempotent, so it is trivially testable and never blocks.
- **Cons:** two sub-features in one plan (schema change + new phase + report changes); a runtime codeindex dependency for handler-kind hints (degrades gracefully); a small prompt regression risk from the added `entryPointHints` clause; trend arrows are bounded by LLM run-to-run jitter (mitigated by a 0.3 noise threshold).

### Option 2 — Replace the LLM evaluation with code-based metrics (rejected)

Drop the persona roleplay in favor of objective code metrics (coverage, route count, etc.).

- **Pros:** removes LLM nondeterminism from scoring entirely.
- **Cons:** explicitly out of scope — the pipeline's value *is* the LLM judgment; the goal is to make that judgment honest via relativization, not to replace it. Would discard the Maria/Dani/Viktor persona model the audit is built around.

### Option 3 — Wire codeindex into Phase 1 evidence collection (rejected, deferred)

Realize the dormant `2026-04-27-behavior-audit-phase1-trust-design.md` instead, attaching codeindex grounding to extraction.

- **Pros:** grounds evidence at the source rather than at the consolidated story.
- **Cons:** different problem (extractor trust, not story closure); far larger blast radius (Phase 1 rewrite); leaves the relativization gap unaddressed. Phase 1 trust remains dormant; Tier 3 reuses only `loadCodeindexDeps` from that code family.

## Decision

The chosen Option 1 shipped across the new shared types, the schema extension, the entry-point maps, the closure verifier and its pipeline, the Phase 2c wiring, the percentile/trend helpers, and the scores sidecar/markdown surfacing. What shipped:

1. **`scores-types.ts` created.** `EntryPointKind`/`ClosureStatus` enums; `EntryPointEntry`/`EntryPointHint`/`ClosureResult`/`PersonaScore`/`StoryEntry`/`DomainEntry`/`ScoresFile` interfaces — the shared vocabulary for the sidecar and the closure result.
2. **Phase 2b schema extended with `entryPointHints`.** `consolidate-agent.ts` gained `EntryPointHintSchema` + an `entryPointHints: z.array(...).default([])` field on `ConsolidationItemSchema`, a `parseConsolidationResult` export, and a system-prompt clause instructing the LLM to list command/tool/handler/route entry points per user-facing story.
3. **`ConsolidatedBehavior` gained `entryPointHints` + `closure`.** `report-writer.ts`'s TypeScript interface and Zod schema both carry the new fields; `closure` is `ClosureResultSchema.nullable().default(null)`, so pre-Tier-3 artifacts still parse.
4. **`entry-point-maps.ts` created.** `buildCommandMap`/`buildToolMap`/`buildRouteMap` plus `loadCommandCatalog`/`loadToolRegistry`/`loadRouteRegistry` loaders that runtime-import `src/commands`/`src/tools`/`src/debug/server` and fall back to empty when an export is absent. Command names are stored in both slashed and unslashed variants.
5. **`src/tools/index.ts` exports `listToolNames` and `src/debug/server-route-options.ts` exports `listRoutes`.** `listToolNames` returns `BUILTIN_TOOL_NAMES`; `listRoutes` returns `BUILTIN_HTTP_ROUTES` (re-exported from `src/debug/server.ts`). `listCommandCatalogEntries` already existed in `src/commands/catalog.ts`.
6. **`closure-verifier.ts` created.** `resolveHint` dispatches by kind (set lookup for command/tool/route, codeindex `findSymbolCandidates` for handler with per-hint try/catch); `runClosureCheck` resolves all hints per behavior and computes `closureStatus` via `computeStatus` (resolved/partial/unresolved/unverified).
7. **`closure-verifier-pipeline.ts` created.** `runPhase2c(manifest, selectedFeatureKeys, deps)` builds the three static maps once, opens a codeindex resolver (with `SYMBOL_SEARCH_LIMIT = 5`), verifies each feature key's consolidated file concurrently via `pLimit(CONCURRENCY)`, writes the `closure` field back into each artifact, and closes the database in a `finally`.
8. **Phase 2c wired into `index.ts`.** `runPhase2cIfNeeded` sits in `BehaviorAuditDeps` between `saveConsolidatedManifest` and `runPhase3IfNeeded`; the default impl skips when no feature keys are selected and otherwise calls `runPhase2c`.
9. **Percentile + bottom-decile helpers added.** `report-index-helpers.ts` exports `computePercentiles` (single-element → [100]; all-equal → all 100; otherwise a percentile-rank formula) and `isBottomDecile` (percentile < 10).
10. **Trend helpers added.** `report-rebuild-helpers.ts` exports `roundToOneDecimal`, `computeTrendDeltas` (match by `consolidatedId`, round before diffing, null for unmatched), and `loadPriorSnapshot` (Zod-validated `git show audit-output-latest:stories/scores.json`, null on any failure).
11. **`stories/scores.json` sidecar emitted.** `writeScoresJson` builds domain-grouped `StoryEntry` records (composite from the 9 persona sub-scores), assigns percentiles and trend deltas, and writes the `ScoresFile` to `stories/scores.json`.
12. **Percentile, trend, and closure surfaced in markdown.** Per-story markdown gains a Composite line (with Δ arrow vs prior or "no prior snapshot"), a Domain-rank line, a bottom-decile callout, a closure-check callout, and an Entry-points list (✓/✗ per hint). `stories/index.md` gains Closure Gaps and Top Movers sections.

## Consequences

### Positive

- Phase 3's LLM self-grades are now honest by context: a reader sees a story's percentile within its domain and a bottom-decile flag, so "3/5" is no longer interpreted identically everywhere.
- Every consolidated user story is grounded against reachable code with per-hint evidence; ungrounded stories are flagged with a `closureStatus` and an entry-point list, so readers can tell which stories describe real features.
- A machine-readable `stories/scores.json` sidecar decouples trend computation and downstream tooling from markdown scraping, and is the artifact Tier 1 publishes for the next run's trend column.
- The closure verifier is pure, idempotent, no-LLM, and concurrent; it adds seconds to a run, needs no checkpointing, and degrades gracefully on every optional dependency (codeindex, command/tool/route maps, prior snapshot, pre-Tier-3 artifacts).
- Backward compatibility is preserved by schema defaults: pre-Tier-3 `consolidated/*.json` files load and report `closureStatus: 'unverified'` until regenerated.

### Negative

- **Two sub-features shipped in one plan.** The schema/prompt change (Part B) and the relativization/sidecar (Part A) are largely independent but coupled in one tier, so a regression in either lands together.
- **A runtime codeindex dependency for handler-kind hints.** When codeindex is unavailable, handler hints are unresolved and the audit logs a warning; command/tool/route hints still resolve. Handler-heavy domains will show spurious `partial`/`unresolved` statuses until codeindex is indexed.
- **A small prompt-regression risk.** Adding the `entryPointHints` clause asks the LLM to do slightly more per consolidation; the first nightly snapshot after ship should be spot-checked against the pre-Tier-3 baseline.
- **Trend arrows are bounded by LLM jitter.** Run-to-run composite jitter on the order of ±0.2 is absorbed by the 0.3 ↑/↓ threshold, but a noisy arrow is a hint, not a verdict.

### Risks

- **Static entry-point map brittleness.** The command/tool/route maps depend on `listCommandCatalogEntries`/`listToolNames`/`listRoutes` staying in sync with the registered surface. A refactor that breaks an export degrades that kind to "all unresolved" silently (mitigated by graceful fallback, but the signal degrades rather than failing).
- **Codeindex correctness for handler hints.** `findSymbolCandidates` returns the first candidate; a wrong first hit resolves a hint that should not. The blast radius is one hint's `resolved` flag, not the git state.
- **Percentile in small domains is coarse.** With <10 stories a true bottom decile cannot exist; the formula and the single-element/all-equal short-circuits prevent false flags, but percentiles in 2–3 story domains are weak signals by construction.
- **Pre-Tier-3 cached artifacts report `unverified`.** Local-dev cached `consolidated/*.json` must be deleted to force regeneration; Tier 1's no-state CI policy means this only affects local caches.

## Related Decisions

- [ADR-0295](0295-behavior-audit-concurrency-grep.md) — Behavior Audit — Configurable Concurrency and Pure-JS Grep Replacement (Tier 2): the sibling plan whose `CONCURRENCY` knob and `pLimit` pattern Phase 2c reuses (`runPhase2c` dispatches across `pLimit(CONCURRENCY)`). Tier 2's parallelization substrate is what makes the per-feature-key closure verification cheap.
- [ADR-0294](0294-behavior-audit-close-the-loop.md) — Behavior Audit — Close the Loop (Tier 1): the sibling plan whose orphan-branch snapshots and `audit-output-latest` tag Tier 3's trend column reads via `git show audit-output-latest:stories/scores.json`. Tier 3's `scores.json` sidecar is published by Tier 1's publisher automatically (it lives in `stories/`); when Tier 1 is absent the trend column degrades to "no prior snapshot".
- [ADR-0114](0114-behavior-audit-phase2-redesign.md) — Behavior Audit Phase 2 Redesign: established the Phase 2a → Phase 2b split whose Phase 2b output (`consolidated/*.json`) is this ADR's closure-verifier input and the artifact the `entryPointHints` schema extends.
- [ADR-0109](0109-behavior-audit-hybrid-to-artifact-migration.md) — Behavior Audit Hybrid State to Canonical Artifact Model: established the canonical artifact model (`ConsolidatedBehavior`, `readConsolidatedFile`/`writeConsolidatedFile`) the verifier reads and writes back into.
- [ADR-0077](README.md) — Behavior Audit Test-Driven UX Evaluation: the base audit pipeline/phase-runner architecture that Phase 2c extends with a new phase. (ADR-0077's file is in the pruned 0001–0100 range; referenced via the index.)
- [ADR-0073](README.md) — Behavior Audit Incremental Runs: the incremental `selectedFeatureKeys` scoping that Phase 2c participates in (the verifier scopes to the selected feature keys, and skips when none are selected). (Referenced via the index; file pruned with the 0001–0100 batch.)

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `scripts/behavior-audit/scores-types.ts:6-61` | Shared types — `EntryPointKind`, `ClosureStatus`, `EntryPointEntry`, `EntryPointHint`, `ClosureResult`, `PersonaScore`, `StoryEntry`, `DomainEntry`, `ScoresFile`. | `read` confirms; matches the plan's Task 1 verbatim. |
| `scripts/behavior-audit/consolidate-agent.ts:46` | System-prompt clause instructing the LLM to list command/tool/handler/route entry points per user-facing story. | `read` confirms. |
| `scripts/behavior-audit/consolidate-agent.ts:48-63` | `EntryPointHintSchema` + `entryPointHints: z.array(EntryPointHintSchema).default([])` on `ConsolidationItemSchema`. | `read` confirms. |
| `scripts/behavior-audit/consolidate-agent.ts:71-73` | `parseConsolidationResult(input)` export running `ConsolidationResultSchema.parse`. | `read` confirms. |
| `scripts/behavior-audit/report-writer.ts:53-69` | `ConsolidatedBehavior` interface carries `entryPointHints: readonly EntryPointHint[]` + `closure: ClosureResult \| null`. | `read` confirms. |
| `scripts/behavior-audit/report-writer.ts:71-109` | `EntryPointHintSchema`/`EntryPointEntrySchema`/`ClosureResultSchema`; `ConsolidatedBehaviorSchema` has `entryPointHints` (`.default([])`) and `closure` (`.nullable().default(null)`). Pre-Tier-3 artifacts parse. | `read` confirms. |
| `scripts/behavior-audit/report-writer.ts:162-191` | `rebuildReportsFromStoredResults` loads artifacts, `loadPriorSnapshot()`, `writeScoresJson(...)`, threads the resulting `ScoresFile` into `writeRebuiltStoryFiles` and `writeIndexFile`. | `read` confirms. |
| `scripts/behavior-audit/scores-writer.ts:125-161` | `writeScoresJson` builds domain-grouped `StoryEntry` records, assigns percentiles + trend deltas, writes `stories/scores.json`. (Divergence: lives in `scores-writer.ts`, not `report-writer.ts`.) | `read` confirms. |
| `scripts/behavior-audit/scores-writer.ts:26-47` | `groupConsolidatedByDomain` — domain-keyed grouping the sidecar consumes. | `read` confirms. |
| `scripts/behavior-audit/report-markdown.ts:27-103` | `writeStoryFile` gains Composite/Domain-rank/bottom-decile/closure callouts + entry-point list (via `appendEntryMetrics`/`appendEntryPointList`), looking entries up from the threaded `ScoresFile`. (Divergence: lives in `report-markdown.ts`, not `report-writer.ts`.) | `read` confirms. |
| `scripts/behavior-audit/report-markdown.ts:130-216` | `writeIndexFile` gains Closure Gaps (`buildClosureGapsSection`) and Top Movers (`buildTopMoversSection`) sections from the threaded `ScoresFile`. | `read` confirms. |
| `scripts/behavior-audit/report-index-helpers.ts:64-80` | `computePercentiles` (single-element → [100]; all-equal short-circuit; otherwise `(strictlyLess+1)/(N+1)*100`) + `isBottomDecile`. (Divergence: formula differs from the plan sketch — see notes.) | `read` confirms. |
| `scripts/behavior-audit/report-rebuild-helpers.ts:250-272` | `roundToOneDecimal` + `computeTrendDeltas` (match by `consolidatedId`, null for unmatched). | `read` confirms. |
| `scripts/behavior-audit/report-rebuild-helpers.ts:69-90,274-291` | `loadPriorSnapshot` — `Bun.spawn(['git','show','audit-output-latest:stories/scores.json'])`, Zod-validated via `PriorSnapshotSchema`, null on any failure. (Divergence: plan used bare `JSON.parse`.) | `read` confirms. |
| `scripts/behavior-audit/entry-point-maps.ts:19-36` | `buildCommandMap`/`buildToolMap`/`buildRouteMap` (synchronous, return `ReadonlySet<string>`). (Divergence: plan made them `async`.) | `read` confirms. |
| `scripts/behavior-audit/entry-point-maps.ts:38-72` | `loadCommandCatalog`/`loadToolRegistry`/`loadRouteRegistry` — runtime imports of `src/commands`/`src/tools`/`src/debug/server` with empty fallback. | `read` confirms. |
| `src/commands/catalog.ts:97` + `src/commands/index.ts:6` | `listCommandCatalogEntries` defined and re-exported. | `grep` confirms. |
| `src/tools/index.ts:33-35` | `listToolNames` returns `BUILTIN_TOOL_NAMES` (real registry, not the plan's `[]` fallback). | `read` confirms. |
| `src/debug/server-route-options.ts:122-124` + `src/debug/server.ts:122` | `listRoutes` returns `BUILTIN_HTTP_ROUTES`; re-exported from `server.ts`. (Divergence: plan placed it directly in `server.ts`.) | `read` + `grep` confirm. |
| `scripts/behavior-audit/closure-verifier.ts:30-68` | `resolveHint` dispatches by kind — set lookup for command/tool/route via `resolveInSet`, codeindex `findSymbolCandidates` for handler via `resolveHandler` (per-hint try/catch). | `read` confirms. |
| `scripts/behavior-audit/closure-verifier.ts:85-105` | `computeStatus` (resolved/partial/unresolved/unverified) + `runClosureCheck` building the `Map<id, ClosureResult>`. | `read` confirms. |
| `scripts/behavior-audit/closure-verifier-pipeline.ts:64-94` | `loadCodeindexResolver` — `loadCodeindexConfig` + `db.openDatabase`, returns `{ resolver, close }`, warns + returns null on failure. (Divergence: richer than the plan's `loaded.codeindex.enabled` check.) | `read` confirms. |
| `scripts/behavior-audit/closure-verifier-pipeline.ts:119-152` | `runPhase2c(manifest, selectedFeatureKeys, depsInput)` — builds maps, verifies each feature key via `pLimit`, writes `closure` back, closes db in `finally`. (Divergence: added `selectedFeatureKeys` param.) | `read` confirms. |
| `scripts/behavior-audit/index.ts:90-100` | `defaultRunPhase2cIfNeeded` — skips when no selected feature keys, else calls `runPhase2c`. | `read` confirms. |
| `scripts/behavior-audit/index.ts:145-149,174` | `runPhase2cIfNeeded` in `BehaviorAuditDeps`; wired into `defaultBehaviorAuditDeps`. | `read` confirms. |
| `scripts/behavior-audit/index.ts:210-211` | Phase 2c invoked between `saveConsolidatedManifest` and `runPhase3IfNeeded`. | `read` confirms. |
| `tests/scripts/behavior-audit/percentile.test.ts` | Percentile unit tests (6 cases incl. single-element, all-equal, bottom-decile, ties). | `read` confirms. |
| `tests/scripts/behavior-audit/trend.test.ts` | `roundToOneDecimal` + `computeTrendDeltas` unit tests (7 cases). | `read` confirms. |
| `tests/scripts/behavior-audit/closure-verifier.test.ts` | `resolveHint`/`runClosureCheck` unit tests (command/tool/route/handler resolution, status computation). | `read` confirms. |
| `tests/scripts/behavior-audit/closure-verifier-pipeline.test.ts` | `runPhase2c` pipeline test with DI harness (215 lines). | `read` confirms. |
| `tests/scripts/behavior-audit/consolidate-agent-schema.test.ts` | Schema-migration tests: item without `entryPointHints` defaults to empty; item with hints parses. | `read` confirms. |
| `tests/scripts/behavior-audit/entry-point-maps.test.ts` | Static-map builder tests. | `glob` confirms. |
| `tests/scripts/behavior-audit/scores-json.test.ts` | `scores.json` sidecar shape tests (503 lines). (Divergence: plan named it `scores-file.test.ts`.) | `read` confirms. |
| `tests/scripts/behavior-audit/scores-markdown.test.ts` | Markdown surfacing tests (413 lines). | `read` confirms. |
| `tests/scripts/behavior-audit/entrypoint.test.ts:145,300-301,509-535` | Entrypoint test tracks `runPhase2cIfNeeded` calls and asserts it runs between manifest save and Phase 3. | `grep` confirms. |

Plan-vs-implementation notes:

- **`writeScoresJson` was extracted into a new `scores-writer.ts`, not added to `report-writer.ts`.** The plan's Task 9 placed `writeScoresJson` (plus percentile/trend assignment) in `report-writer.ts`. Shipped, the sidecar logic lives in `scripts/behavior-audit/scores-writer.ts:125-161` alongside `groupConsolidatedByDomain` and the `assignPercentiles`/`assignTrendDeltas` helpers; `report-writer.ts:22` imports them. `report-writer.ts` instead threads the resulting `ScoresFile` object through `writeRebuiltStoryFiles` and `writeIndexFile`. Intent (emit `stories/scores.json` with composite/percentile/trend/closure) fully preserved; the module boundary moved.
- **The markdown functions were extracted into a new `report-markdown.ts`, not modified in `report-writer.ts`.** The plan's Task 10 modified `writeStoryFile`/`writeIndexFile` inside `report-writer.ts`. Shipped, both live in `scripts/behavior-audit/report-markdown.ts` (`report-writer.ts:13,25` imports/re-exports). Both take an optional `scores?: ScoresFile` parameter and look up the matching `StoryEntry` by `featureName`, rather than each story carrying its scores inline. The Composite/Domain-rank/bottom-decile/closure/entry-points surface and the Closure Gaps / Top Movers index sections all shipped as specified; they just live in a sibling module.
- **`computePercentiles` uses a corrected formula.** The plan sketch computed `Math.round((strictlyLess + ties) / N * 100)` with "ties get the max rank." That formula is buggy: a min-rank max-ties score would receive a high percentile (e.g., the lone 1.0 in a 10-element domain would get 100), and the plan's own tests ("10-element domain with one low outlier flags bottom decile", "ties at boundary both flagged") would have failed against it. Shipped (`report-index-helpers.ts:64-76`) uses `Math.round(((strictlyLess + 1) / (scores.length + 1)) * 100)` plus an explicit all-equal short-circuit returning all 100 and a single-element `[100]` early return. The shipped formula satisfies the plan's test cases; the exported name/signature is unchanged.
- **`closure-verifier-pipeline.ts` diverges structurally from the plan sketch.** The plan's sketch had signature `runPhase2c(manifest, deps={})`, checked `loaded.codeindex.enabled`, used `process.cwd()`, and wrote the consolidated file keyed by `domain` (which would have been a bug — `writeConsolidatedFile` keys by feature key). Shipped (`closure-verifier-pipeline.ts:119-152`) has signature `runPhase2c(manifest, selectedFeatureKeys, depsInput={})`, builds the codeindex resolver via `loadCodeindexConfig` + `db.openDatabase`, uses `PROJECT_ROOT` from config, keys writes by `featureKey`, opens and closes the database in a `try/finally`, and adds a `SYMBOL_SEARCH_LIMIT = 5` passed to `findSymbolCandidates`. The `selectedFeatureKeys` parameter threads incremental scoping through Phase 2c, and `defaultRunPhase2cIfNeeded` (`index.ts:90-100`) skips the phase entirely when no feature keys are selected. Intent (concurrent per-feature-key closure verification with graceful codeindex degradation) preserved.
- **`closure-verifier.ts` was refactored but is functionally equivalent.** The plan's `resolveHint` was an `async` switch; shipped (`closure-verifier.ts:57-68`) returns `Promise<EntryPointEntry>` via `resolveInSet`/`resolveHandler` helpers. The plan's `runClosureCheck` used a `for...of`; shipped (`closure-verifier.ts:93-105`) builds via a `Promise.all`-map into `[id, entry]` pairs. Exported API, the four-kind dispatch, the per-hint try/catch, and the `computeStatus` taxonomy are all preserved.
- **`loadPriorSnapshot` Zod-validates the prior snapshot.** The plan used bare `JSON.parse(text)`. Shipped (`report-rebuild-helpers.ts:69-90,287`) parses through a `PriorSnapshotSchema` (a strict readonly shape over `{ domains: [{ stories: [{ consolidatedId, composite }] }] }`), so a corrupt or schema-mismatched prior degrades to `null` rather than throwing. Hardening; the "return null on any failure" contract is preserved.
- **`listRoutes` lives in `src/debug/server-route-options.ts`, not `src/debug/server.ts`.** The plan/spec placed `listRoutes` directly in `server.ts`. Shipped defines it in `server-route-options.ts:122` (returning `BUILTIN_HTTP_ROUTES`) and re-exports it from `server.ts:122`, so the loader's import path (`src/debug/server.js`) still resolves. `listToolNames` similarly returns the real `BUILTIN_TOOL_NAMES` registry rather than the plan's `[]` fallback.
- **`entry-point-maps.ts` builders are synchronous.** The plan declared `buildCommandMap`/`buildToolMap`/`buildRouteMap` as `async`; shipped (`entry-point-maps.ts:19-36`) they are synchronous returning `ReadonlySet<string>`, and `closure-verifier-pipeline.ts:131-135` calls them without `await`. Behaviorally identical.
- **Test file naming split.** The plan/spec named the sidecar test `scores-file.test.ts`; shipped splits the coverage into `scores-json.test.ts` (sidecar shape, 503 lines) and `scores-markdown.test.ts` (markdown surfacing, 413 lines). All other test files (`percentile.test.ts`, `trend.test.ts`, `closure-verifier.test.ts`, `closure-verifier-pipeline.test.ts`, `consolidate-agent-schema.test.ts`, `entry-point-maps.test.ts`) ship under their planned names.

The source plan `docs/superpowers/plans/2026-07-19-behavior-audit-relative-scoring-closure-implementation.md` and design `docs/superpowers/specs/2026-07-19-behavior-audit-relative-scoring-closure-design.md` are archived alongside this ADR to `docs/archive/`.
