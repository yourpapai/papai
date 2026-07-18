<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit — Configurable Concurrency + Grep Replacement (Tier 2)

Date: 2026-07-19
Status: Proposed (not yet implemented)

Second of three sequential specs (Tier 1 → Tier 2 → Tier 3). Tier 4 is deferred.

- **Tier 1 — Close the loop**: nightly CI, external gateway, orphan-branch publishing.
- **Tier 2 — Concurrency + grep** (this document): remove `pLimit(1)` serialization in three phases; replace the grep shell-out with portable pure-JS.
- **Tier 3 — Relative scoring + closure**: percentile-ranked scores, codeindex-grounded story verification.

## Problem

The behavior-audit pipeline serializes its three most LLM-intensive phases:

- `scripts/behavior-audit/classify.ts:258` — Phase 2a, `pLimit(1)`.
- `scripts/behavior-audit/consolidate.ts:219` — Phase 2b, `pLimit(1)`.
- `scripts/behavior-audit/evaluate-runner.ts:211` — Phase 3, `pLimit(1)`.

Only Phase 1 (`extract.ts:135`) runs concurrently, at `pLimit(4)`. At ~800 test files
in scope, Phase 2a alone processes hundreds of behaviors end-to-end serialized; the
nightly Tier 1 audit is expected to spend most of its wall clock blocked on these
three phases.

Separately, `scripts/behavior-audit/tools.ts:49-78` implements the LLM-callable
`grep` tool as a shell-out to the system `grep` binary via `Bun.spawn`. This is:

- Fragile on platforms without GNU grep (BSD/macOS `grep -E` differs subtly).
- Inconsistent with the repo's tooling conventions (AGENTS.md directs the agent
  itself to prefer dedicated tools over shelling out).
- Untestable without spawning real processes.

## Current State (as of 2026-07-19)

### Concurrency

| File                                              | Line | Phase            | Limit       |
| ------------------------------------------------- | ---- | ---------------- | ----------- |
| `scripts/behavior-audit/extract.ts`               | 135  | Phase 1          | `pLimit(4)` |
| `scripts/behavior-audit/extract-phase1-runner.ts` | 202  | Phase 1 per-file | `pLimit(1)` |
| `scripts/behavior-audit/classify.ts`              | 258  | Phase 2a         | `pLimit(1)` |
| `scripts/behavior-audit/consolidate.ts`           | 219  | Phase 2b         | `pLimit(1)` |
| `scripts/behavior-audit/evaluate-runner.ts`       | 211  | Phase 3          | `pLimit(1)` |

The `pLimit(1)` calls in 2a/2b/3 are not correctness requirements; they are
cautious defaults that mask write-race risk in shared state.

### Write-race surface

The reason `pLimit(1)` works today is that each per-item completion does
read-modify-write on shared state. With concurrency > 1, these races corrupt artifacts:

- **Phase 2a** (hardest case): `writeClassifiedFile` is per-test-file
  read-modify-write. Multiple behaviors from the same test file race on the same
  `classified/{file}.json`. Additionally, `saveManifest` and `saveProgress` write
  to single shared JSON files.
- **Phase 2b**: `writeConsolidatedFile` writes one file per `featureKey`; no
  within-phase file race. Only `saveProgress` and `saveConsolidatedManifest` are shared.
- **Phase 3**: `writeEvaluatedFile` writes one file per `featureKey`; only
  `saveProgress` and `saveConsolidatedManifest` are shared.

### Grep tool

```ts
// scripts/behavior-audit/tools.ts:49-78 (simplified)
function makeGrepTool() {
  return tool({
    description: 'Search for a regex pattern in src/ and tests/...',
    execute: async ({ pattern, directory }) => {
      const args = ['-rn', '--include=*.ts', '-E', pattern, ...dirs]
      const proc = Bun.spawn(['grep', ...args], { cwd: PROJECT_ROOT, ... })
      // ... format output, cap at 100 matches
    },
  })
}
```

