<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent Check-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every check run leave a durable, queryable artifact, so an agent answers N follow-up questions from one run instead of paying ~6 minutes per question; then narrow the inner loop, remove the 18 environmental false failures, and take the 110-second file off the suite's critical path.

**Architecture:** A new `scripts/test/` module tree. Pure parsers (`junit.ts`, `console-log.ts`, `join.ts`, `fingerprint.ts`, `mode.ts`, `import-graph.ts`, `affected.ts`) with all IO injected; two thin CLI entry points (`run.ts`, `query.ts`) that wire real collaborators. `bun run test` becomes `scripts/test/run.ts`; bare `bun test` stays Bun's builtin and is the escape hatch. Everything downstream (query commands, `test:affected`, the privacy-contract gate) reads `reports/test/last-run.json` and never spawns a test run.

**Tech Stack:** Bun runtime, `bun:test`, Zod v4 for the report schema, `Bun.spawn` for the child, `Bun.Glob` for scanning. No new dependencies.

**Design spec:** [`docs/superpowers/specs/2026-08-09-agent-check-loop-design.md`](../specs/2026-08-09-agent-check-loop-design.md)
**Research:** [`docs/research/2026-08-09-agent-check-loop-efficiency.md`](../../research/2026-08-09-agent-check-loop-efficiency.md)

## Global Constraints

