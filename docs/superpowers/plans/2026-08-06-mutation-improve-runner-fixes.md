<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation-Improve Runner — Gate & Finalize Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix eight verified issues in the `mutation-improve/` runner: two trust-breaking gate bugs, dead per-iteration artifacts, crash-unsafe state saving, a contradictory finalize push/PR flow, a stale-floor skip path, missing failure context, a diff-guard rename bypass, and a misleading timeout config key.

**Architecture:** Four commit units per the approved spec
(`docs/superpowers/specs/2026-08-06-mutation-improve-runner-fixes-design.md`):
A) gate integrity, B) artifacts+state, C) finalize flow, D) skip-ratchet+config.
All changes stay inside `mutation-improve/src` + `tests/mutation-improve` +
workspace config/docs; review-loop is consumed but never modified.

**Tech Stack:** Bun runtime + `bun:test`, strict TypeScript, Zod v4, DI-first
deps (`PipelineDeps`, `FinalizeDeps`), real-git integration tests in temp dirs.

## Global Constraints

- Run ALL commands from the repo root (`/Users/ki/Projects/yourpapai/papai/.worktrees/mutation-improve-01`).
- Test runner is **Bun** (`bun:test`); no Jest/Vitest. Focused run: `bun test tests/mutation-improve/<file>.test.ts`.
- Unit-green bar (run at the end of every task): `bun run mutation-improve:test && bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`.
- DI-first tests: fake the `PipelineDeps`/`FinalizeDeps` interfaces; no `mock.module()`.
- No `??`/ternary/conditionals inside **test bodies** (`vitest/no-conditional-in-test`); sequence/branch helpers live at module scope (see `sequenceMeasure` pattern in `pipeline.test.ts`).
- Import paths use `.js` extensions.
- Never add lint-disable or type-ignore comments.
- `mutation-improve/src/pipeline.ts` has an established explanatory-comment convention (C1/C2/I1 markers); one brief rationale comment per new helper matches it — do not strip existing comments.
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- `mutation-improve/AGENTS.md` is a symlink to `mutation-improve/CLAUDE.md` — edit `CLAUDE.md` only.
- review-loop has its own unrelated `agentTimeoutMs`; never touch `review-loop/**`.

---

### Task 1: Diff-guard rename parsing (Unit A)

`git status --porcelain` rename lines (`R  orig -> new`) are currently sliced as
one string, so `R  tests/a.ts -> src/b.ts` passes the guard (line starts with an
allowed prefix). Parse both endpoints and classify each.

