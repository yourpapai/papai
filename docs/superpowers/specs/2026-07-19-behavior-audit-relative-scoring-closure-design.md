<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit — Relative Scoring + Codeindex Closure Check (Tier 3)

Date: 2026-07-19
Status: Proposed (not yet implemented)

Third of three sequential specs (Tier 1 → Tier 2 → Tier 3). Tier 4 is deferred.

- **Tier 1 — Close the loop**: nightly CI, external gateway, orphan-branch publishing.
- **Tier 2 — Concurrency + grep**: remove serialization, portable grep.
- **Tier 3 — Relative scoring + closure** (this document): percentile-ranked scores, codeindex-grounded story verification.

## Problem

The behavior-audit pipeline produces per-story persona scores (Maria/Dani/Viktor ×
discover/use/retain, 1–5 each) and consolidated user stories, but:

1. **Scores are absolute grades with no context.** A story scoring "Maria: use 3/5"
   is impossible to interpret without knowing the domain's distribution. The same
   score may be top-quartile in one domain and bottom-decile in another. Today's
   reports treat `3/5` identically everywhere.
2. **Personas are LLM self-reports, not measurements.** Phase 3 asks the LLM to
   roleplay each persona and assign numbers. Two model runs on the same input
   produce different numbers. As _absolute_ grades these are scientifically weak;
   as _relative_ signals (rank within domain, trend across snapshots) they carry
   usable information.
3. **Stories are not grounded in code.** Nothing verifies that a consolidated
   "user story" describes a feature with an actual reachable entry point. The LLM
   may produce a plausible-sounding story that has no corresponding command, tool,
   handler, or route. Readers cannot tell which stories are grounded.

## Current State (as of 2026-07-19)

### Phase 3 output

`scripts/behavior-audit/evaluate-agent.ts:31-47` defines the system prompt that
asks for persona scores; `evaluate-agent.ts:49-62` defines the schema. Output flows
through `evaluate-store.ts` to `evaluated/{featureKey}.json`, then to
`report-writer.ts:writeStoryFile` (markdown per domain) and `writeIndexFile`
(top-level summary).

`report-index-helpers.ts` computes per-domain aggregates (mean scores, top flaws by
frequency, top improvements by frequency). No percentile, no rank, no trend.

### Codeindex integration (unused scaffolding)

`scripts/behavior-audit/extract-evidence.ts` and `extract-evidence-loader.ts`
implement a codeindex integration: `loadCodeindexDeps(repoRoot)` returns
`{ db, search, impact }` with `findSymbolCandidates` and `findIncomingReferences`.
The spec `2026-04-27-behavior-audit-phase1-trust-design.md` proposed wiring this
into Phase 1 extraction.

Current wiring status (verified 2026-07-19):

- `collectEvidence` is exported from `extract-evidence.ts:171`.
- `collectEvidence` is called only from `extract-phase1-evidence.ts`.
- `extract-phase1-evidence.ts` is imported only from `extract-phase1-single-test.ts`.
- `extract-phase1-single-test.ts` is a standalone debug runner, NOT part of
  `index.ts:runBehaviorAudit`.

Conclusion: codeindex infrastructure exists but is not in the live pipeline. Tier 3
revives it for a different purpose (closure verification at Phase 2b output rather
than evidence collection at Phase 1 input).

### Tier 1 dependency

Tier 1 publishes nightly snapshots to the `audit-output` orphan branch. Tier 3's
trend column reads the prior snapshot via `git show audit-output-latest:stories/scores.json`
(where `audit-output-latest` is the lightweight tag Tier 1 moves on each publish).
If Tier 1 is not yet shipped, Tier 3's trend column degrades to "no prior snapshot".

## Goals

- Reorient the persona scores as **relative signals within a domain**: percentile
  rank, bottom-decile flag.
- Add **trend across snapshots**: composite-score delta vs the previous nightly run.
- Ground each consolidated user story in actual reachable code via **codeindex closure
  check**: every story's claimed entry points are resolved to real symbols; unresolved
  stories are flagged.
- Emit a **machine-readable sidecar** `stories/scores.json` so consumers (trend
  computation, downstream tooling) don't have to parse markdown.