- **Strict TypeScript, `.js` import extensions, no lint-disable/type-ignore comments.** SPDX BUSL-1.1 header on every new `.ts` file (copy verbatim from `scripts/ensure-client-built.ts:1-4`).
- **TDD:** every task writes the failing test first, runs it red, implements, runs green, commits. `scripts/` is not a gateable root for the TDD write-hook, so nothing enforces this — do it anyway.
- **Pure core, injected IO.** Parsers take strings and return data; nothing under `scripts/test/` reads the filesystem except `report.ts`'s explicit read/write functions and the two CLI `main()`s. This is what makes the join testable against recorded fixtures.
- **Reuse, don't duplicate:** `classifyTestLane` / `buildCoverageArgs` from `scripts/mutation/coverage-runner.ts`; `listCandidateTests` from `scripts/mutation/coverage-map.ts` (Task 12 exports it); `findTestFile` / `isTestFile` / `isGateableImplFile` from `.hooks/tdd/test-resolver.mjs`; `ensureClientBuilt` from `scripts/ensure-client-built.ts`. Do not reimplement any of them.
- **Query commands must never spawn a test run.** Asserted explicitly in tests (Task 8).
- **Exit-code fidelity:** the wrapper exits with the child's code, unchanged. Query commands exit `0` regardless of the run's outcome, and `3` only when no usable report exists.
- **Fail open on reads, fail closed on gates.** A corrupt report degrades a query to "run the suite first"; it never lets the privacy-contract gate pass.
- **Never filter `last-run.log`.** It is stored byte-complete. Noise is removed at the source (Tasks 15–18), never by dropping bytes from the captured log.
- **Measured constants** (do not re-derive): fingerprint over 3,362 files = ~115 ms; import graph over 3,124 files = < 1 s; affected depth 2 = p50 0.5 % of the suite, 0 % empty; full suite = ~6 min at 4 vCPU.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/test/paths.ts` | `REPORT_DIR`, `LAST_RUN_LOG`, `LAST_RUN_JUNIT`, `LAST_RUN_JSON`, `PREVIOUS_RUN_*`, `CHECKS_DIR` |
| `scripts/test/fingerprint.ts` | `computeFingerprint(deps)` — size+mtime hash over the source roots |
| `scripts/test/junit.ts` | `parseJUnit(xml): JUnitRun` — testsuites → per-file ordered testcases |
| `scripts/test/console-log.ts` | `segmentLog(text): LogSegment[]` — file sections and `(fail)` blocks with byte offsets |
| `scripts/test/join.ts` | `joinFailures(junit, segments): { failures, joinWarnings }` |
| `scripts/test/report.ts` | `RunReportSchema` (Zod), `buildReport`, `readReport`, `writeReport` |
| `scripts/test/mode.ts` | `selectMode`, `parseWrapperArgs` — pure argv/mode decisions |
| `scripts/test/run.ts` | wrapper CLI (`bun run test`) |
| `scripts/test/query.ts` | `renderStatus`/`renderFailures`/`renderShow`/`renderLog`/`renderSlowest` + CLI dispatch |
| `scripts/test/import-graph.ts` | `buildReverseGraph`, `resolveSpecifier`, `reachableTests` |
| `scripts/test/affected.ts` | `selectAffected` (pure) + `runAffected` CLI |
| `scripts/analytics/privacy-contract-gate.ts` | 17-control gate reading `last-run.json` |
| `tests/scripts/test/*.test.ts` | one companion per module |
| `tests/scripts/test/fixtures/**` | recorded Bun JUnit + console output (the join contract) |

---

## Task 1: `paths.ts` + `fingerprint.ts`

**Files:**
- Create: `scripts/test/paths.ts`, `scripts/test/fingerprint.ts`
- Create: `tests/scripts/test/fingerprint.test.ts`

**Interfaces:**
```ts
// paths.ts — all repo-relative
export const REPORT_DIR = 'reports/test'
export const CHECKS_DIR = 'reports/checks'
export const LAST_RUN_LOG = 'reports/test/last-run.log'
export const LAST_RUN_JUNIT = 'reports/test/last-run.junit.xml'
export const LAST_RUN_JSON = 'reports/test/last-run.json'
export const PREVIOUS_RUN_JSON = 'reports/test/previous-run.json'

// fingerprint.ts
export const FINGERPRINT_ROOTS: readonly string[] = [
  'src/**/*.ts', 'client/**/*.{ts,svelte}', 'plugins/**/*.ts',
  'tests/**/*.ts', 'scripts/**/*.ts',
]
export const FINGERPRINT_FILES: readonly string[] = ['bunfig.toml', 'package.json', 'bun.lock']
export interface FingerprintDeps {
  scan: (pattern: string) => Iterable<string>
  stat: (relPath: string) => { size: number, mtimeMs: number } | null
}
export function computeFingerprint(deps: FingerprintDeps): string   // 16-hex-char prefix of sha256
export function defaultFingerprintDeps(cwd: string): FingerprintDeps
```

- [ ] **Step 1: Write `tests/scripts/test/fingerprint.test.ts` (red)** — with an injected in-memory `scan`/`stat`:
  - stable across two calls on identical input;
  - changes when a file's `size` changes, when `mtimeMs` changes, when a path is added, and when a path is removed;
  - order-independent (shuffled `scan` output yields the same digest — sort inside);
  - a `stat` returning `null` (file vanished between scan and stat) is skipped, not thrown on.
- [ ] **Step 2: Implement both modules.** Sort entries before hashing. Hash `path + '\0' + size + '\0' + mtimeMs + '\n'` per entry into one `Bun.CryptoHasher('sha256')`; return `digest('hex').slice(0, 16)`.
- [ ] **Step 3: Run green; commit.**

---

## Task 2: `junit.ts` — parse Bun's JUnit output

**Files:**
- Create: `scripts/test/junit.ts`
- Create: `tests/scripts/test/junit.test.ts`
- Create: `tests/scripts/test/fixtures/junit-basic.xml`, `fixtures/junit-nested.xml`, `fixtures/junit-empty.xml`

**Interfaces:**
```ts
export interface JUnitCase {
  file: string          // repo-relative, normalized
  name: string          // leaf test name
  suitePath: string[]   // outermost → innermost, un-reversed and unescaped
  ms: number
  line: number | null
  failed: boolean
}
export interface JUnitRun {
  totals: { tests: number, failures: number, skipped: number, assertions: number, timeMs: number }
  byFile: Map<string, JUnitCase[]>   // insertion order == document order
}
export function parseJUnit(xml: string, cwd: string): JUnitRun
export function decodeClassname(raw: string): string[]   // exported for the contract test
```

**Two measured facts this task exists to encode** (verified against Bun 1.3.11 — see the design spec §0.3):

1. `classname` holds the describe chain **reversed** and the separator is **double-escaped**. A test declared as `describe('outer') > describe('inner') > test('deep fails')` serialises as `classname="inner &amp;gt; outer"`, which XML-decodes to `inner &gt; outer`. `decodeClassname` must decode **twice**, split on ` > `, and reverse — yielding `['outer', 'inner']`.
2. `file` is repo-relative for in-tree files and absolute for out-of-tree ones. Normalize to repo-relative against `cwd`.

- [ ] **Step 1: Record the fixtures.** Generate them with real Bun, do not hand-write:
  ```bash
  bun test --reporter=junit --reporter-outfile=tests/scripts/test/fixtures/junit-nested.xml <a nested failing fixture>
  ```
  `junit-nested.xml` must contain sibling describes with a **shared leaf name** (`A > x`, `A > y`, `B > x`) — that ambiguity is the whole reason the join is positional. `junit-empty.xml` is a run that produced no testcases.
- [ ] **Step 2: Write `tests/scripts/test/junit.test.ts` (red).** Assert `decodeClassname('inner &amp;gt; outer')` → `['outer', 'inner']` **verbatim** (`toEqual`, not `toContain`); assert `byFile` preserves document order; assert absolute `file` normalizes to repo-relative; assert `junit-empty.xml` yields zero cases and does not throw.
- [ ] **Step 3: Implement.** A regex/streaming scan over `<testcase …>` is sufficient and avoids an XML dependency; capture `name`, `classname`, `time`, `file`, `line`, and whether a `<failure`/`<error` child follows before the element closes. Read totals from the root `<testsuites>` attributes.
- [ ] **Step 4: Run green; commit.**

---

## Task 3: `console-log.ts` — segment Bun's console output

**Files:**
- Create: `scripts/test/console-log.ts`
- Create: `tests/scripts/test/console-log.test.ts`
- Create: `tests/scripts/test/fixtures/console-nested.log`, `fixtures/console-unhandled.log`, `fixtures/console-green.log`

**Interfaces:**
```ts
export interface LogFailureBlock {
  markerText: string        // e.g. "outer > inner > deep fails"
  ms: number
  offset: number            // byte offset into the log
  length: number
}
export interface LogSegment {
  file: string | null       // repo-relative; null for output before any file header
  blocks: LogFailureBlock[]
}
export interface LogRunError { file: string | null, message: string }
export interface LogSummary { files: number, tests: number, pass: number, fail: number, skip: number, expects: number }

export function segmentLog(text: string, cwd: string): {
  segments: LogSegment[]
  runErrors: LogRunError[]
  summary: LogSummary | null
}
```

Format notes to encode:
- A file header is a line ending in `:` whose content resolves to a path — **relative to cwd**, so it can be `../../tmp/...` for out-of-tree files. Normalize like Task 2.
- A failure marker is `(fail) <text> [<n>ms]`. It comes **after** its diagnostic block; a block runs from the end of the previous marker (or the file header) through the end of its own marker line.
- `# Unhandled error between tests` blocks have **no** marker and no testcase — they become `runErrors`. On a dependency-less checkout this is the *only* signal: 1,294 files of them and an empty JUnit index.
- The trailing summary is ` N pass` / ` N fail` / ` N skip` / ` N expect() calls` / `Ran N tests across M files. [T]`.