**Files:**
- Modify: `mutation-improve/src/diff-guard.ts`
- Test: `tests/mutation-improve/diff-guard.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parsePorcelainPaths(line: string): string[]` (new export);
  `runDiffGuard(execGit, cwd)` behavior change: rename entries contribute both
  endpoints to `classifyDiff`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('diff-guard')` block in
`tests/mutation-improve/diff-guard.test.ts`. Add `parsePorcelainPaths` to the
existing import from `'../../mutation-improve/src/diff-guard.js'`.

```typescript
  test('parsePorcelainPaths returns a single path for non-rename entries', () => {
    expect(parsePorcelainPaths(' M tests/a.test.ts')).toEqual(['tests/a.test.ts'])
    expect(parsePorcelainPaths('?? "docs/superpowers/a b.md"')).toEqual(['docs/superpowers/a b.md'])
  })

  test('parsePorcelainPaths splits rename entries into both endpoints', () => {
    expect(parsePorcelainPaths('R  tests/old.test.ts -> tests/new.test.ts')).toEqual([
      'tests/old.test.ts',
      'tests/new.test.ts',
    ])
    expect(parsePorcelainPaths('R  "tests/a b.test.ts" -> "tests/c d.test.ts"')).toEqual([
      'tests/a b.test.ts',
      'tests/c d.test.ts',
    ])
  })

  test('runDiffGuard flags a rename from allowed to forbidden (smuggle)', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: 'R  tests/a.test.ts -> src/foo.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/foo.ts'] })
  })

  test('runDiffGuard flags a rename from forbidden to allowed (source removal)', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: 'R  src/foo.ts -> tests/foo.test.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/foo.ts'] })
  })

  test('runDiffGuard allows a rename within tests/', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: 'R  tests/old.test.ts -> tests/new.test.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/diff-guard.test.ts`
Expected: FAIL — `parsePorcelainPaths is not a function` (and the two smuggle
tests fail if the import is faked). The `parsePorcelainPaths` import also fails
typecheck.

- [ ] **Step 3: Implement rename parsing**

In `mutation-improve/src/diff-guard.ts`, replace the whole `runDiffGuard`
function and add the parser above it:

```typescript
function unquote(p: string): string {
  return p.replace(/^"|"$/gu, '')
}

// Porcelain v1 rename/copy entries look like `R  orig -> new` (each side
// quoted independently when it contains special chars). Only R/C statuses use
// the arrow form, so the status check prevents mis-splitting a quoted path
// that merely contains ' -> '.
export function parsePorcelainPaths(line: string): string[] {
  const status = line.slice(0, 2)
  const body = line.slice(3).trim()
  if (!status.includes('R') && !status.includes('C')) return [unquote(body)]
  const arrowIdx = body.indexOf(' -> ')
  if (arrowIdx === -1) return [unquote(body)]
  return [unquote(body.slice(0, arrowIdx)), unquote(body.slice(arrowIdx + 4))]
}

export async function runDiffGuard(
  execGit: ExecGitFn,
  cwd: string,
): Promise<{ ok: true } | { ok: false; violations: string[] }> {
  const { stdout } = await execGit(cwd, ['status', '--porcelain', '--untracked-files=all'])
  const paths = stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap(parsePorcelainPaths)
    .filter((p) => p.length > 0)
  const { violations } = classifyDiff(paths)
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mutation-improve/diff-guard.test.ts`
Expected: PASS (all 10 tests, including the 5 pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/diff-guard.ts tests/mutation-improve/diff-guard.test.ts
git commit -m "fix(mutation-improve): parse porcelain renames in diff-guard"
```

---

### Task 2: Build gate runs inside the iteration worktree (Unit A)

`runBuildCheck` currently executes `checkCommand` with cwd = `runDir`, so
`bun check:full` never sees the agent's diff. Thread the worktree path through.

**Files:**
- Modify: `mutation-improve/src/pipeline.ts` (PipelineDeps type + gatePhase)
- Modify: `mutation-improve/src/cli.ts` (`buildPipelineDeps`)
- Test: `tests/mutation-improve/pipeline.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PipelineDeps.runBuildCheck: (worktreePath: string) => Promise<{ passed: boolean; stdout: string; stderr: string }>`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('pipeline runIteration')` in
`tests/mutation-improve/pipeline.test.ts`:

```typescript
  test('build gate runs checkCommand inside the iteration worktree', async () => {
    const deps = happyDeps()
    let buildCwd = ''
    deps.runBuildCheck = (worktreePath: string): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
      buildCwd = worktreePath
      return Promise.resolve({ passed: true, stdout: '', stderr: '' })
    }
    await runIteration(deps, 1)
    expect(buildCwd).toBe(path.join(deps.config.workDir, 'worktrees', 'r1-iter1'))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mutation-improve/pipeline.test.ts -t "build gate runs"`
Expected: FAIL — `buildCwd` stays `''` because the current impl calls
`deps.runBuildCheck()` with no argument.

- [ ] **Step 3: Change the dep signature and call site**

In `mutation-improve/src/pipeline.ts`, `PipelineDeps`:

```typescript
    runBuildCheck: (worktreePath: string) => Promise<{ passed: boolean; stdout: string; stderr: string }>
```

In `gatePhase`, replace `const build = await deps.runBuildCheck()` with:

```typescript
  const build = await deps.runBuildCheck(worktreePath)
```

In `mutation-improve/src/cli.ts` `buildPipelineDeps`, replace the
`runBuildCheck` entry with:

```typescript
    runBuildCheck: (worktreePath: string) => {
      const exec = createShellExec(worktreePath, config.checkCommand, config.buildTimeoutMs)
      return runBuildCheck({ exec: () => exec() })
    },
```

(`createShellExec` and `runBuildCheck` are already imported in cli.ts.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS. The pre-existing `runBuildCheck: () => Promise.resolve(...)`
stubs in `integration.test.ts` / `integration-git.test.ts` remain valid
(zero-arg functions are assignable to the new one-arg type).

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/pipeline.ts mutation-improve/src/cli.ts tests/mutation-improve/pipeline.test.ts
git commit -m "fix(mutation-improve): run build gate inside the iteration worktree"
```

---

### Task 3: Per-iteration agent outputPath threading (Unit B)

`cli.ts` hardcodes `iter/selection.json` / `iter/result.json` as the runner copy
destination, so `iter/<N>/` dirs stay empty and artifacts overwrite each other.
Pass the pipeline's per-iter path through the dep call.

**Files:**
- Modify: `mutation-improve/src/pipeline.ts` (PipelineDeps type + selectPhase + improvePhase)
- Modify: `mutation-improve/src/cli.ts` (`selectRunner`, `improveRunner`)
- Test: `tests/mutation-improve/pipeline.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  `runSelectAgent: (worktreePath: string, prompt: string, outputPath: string) => Promise<AgentRunResult<Selection>>`
  and the identical third parameter on `runImproveAgent` (with `Result`).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('pipeline runIteration')` in
`tests/mutation-improve/pipeline.test.ts`:

```typescript
  test('select agent receives the per-iteration outputPath', async () => {
    const deps = happyDeps()
    let seenOut = ''
    deps.runSelectAgent = (
      _worktreePath: string,
      _prompt: string,
      outputPath: string,
    ): Promise<{ value: Selection; usage: AgentUsage }> => {
      seenOut = outputPath
      return Promise.resolve({ value: selection, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    expect(seenOut).toBe(path.join(deps.runState.runDir, 'iter', '1', 'selection.json'))
  })

  test('improve agent receives the per-iteration outputPath', async () => {
    const deps = happyDeps()
    let seenOut = ''
    deps.runImproveAgent = (
      _worktreePath: string,
      _prompt: string,
      outputPath: string,
    ): Promise<{ value: Result; usage: AgentUsage }> => {
      seenOut = outputPath
      return Promise.resolve({ value: result, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    expect(seenOut).toBe(path.join(deps.runState.runDir, 'iter', '1', 'result.json'))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/pipeline.test.ts -t "per-iteration outputPath"`
Expected: FAIL — `seenOut` stays `''` (impl calls the deps with two args).

- [ ] **Step 3: Thread outputPath through**

In `mutation-improve/src/pipeline.ts`, `PipelineDeps`:

```typescript
    runSelectAgent: (worktreePath: string, prompt: string, outputPath: string) => Promise<AgentRunResult<Selection>>
    runImproveAgent: (worktreePath: string, prompt: string, outputPath: string) => Promise<AgentRunResult<Result>>
```

In `selectPhase`, change the `deps.runSelectAgent(...)` call so the third
argument is `selectOut` (the prompt construction is unchanged):

```typescript
  const selectRes = await deps.runSelectAgent(
    worktreePath,
    buildSelectPrompt({
      doneSet: deps.runState.doneSet,
      baselineSummary: JSON.stringify(baseline),
      outputPath: agentWritePath(worktreePath, selectOut),
    }),
    selectOut,
  )
```

In `improvePhase`, change the `deps.runImproveAgent(...)` call so the third
argument is `improveOut`:

```typescript
  const improveRes = await deps.runImproveAgent(
    worktreePath,
    buildImprovePrompt({
      file,
      beforeScore,
      threshold: deps.config.threshold,
      date: new Date().toISOString().slice(0, 10),
      outputPath: agentWritePath(worktreePath, improveOut),
    }),
    improveOut,
  )
```

In `mutation-improve/src/cli.ts`, replace both runner factories:

```typescript
function selectRunner(
  config: MutationImproveConfig,
  runState: MutationImproveRunState,
  log: LiveRenderer,
): PipelineDeps['runSelectAgent'] {
  return (worktreePath, prompt, outputPath) =>
    runAgent({
      spawn: realSpawn,
      model: config.agent.model,
      cwd: worktreePath,
      prompt,
      outputPath,
      outputSchema: SelectionSchema,
      label: 'select',
      logPath: path.join(runState.runDir, 'agent-output.log'),
      extraArgs: config.agent.extraArgs,
      reporter: log,
      timeoutMs: config.agent.timeoutMs,
    })
}

function improveRunner(
  config: MutationImproveConfig,
  runState: MutationImproveRunState,
  log: LiveRenderer,
): PipelineDeps['runImproveAgent'] {
  return (worktreePath, prompt, outputPath) =>
    runAgent({
      spawn: realSpawn,
      model: config.agent.model,
      cwd: worktreePath,
      prompt,
      outputPath,
      outputSchema: ResultSchema,
      label: 'improve',
      logPath: path.join(runState.runDir, 'agent-output.log'),
      extraArgs: config.agent.extraArgs,
      reporter: log,
      timeoutMs: config.agent.timeoutMs,
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS. The existing prompt-path tests
(`select prompt directs the agent to the worktree scratch path…`) keep passing
because the prompt path still derives from the same `selectOut`/`improveOut`.

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/pipeline.ts mutation-improve/src/cli.ts tests/mutation-improve/pipeline.test.ts
git commit -m "fix(mutation-improve): write agent artifacts to per-iteration dirs"
```

---

### Task 4: failure.json + file in failed entries (Unit B)

`failIter` drops the file and never writes the spec'd `iter/<N>/failure.json`.
Add a `recordFailure` helper used by every failure path.

**Files:**
- Modify: `mutation-improve/src/pipeline.ts`
- Test: `tests/mutation-improve/pipeline.test.ts`

**Interfaces:**
- Consumes: `iterDir(runDir, iter)` from `run-state.ts` (already imported in pipeline.ts).
- Produces: `PhaseFail` gains `file?: string`; `failIter` gains a trailing
  `file?: string` parameter; every failure writes
  `<runDir>/iter/<N>/failure.json` containing `{iter, gate, reason, file?}`.

- [ ] **Step 1: Write the failing tests**

In `tests/mutation-improve/pipeline.test.ts`, add to the imports:

```typescript
import { readFile } from 'node:fs/promises'
```

Update the existing test `thrown exception after worktree creation
resets/removes worktree and records exception gate` — replace its
`runState.failed` expectation (the throw happens after selection, so the file
is now recorded) and add a `failure.json` assertion:

```typescript
    expect(deps.runState.failed).toEqual([
      { iter: 1, gate: 'exception', reason: 'agent blew up', file: 'src/live-status/tool-status-labels.ts' },
    ])
    const failure = JSON.parse(
      await readFile(path.join(deps.runState.runDir, 'iter', '1', 'failure.json'), 'utf8'),
    ) as unknown
    expect(failure).toEqual({
      iter: 1,
      gate: 'exception',
      reason: 'agent blew up',
      file: 'src/live-status/tool-status-labels.ts',
    })
```

Append two new tests inside `describe('pipeline runIteration')`:

```typescript
  test('select-gate rejection records the invalidly picked file and writes failure.json', async () => {
    const deps = happyDeps()
    deps.runSelectAgent = (): Promise<{ value: Selection; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...selection, file: 'src/not-in-baseline.ts' }, usage: emptyUsage() })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('select')
    expect(deps.runState.failed[0]).toEqual({
      iter: 1,
      gate: 'select',
      reason: 'selection file not in baseline or already done',
      file: 'src/not-in-baseline.ts',
    })
    const failure = JSON.parse(
      await readFile(path.join(deps.runState.runDir, 'iter', '1', 'failure.json'), 'utf8'),
    ) as unknown
    expect(failure).toEqual({
      iter: 1,
      gate: 'select',
      reason: 'selection file not in baseline or already done',
      file: 'src/not-in-baseline.ts',
    })
  })

  test('createWorktree throw still writes failure.json without a file', async () => {
    const deps = happyDeps()
    deps.createWorktree = (): Promise<void> => Promise.reject(new Error('worktree add failed'))
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    const failure = JSON.parse(
      await readFile(path.join(deps.runState.runDir, 'iter', '1', 'failure.json'), 'utf8'),
    ) as unknown
    expect(failure).toEqual({ iter: 1, gate: 'exception', reason: 'worktree add failed' })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/pipeline.test.ts`
Expected: FAIL — updated exception test sees `failed` without `file`;
`failure.json` reads throw ENOENT.

- [ ] **Step 3: Implement recordFailure + file threading**

In `mutation-improve/src/pipeline.ts`:

1. Change the fs import to `import { mkdir, writeFile } from 'node:fs/promises'`.
2. Change the `PhaseFail` type:

```typescript
type PhaseFail = { ok: false; gate: string; reason: string; file?: string }
```

3. In `selectPhase`, change the rejection return to carry the picked file:

```typescript
  if (deps.runState.doneSet.includes(selection.file) || baseline[selection.file] === undefined) {
    return { ok: false, gate: 'select', reason: 'selection file not in baseline or already done', file: selection.file }
  }
```

4. Replace `failIter` with `recordFailure` + a slimmer `failIter`:

```typescript
type FailureEntry = { iter: number; gate: string; reason: string; file?: string }

// Single failure sink: every failed iteration leaves a durable
// iter/<N>/failure.json (runner-spec artifact) and a state.json entry. The
// file is recorded when known so the summary PR can name what was attempted.
async function recordFailure(
  deps: PipelineDeps,
  iter: number,
  gate: string,
  reason: string,
  file?: string,
): Promise<FailureEntry> {
  const entry: FailureEntry = file === undefined ? { iter, gate, reason } : { iter, gate, reason, file }
  await writeFile(
    path.join(iterDir(deps.runState.runDir, iter), 'failure.json'),
    `${JSON.stringify(entry, null, 2)}\n`,
  )
  deps.runState.failed.push(entry)
  return entry
}

async function failIter(
  deps: PipelineDeps,
  iter: number,
  worktreePath: string,
  gate: string,
  reason: string,
  file?: string,
): Promise<IterationResult> {
  const entry = await recordFailure(deps, iter, gate, reason, file)
  await deps.resetWorktree(worktreePath)
  await deps.removeWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
  return { ...entry, outcome: 'failed' }
}
```

5. In `runIteration`: declare `let file: string | undefined` next to
   `worktreeCreated`; pass `sel.file` on the select-gate failure; set
   `file = selection.file` right after destructuring `sel.value`; pass `file`
   to the gate-failure `failIter` call. Replace the whole catch block with:

```typescript
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // If createWorktree itself threw there is nothing to reset/remove; record
    // the failure (no file — selection never ran) so the run is not dropped.
    if (!worktreeCreated) {
      await recordFailure(deps, iter, 'exception', reason)
      return { iter, outcome: 'failed', gate: 'exception', reason }
    }
    return failIter(deps, iter, worktreePath, 'exception', reason, file)
  }
```

(The pre-existing C2 comment above the `try` stays.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS. Note the `createWorktree throwing records exception gate
without touching reset/remove` test keeps its old `runState.failed`
expectation (no file) and still passes.

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/pipeline.ts tests/mutation-improve/pipeline.test.ts
git commit -m "fix(mutation-improve): record failure.json and file on failed iterations"
```

---

### Task 5: Save run state per iteration (Unit B)

`state.json` is only persisted in the `cli.ts` finally-block, so a crash loses
all progress. Save after every iteration through a new dep.

**Files:**
- Modify: `mutation-improve/src/pipeline.ts` (PipelineDeps + runPipeline)
- Modify: `mutation-improve/src/cli.ts` (`buildPipelineDeps`)
- Test: `tests/mutation-improve/pipeline.test.ts`
- Modify (factory stub): `tests/mutation-improve/integration.test.ts`, `tests/mutation-improve/integration-git.test.ts`

**Interfaces:**
- Consumes: `saveRunState` from `run-state.ts` (already imported in cli.ts).
- Produces: `PipelineDeps.saveRunState: (state: MutationImproveRunState) => Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('pipeline runPipeline')` in
`tests/mutation-improve/pipeline.test.ts`:

```typescript
  test('saves run state after each iteration', async () => {
    const deps = happyDeps()
    deps.config = config(deps.config.repoRoot, { count: 2 })
    deps.measureScore = sequenceMeasure([0.46, 0.97, 0.5, 0.96])
    const picks = ['src/live-status/tool-status-labels.ts', 'src/tools/memory.ts']
    deps.runSelectAgent = sequenceSelect(picks, selection)
    const savedIterations: number[] = []
    deps.saveRunState = (state: MutationImproveRunState): Promise<void> => {
      savedIterations.push(state.currentIteration)
      return Promise.resolve()
    }
    await runPipeline(deps)
    expect(savedIterations).toEqual([1, 2])
  })

  test('merge-abort saves state with status aborted', async () => {
    const deps = happyDeps()
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const savedStatuses: string[] = []
    deps.saveRunState = (state: MutationImproveRunState): Promise<void> => {
      savedStatuses.push(state.status)
      return Promise.resolve()
    }
    const { aborted } = await runPipeline(deps)
    expect(aborted).toBe(true)
    expect(savedStatuses).toEqual(['aborted'])
  })
```

`MutationImproveRunState` is already imported as a type in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/pipeline.test.ts -t "saves run state"`
Expected: typecheck breaks (`saveRunState` not on `PipelineDeps`); at runtime
`deps.saveRunState is not a function`.

- [ ] **Step 3: Implement per-iteration save**

In `mutation-improve/src/pipeline.ts`, `PipelineDeps` gains:

```typescript
    saveRunState: (state: MutationImproveRunState) => Promise<void>
```

In `runPipeline`, replace the `runFrom` body so state is persisted after each
iteration (after the abort-status mutation, so an aborted run resumes correctly):

```typescript
  const runFrom = async (iter: number, aborted: boolean): Promise<{ results: IterationResult[]; aborted: boolean }> => {
    if (aborted || iter > deps.config.count) return { results, aborted }
    deps.runState.currentIteration = iter
    const outcome = await runIteration(deps, iter)
    results.push(outcome)
    if (outcome.gate === 'merge') {
      deps.runState.status = 'aborted'
      await deps.saveRunState(deps.runState)
      return { results, aborted: true }
    }
    await deps.saveRunState(deps.runState)
    return runFrom(iter + 1, false)
  }
```

(The trailing `status = 'completed'` assignment stays; the cli.ts
finally-block save remains the final flush for it.)

In `mutation-improve/src/cli.ts` `buildPipelineDeps`, add the entry
(`saveRunState` is already imported there):

```typescript
    saveRunState,
```

Add the stub to the deps factories: `happyDeps()` in
`tests/mutation-improve/pipeline.test.ts`, and the inline `deps` literals in
`tests/mutation-improve/integration.test.ts` and
`tests/mutation-improve/integration-git.test.ts`:

```typescript
    saveRunState: () => Promise.resolve(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/pipeline.ts mutation-improve/src/cli.ts tests/mutation-improve/pipeline.test.ts tests/mutation-improve/integration.test.ts tests/mutation-improve/integration-git.test.ts
git commit -m "fix(mutation-improve): persist run state after every iteration"
```

---

### Task 6: Integration-branch startup guard (Unit C)

Iterations merge into whatever branch `repoRoot` is checked out on. Fail fast
at startup if that is `base` or a detached HEAD.

**Files:**
- Modify: `mutation-improve/src/finalize.ts` (new export)
- Modify: `mutation-improve/src/cli.ts` (`runCli`)
- Test: `tests/mutation-improve/finalize.test.ts`, `tests/mutation-improve/cli.test.ts`

**Interfaces:**
- Consumes: `ExecGitFn` (already defined in finalize.ts).
- Produces: `assertIntegrationBranch(execGit: ExecGitFn, repoRoot: string, base: string): Promise<void>` — throws when the checked-out branch is `base` or `HEAD` (detached).

- [ ] **Step 1: Write the failing unit tests**

In `tests/mutation-improve/finalize.test.ts`, add `assertIntegrationBranch` to
the finalize.js import and append:

```typescript
describe('assertIntegrationBranch', () => {
  const branchExec =
    (branch: string): ExecGitFn =>
    () =>
      Promise.resolve({ stdout: `${branch}\n`, stderr: '' })

  test('passes on a non-base branch', async () => {
    await expect(
      assertIntegrationBranch(branchExec('mutation-improve-10'), '/repo', 'master'),
    ).resolves.toBeUndefined()
  })

  test('throws on the base branch', async () => {
    await expect(assertIntegrationBranch(branchExec('master'), '/repo', 'master')).rejects.toThrow(
      /integration branch/u,
    )
  })

  test('throws on a detached HEAD', async () => {
    await expect(assertIntegrationBranch(branchExec('HEAD'), '/repo', 'master')).rejects.toThrow(
      /integration branch/u,
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/finalize.test.ts -t "assertIntegrationBranch"`
Expected: FAIL — export does not exist.

- [ ] **Step 3: Implement the guard and wire it into runCli**

Append to `mutation-improve/src/finalize.ts`:

```typescript
// Iterations merge into whatever branch repoRoot is checked out on. Starting
// a run on base (or a detached HEAD) would merge+push straight onto base with
// no PR, so refuse before any run state is created.
export async function assertIntegrationBranch(execGit: ExecGitFn, repoRoot: string, base: string): Promise<void> {
  const { stdout } = await execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = stdout.trim()
  if (branch === base || branch === 'HEAD') {
    throw new Error(
      `mutation-improve merges iterations into the checked-out branch, but repoRoot is on '${branch}'. Check out a non-base integration branch first (base: ${base}).`,
    )
  }
}
```

In `mutation-improve/src/cli.ts`: add `assertIntegrationBranch` to the
`./finalize.js` import, then in `runCli` immediately after the CLI-override
assignments (`if (args.base !== undefined) config.base = args.base`) and before
the `runState` creation:

```typescript
  await assertIntegrationBranch(execGit, config.repoRoot, config.base)
```

- [ ] **Step 4: Write the runCli guard tests (real git)**

In `tests/mutation-improve/cli.test.ts`: hoist the `setupRepo` function out of
`describe('resetRunWorktrees')` to file scope (unchanged body), add `runCli` to
the `'../../mutation-improve/src/cli.js'` import, and append:

```typescript
describe('runCli integration-branch guard', () => {
  test('fails fast on the base branch before creating run state', async () => {
    const { repoRoot } = await setupRepo()
    const configPath = path.join(repoRoot, 'cfg.json')
    writeFileSync(configPath, JSON.stringify({ repoRoot, workDir: '.mi', agent: { model: 'm' } }))
    await expect(runCli(['--config', configPath])).rejects.toThrow(/integration branch/u)
    expect(existsSync(path.join(repoRoot, '.mi', 'runs'))).toBe(false)
  })

  test('fails fast on a detached HEAD', async () => {
    const { repoRoot } = await setupRepo()
    const { stdout: sha } = await execGit(repoRoot, ['rev-parse', 'HEAD'])
    await execGit(repoRoot, ['checkout', sha.trim()])
    const configPath = path.join(repoRoot, 'cfg.json')
    writeFileSync(configPath, JSON.stringify({ repoRoot, workDir: '.mi', agent: { model: 'm' } }))
    await expect(runCli(['--config', configPath])).rejects.toThrow(/integration branch/u)
    expect(existsSync(path.join(repoRoot, '.mi', 'runs'))).toBe(false)
  })
})
```

(setupRepo checks out `master`, which equals the config default `base`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mutation-improve/src/finalize.ts mutation-improve/src/cli.ts tests/mutation-improve/finalize.test.ts tests/mutation-improve/cli.test.ts
git commit -m "fix(mutation-improve): refuse to start a run on base or detached HEAD"
```

---

### Task 7: runFinalize pushes the integration branch, PRs with --head (Unit C)

Finalize currently pushes `base` (wrong — merges are on the checked-out
branch) and opens a PR with no head.

**Files:**
- Modify: `mutation-improve/src/finalize.ts` (`runFinalize`)
- Test: `tests/mutation-improve/finalize.test.ts`
- Modify (mock tweak): `tests/mutation-improve/integration.test.ts`

**Interfaces:**
- Consumes: `ExecGitFn`, `RunGhFn`, `FinalizeInput` (unchanged shapes).
- Produces: `runFinalize` resolves the current branch itself; pushes
  `<upstream> <branch>`; `gh pr create --base <base> --head <branch> …`.

- [ ] **Step 1: Update the failing tests**

In `tests/mutation-improve/finalize.test.ts`, add a module-scope helper above
`describe('finalize')`:

```typescript
const branchExecGit =
  (branch: string, seen?: string[]): ExecGitFn =>
  (_cwd, args) => {
    seen?.push(args.join(' '))
    return Promise.resolve({ stdout: args[0] === 'rev-parse' ? `${branch}\n` : '', stderr: '' })
  }
```

Add `readFile` import: `import { readFile } from 'node:fs/promises'`.

Replace the body of `runFinalize pushes and opens a PR via gh, returning the
URL` from `const seen: string[] = []` onward with:

```typescript
    const seen: string[] = []
    const execGit = branchExecGit('mutation-improve-10', seen)
    let ghArgs: readonly string[] = []
    const runGh: RunGhFn = (args) => {
      ghArgs = args
      return Promise.resolve({ exitCode: 0, stdout: 'https://github.com/x/pull/9\n', stderr: '' })
    }
    const out = await runFinalize({ execGit, runGh }, { config: config(repoRoot), runState })
    expect(out.pushed).toBe(true)
    expect(out.prUrl).toBe('https://github.com/x/pull/9')
    expect(seen).toContain('push origin mutation-improve-10')
    expect(ghArgs).toContain('--head')
    expect(ghArgs[ghArgs.indexOf('--head') + 1]).toBe('mutation-improve-10')
```

In `runFinalize survives gh failure and still reports pushed=true`, replace the
`execGit` line and add a log assertion at the end:

```typescript
    const execGit = branchExecGit('mutation-improve-10')
```

```typescript
    const log = await readFile(`${repoRoot}/.mi/runs/r/finalize.log`, 'utf8')
    expect(log).toContain('--head mutation-improve-10')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/finalize.test.ts`
Expected: FAIL — push is still `push origin master`, no `--head` in gh args,
finalize.log lacks `--head`.

- [ ] **Step 3: Implement the runFinalize fix**

In `mutation-improve/src/finalize.ts`, replace the body of `runFinalize`:

```typescript
export async function runFinalize(deps: FinalizeDeps, input: FinalizeInput): Promise<FinalizeResult> {
  const { config, runState } = input
  const { stdout } = await deps.execGit(config.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = stdout.trim()
  await deps.execGit(config.repoRoot, ['push', config.upstream, branch])
  const title = `mutation-improve: ${runState.merged.map((m) => m.file).join(', ')}`
  const body = buildSummaryBody(runState.merged, runState.failed)
  const result = await deps.runGh(
    ['pr', 'create', '--base', config.base, '--head', branch, '--title', title, '--body', body],
    config.repoRoot,
  )
  if (result.exitCode !== 0) {
    const logPath = path.join(runState.runDir, 'finalize.log')
    await mkdir(path.dirname(logPath), { recursive: true })
    await appendFile(
      logPath,
      `gh pr create failed (exit ${result.exitCode}): ${result.stderr}\nRe-run: gh pr create --base ${config.base} --head ${branch} --title ${JSON.stringify(title)} --body <body>\n`,
    )
    return { pushed: true }
  }
  return { pushed: true, prUrl: result.stdout.trim() || undefined }
}
```

In `tests/mutation-improve/integration.test.ts`, change the `runFinalize`
call's `execGit` mock so `rev-parse` yields a branch:

```typescript
        execGit: () => Promise.resolve({ stdout: 'feat\n', stderr: '' }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/finalize.ts tests/mutation-improve/finalize.test.ts tests/mutation-improve/integration.test.ts
git commit -m "fix(mutation-improve): push integration branch and PR with explicit head"
```

---

### Task 8: Skip-ratchet (Unit D)

A skip means the floor was stale. Ratchet `baseline.json` directly in repoRoot
(on the guarded integration branch) with a baseline-only commit.

**Files:**
- Modify: `mutation-improve/src/pipeline.ts` (`runIteration` skip path + helper)
- Test: `tests/mutation-improve/pipeline.test.ts`

**Interfaces:**
- Consumes: `bumpScore`, `BaselineMap` (already imported in pipeline.ts).
- Produces: no new exports; skip path may call `deps.writeBaseline(repoRoot, …)`
  and `deps.execGit(repoRoot, ['add', …])` / `['commit', …]`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('pipeline runIteration')` in
`tests/mutation-improve/pipeline.test.ts`:

```typescript
  test('skip ratchets a stale baseline floor with a baseline-only commit in repoRoot', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasure([0.97])
    const gitCalls: string[] = []
    deps.execGit = (cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
      gitCalls.push(`${cwd} ${args.join(' ')}`)
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const outcome = await runIteration(deps, 1)
    expect(outcome).toEqual({
      iter: 1,
      outcome: 'skipped',
      file: 'src/live-status/tool-status-labels.ts',
      beforeScore: 0.97,
    })
    const baseline = await deps.readBaseline(deps.config.repoRoot)
    expect(baseline['src/live-status/tool-status-labels.ts']).toBe(0.97)
    const repoRoot = deps.config.repoRoot
    expect(gitCalls).toContain(`${repoRoot} add scripts/mutation/baseline.json`)
    const commitPrefix = `${repoRoot} commit -m chore(mutation): ratchet src/live-status/tool-status-labels.ts baseline to 0.97`
    expect(gitCalls.some((c) => c.startsWith(commitPrefix))).toBe(true)
  })

  test('skip with an accurate floor does not rewrite or commit the baseline', async () => {
    const deps = happyDeps()
    deps.readBaseline = () => Promise.resolve({ 'src/live-status/tool-status-labels.ts': 0.97 })
    let writes = 0
    deps.writeBaseline = (): Promise<void> => {
      writes += 1
      return Promise.resolve()
    }
    const gitCalls: string[] = []
    deps.execGit = (_cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
      gitCalls.push(args.join(' '))
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    deps.measureScore = sequenceMeasure([0.96])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('skipped')
    expect(writes).toBe(0)
    expect(gitCalls.some((c) => c.startsWith('commit'))).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/pipeline.test.ts -t "skip"`
Expected: FAIL — baseline stays 0.46, no add/commit calls recorded.

- [ ] **Step 3: Implement ratchetVerifiedSkip**

In `mutation-improve/src/pipeline.ts`, add above `skipIter`:

```typescript
// A skip means the measured score already clears the threshold while the
// baseline floor lags behind. Ratchet the floor directly on the integration
// branch (repoRoot) so future runs don't re-select the file and burn a full
// mutation run rediscovering it. Only baseline.json is staged, so a dirty
// repoRoot working tree is safe.
async function ratchetVerifiedSkip(
  deps: PipelineDeps,
  baseline: BaselineMap,
  file: string,
  score: number,
): Promise<void> {
  const bumped = bumpScore(baseline, file, score)
  if (bumped[file] === baseline[file]) return
  await deps.writeBaseline(deps.config.repoRoot, bumped)
  await deps.execGit(deps.config.repoRoot, ['add', 'scripts/mutation/baseline.json'])
  await deps.execGit(deps.config.repoRoot, [
    'commit',
    '-m',
    `chore(mutation): ratchet ${file} baseline to ${score} (verified at threshold)`,
  ])
}
```

In `runIteration`, change the skip branch:

```typescript
    const beforeScore = await deps.measureScore(worktreePath, selection.file)
    if (beforeScore >= deps.config.threshold) {
      deps.runState.doneSet.push(selection.file)
      await ratchetVerifiedSkip(deps, baseline, selection.file, beforeScore)
      return await skipIter(deps, iter, worktreePath, selection.file, beforeScore)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/pipeline.ts tests/mutation-improve/pipeline.test.ts
git commit -m "fix(mutation-improve): ratchet baseline floor on threshold-verified skips"
```

---

### Task 9: Rename agentTimeoutMs → mutateTimeoutMs + docs sync (Unit D)

The top-level key gates the mutation-run exec, not agents. Hard rename, no
alias (Zod strips the unknown old key), plus sync the workspace doc.

**Files:**
- Modify: `mutation-improve/src/config.ts`
- Modify: `mutation-improve/src/cli.ts:159`
- Modify: `mutation-improve/config.json`, `mutation-improve/config.example.json`
- Modify: `mutation-improve/CLAUDE.md`
- Test: `tests/mutation-improve/config.test.ts`
- Modify (factory renames): `tests/mutation-improve/pipeline.test.ts`, `tests/mutation-improve/finalize.test.ts`, `tests/mutation-improve/integration.test.ts`, `tests/mutation-improve/integration-git.test.ts`, `tests/mutation-improve/run-state.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MutationImproveConfig.mutateTimeoutMs: number` (replaces
  `agentTimeoutMs`).

- [ ] **Step 1: Write the failing tests**

In `tests/mutation-improve/config.test.ts`, inside the existing
`MutationImproveConfigSchema applies defaults` test add:

```typescript
    expect(parsed.mutateTimeoutMs).toBe(1_800_000)
```

Append a new test in `describe('config')`:

```typescript
  test('MutationImproveConfigSchema strips the legacy agentTimeoutMs key', () => {
    const parsed = MutationImproveConfigSchema.parse({ ...minimalValid, agentTimeoutMs: 5 })
    expect(parsed.mutateTimeoutMs).toBe(1_800_000)
    expect('agentTimeoutMs' in parsed).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/config.test.ts`
Expected: FAIL — `parsed.mutateTimeoutMs` is `undefined`.

- [ ] **Step 3: Rename everywhere**

In `mutation-improve/src/config.ts`, schema line:

```typescript
  mutateTimeoutMs: z.number().int().min(0).default(1_800_000),
```

(replaces `agentTimeoutMs: z.number().int().min(0).default(1_800_000),`).

In `mutation-improve/src/cli.ts:159`:

```typescript
      const exec = createShellExec(worktreePath, `${config.mutateFileCommand} ${srcFile}`, config.mutateTimeoutMs)
```

In `mutation-improve/config.json` and `mutation-improve/config.example.json`:
rename the `"agentTimeoutMs": 1800000` key to `"mutateTimeoutMs": 1800000`.

In the five test files, rename the factory key `agentTimeoutMs:` →
`mutateTimeoutMs:` (values unchanged): `pipeline.test.ts:29`,
`finalize.test.ts:23`, `integration.test.ts:68`, `integration-git.test.ts:89`,
`run-state.test.ts:29`.

In `mutation-improve/CLAUDE.md`:
- `Two timeouts exist: \`agent.timeoutMs\` for agent subprocesses, top-level \`agentTimeoutMs\` for the mutation-run exec, \`buildTimeoutMs\` for the build check.` → `Three timeouts exist: \`agent.timeoutMs\` for agent subprocesses, top-level \`mutateTimeoutMs\` for the mutation-run exec, \`buildTimeoutMs\` for the build check.`
- Purpose paragraph: `merges per-iteration worktree branches into \`base\`; a final step pushes and opens a PR via \`gh\`.` → `merges per-iteration worktree branches into the checked-out integration branch (the CLI refuses to start on \`base\` or a detached HEAD); a final step pushes that branch and opens a PR to \`base\` via \`gh\`.`
- Pipeline step 5: `then merged to \`base\`.` → `then merged into the integration branch.`

- [ ] **Step 4: Run tests + full greps to verify**

Run: `bun run mutation-improve:test && bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check`
Expected: PASS all four.

Run: `rg agentTimeoutMs mutation-improve tests/mutation-improve`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add mutation-improve/src/config.ts mutation-improve/src/cli.ts mutation-improve/config.json mutation-improve/config.example.json mutation-improve/CLAUDE.md tests/mutation-improve/config.test.ts tests/mutation-improve/pipeline.test.ts tests/mutation-improve/finalize.test.ts tests/mutation-improve/integration.test.ts tests/mutation-improve/integration-git.test.ts tests/mutation-improve/run-state.test.ts
git commit -m "refactor(mutation-improve): rename agentTimeoutMs to mutateTimeoutMs"
```

---

## Final verification

After Task 9, from the repo root:

```bash
bun run mutation-improve:test && bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check
```

All four green. Then confirm the eight spec issues map to commits:

| Issue | Fixed by |
|-------|----------|
| 1 build-gate cwd | Task 2 |
| 2 finalize push/PR | Tasks 6, 7 |
| 3 per-iter artifacts | Task 3 |
| 4 state saved once | Task 5 |
| 5 skip no-ratchet | Task 8 |
| 6 failed lacks file | Task 4 |
| 7 rename bypass | Task 1 |
| 8 timeout key | Task 9 |