## Goals

- Make Phase 2a, 2b, and 3 concurrency configurable via a single env var.
- Eliminate write races on shared state without serializing the LLM call (the expensive part).
- Replace the grep shell-out with a portable pure-JS implementation that produces
  identical output to GNU grep for the inputs the LLM realistically emits.
- Preserve all existing test behavior with `CONCURRENCY=1` (identical to today's `pLimit(1)`).

## Non-goals

- Changes to the schema, manifest format, progress format, or output artifacts.
- Changes to Phase 1's existing `pLimit(4)` (already concurrent).
- Changes to the per-test-file runner's `pLimit(1)` in `extract-phase1-runner.ts:202`
  (correctly serializes behaviors within a single extracted file).
- 429 / rate-limit-specific retry handling (existing retry logic in each agent already
  applies uniformly; a future tier may add rate-limit-aware backoff).
- Tier 4 architectural rewrite (deferred).

## Design

### 1. New config knob `CONCURRENCY`

In `scripts/behavior-audit/config.ts`:

```ts
export let CONCURRENCY = 4
// in reloadBehaviorAuditConfig():
CONCURRENCY = resolveNumberOverride('BEHAVIOR_AUDIT_CONCURRENCY', 4)
```

Default of 4 matches Phase 1's existing setting and is well within typical cloud-gateway
rate limits. Documented as "tune down on 429s; tune up on private/self-hosted gateways".

### 2. New helper `scripts/behavior-audit/async-mutex.ts`

A per-key async mutex. Pure TypeScript, no dependencies, fully unit-testable.

```ts
export interface AsyncMutex {
  <T>(key: string, task: () => Promise<T>): Promise<T>
}

export function createAsyncMutex(): AsyncMutex {
  const chains = new Map<string, Promise<unknown>>()
  return async (key, task) => {
    const prev = chains.get(key) ?? Promise.resolve()
    const next = prev.then(() => task())
    chains.set(
      key,
      next.then(undefined, () => {}),
    ) // swallow to keep chain alive on error
    try {
      return await next
    } finally {
      // optional: prune idle keys (omitted for simplicity; map is bounded by key space)
    }
  }
}
```

Each phase creates one mutex instance at phase start. Keys are scoped to that phase.

### 3. Refactor Phase 2a writes (`classify.ts`)

The race surface in Phase 2a:

- `writeClassifiedFile(testFilePath, ...)` — per-test-file race (multiple behaviors
  per file).
- `saveManifest(updatedManifest)` — single shared manifest.
- `saveProgress(progress)` — single shared progress.

In `processSelectedClassification` (currently at `classify.ts:136-168`), wrap each
write in a keyed mutex:

```ts
// inside persistSuccessfulClassification, replacing direct calls:
await mutex(`classified:${testFilePath}`, () => writeSingleClassification(...))
const updatedManifest = updateManifestForClassification(input.manifest, classified, behavior)
await mutex('manifest', () => input.deps.saveManifest(updatedManifest))
await mutex('progress', () => input.deps.saveProgress(input.progress))
return updatedManifest
```

Replace `const limit = pLimit(1)` at `classify.ts:258` with `pLimit(CONCURRENCY)`.

Critical detail: `input.manifest` passed to each task is the SAME starting manifest
object (not the latest). Each task returns its own `updatedManifest`, which is
currently assigned back to `currentManifest = result.manifest`. At concurrency > 1
this assignment races.

Fix: change the per-task return shape from `{ manifest: IncrementalManifest }` to
`{ manifestDelta: ManifestDelta }` where `ManifestDelta` is `{ testKey, entry }`.
After all tasks complete, merge all deltas into the starting manifest in a single
serial pass, then save once. This eliminates the `currentManifest` shared-state
assignment entirely.

### 4. Refactor Phase 2b writes (`consolidate.ts`)

Race surface: only `saveProgress` and `saveConsolidatedManifest` are shared.

```ts
await mutex('progress', () => input.deps.saveProgress(input.progress))
await mutex('consolidated-manifest', () => input.deps.saveConsolidatedManifest(updatedManifest))
```

`writeConsolidatedFile` writes a unique file per `featureKey` so no mutex is needed
on the file write itself.

Replace `const limit = pLimit(1)` at `consolidate.ts:219` with `pLimit(CONCURRENCY)`.

The Phase 2b manifest-update pattern (`currentManifest = result.manifest`) has the
same shared-state assignment race as Phase 2a. Apply the same delta-merge fix.

### 5. Refactor Phase 3 writes (`evaluate-runner.ts`)

Race surface: only `saveProgress` and `saveConsolidatedManifest` are shared. Same
pattern as Phase 2b.

Replace `const limit = pLimit(1)` at `evaluate-runner.ts:211` with `pLimit(CONCURRENCY)`.

Phase 3 also performs an end-of-phase report write via `writeReports(...)`. This
already happens after all tasks complete (in `persistPhase3Outputs` in `evaluate.ts:96-112`),
so it's race-free. No mutex needed.

### 6. Replace grep tool with pure-JS implementation (`tools.ts`)

New `makeGrepTool`:

```ts
import { Glob } from 'bun'
import { resolve, relative, join } from 'node:path'

// module-level cache: lazily populated, lives for the audit process lifetime
interface CachedFile {
  readonly text: string
}
const fileCache = new Map<string, CachedFile>()

async function readCached(absPath: string): Promise<string> {
  const hit = fileCache.get(absPath)
  if (hit !== undefined) return hit.text
  const text = await Bun.file(absPath).text()
  fileCache.set(absPath, { text })
  return text
}

function resetFileCache(): void {
  fileCache.clear()
}

async function enumerateTsFiles(dirs: readonly string[]): Promise<readonly string[]> {
  const out: string[] = []
  for (const dir of dirs) {
    const abs = resolve(PROJECT_ROOT, dir)
    for await (const path of new Glob('**/*.ts').scan({ cwd: abs, absolute: true })) {
      out.push(path)
    }
  }
  return out
}

function makeGrepTool(): ToolSet[string] {
  return tool({
    description: 'Search for a regex pattern in src/ and tests/. Returns matching lines as "file:line:content".',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      directory: z.string().optional().describe('Subdirectory to search within (default: src/ and tests/'),
    }),
    execute: async ({ pattern, directory }): Promise<string> => {
      const dirs = resolveGrepDirectories(directory)
      if (dirs === null) return `Error: directory "${directory}" resolves outside project`
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'u')
      } catch (err) {
        return `Error: invalid regex: ${err instanceof Error ? err.message : String(err)}`
      }
      const files = await enumerateTsFiles(dirs)
      const matches: string[] = []
      for (const file of files) {
        const text = await readCached(file)
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            matches.push(`${relative(PROJECT_ROOT, file)}:${i + 1}:${lines[i]}`)
            if (matches.length >= 100) {
              return matches.join('\n')
            }
          }
        }
      }
      return matches.length > 0 ? matches.join('\n') : 'No matches found'
    },
  })
}
```

The cache is cleared at the start of each audit run via a small hook from `index.ts`
(or by relying on process restart — each `bun audit:behavior` invocation is a fresh
process). Cache key is the absolute file path; cache value is the file text.

`enumerateTsFiles` uses `Bun.Glob` (built into Bun, available since 1.x). File
ordering is filesystem-dependent; this matches `grep -rn` behavior (also
filesystem-dependent).

### 7. Cap file cache memory

The cache holds ~800 files × ~10KB average = ~8MB. Negligible. No eviction logic
needed. If the audit is ever extended to scan larger trees, revisit.

## Data Flow

Phase data flow is unchanged from before. Tier 2 only changes:

- The fan-out width of Phase 2a, 2b, 3 (config-driven).
- How shared-state writes are serialized after each LLM call.
- The internal implementation of the LLM-callable `grep` tool.

Per-item flow inside Phase 2a:

```
limit(N) slot acquired
  → LLM call (the expensive part; no shared state touched)
  → keyed mutex on classified:{testFilePath}  →  write classified JSON
  → manifest delta recorded (no shared assignment)
  → keyed mutex on progress                  →  save progress
limit slot released
--- after all tasks complete ---
merge all manifest deltas into starting manifest
save manifest once
```

## Error Handling

| Failure                             | Behavior                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Mutex task throws                   | Error propagates to caller; mutex chain continues (the next acquisition still runs).        |
| Invalid regex from LLM              | Returns `Error: invalid regex: ...` to the LLM (matches current `grep -E` failure surface). |
| Glob scan fails (permission denied) | Returns `Error enumerating files: ...` to the LLM.                                          |
| Cloud gateway 429                   | Existing per-agent retry/backoff handles it. Concurrency stays at configured level.         |
| Concurrency set to 0 or negative    | `reloadBehaviorAuditConfig` falls back to default 4 (via `Number.isFinite` + positivity).   |

No new error paths. All existing retry, timeout, and progress-checkpoint behavior
is preserved.

## Testing Strategy

### `async-mutex.ts` — pure unit tests

- Single-key tasks execute serially.
- Distinct-key tasks execute in parallel.
- Error in one task does not break the chain for subsequent acquisitions of the same key.
- Return values propagate correctly.

Tests live in `tests/scripts/behavior-audit/async-mutex.test.ts`.

### Phase 2a/2b/3 concurrency

Existing tests must pass unchanged with `CONCURRENCY=1`. Add new tests for `CONCURRENCY=4`:

- **Phase 2a**: inject a fake `classifyBehaviorWithRetry` that returns deterministic
  but order-sensitive results (e.g., behavior id embedded in the response). Run the
  phase with concurrency 4. Assert:
  - The final manifest contains all expected entries.
  - For two behaviors sharing the same test file, both appear in the final
    `classified/{file}.json` (no overwrite).
- **Phase 2b / Phase 3**: similar pattern. The shared-state writes are simpler (no
  per-file race), so the test focuses on manifest-delta merge correctness.

### Grep replacement

A new test file `tests/scripts/behavior-audit/tools-grep.test.ts` with a fixture
directory:

- Identical output to old shell `grep` on a known fixture for a sample of patterns.
- Invalid regex returns error string (not throw).
- Directory resolving outside project returns error string.
- 100-match cap is enforced.
- Cache hit on second call with same directory returns identical results.

The fixture directory is a small synthetic tree under
`tests/scripts/behavior-audit/fixtures/grep-sample/` with ~5 `.ts` files of known
content. Avoids depending on the real `src/` tree (which changes over time).

### Regression coverage

Existing 219 behavior-audit tests (`bun test tests/scripts/behavior-audit/`) must
pass with `CONCURRENCY=1`. This is the primary regression guarantee.

## Files Touched

| File                                                 | Change                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `scripts/behavior-audit/config.ts`                   | +`CONCURRENCY` knob, +env read                            |
| `scripts/behavior-audit/async-mutex.ts`              | new (~30 lines)                                           |
| `scripts/behavior-audit/classify.ts`                 | wrap writes in mutex; delta-merge manifest; swap `pLimit` |
| `scripts/behavior-audit/consolidate.ts`              | wrap writes in mutex; delta-merge manifest; swap `pLimit` |
| `scripts/behavior-audit/evaluate-runner.ts`          | wrap writes in mutex; delta-merge manifest; swap `pLimit` |
| `scripts/behavior-audit/tools.ts`                    | rewrite `makeGrepTool`, add cache + glob helpers          |
| `tests/scripts/behavior-audit/async-mutex.test.ts`   | new                                                       |
| `tests/scripts/behavior-audit/tools-grep.test.ts`    | new                                                       |
| `tests/scripts/behavior-audit/fixtures/grep-sample/` | new fixture tree                                          |
| existing phase tests                                 | extend with `CONCURRENCY=4` variants                      |

## Risks and Mitigations

### Crash-recovery granularity

Previously, every successful item wrote progress immediately, so a crash lost at most
one item's worth of work. With concurrency + delta-merge, progress is still saved per
item (the mutex on `'progress'` serializes each save), so crash-recovery granularity
is unchanged.

The manifest save moves from per-item to per-phase-end. A crash mid-phase loses the
manifest delta for that phase (but progress is intact, so the next run reprocesses
those items). Acceptable: items are idempotent.

### Gateway rate limits

Cloud gateways return 429 on burst traffic. Default `CONCURRENCY=4` is conservative
for OpenRouter / OpenAI / Anthropic. The existing per-agent retry/backoff
(`extract-agent.ts:98-109`, etc.) handles transient 429s. If a gateway is
particularly restrictive, the user sets `BEHAVIOR_AUDIT_CONCURRENCY=2` or `1` and
behavior is identical to today.

### Memory cost of file cache

~800 files × ~10KB = ~8MB. Negligible on any runner. If the audit is ever extended
to scan much larger trees, add an LRU eviction policy. Document as a future concern.

### Grep output divergence from GNU grep

The pure-JS implementation uses `RegExp(pattern, 'u')` (Unicode mode). GNU `grep -E`
uses POSIX ERE. The two differ on edge cases (e.g., backreferences, look-ahead).
The LLM-callable tool is used by the audit agents for ad-hoc exploration; the
patterns emitted are simple (`/config`, `function\\s+createTask`, etc.). Risk of
divergence on realistic inputs is low.

- **Mitigation**: the grep-replacement test suite includes a "realistic patterns"
  set drawn from observed audit-tool invocations in development runs.

### Tier 4 throwaway risk

Tier 4 (deferred) may rewrite the phase structure entirely. The mutex helper and
grep tool would survive (general-purpose utilities); the per-phase refactor (delta
merge) would likely be thrown away. Acceptable: Tier 2's value is delivered nightly
until Tier 4 ships.

## Interactions with Other Tiers

### Tier 1 (close the loop)

Tier 1's nightly workflow needs no change for Tier 2. To opt into higher concurrency
in CI, add `BEHAVIOR_AUDIT_CONCURRENCY: '4'` to the workflow's `Run audit` step env
block. Default is already 4, so this is a no-op unless tuning.

### Tier 3 (relative scoring + closure)

Tier 3 adds a new Phase 2c (closure verifier) that runs between Phase 2b and Phase 3.
Phase 2c is itself per-featureKey and benefits from the same concurrency treatment.
Tier 3 will apply `pLimit(CONCURRENCY)` to its own work, reusing the same pattern.

The grep tool replacement has no interaction with Tier 3 (Tier 3's verifier uses
codeindex, not grep).

## Related Decisions

- ADR-0114 — Behavior Audit Phase 2 Redesign (established the phase split Tier 2 optimizes).
- ADR-0103 — Behavior Audit Keyword Consolidation (Phase 1b is unaffected by Tier 2).
- ADR-0110 — Behavior Audit Legacy Cleanup (cleaned up dead code; Tier 2 doesn't
  reintroduce any).

## References

- Pipeline entry: `scripts/behavior-audit/index.ts`.
- Phase entry points: `extract.ts`, `classify.ts`, `consolidate.ts`, `evaluate.ts`.
- Concurrency primitive in use: `p-limit` (`package.json`).
- Repo concurrency guidance: AGENTS.md ("Use `p-limit` for bounded concurrency over
  remote ops, not unbounded `Promise.all`").