- [ ] **Step 1: Record the fixtures with real Bun** (same runs as Task 2's, so the pair is coherent). Include one out-of-tree relative header and one `# Unhandled error between tests` block.
- [ ] **Step 2: Write `tests/scripts/test/console-log.test.ts` (red).** Assert per-file block counts and marker texts; assert `offset`/`length` slice back to the expected substring (`text.slice(offset, offset+length)`); assert `console-green.log` yields zero blocks and a parsed summary; assert `console-unhandled.log` yields `runErrors` and a `null`-ish summary.
- [ ] **Step 3: Implement; run green; commit.**

---

## Task 4: `join.ts` — the version-sensitive seam

**Files:**
- Create: `scripts/test/join.ts`
- Create: `tests/scripts/test/join.test.ts`

**Interfaces:**
```ts
export interface JoinedFailure {
  id: number
  file: string
  line: number | null
  suite: string[]
  name: string
  ms: number
  detail: { logOffset: number, logLength: number } | null
}
export function joinFailures(junit: JUnitRun, segments: LogSegment[]): {
  failures: JoinedFailure[]
  joinWarnings: string[]
}
```

Algorithm (from design spec §0.3):
1. Group both sides by repo-relative file.
2. **Within a file**, zip the ordered `(fail)` blocks against that file's ordered failing testcases. Global order is not reliable under `--parallel`; per-file order is — verified.
3. Cross-check each pair: `[...suitePath, name].join(' > ') === markerText`. On mismatch, keep the JUnit identity, set `detail: null`, and push a `joinWarnings` entry naming the file. **Degrade, never guess.**
4. A file present in JUnit with failures but absent from the log (or vice versa) is a warning, not a throw.

- [ ] **Step 1: Write `tests/scripts/test/join.test.ts` (red)** using the Task 2/3 fixtures as a **pair**:
  - the nested fixture joins 3-for-3 with correct `detail` ranges, including the two `x` leaf names in different describes landing on the right blocks;
  - a deliberately shuffled log segment order still joins correctly (grouping is by file, not by position);
  - a synthetic mismatch (rename one testcase) produces `detail: null` + exactly one `joinWarnings` entry, and does **not** throw;
  - the empty/unhandled fixtures produce zero failures and no warnings.
- [ ] **Step 2: Implement; run green; commit.**

> This is the only part of the system that depends on Bun's output format. Its fixtures are recorded, not synthesised, so a Bun upgrade that changes the reporter fails **here**, loudly, instead of silently emptying every `test:show`.

---

## Task 5: `report.ts` — schema, build, read, write

**Files:**
- Create: `scripts/test/report.ts`
- Create: `tests/scripts/test/report.test.ts`

**Interfaces:**
```ts
export const RunReportSchema = z.object({
  schemaVersion: z.literal(1),
  startedAt: z.string(),
  wallMs: z.number(),
  argv: z.array(z.string()),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('full') }),
    z.object({ kind: z.literal('paths'), paths: z.array(z.string()), selectedBy: z.string().optional() }),
  ]),
  mode: z.enum(['parallel', 'serial']),
  fingerprint: z.string(),
  gitSha: z.string().nullable(),
  totals: z.object({ files: z.number(), tests: z.number(), pass: z.number(), fail: z.number(), skip: z.number(), expects: z.number() }),
  // Per-file pass/fail, derived from the JUnit index. Task 18's gate needs it;
  // include it here so the schema never has to be versioned for that.
  files: z.record(z.string(), z.object({ tests: z.number(), failures: z.number() })),
  failures: z.array(/* JoinedFailure */),
  runErrors: z.array(z.object({ file: z.string().nullable(), message: z.string() })),
  slowestFiles: z.array(z.object({ file: z.string(), ms: z.number(), tests: z.number() })),
  joinWarnings: z.array(z.string()),
})
export type RunReport = z.infer<typeof RunReportSchema>

export interface BuildReportInput { junitXml: string, logText: string, /* … meta … */ }
export function buildReport(input: BuildReportInput): RunReport
export function readReport(path: string, read: (p: string) => string | null): RunReport | null   // fail-open: null on missing/corrupt
export function writeReport(report: RunReport, write: (p: string, s: string) => void): void       // rotates last-run.json → previous-run.json
```

- [ ] **Step 1: Write `tests/scripts/test/report.test.ts` (red).** `buildReport` on the fixture pair produces the expected totals/failures/slowestFiles; `slowestFiles` is per-file summed testcase time, descending, capped at 20; `readReport` returns `null` for missing, for invalid JSON, and for a schema mismatch (never throws — this is the fail-open rule); `writeReport` rotates the previous report exactly once.
- [ ] **Step 2: Implement; run green; commit.**

---

## Task 6: `mode.ts` — argv parsing and execution mode

**Files:**
- Create: `scripts/test/mode.ts`
- Create: `tests/scripts/test/mode.test.ts`

**Interfaces:**
```ts
export interface WrapperArgs {
  mode: 'parallel' | 'serial' | null   // explicit override, else null
  bypass: boolean                      // --watch / --update-snapshots / -u
  stream: boolean                      // --stream
  passthrough: string[]                // everything for the child, minus wrapper-only flags
  paths: string[]                      // positional path arguments
}
export function parseWrapperArgs(argv: readonly string[]): WrapperArgs
export function selectMode(explicit: 'parallel' | 'serial' | null, env: Record<string, string | undefined>, cores: number): 'parallel' | 'serial'
```

`selectMode` rules, in order: explicit wins; `CI` truthy → `serial`; `cores >= 8` → `parallel`; else `serial`.

Rationale (measured, 4 vCPU): `--parallel` was **slower** than serial on `tests/review-loop` (34.2 s vs 27.6 s) and a wash on 200 light files. The documented ~2.5x speedup holds at 12 cores. `navigator.hardwareConcurrency` reports 4 correctly in a 4-vCPU container.

- [ ] **Step 1: Write `tests/scripts/test/mode.test.ts` (red).** Table-drive `selectMode` across `{explicit, CI, cores}`; assert `--watch`, `-u`, `--update-snapshots` set `bypass`; assert wrapper-only flags (`--serial`, `--parallel`, `--stream`) are stripped from `passthrough` while everything else (`-t`, `--bail`, `--rerun-each`, `--coverage`, paths) survives **in order**.
- [ ] **Step 2: Implement; run green; commit.**

---

## Task 7: `run.ts` — the wrapper, and `package.json` wiring

**Files:**
- Create: `scripts/test/run.ts`
- Create: `tests/scripts/test/run.test.ts`
- Modify: `package.json`

**Interfaces:**
```ts
export interface RunDeps {
  ensureClientBuilt: () => void
  spawn: (argv: readonly string[]) => { exitCode: number, output: string, wallMs: number }
  fingerprint: () => string
  gitSha: () => string | null
  writeArtifacts: (log: string, junitXml: string, report: RunReport) => void
  readJUnit: () => string
  print: (line: string) => void
  now: () => string
}
export function runWrapper(argv: readonly string[], deps: RunDeps): number   // returns the child's exit code
```

Order of operations: `ensureClientBuilt()` → resolve mode → spawn child with `--timeout 15000 --reporter=junit --reporter-outfile=<LAST_RUN_JUNIT>` + passthrough → capture combined output → build + write report → print summary → return child exit code.

`ensureClientBuilt` closes the documented `bun run test` footgun and removes 2 of the 19 clean-container failures. `--watch`/`--update-snapshots` bypass persistence and stream straight through.

Summary format (≤ 20 lines, and the only thing most runs print):
```
1294 files · 12868 tests · 12847 pass · 19 fail · 2 skip · 6m01s (parallel)
19 failures — bun run test:show <#id>
  #1  tests/debug/server.test.ts:143      debug-server > (unnamed)
  #2  tests/stats/perf.test.ts:102        stats perf bench > getGlobalStats(…) completes under 1000ms
  … 14 more — bun run test:failures
reports/test/last-run.{log,junit.xml,json}
```
When `failures.length === 0` and `runErrors.length === 0`, print only the first and last lines.

- [ ] **Step 1: Write `tests/scripts/test/run.test.ts` (red)** with fully injected deps:
  - the child argv contains `--reporter=junit`, `--reporter-outfile`, `--timeout 15000` and every passthrough arg in order;
  - the wrapper's return value equals the injected child's exit code, for `0`, `1`, and `143`;
  - `ensureClientBuilt` is called exactly once, **before** spawn;
  - `--watch` bypasses: no `--reporter` in argv, `writeArtifacts` never called;
  - a green run prints the 2-line summary; a failing run lists at most 5 failures then the "… N more" pointer;
  - `runErrors` present with zero testcases still produces a report and a summary that names the module error.
- [ ] **Step 2: Implement `runWrapper` + a `main()` guarded by `import.meta.main`.**
- [ ] **Step 3: Wire `package.json`:**
  ```jsonc
  "test":        "bun scripts/test/run.ts",
  "test:serial": "bun scripts/test/run.ts --serial",
  "test:raw":    "bun test --parallel",
  ```
- [ ] **Step 4:** Run `bun run test tests/utils` and confirm `reports/test/last-run.json` appears with `scope.kind === 'paths'`. Commit.

---

## Task 8: the query commands

**Files:**
- Create: `scripts/test/query.ts`
- Create: `tests/scripts/test/query.test.ts`
- Modify: `package.json`

**Interfaces:**
```ts
export interface QueryContext { report: RunReport | null, log: string | null, currentFingerprint: string }
export function stalenessBanner(ctx: QueryContext): string | null
export function renderStatus(ctx: QueryContext): string
export function renderFailures(ctx: QueryContext, opts: { filesOnly: boolean }): string
export function renderShow(ctx: QueryContext, selector: string): string
export function renderLog(ctx: QueryContext, pattern: string, opts: { context: number, max: number }): string
export function renderSlowest(ctx: QueryContext, n: number): string
```

`renderShow`'s selector resolves in order: `#<id>` → `<file>:<line>` → `<file>` → case-insensitive substring of `suite > name`. Multiple matches render all of them (an agent pasting a test name back should not have to disambiguate).

`renderLog` is the honest replacement for the re-run-and-grep loop, and the command Task 22's advisory hook points at. Default `--max 200` lines, `-C 3`.

`stalenessBanner` returns `⚠ N files changed since this run (fingerprint <old> → <new>) — re-run bun run test` when the fingerprints differ. Every renderer prefixes it. It never suppresses the answer.

- [ ] **Step 1: Write `tests/scripts/test/query.test.ts` (red)** against a fixture `reports/test/`:
  - each renderer's golden output;
  - all four `renderShow` selector forms, plus "no match" wording;
  - the staleness banner appears exactly once per render and only when fingerprints differ;
  - `ctx.report === null` → the "no usable report — run `bun run test` first" message, and the CLI exits `3`;
  - a report with `joinWarnings` surfaces them in `renderStatus`;
  - **`renderLog` respects `--max` and never returns unbounded output**;
  - a guard asserting no renderer references `Bun.spawn`/`spawnSync` (grep the module source in-test) — the query layer must be provably non-executing.
- [ ] **Step 2: Implement + a `main()` dispatching on `argv[2]`.**
- [ ] **Step 3: Wire `package.json`:**
  ```jsonc
  "test:status":   "bun scripts/test/query.ts status",
  "test:failures": "bun scripts/test/query.ts failures",
  "test:show":     "bun scripts/test/query.ts show",
  "test:log":      "bun scripts/test/query.ts log",
  "test:slowest":  "bun scripts/test/query.ts slowest",
  ```
- [ ] **Step 4: Run green; commit.**

---

## Task 9: `check.sh` keeps its per-check logs

**Files:**
- Modify: `scripts/check.sh`
- Modify: `tests/scripts/check.test.ts`

- [ ] **Step 1: Extend `tests/scripts/check.test.ts` (red).** Reuse the existing fake-`bun`-on-`PATH` harness (`sharedBinDir`, `CHECK_LOG_FILE`, `CHECK_FAIL_MATCH`). Assert that after a run with `CHECK_FAIL_MATCH=typecheck`, `reports/checks/typecheck.log` exists in the temp repo and contains the failed check's output; that `reports/checks/` is cleared at the **start** of a run (a stale file from a previous run is gone); and that the `test` check invokes the wrapper (`bun run test` / `bun scripts/test/run.ts`), not `bun test --parallel`.
- [ ] **Step 2: Modify `scripts/check.sh`:**
  - keep `TMPDIR` for the `.exit` sentinels, but write `.out` files to `reports/checks/` (`mkdir -p` + clear at start; the `trap 'rm -rf "$TMPDIR"' EXIT` stays and no longer takes the logs with it);
  - in the `test` branch, replace the inline `bun test --parallel --timeout 15000` with the wrapper. Leave the `CI=true` branch's `bun test --coverage --timeout 15000` + `bun coverage:ratchet` sequence **exactly as it is** — the coverage lane is not this plan's business.
  - after each failed check's inline output, append `→ reports/checks/<name>.log`.
- [ ] **Step 3: Run `bun run test tests/scripts/check.test.ts` green; run `bun check:full --skip-tests` manually and confirm `reports/checks/` is populated. Commit.**

---

## Task 10: stop telling the agent to re-run

**Files:**
- Modify: `.hooks/tdd/checks/check-full.mjs`
- Modify: `.hooks/tests/tdd/checks/check-full.test.ts`

`formatCheckResult` currently maps over `failures` twice using only `check`, and never reads the `files` that `parseCheckOutput` already extracted for it. The three existing tests pin that wording and must be rewritten, not appended to.

- [ ] **Step 1: Rewrite the three `formatCheckResult` cases in `.hooks/tests/tdd/checks/check-full.test.ts` (red)** for the new output:
  ```
  `bun check:full` failed:
  - typecheck (2 files) — src/a.ts, src/b.ts
    → reports/checks/typecheck.log
  - test (2 files) — tests/c.test.ts, tests/d.test.ts
    → bun run test:failures      (report already on disk; do not re-run to look)
  - knip
    → reports/checks/knip.log
  ```
  Cover: a check with files, a check with none (`knip`), and the `test` check's distinct pointer. Cap the inline file list at 5 with `+N more`.
- [ ] **Step 2: Implement.** Map `check → pointer`: `test`/`test:client`/`review-loop:test` → `bun run test:failures`; everything else → `reports/checks/<safeName>.log`.
- [ ] **Step 3: Run green; commit.**

---

## Task 11: `import-graph.ts`

**Files:**
- Create: `scripts/test/import-graph.ts`
- Create: `tests/scripts/test/import-graph.test.ts`

**Interfaces:**
```ts
export const GRAPH_ROOTS = ['src/**/*.ts', 'client/**/*.ts', 'plugins/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts']
export interface GraphDeps {
  scan: (pattern: string) => Iterable<string>
  read: (relPath: string) => string | null
  exists: (relPath: string) => boolean
}
export function resolveSpecifier(fromFile: string, spec: string, exists: (p: string) => boolean): string | null
export function buildReverseGraph(deps: GraphDeps): Map<string, Set<string>>   // dep → importers
export function reachableTests(graph: Map<string, Set<string>>, seeds: readonly string[], depth: number): Set<string>
```

`resolveSpecifier` tries, in order: `.js`→`.ts`, `.js`→`.tsx`, the literal path, `+ '.ts'`, `+ '/index.ts'`. Only relative specifiers (`./`, `../`) participate — the repo uses no path aliases. Import matching regex: `/(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g`, which covers static imports, `require`, `mock.module`, and dynamic `import()` with a **literal** specifier.

`reachableTests` is a breadth-limited traversal: expand non-test importers up to `depth` hops, collect test files encountered at any hop.

- [ ] **Step 1: Write `tests/scripts/test/import-graph.test.ts` (red)** on a synthetic in-memory file set:
  - each `resolveSpecifier` form, plus "unresolvable returns null" and "bare specifier ignored";
  - `reachableTests` at depths 1/2/3 on a hand-built chain `t.test.ts → a.ts → b.ts → c.ts`;
  - a cycle terminates;
  - a file with no importers yields the empty set.
- [ ] **Step 2: Implement; run green.**
- [ ] **Step 3: Sanity-check against the real repo** — `buildReverseGraph` over `GRAPH_ROOTS` should report ~3,124 files and ~11,949 edges in under 1 s. Record the actual numbers in the commit message; a large divergence means the resolver regressed. Commit.

---

## Task 12: `test:affected`

**Files:**
- Create: `scripts/test/affected.ts`
- Create: `tests/scripts/test/affected.test.ts`
- Modify: `scripts/mutation/coverage-map.ts` (export `listCandidateTests`)
- Modify: `package.json`

**Interfaces:**
```ts
export const BLAST_RADIUS_INPUTS: readonly string[] = [
  'bunfig.toml', 'package.json', 'bun.lock', 'tests/setup.ts', 'tests/mock-reset.ts',
]
export const BLAST_RADIUS_PREFIXES: readonly string[] = ['tests/utils/']

export type Selection =
  | { kind: 'full', reason: string }
  | { kind: 'paths', server: string[], client: string[], skippedExternal: string[], depth: number, changed: string[] }

export function selectAffected(input: {
  changed: readonly string[]
  graph: Map<string, Set<string>>
  candidates: (srcFile: string) => readonly string[]   // listCandidateTests
  depth: number
}): Selection
```

Selection = union of (a) `reachableTests(graph, changed, depth)`, (b) `candidates(f)` for each changed non-test file, (c) changed files that are themselves tests. Then split by `classifyTestLane`.

Depth default **2**, measured across all 937 `src/` files: p50 **0.5 %** of the suite, p90 2.7 %, and — unlike depth 1 — **never empty** (depth 1 is empty for 6 % of source files). Depth 3 blows out to 47.9 % at p90 as the hub cluster is reached; the full closure is meaningless (p50 49 %).

- [ ] **Step 1: Export `listCandidateTests` from `scripts/mutation/coverage-map.ts`.** It is currently module-private; the file already exports test-only seams (`_samePackageTestDirForTest`). Export it properly — this is a real second consumer, so knip is satisfied. Do not copy it.
- [ ] **Step 2: Write `tests/scripts/test/affected.test.ts` (red):**
  - depth-2 selection on the Task 11 synthetic graph;
  - **each of the seven blast-radius inputs individually** returns `{ kind: 'full' }` with a reason naming the file;
  - lane split: a `tests/client/**` hit lands in `client`, `tests/e2e/**` and `tests/stories/**` land in `skippedExternal` and never in a run list;
  - a changed test file selects itself even with no graph edges;
  - an empty change set returns `{ kind: 'full' }` (nothing to narrow from).
- [ ] **Step 3: Implement `selectAffected` + a `main()`** that: collects changed files from `git diff --name-only --diff-filter=ACMR <base>...HEAD` ∪ `git status --porcelain` (mirroring `selectChangedMutationTargets` in `scripts/mutation/changed-files.ts`, default base `origin/master`); prints the banner; runs the server lane through `scripts/test/run.ts` and the client lane through the `test:client` preset via `buildCoverageArgs`-style argv; records `scope: { kind: 'paths', selectedBy: 'affected@<depth>' }` in the report.
- [ ] **Step 4: The banner is mandatory and is printed before results:**
  ```
  test:affected — 7 of 1391 server test files (depth 2, 3 changed files)
    skipped lanes: e2e, stories
    This is a static-import heuristic: it cannot see mock.module() targets, computed
    dynamic imports, or behaviour reached through DI seams. Green here is not green
    for the suite.
  ```
  Assert its presence in the test — a silent subset run is the failure mode this whole task risks.
- [ ] **Step 5: Soundness sample (manual, recorded in the commit message).** Pick 5 recent commits that changed `src/`; for each, confirm the depth-2 selection contains every test file that the full run reports as failing when that change is reverted. Any miss is a resolver gap to fix or document, not to ignore.
- [ ] **Step 6: Wire `"test:affected": "bun scripts/test/affected.ts"`; commit.**

---

## Task 13: wire the orphaned per-edit checks

**Files:**
- Modify: `.claude/hooks/post-tool-use.mjs`, `.claude/settings.json`
- Modify: `.codex/hooks/post-tool-use.mjs`, `.codex/hooks.json`
- Modify: `.opencode/plugins/tdd-enforcement.ts`
- Modify: `.hooks/tests/tdd/checks/verify-tests-pass.test.ts` (if wiring reveals gaps)

`verifyTestsPass` is implemented and tested and imported by nothing. Its coverage-regression branch reads `getSessionBaseline`, which **nothing writes** — so wiring it costs exactly one targeted `bun test <companion>` (~2 s) and the coverage branch stays inert. That is the intended scope here.

- [ ] **Step 1: Raise the PostToolUse timeout in `.claude/settings.json` from `200` to `15000` ms** (and the `.codex` twin). A targeted `bun test` needs ~3 s cold; at 200 ms the hook is killed before it can report and *looks* like it passed. Do this **before** step 2 or the wiring appears to work while doing nothing.
- [ ] **Step 2: Add `verifyTestsPass` to `.claude/hooks/post-tool-use.mjs`** after `verifyTestImport`, emitting the same `{ decision: 'block', reason }` shape the other checks use. Mirror into `.codex/hooks/post-tool-use.mjs` and `.opencode/plugins/tdd-enforcement.ts` (which notifies rather than blocks — follow its local pattern).
- [ ] **Step 3: Verify by hand:** edit a `src/` file so its companion test fails; confirm the hook blocks with the test output. Revert.
- [ ] **Step 4: Decide `snapshot-surface` / `verify-no-new-surface` / `check-uncommitted`** — wire them the same way, or delete steps 3/6/7 from `docs/architecture/commands.md:71`. Shipping docs that describe a pipeline that does not exist is its own cost. Record the decision in the commit message.
- [ ] **Step 5: Commit.**

---

## Task 14: silence the `git init` hint noise

**Files:**
- Modify: `tests/setup.ts`
- Create: `tests/fixtures/gitconfig` (or generate into `TMPDIR` at preload time)

100 of 509 log lines — **20 %** of a near-green full run — are `hint: Using 'master' as the name for the initial branch…`, emitted by the ~20 suites that shell out to `git init`. `tests/scripts/behavior-audit/publish-snapshot.test.ts:226` already passes `-q -b main`; fixing ~20 call sites is the worse option.

- [ ] **Step 1: Write the test (red)** — a test that runs `git init` in a temp dir via the same path the suites use and asserts stderr contains no `hint:` line.
- [ ] **Step 2: In `tests/setup.ts`, set `process.env.GIT_CONFIG_GLOBAL`** to a fixture containing `[init] defaultBranch = master` (and `GIT_CONFIG_SYSTEM=/dev/null` so a host config cannot re-introduce the hint). `tests/setup.ts` is a frozen story-lane input — confirm the story manifest is regenerated and the change is landed on master **before** any refactor baseline is recorded (`docs/architecture/commands.md`, "Hermetic story qualification").
- [ ] **Step 3: Run the full suite; confirm `hint:` lines are gone and the log shrinks by ~100 lines. Commit.**

---

## Task 15: fix the 16 story-runner failures (missing DI seam)

**Files:**
- Modify: `tests/scripts/test-stories.test.ts`

These 16 failures are **not** an environment requirement. The tests in `describe('story runner reports and compatibility')` and `describe('story report lifecycle')` call `runStoryTests` without injecting `assertLinuxSandboxBackend`, so the real Docker preflight runs and returns exit 2 — while sibling tests in the same file (`rejects a Docker preflight failure on %s…`, `:230`) *do* inject it. It is a forgotten seam.

- [ ] **Step 1: Inject `assertLinuxSandboxBackend: () => undefined`** into every `runStoryTests` call in those two describes that does not already override it. No skip, no env gate, no change to `scripts/story/**` — the sandbox contract is untouched.
- [ ] **Step 2: Run `bun run test tests/scripts/test-stories.test.ts` on a machine with no Docker daemon and confirm 0 failures.** Then confirm the still-Docker-dependent assertions (the preflight-failure tests) still pass. Commit.

---

## Task 16: de-flake the wall-clock perf budget

**Files:**
- Modify: `tests/stats/perf.test.ts`
- Modify: `.github/workflows/ci.yml` (set `PAPAI_PERF_BUDGETS=1` on the serial check job) — or `scripts/check.sh`'s `CI=true` branch

`tests/stats/perf.test.ts:102` asserts `elapsed < 1000` and failed at 1075 ms under worker contention. A fixed wall-clock assertion contradicts `tests/CLAUDE.md`'s own rule ("No fixed-wall-clock timing assertions … under worker CPU contention the event loop starves and these flake").

- [ ] **Step 1: Split the test.** Correctness assertions (`subjects.dmTotal`, `groupTotal`, result shape) stay unconditional. The `toBeLessThan(PERF_BUDGET_MS)` assertion runs only when `process.env.PAPAI_PERF_BUDGETS === '1'`, with an explicit skip reason so a reader sees it was not silently dropped.
- [ ] **Step 2: Set `PAPAI_PERF_BUDGETS=1` in the CI serial run** so the budget keeps being enforced where the machine is quiet.
- [ ] **Step 3: Commit.**

---

## Task 17: stop the deliberate test stdout

**Files:**
- Modify: the `review-loop`/`mutation-improve` suites emitting `[round N/M] …`, `[build] …`, `[done] …`
- Modify: `scripts/mutation/coverage-map.ts` (`coverage-map: no covering test found …` → injected reporter)
- Modify: the suites emitting HTTP access lines (`GET /repos/… - 403 …`)

~135 lines of a near-green run are deliberate progress output that escapes `tests/setup.ts`'s `console.log` suppression because it goes through `console.error` or an injected renderer.

- [ ] **Step 1: For each source, route through the injected logger/renderer the module already accepts** and have the test inject a silent one. Where no seam exists, add one — do **not** widen `tests/setup.ts`'s blanket suppression to `console.error`, which is the one channel that still carries real diagnostics.
- [ ] **Step 2: Re-run the full suite; confirm a green run's log is a handful of lines. Commit.**

---

## Task 18: `privacy-contract` becomes a post-run gate

**Files:**
- Create: `scripts/analytics/privacy-contract-gate.ts`
- Create: `tests/scripts/analytics/privacy-contract-gate.test.ts`
- Modify: `tests/analytics/privacy-contract.test.ts`
- Modify: `scripts/check.sh`, `package.json`, `docs/architecture/commands.md`

`tests/analytics/privacy-contract.test.ts` is **110 s of the suite's 371 s** — 33 % of all in-test time and a hard floor no scheduling change beats. `runFixture` (`:256-273`) does `Bun.spawnSync(['bun','test',<fixture>])` across **57 unique fixture files**, every one of which the parent suite already runs. The nested spawns re-execute work the run just did, purely to make the control→proof linkage explicit.

**This strengthens the gate.** Today it proves the fixtures pass *in a fresh nested process*; afterwards it proves they passed *in the very run that gates the release*. The 17-row table, the fixture-existence checks, the proof-point requirements, and the release-blocking status are all unchanged.

- [ ] **Step 1: Extract the table.** Move `PRIVACY_CONTRACT` (17 rows) to `src/analytics/privacy-contract-table.ts` — or `scripts/analytics/privacy-contract-table.ts` if it must stay out of `src/` — so both the test and the gate import one definition. No row content changes.
- [ ] **Step 2: Write `tests/scripts/analytics/privacy-contract-gate.test.ts` (red).** The gate takes an injected `RunReport` and returns `{ ok, problems[] }`:
  - green: report is full-scope, fresh, and every one of the 57 fixtures appears with zero failures;
  - **fails closed** on: no report, `scope.kind !== 'full'`, stale fingerprint, a fixture absent from the report, a fixture present with failures, and `runErrors` non-empty;
  - each failure mode names the offending fixture or condition in `problems`.
- [ ] **Step 3: Implement `scripts/analytics/privacy-contract-gate.ts`** + `main()` exiting non-zero on `!ok`. It reads the per-file `files` map Task 5 already puts in the report; no schema change is needed.
- [ ] **Step 4: In `tests/analytics/privacy-contract.test.ts`, delete only the `control N — … every proof fixture passes` loop and `runFixture`/`expectFixtureGreen`.** Keep the structural test (17 rows, proof points non-empty, fixture paths exist) and keep the entire `synthetic captured-request canary sweep` describe — that is real in-process work, not duplication.
- [ ] **Step 5: Wire `"analytics:privacy-contract": "bun scripts/analytics/privacy-contract-gate.ts"`; add it to `scripts/check.sh` immediately after the `test` check (gated on that check passing); replace the `bun test tests/analytics/privacy-contract.test.ts` line in `docs/architecture/commands.md`'s analytics release-gate sequence.**
- [ ] **Step 6: Measure.** Run the full suite and record the new wall time in the commit message. Expected ~6 min → **~3–4 min** at 4 vCPU. Confirm the gate passes on that run and fails on a subset run. Commit.

---

## Task 19: `opencode-agent` default check command

**Files:**
- Modify: `opencode-agent/src/config.ts`
- Modify: `tests/opencode-agent/config.test.ts`

`AGENT_CHECK_COMMAND` defaults to `bun run lint && bun run typecheck && bun test` (`:262`) — `&&`-chained, so a lint failure hides the typecheck and test results and costs an extra repair round; and bare `bun test` bypasses the wrapper entirely.

- [ ] **Step 1: Update the default-value assertion in `tests/opencode-agent/config.test.ts` (red)** to `'bun check:full'`.
- [ ] **Step 2: Change the default.** `check.sh` already runs its checks concurrently and now leaves `reports/checks/` + `reports/test/` behind; `check-loop.ts`'s narrow-to-failed-checks behaviour is unchanged and composes with it.
- [ ] **Step 3: Run green; commit.**

---

## Task 20: documentation

**Files:**
- Modify: `CLAUDE.md`, `tests/CLAUDE.md`, `README.md`, `docs/architecture/commands.md`

- [ ] **Step 1: Add "Running and inspecting checks" to `CLAUDE.md`** (detail in `tests/CLAUDE.md`): run once → read the artifact → **never re-run to re-filter**; `test:affected` in the loop, full suite before commit; the full command table from the design spec; and the measured cost table so an agent can budget — `lint` 35 s, `typecheck` 24 s, `knip` 4.6 s, `format:check` 2.9 s, `duplicates` 1.3 s, full suite ~6 min at 4 vCPU.
- [ ] **Step 2: Update `docs/architecture/commands.md`** — the `bun run test` entry (now self-building and persisting; `--parallel` no longer unconditional), the new query commands, `test:raw`, and whatever Task 13 Step 4 decided about the hook pipeline's steps 3/6/7.
- [ ] **Step 3: Update `README.md`'s Testing section** — drop the "still required once before `bun run test` on a clean checkout" caveat for `bun build:client`, which Task 7 makes false.
- [ ] **Step 4: Commit.**

---

## Task 21: stop teaching the old idiom

**Files:**
- Modify: `docs/superpowers/plans/**` (20 occurrences)
- Modify: `.claude/hooks/pre-bash.mjs`, `.codex/hooks/pre-bash.mjs`
- Create: `.hooks/git/checks/warn-test-pipe.mjs` (naming follows the existing `block-*` checks)
- Create: `.hooks/tests/tdd/checks/warn-test-pipe.test.ts`

- [ ] **Step 1: Replace the 20 `bun test … 2>&1 | tail -N` / `| head -N` / `| grep …` occurrences** in `docs/superpowers/plans/` with `bun run test <paths>` followed by `bun run test:log <pattern>`. Three of them pipe the **full** suite. A plan that teaches the idiom recreates the problem on every future read.
- [ ] **Step 2: Write `.hooks/tests/tdd/checks/warn-test-pipe.test.ts` (red).** The check matches a `bun run test`/`bun test` invocation piped into `head`/`tail`/`grep`/`rg` and returns an advisory string; it returns `null` for a bare run, for a `test:log` invocation, and for unrelated commands (`git log | head`).
- [ ] **Step 3: Implement and wire into `pre-bash.mjs` as an advisory only.** It must **not** return a `permissionDecision: 'deny'` — the existing `blockGitStash`/`blockGitCheckoutDiscard` path is for policy violations; this is a hint:
  > `bun run test` persists to `reports/test/`. To re-filter without re-running: `bun run test:log <pattern>`, `bun run test:failures`, `bun run test:show <id>`.
  Precedent for the posture: `review-loop/src/prompt-templates.ts:19` already gives reviewers an explicit verification budget forbidding test suites and `bun check:full`.
- [ ] **Step 4: Run green; commit.**

---

## Verification (whole plan)

- [ ] `bun check:full` green.
- [ ] On a clean container with no Docker and no `public/`: `bun run test` reports **0 failures** (was 19).
- [ ] Full-suite wall time recorded before/after Task 18 on the same machine.
- [ ] A green run's `last-run.log` is a handful of lines; `last-run.json` round-trips through `readReport`.
- [ ] `bun run test:log`, `test:failures`, `test:show`, `test:status`, `test:slowest` all answer from one run, and `test:status` reports the run as stale after a single edit.
- [ ] `bun run test:affected` on a one-file change selects < 1 % of the suite and prints the heuristic banner.
- [ ] `bun run analytics:privacy-contract` passes on a full run and **fails** on a `test:affected` run.
- [ ] `bun test:stories:contracts` and `bun test:stories` still green (Task 14 touches a frozen story-lane input — land it on master before any refactor baseline is recorded).

## Open questions to resolve during implementation

1. **Retention.** Task 5 rotates one `previous-run.json`. If diffing two runs proves useful, promote it to a keyed history; do not build that speculatively.
2. **`test:affected` in `check.sh`.** No — the coverage ratchet and the privacy-contract gate both require full-scope runs. Revisit only with a separate fast pre-commit lane.
3. **Bun version pin.** The join contract is recorded against 1.3.11 locally and 1.3.13 in CI. Decide whether `run.ts` should warn outside a known-good reporter range rather than silently producing empty details.
4. **Warm-runner spike.** A long-lived `bun test --watch` the agent queries would remove cold start entirely but needs a control channel. Out of scope here; worth its own spike if the inner loop still feels slow after Task 12.
