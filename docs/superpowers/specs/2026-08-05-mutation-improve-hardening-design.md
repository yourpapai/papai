<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation-Improve Runner — Hardening (PR #222 Deferred Items)

**Date:** 2026-08-05
**Status:** Design — approved (pending implementation plan)
**Type:** Tooling hardening, test-only + two small source edits; no papai runtime changes

## Summary

PR #222 landed the autonomous `mutation-improve` runner and listed four
non-blocking deferred items from its final review. One — `--reset-worktree`
being parsed but not consumed — is **already resolved** on the `mutation-improve-09`
branch (commit `70684ef7b` wired it to `resetRunWorktrees`; tested in
`tests/mutation-improve/cli.test.ts:43`). This spec designs the remaining three,
bundled as a single hardening PR:

1. **Parser coverage** — `parseCliArgs` has real uncovered branches.
2. **Score-reader retry fragility** — `score-reader.ts:34` decides whether to
   retry by regex-matching error-message *wording* emitted by a foreign module
   (`scripts/mutation/json-readers.ts`); if that wording drifts, the retry
   silently stops firing.
3. **Cross-workspace coupling unguarded** — `mutation-improve` consumes a broad
   surface of `review-loop/src/*`. TypeScript catches removed/renamed symbols at
   compile time, but there is no guard against **behavioral drift** (review-loop
   changes a return shape while keeping the name), and `contracts.test.ts`
   currently only tests the two Zod schemas — it does not pin the review-loop
   surface at all.

## Why this shape

- **Bundle all three** (chosen) — they are all hardening of one workspace, each
  small, and a single spec/plan/PR keeps review surface small. The
  cross-workspace item stays proportionate (contract guard, no new workspace)
  rather than escalating to a shared `harness/` package that would touch
  review-loop heavily for a non-blocking follow-up.
- **Reuse existing test files** (chosen) — parser cases extend the existing
  `cli.test.ts` describe block; the cross-workspace guard extends the existing
  `contracts.test.ts`. No new test files unless a split is forced by size.
- **Decouple by type, not by string** (chosen) — the retry decision is a control
  that should not depend on a sibling module's prose. A typed error plus a
  structured FS error-code check removes the wording dependency entirely.

## Non-goals

- No change to `mutation-improve` runtime behavior (gates, pipeline order,
  config, prompts). The retry's *trigger conditions* are preserved exactly;
  only the *mechanism* of detecting them changes.
- No new `harness/` shared workspace, no facade module in `mutation-improve/src`.
- No rework of `pipeline.ts`'s DI ports — they already insulate the pipeline
  from concrete review-loop functions. The composition root (`cli.ts`) keeps its
  direct imports; that is where concrete imports belong.
- No changes under `src/`, `client/`, or `plugins/`.

## Stream 1 — Parser coverage

`parseCliArgs` (`mutation-improve/src/cli.ts:52`) is a hand-rolled loop with
several branches the current tests do not reach:

| Uncovered branch | Trigger |
| --- | --- |
| unknown-arg throw | any arg not matching a known flag (`cli.ts:91`) |
| `readValueArg` missing-value throw | `--config` / `--count` / `--base` / `--resume-run` as the last token (`cli.ts:48`) |
| non-integer `--count` | `--count 3.5`, `--count abc` (`cli.ts:64`) |
| non-numeric `--threshold=` | `--threshold=abc` (`cli.ts:70`) — currently `Number(...)` yields `NaN` and silently sets `config.threshold = NaN` |
| default config path | no `--config` → `flags.configPath === DEFAULT_CONFIG_PATH` (`cli.ts:53`) |

The `NaN`-threshold case is a genuine latent bug: `NaN` flows into
`config.threshold` and every `>= threshold` comparison in the pipeline becomes
`false`, so gate ⑤ rejects every iteration. The fix is to validate after
`Number(...)` in the parser (throw on `NaN`), consistent with how `--count`
already validates.

### Design

Extend the existing `describe('cli parseCliArgs')` block in
`tests/mutation-improve/cli.test.ts` with one test per row above. Add the
`NaN`-guard to `parseCliArgs` (`--threshold=` branch) so the parser throws on
non-numeric thresholds, mirroring the `--count` integer check. No new files.

## Stream 2 — Score-reader retry decoupling

`measureMutationScore` (`mutation-improve/src/score-reader.ts:19`) runs the
Stryker command then reads the per-file report. On a read failure it retries
once. Today it decides retry-worthiness by testing the caught error's message:

```ts
if (/enoent|malformed|must contain a stryker/iu.test(message)) { ... retry ... }
```

Two problems:

- **Foreign wording dependency.** `must contain a Stryker JSON report object` is
  emitted by `readStrykerReport` in `scripts/mutation/json-readers.ts:24`; `ENOENT`
  comes from Node's `fs.readFileSync`. Both are outside score-reader's control.
  A routine rephrasing of the sibling error silently disables the retry.
- **Dead alternative.** The `malformed` token matches nothing any code path
  throws today (`JSON.parse` SyntaxErrors read `Unexpected token…`), so it is
  misleading dead weight.

### Design

Introduce a typed error and a structured FS check; remove the regex entirely.

1. **New error class** `ReportReadError` in `scripts/mutation/json-readers.ts`,
   thrown by `readStrykerReport` whenever `isStrykerReport` returns false
   (replaces the current plain `Error`). Exported for cross-module `instanceof`
   use. Kept in `json-readers.ts` because that is the module that decides report
   validity — it owns the failure mode it signals.
2. **score-reader retry predicate** becomes:

   ```ts
   function isRetryable(error: unknown): boolean {
     if (error instanceof ReportReadError) return true
     return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'
   }
   ```

   - `ReportReadError` → wrong report shape → retry (preserves today's behavior
     for the `must contain a Stryker` path).
   - `err.code === 'ENOENT'` → report file missing → retry (preserves today's
     `enoent` path, robustly, via Node's stable `.code` rather than message text).
   - `JSON.parse` SyntaxError and any other error → propagate (unchanged).
   - Non-zero Stryker exit already throws `mutation run failed (exit N)` and
     bypasses the retry predicate — unchanged.

Behavior is preserved exactly (same inputs retry, same inputs propagate); only
the coupling to sibling prose is removed.

### `readJsonRecord`

`readJsonRecord` (same file) also throws a plain `Error` on a non-record. It is
not on score-reader's path, so it is **not** changed to `ReportReadError` — that
would widen the typed-error surface beyond the retry use case. Left as-is.

## Stream 3 — Cross-workspace coupling guard

`mutation-improve` imports across the workspace boundary in three places:

- `cli.ts` (composition root): `runAgent`, `createShellExec`,
  `runBuildCheck`, `LiveRenderer`, `realSpawn`, `createWorktree`, `execGit`,
  `mergeWorktree`, `removeWorktree`, `resetWorktree`.
- `config.ts`: `detectGitRoot`.
- `pipeline.ts` (type-only): `AgentRunResult`, `MergeResult`.

`pipeline.ts` already consumes these through its own `PipelineDeps` interface,
so the pipeline body is insulated; the concrete imports live in `cli.ts`, which
is exactly where they belong. TypeScript makes symbol removal/rename a
compile error already. The genuine unguarded gap is **behavioral drift**:
review-loop keeps the symbol name but changes its signature or return shape in a
way mutation-improve relies on, and mutation-improve gets no signal in its own
gate. `contracts.test.ts` today only exercises the two Zod schemas and provides
no such signal.

### Design

Repurpose `contracts.test.ts` into a real cross-workspace contract guard with
two tiers:

**Tier A — behavioral (cheap, no externals).** Exercise the symbols that can be
run without `git` or `opencode`:

- construct `new LiveRenderer(sink)` and call `.log(msg)`; assert it does not
  throw and writes through to the sink.
- round-trip `createShellExec` + `runBuildCheck` in a fresh temp dir against a
  trivially-passing command (e.g. `true`); assert `{ passed: true }`.

These pin behavior directly and catch signature drift the compiler might miss
(e.g. a renamed option field).

**Tier B — surface inventory (for the heavy-external symbols).** For
`runAgent`, `realSpawn`, `createWorktree`, `execGit`, `mergeWorktree`,
`removeWorktree`, `resetWorktree`, `detectGitRoot` — which require real git or a
spawned `opencode` subprocess and so cannot be exercised cheaply — assert:

- symbol is defined (`typeof x === 'function'`, or constructable for `LiveRenderer`),
- function arity (`x.length`) matches what `cli.ts`/`pipeline.ts` call with.

These are weak on their own but make the consumed surface explicit and fail
loudly on removal/rename/arity drift. Each assertion carries a comment naming
`review-loop`'s own suite (under `tests/review-loop/`) as the behavioral
authority for these functions — the contract here is existence and call-shape,
not full behavior.

The file keeps its existing Zod-schema tests; the new `describe` block is added
alongside them. No source changes in this stream — `cli.ts` keeps its direct
imports (no facade). The guard is a test, not an adapter.

### Why not a facade / shared workspace

- **Facade (`harness.ts`)** would relocate imports `cli.ts` already legitimately
  owns as composition root; the marginal compile-time benefit over the direct
  imports (which TS already checks) is low, and it adds an indirection layer.
- **Shared `harness/` workspace** is the correct long-term answer if a third
  consumer appears, but it touches review-loop heavily and is out of proportion
  for a non-blocking follow-up. Noted as future work.

## Testing strategy

All new tests live under `tests/mutation-improve/` (the workspace's TDD gate).
No real `git`, `opencode`, or Stryker in the suite (matches existing hermetic
conventions; uses `makeTempDir` from `./test-helpers.ts`).

- **cli.test.ts** — the five new parser cases plus the `NaN`-guard.
- **score-reader.test.ts** — extend the existing fixtures with: report-missing
  (`ENOENT`) → retries then succeeds; wrong-shape report → `readStrykerReport`
  throws `ReportReadError` → retries then succeeds; a plain `Error` (non-typed,
  non-ENOENT) → does **not** retry, propagates. Keeps the existing
  valid-report and malformed-fallback cases.
- **contracts.test.ts** — Tier A behavioral + Tier B inventory, in a new
  `describe('review-loop surface contract')` block.
- **json-readers** — `readStrykerReport` has no dedicated test home today (it is
  only covered transitively via `tests/scripts/mutation/paired-run.test.ts`,
  which uses a *local* stub of the same name, and via score-reader). The
  `ReportReadError` throw on a non-report is asserted directly in the
  **score-reader** suite (it already imports `readStrykerReport` and is the
  boundary that relies on the typed contract): call `readStrykerReport` on a
  fixture that parses but is not a Stryker report, assert it throws an
  `instanceof ReportReadError`.

## Verification

- `bun run mutation-improve:test` (44 → 4x+ new cases) green.
- `bun test scripts/mutation` (json-readers change) green.
- Root `bun check:full` (lint/typecheck/format/knip) clean.
- The retry behavior-change is verified by the new score-reader cases asserting
  retry-fires and retry-skips against typed/ENOENT/plain errors — no behavioral
  regression vs. the regex path.

## Risk & notes

- **Behavioral preservation (Stream 2).** The retry's trigger set is unchanged
  by construction: the design enumerates each current trigger and maps it to a
  typed/`.code` equivalent. The new score-reader tests are the proof.
- **Contract-test strength (Stream 3).** Tier B is intentionally weak
  (existence/arity); the spec says so explicitly rather than overselling it as a
  full behavioral guarantee. The honest claim is "drift in the consumed surface
  now fails loudly in mutation-improve's own gate," not "review-loop is fully
  pinned."
- **`ReportReadError` export surface.** Adding an exported class to
  `scripts/mutation/json-readers.ts` is the one new public symbol; it is
  consumed only by `score-reader.ts`. Knip must see both the export and the
  import or it will flag the class as unused — the wiring lands together.
- **`--reset-worktree`** is intentionally out of scope: already shipped on this
  branch.