- Reuse existing codeindex infrastructure rather than building fresh.

## Non-goals

- Changes to the personas themselves (Maria/Dani/Viktor personas unchanged).
- Changes to Phase 3's LLM prompt or schema (the LLM still emits absolute 1–5 scores;
  relativization happens at report-write time).
- Replacing the LLM-based evaluation with code-based metrics (out of scope; the
  pipeline's value is the LLM judgment, made honest via relativization).
- Wiring codeindex into Phase 1 evidence collection (the 2026-04-27 trust spec
  remains dormant; Tier 3 uses codeindex only at the new Phase 2c step).
- Tier 4 architectural rewrite (deferred).

## Design

This tier has two largely independent parts that ship together.

### Part A: Relative-signal scoring

#### A.1 New machine-readable sidecar `stories/scores.json`

Emitted by `report-writer.ts` alongside the existing markdown. Top-level shape:

```ts
interface ScoresFile {
  readonly generatedAt: string // ISO 8601
  readonly model: string // BEHAVIOR_AUDIT_MODEL used for this run
  readonly domains: readonly DomainEntry[]
}

interface DomainEntry {
  readonly domain: string
  readonly stories: readonly StoryEntry[]
}

interface StoryEntry {
  readonly featureKey: string
  readonly consolidatedId: string
  readonly featureName: string
  readonly userStory: string
  readonly composite: number // mean of 9 sub-scores, 1–5
  readonly percentile: number // 0–100 within domain
  readonly bottomDecile: boolean // true if percentile < 10
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly trendDelta: number | null // composite vs prior snapshot, or null if no prior
  readonly closureStatus: 'resolved' | 'partial' | 'unresolved' | 'unverified'
  readonly entryPoints: readonly EntryPointEntry[]
}

interface EntryPointEntry {
  readonly kind: 'command' | 'tool' | 'handler' | 'route'
  readonly identifier: string
  readonly resolved: boolean
  readonly evidence: { readonly filePath: string; readonly symbol?: string } | null
}
```

`trendDelta` and `closureStatus`/`entryPoints` are populated by Part B and the
closure verifier respectively.

#### A.2 Percentile computation

In `report-index-helpers.ts`, add a helper:

```ts
function computePercentiles(scores: readonly number[]): readonly number[] {
  // Returns percentile (0–100) for each input, aligned by index.
  // Ties get the max rank (matches standard "percentile rank" semantics).
  // Single-element domain returns [100] (avoid flagging the only story as bottom-decile).
}
```

Within each domain, sort stories by composite score; assign percentile; flag
`bottomDecile = percentile < 10`.

Edge cases:

- Domain with 1 story: percentile 100, never bottom-decile.
- Domain with 2 stories: percentiles 67 and 33; neither is bottom-decile (need ≥10
  stories for a true bottom decile to exist).
- All-equal composite scores in a domain: every story gets percentile 100; none
  flagged.

#### A.3 Trend computation

In `report-rebuild-helpers.ts`, add:

```ts
async function loadPriorSnapshot(): Promise<ScoresFile | null> {
  // Resolve prior snapshot via:
  //   git show audit-output-latest:stories/scores.json
  // (audit-output-latest is the lightweight tag moved on each Tier 1 publish.)
  // Returns null if:
  //   - the tag doesn't exist (Tier 1 not yet shipped)
  //   - the file doesn't exist in prior snapshot (older Tier 1 run pre-Tier 3)
  //   - parsing fails (corrupt prior)
}

function computeTrendDeltas(
  current: readonly StoryEntry[],
  prior: readonly StoryEntry[] | null,
): readonly (number | null)[] {
  // Match by consolidatedId. Round composite to 1 decimal before diffing.
  // Return null for unmatched ids (newly added stories).
}
```

Trend-arrow thresholds in markdown:

- `Δ ≥ +0.3` → `↑`
- `Δ ≤ -0.3` → `↓`
- `|Δ| < 0.3` → `=` (noise filter)

The 0.3 threshold absorbs typical LLM run-to-run jitter on a 1–5 composite scale.

#### A.4 Markdown surface

Per-story markdown gains:

- `**Composite:** 3.4 (Δ ↑ +0.5 vs prior)` line if trend available.
- `**Domain rank:** 67th percentile` line.
- `⚠ Bottom decile (within {domain})` callout if flagged.

`stories/index.md` gains:

- A "Bottom decile by domain" section listing flagged stories (max 5 per domain,
  collapsible if more).
- A "Top movers" section: top 5 positive trend, top 5 negative trend across the
  whole audit.

### Part B: Closure check via codeindex

#### B.1 Schema extension to Phase 2b consolidation

In `scripts/behavior-audit/consolidate-agent.ts:45-54` (the `ConsolidationItemSchema`),
add:

```ts
entryPointHints: z.array(
  z.object({
    kind: z.enum(['command', 'tool', 'handler', 'route']),
    identifier: z.string(),
  }),
).default([])
```

The consolidate-agent system prompt (`consolidate-agent.ts:31-43`) gains one clause:

> For each user-facing story, list the entry points a user would actually trigger.
> Use `kind: "command"` for slash commands (identifier is the command text, e.g.
> "/config"). Use `kind: "tool"` for LLM-callable tools (identifier is the tool
> name, e.g. "createTask"). Use `kind: "handler"` for chat-platform message
> handlers (identifier is a symbol name or route description, e.g.
> "telegram:onTextMessage"). Use `kind: "route"` for HTTP routes (identifier is
> the path, e.g. "/api/settings"). Omit `entryPointHints` for internal-only
> consolidations.

#### B.2 New verifier `scripts/behavior-audit/closure-verifier.ts`

The verifier is a new pipeline step, designated **Phase 2c**. It runs after Phase 2b
writes `consolidated/*.json` and before Phase 3 begins. It has no LLM calls — pure
deterministic resolution.

Inputs:

- `consolidatedManifest` (from Phase 2b).
- The set of consolidated artifacts on disk.

Process (per `consolidatedId`):

1. Load `consolidated/{featureKey}.json`. Read each `ConsolidatedBehavior`'s
   `entryPointHints`.
2. For each hint, resolve by kind:
   - **command** — check whether `identifier` appears in the static command map
     (built once per audit run by enumerating `src/commands/**` exports — see B.3).
   - **tool** — check whether `identifier` appears in the static tool map
     (built once per audit run by enumerating `src/tools/**` exports).
   - **handler** — call `codeindex.search.findSymbolCandidates(identifier)` via
     `loadCodeindexDeps`; resolved if any candidate exists under `src/chat/`.
   - **route** — check whether `identifier` appears in the static route map (built
     by parsing the settings/debug server route registrations — see B.3).
3. Record per-hint `{ kind, identifier, resolved, evidence }`.
4. Compute `closureStatus`:
   - `resolved` if all hints resolved.
   - `partial` if some resolved, some not.
   - `unresolved` if no hints resolved.
   - `unverified` if the story had zero hints (LLM omitted them).
5. Write the closure results back into the consolidated artifact:
   ```ts
   interface ClosureResult {
     readonly closureStatus: 'resolved' | 'partial' | 'unresolved' | 'unverified'
     readonly entryPoints: readonly {
       readonly kind: 'command' | 'tool' | 'handler' | 'route'
       readonly identifier: string
       readonly resolved: boolean
       readonly evidence: { readonly filePath: string; readonly symbol?: string } | null
     }[]
   }
   ```
   Added to `ConsolidatedBehavior` as `closure?: ClosureResult`.

If codeindex is unavailable (`loadCodeindexDeps` returns
`{ codeindex: { enabled: false } }`), handler-kind hints are marked `resolved: false`
with `evidence: null` and a single warning is logged at verifier start. Command,
tool, and route resolution still work (they don't need codeindex).

#### B.3 Static entry-point maps

To avoid codeindex dependence for the most common kinds, build small static maps
once per audit run:

- **Command map**: import `listCommandCatalogEntries` from `src/commands/catalog.ts`
  (re-exported from `src/commands/index.ts:6`) and call it. This returns the canonical
  command list (currently `/help`, `/start`, `/config`, `/context`, `/clear`,
  `/dashboard`, `/stop`, plus active-plugin `plugin_*` commands — see
  `src/commands/CLAUDE.md`). Returns `Set<string>`.
- **Tool map**: import the tool registry / catalog from `src/tools/` (analogous to
  `listCommandCatalogEntries`; exact entry point to be resolved in implementation
  plan by inspecting `src/tools/AGENTS.md`). Returns `Set<string>` of tool names.
- **Route map**: walk the settings/debug server route registrations. Returns
  `Set<string>` of HTTP paths.

These maps are computed at Phase 2c start, cached for the verifier's lifetime.
Implementation note: parsing TS exports statically is brittle; prefer to import
the modules directly when possible (Bun supports runtime imports of `src/` from
`scripts/`).

If a static map can't be built for any reason, the corresponding kind degrades to
"unverifiable" (treated like the codeindex-unavailable case for handler kinds).

#### B.4 Wire into pipeline (`index.ts`)

Insert a new step between Phase 2b's manifest save and Phase 3's start:

```ts
// in executeSelectedBehaviorAuditWork, after saveConsolidatedManifest:
const closureManifest = await runClosureCheck({ consolidatedManifest }, { reporter })
// closureManifest has closure results written into each entry; use it for Phase 3
```

No progress-schema change. Phase 2c is a pure post-pass that doesn't need
checkpointing (it has no LLM calls, completes in seconds, and is idempotent —
re-running on the same input produces identical output).

#### B.5 Surface in reports

`report-writer.ts` reads each consolidated artifact's `closure` field and emits:

Per-story markdown:

- `**Entry points:**` section listing each hint with ✓ or ✗ prefix.
  - `✓ command: /config` (resolved, with file path tooltip)
  - `✗ tool: createFoo` (unresolved)
- If `closureStatus !== 'resolved'`:
  `⚠ Closure check: 1 of 2 entry points unresolved` callout.

Per-domain `index.md`:

- New "Closure gaps" section listing stories with `closureStatus === 'unresolved'`
  or `'partial'` (max 10 per domain, sorted by number of unresolved hints).
- Summary stat: "X of Y stories fully grounded (Z%)".

## Data Flow

```
Phase 2b → consolidated/{featureKey}.json
           (now includes entryPointHints from LLM)

Phase 2c (new) → closure-verifier.ts
                 builds static command/tool/route maps
                 uses codeindex for handler-kind hints
                 writes closure field back into each artifact

Phase 3   → evaluated/{featureKey}.json
           (unchanged; reads closure for reporting only)

report-writer → stories/{domain}.md (with percentile, trend, closure)
                stories/index.md   (with bottom-decile, top movers, closure gaps)
                stories/scores.json (new, machine-readable)
```

## Error Handling

| Failure                                                          | Behavior                                                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codeindex unavailable (`enabled: false`)                         | Verifier logs warning. Handler-kind hints marked unresolved. Command/tool/route still checked. Report notes "Codeindex unavailable; handler entry points not verified." |
| `src/commands/` or `src/tools/` missing                          | Static map for that kind is empty. All hints of that kind unresolved. Honest signal.                                                                                    |
| Consolidated artifact lacks `entryPointHints` (pre-Tier-3 cache) | `closureStatus: 'unverified'`. Markdown notes "No entry-point hints provided."                                                                                          |
| No prior snapshot for trend (`loadPriorSnapshot` returns null)   | `trendDelta: null`. Markdown omits trend column with `(no prior snapshot)` note.                                                                                        |
| Prior snapshot has different schema                              | `loadPriorSnapshot` returns null. Same as missing.                                                                                                                      |
| LLM emits zero hints for a story                                 | `closureStatus: 'unverified'`. Distinct from `unresolved` (which requires hints but no matches).                                                                        |
| Codeindex query errors                                           | Caught per-hint; that hint marked unresolved with `evidence: null`. Verifier continues.                                                                                 |

## Testing Strategy

### `scores.json` shape

Unit tests in `tests/scripts/behavior-audit/scores-file.test.ts`:

- Synthetic Phase 3 output → `ScoresFile` matches expected shape.
- Round-trip: write → read → compare.
- `closureStatus` and `entryPoints` populated correctly from synthetic closure data.

### Percentile math

Unit tests in `tests/scripts/behavior-audit/percentile.test.ts`:

- Single-element domain → percentile 100, `bottomDecile: false`.
- Two-element domain → percentiles 67/33, no bottom-decile.
- 10-element domain with one low outlier → bottom-decile flag on outlier only.
- All-equal composite scores → all percentile 100, no flags.
- Ties at the decile boundary → both flagged (max-rank semantics).

### Trend diff

Unit tests in `tests/scripts/behavior-audit/trend.test.ts`:

- Synthetic prior + current → expected `trendDelta` per story.
- Missing prior → all `trendDelta: null`.
- `consolidatedId` added in current (not in prior) → `trendDelta: null`.
- `consolidatedId` removed in current → absent from current's `trendDelta` list.
- Composite 3.4 prior vs 3.42 current → both round to 3.4 → `trendDelta: 0.0` → arrow `=`.
- Composite 3.4 prior vs 3.9 current → `trendDelta: +0.5` → arrow `↑`.

### Closure verifier

Unit tests in `tests/scripts/behavior-audit/closure-verifier.test.ts`:

- Stubbed `src/commands/` (synthetic tree) → command-kind hints resolve correctly.
- Stubbed `src/tools/` → tool-kind hints resolve correctly.
- Stubbed `codeindex.search.findSymbolCandidates` → handler-kind hints resolve or
  don't based on stubbed response.
- Codeindex unavailable → graceful degradation; warning logged.
- Zero-hint story → `closureStatus: 'unverified'`.
- All-hints-resolved story → `closureStatus: 'resolved'`.
- Mixed → `closureStatus: 'partial'`.
- All-hints-failed story → `closureStatus: 'unresolved'`.

Integration test: run the verifier against the actual papai `src/` tree, assert
that known-good stories (e.g., one with a `command: /config` hint) resolve and
known-bogus identifiers (e.g., `command: /not-a-real-command`) don't. Lives in
`tests/scripts/behavior-audit/closure-verifier-integration.test.ts`.

### Schema-migration coverage

- Loading a pre-Tier-3 `consolidated/{featureKey}.json` (no `entryPointHints`)
  via `ConsolidatedBehaviorSchema` succeeds (the field has `.default([])`).
- Loading a pre-Tier-3 file with no `closure` field succeeds (the field is
  optional/`.default(undefined)`).

### End-to-end

Existing audit integration tests now include the Phase 2c step in their pipeline
flow and assert:

- `scores.json` is emitted alongside `stories/*.md`.
- Closure status appears in the markdown for at least one story.
- No regression in Phase 1/2a/2b/3 outputs.

## Files Touched

| File                                               | Change                                                         |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `scripts/behavior-audit/consolidate-agent.ts`      | +`entryPointHints` to schema, +prompt clause                   |
| `scripts/behavior-audit/closure-verifier.ts`       | new (~150 lines)                                               |
| `scripts/behavior-audit/index.ts`                  | +Phase 2c step wiring                                          |
| `scripts/behavior-audit/report-writer.ts`          | +`scores.json` emission, +percentile/trend/closure in markdown |
| `scripts/behavior-audit/report-index-helpers.ts`   | +percentile + bottom-decile + top-movers helpers               |
| `scripts/behavior-audit/report-rebuild-helpers.ts` | +`loadPriorSnapshot` + `computeTrendDeltas`                    |
| `scripts/behavior-audit/consolidated-store.ts`     | +`closure?: ClosureResult` field, schema migration             |
| tests (multiple new + extended)                    | see Testing Strategy                                           |

## Risks and Mitigations

### Schema break for older artifacts

Pre-Tier-3 `consolidated/*.json` files lack `entryPointHints` and `closure`. The
Zod schemas use `.default([])` and `.optional()` respectively, so loading old files
succeeds. Old artifacts get `closureStatus: 'unverified'` until regenerated.

Tier 1's no-state CI policy means this only affects local-dev cached artifacts.
Document in the upgrade notes: "delete `reports/audit-behavior/consolidated/`
after upgrading to force regeneration".

### Codeindex runtime dependency

The verifier depends on codeindex being available. If codeindex is not cloned at
`../codeindex` (per `codeindex-cli-support.ts:79`) or not indexed, the verifier
degrades gracefully.

- **Mitigation**: add a preflight check at verifier start. If codeindex is
  unavailable, log a clear warning and continue with handler-kind hints marked
  unresolved. Do not fail the audit.

### Prompt regression from added clause

Adding `entryPointHints` to the Phase 2b prompt asks the LLM to do slightly more
work per consolidation. There is a small risk of degradation in story quality.

- **Mitigation**: prompt is extended minimally (one clause, clear instructions).
- **Mitigation**: spot-check the first nightly snapshot after Tier 3 ships.
  Compare a sample of stories to pre-Tier-3 baseline (from the orphan branch
  history). If quality regresses, refine the prompt.

### Trend column noise

LLM nondeterminism produces run-to-run score jitter on the order of ±0.2 on the
composite scale. The 0.3 threshold for `↑`/`↓` arrows absorbs this for most cases.

- **Mitigation**: if the noise floor turns out higher than expected after
  observing real runs, raise the threshold to 0.5.
- **Mitigation**: trend is informational, never blocking. A noisy arrow is a
  hint, not a verdict.

### Static entry-point map brittleness

Building static maps by walking `src/commands/` and parsing exports is brittle to
refactors in those directories. If the command-registration pattern changes, the
map silently produces wrong results.

- **Mitigation**: prefer runtime imports over static parsing where possible
  (Bun supports this). Where parsing is unavoidable, log a count of detected
  entries at verifier start; a sudden drop to zero is a canary.

### Tier 4 throwaway risk (now reduced)

Tier 4 was deferred at design time. If it ships later, the closure-verifier
concept and `scores.json` sidecar survive any reasonable rewrite; specific file
shapes may change. The relativization principle (percentile, trend) is
architecture-independent.

## Interactions with Other Tiers

### Tier 1 (close the loop)

Tier 3's trend column depends on Tier 1's orphan-branch snapshots. If Tier 1 has
not shipped, the trend column degrades gracefully to "no prior snapshot".

Tier 3's `scores.json` sidecar is published by Tier 1's publisher automatically
(it lives in `stories/`). No Tier 1 code change required.

### Tier 2 (concurrency + grep)

Phase 2c (closure verifier) processes each `featureKey` independently. It should
apply `pLimit(CONCURRENCY)` using the same pattern as Tier 2's other phases. The
verifier has no LLM calls so concurrency is purely I/O-bound; can safely go higher
than Tier 2's default if desired (e.g., `pLimit(CONCURRENCY * 2)`).

No grep interaction (verifier uses codeindex, not grep).

## Related Decisions

- ADR-0114 — Behavior Audit Phase 2 Redesign (Phase 2b output is the verifier's input).
- ADR-0109 — Behavior Audit Hybrid-to-Artifact Migration (canonical artifact model
  the verifier reads/writes).
- Spec `2026-04-27-behavior-audit-phase1-trust-design.md` — Phase 1 trustworthiness
  design; scaffolding exists (`extract-evidence.ts`, `extract-evidence-loader.ts`)
  but is not wired into the live pipeline. Tier 3 reuses `loadCodeindexDeps` from
  this code family for closure verification, leaving the original Phase 1 evidence
  work dormant.

## References

- Pipeline entry: `scripts/behavior-audit/index.ts`.
- Phase 2b agent: `scripts/behavior-audit/consolidate-agent.ts`.
- Report writer: `scripts/behavior-audit/report-writer.ts`.
- Codeindex loader: `scripts/behavior-audit/extract-evidence-loader.ts:79`.
- Personas: `scripts/behavior-audit/personas.ts`.
- Tier 1 spec: `2026-07-19-behavior-audit-close-the-loop-design.md`.
- Tier 2 spec: `2026-07-19-behavior-audit-concurrency-grep-design.md`.
