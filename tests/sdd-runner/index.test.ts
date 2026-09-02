// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { PathLike, RmOptions } from 'node:fs'
import * as fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { USAGE, readChangeSummary, runEntry } from '../../sdd-runner/src/index.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import { writeHolder } from '../../sdd-runner/src/stop-controller.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-entry-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('USAGE', () => {
  it('names the routing verb and the calm-stop verb', () => {
    expect(USAGE).toContain('sdd [<task-file> | <run-id>]')
    expect(USAGE).toContain('sdd stop [<run-id>]')
  })

  it('pins every usage line, including the blank separators', () => {
    expect(USAGE.split('\n')).toEqual([
      'sdd — autonomous SDD pipeline',
      '',
      'Usage:',
      '  sdd [<task-file> | <run-id>] [--depth S|M|L] [--pr] [--reopen [<n>]] [--config <path>]',
      '  sdd stop [<run-id>]',
      '  sdd analyze [workdirs…] [--json] [--config <path>]',
      '',
      'A task file starts a run; a run id routes by its state (gate decision, resume, report).',
      'No target opens the session screen on a terminal — a loop, not a launcher: pick a run',
      '(Enter/s/r/d — d deletes a dead row behind a named confirmation), start one from a typed',
      'description (n), and every finished action returns to the refreshed list; only an explicit',
      'quit (q) exits. Non-terminals keep the list-and-exit contract. Gate decisions: the TUI on',
      'a terminal; else hand-edit the gate file.',
      'Analyze replays run artifacts read-only across workdirs (default: this worktree) and',
      'prints a corpus report — it never routes into a run or disturbs pending gates.',
    ])
  })
})

describe('sdd bin entry', () => {
  // Every halt line the runner prints names `sdd <run-id>`. Without a bin entry
  // resolving to a shebang'd, runnable file, that hint is a command the operator
  // does not have — and the failure is silent until someone pastes it.
  const packageDir = path.join(import.meta.dir, '..', '..', 'sdd-runner')

  function fieldOf(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null) return undefined
    return Object.getOwnPropertyDescriptor(value, key)?.value
  }

  function binTarget(): string {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
    const target = fieldOf(fieldOf(manifest, 'bin'), 'sdd')
    expect(typeof target).toBe('string')
    return path.resolve(packageDir, typeof target === 'string' ? target : '')
  }

  it('declares an sdd bin whose target exists', () => {
    expect(fs.existsSync(binTarget())).toBe(true)
  })

  it('starts the bin target with a bun shebang so it runs when linked', () => {
    const firstLine = fs.readFileSync(binTarget(), 'utf8').split('\n')[0]
    expect(firstLine).toBe('#!/usr/bin/env bun')
  })
})

describe('readChangeSummary', () => {
  it('counts checked and unchecked task checkboxes', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '## 1\n- [x] 1.1 done\n- [ ] 1.2 todo\n')
    const summary = await readChangeSummary(dir, 'add-thing')
    expect(summary.tasksDone).toBe(1)
    expect(summary.tasksTotal).toBe(2)
  })

  it('counts only line-anchored checkboxes, indented or not, never prose mentions', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(
      path.join(changeDir, 'tasks.md'),
      '## Tasks\n  - [x] indented done\n- [ ] todo\nprose - [x] not a task\nprose - [ ] also not a task\n- [x] done\n  - [ ] indented todo\n',
    )
    const summary = await readChangeSummary(dir, 'add-thing')
    expect(summary.tasksDone).toBe(2)
    expect(summary.tasksTotal).toBe(4)
  })

  it('lists markdown artifacts recursively, ignoring non-markdown files', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# proposal\n')
    fs.writeFileSync(path.join(changeDir, 'notes.txt'), 'not markdown\n')
    fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const summary = await readChangeSummary(dir, 'add-thing')
    expect([...summary.artifacts].sort()).toEqual(['proposal.md', 'spec.md'])
  })

  it('returns zero counts and no artifacts when the change is absent', async () => {
    const dir = makeDir()
    const summary = await readChangeSummary(dir, 'missing')
    expect(summary.tasksDone).toBe(0)
    expect(summary.tasksTotal).toBe(0)
    expect(summary.artifacts).toEqual([])
  })
})

describe('readChangeSummary edges (mutation kills)', () => {
  it('an uppercase X counts as checked; a missing change dir yields zeros and no artifacts', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [X] done uppercase\n')
    const summary = await readChangeSummary(dir, 'add-thing')
    expect(summary.tasksDone).toBe(1)
    expect(summary.tasksTotal).toBe(1)
    expect(summary.artifacts).toStrictEqual(['tasks.md'])

    const missing = await readChangeSummary(dir, 'never-created')
    expect(missing).toStrictEqual({ tasksDone: 0, tasksTotal: 0, artifacts: [] })
  })

  it('collects nested markdown artifacts only, preserving discovery of subdirectories', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'openspec', 'changes', 'nested')
    fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'x')
    fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), 'x')
    fs.writeFileSync(path.join(changeDir, 'notes.txt'), 'x')
    const summary = await readChangeSummary(dir, 'nested')
    expect(summary.artifacts).toContain('proposal.md')
    expect(summary.artifacts).toContain('spec.md')
    expect(summary.artifacts).not.toContain('notes.txt')
    expect(summary.artifacts).toHaveLength(2)
  })
})

describe('runEntry --help (subprocess)', () => {
  it('prints USAGE and exits 0 for --help', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', '--help'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).toBe(0)
    const out = new TextDecoder().decode(proc.stdout)
    expect(out).toContain('sdd — autonomous SDD pipeline')
    expect(out).toContain('sdd stop [<run-id>]')
  })

  it('prints USAGE and exits 0 for -h', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', '-h'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).toBe(0)
    expect(new TextDecoder().decode(proc.stdout)).toContain('sdd — autonomous SDD pipeline')
  })

  it('an unknown flag exits non-zero with the parse error on stderr', () => {
    const proc = Bun.spawnSync(['bun', 'sdd-runner/src/index.ts', 'x.md', '--bogus'], {
      cwd: import.meta.dir + '/../../',
    })
    expect(proc.exitCode).not.toBe(0)
    const err = new TextDecoder().decode(proc.stderr)
    expect(err).toContain('unknown flag')
  })
})

describe('runEntry in-process (help route)', () => {
  it('prints USAGE to stdout and returns without exiting for --help', async () => {
    const writes: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(Buffer.from(chunk).toString())
      return true
    })
    const originalArgv = process.argv
    try {
      process.argv = ['bun', 'sdd-runner', '--help']
      writes.length = 0
      await runEntry()
      expect(writes.join('')).toContain('sdd — autonomous SDD pipeline')
    } finally {
      process.argv = originalArgv
      spy.mockRestore()
      void originalWrite
    }
  })
})

describe('runEntry wiring routes (in-process, mutation kills)', () => {
  interface EntryFixture {
    readonly repoRoot: string
    readonly workDir: string
    readonly configPath: string
    readonly writes: string[]
    readonly exitCodes: number[]
  }

  let fixture: EntryFixture | null = null
  const currentFixture = (): EntryFixture | null => fixture
  let writeSpy: { mockRestore(): void }
  let exitSpy: { mockRestore(): void }
  const saved: { argv: string[]; config: string | undefined } = { argv: [], config: undefined }

  function makeEntryFixture(backend?: 'claude'): EntryFixture {
    const dir = makeDir()
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({
        repoRoot: dir,
        workDir: '.sdd-runner',
        model: 'test-model',
        budget: 5,
        ...(backend === undefined ? {} : { backend }),
      }),
    )
    return {
      repoRoot: dir,
      workDir: path.join(dir, '.sdd-runner'),
      configPath: path.join(dir, 'config.json'),
      writes: [],
      exitCodes: [],
    }
  }

  beforeEach(() => {
    writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      currentFixture()?.writes.push(Buffer.from(chunk).toString())
      return true
    })
    exitSpy = spyOn(process, 'exit').mockImplementation((code?: number): never => {
      currentFixture()?.exitCodes.push(code ?? 0)
      throw new Error(`intercepted process.exit(${code ?? 0})`)
    })
  })

  /**
   * The three names the claude-route guard reads. Every credential test sets
   * all three explicitly: the process running this suite may itself carry a
   * real one, and an inherited spelling would decide the test's outcome.
   */
  const CREDENTIAL_NAMES = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'LLM_API_KEY'] as const
  const savedCredentials = new Map<string, string | undefined>()

  function setCredentials(values: Partial<Record<(typeof CREDENTIAL_NAMES)[number], string>>): void {
    for (const name of CREDENTIAL_NAMES) {
      savedCredentials.set(name, process.env[name])
      const value = values[name]
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
  }

  afterEach(() => {
    process.argv = saved.argv
    if (saved.config === undefined) delete process.env['SDD_RUNNER_CONFIG']
    else process.env['SDD_RUNNER_CONFIG'] = saved.config
    for (const [name, value] of savedCredentials) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
    savedCredentials.clear()
    writeSpy.mockRestore()
    exitSpy.mockRestore()
    fixture = null
  })

  async function runEntryAgainst(target: EntryFixture, args: readonly string[]): Promise<void> {
    fixture = target
    saved.argv = process.argv
    saved.config = process.env['SDD_RUNNER_CONFIG']
    process.env['SDD_RUNNER_CONFIG'] = target.configPath
    process.argv = ['bun', 'sdd', ...args]
    await runEntry()
  }

  it('a non-help argv never prints USAGE; parse errors surface before any wiring', async () => {
    const fx = makeEntryFixture()
    await expect(runEntryAgainst(fx, ['task.md', '--bogus'])).rejects.toThrow(/unknown flag/u)
    expect(fx.writes).toEqual([])
    expect(fx.exitCodes).toEqual([])
  })

  it('stop routes through the harness: marker written, pointer printed, clean exit', async () => {
    const fx = makeEntryFixture()
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    writeHolder(path.join(fx.workDir, 'runs', state.runId), process.pid)
    await expect(runEntryAgainst(fx, ['stop', state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fs.existsSync(path.join(fx.workDir, 'runs', state.runId, 'stop-requested'))).toBe(true)
    expect(fx.writes.join('')).toBe(`calm stop requested for ${state.runId} — honored at the next boundary\n`)
    expect(fx.exitCodes).toEqual([0])
  })

  it('stop settles a dead run through the real wiring: no holder, run aborted, fresh-start pointer', async () => {
    const fx = makeEntryFixture()
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    await expect(runEntryAgainst(fx, ['stop', state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fs.existsSync(path.join(fx.workDir, 'runs', state.runId, 'stop-requested'))).toBe(false)
    expect(fx.writes.join('')).toBe(
      `run ${state.runId} has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>\n`,
    )
    expect((await loadRunState(fx.workDir, state.runId)).status).toBe('aborted')
    expect(fx.exitCodes).toEqual([0])
  })

  it('a completed run id builds and prints its report from the wired harness', async () => {
    const fx = makeEntryFixture()
    execFileSync('git', ['init', '-b', 'sdd-test-branch', fx.repoRoot], { stdio: 'ignore' })
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...state, status: 'completed' })
    fs.writeFileSync(path.join(fx.workDir, 'runs', state.runId, 'events.ndjson'), '')
    await expect(runEntryAgainst(fx, [state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    const out = fx.writes.join('')
    expect(out).toContain(`run: ${state.runId}`)
    expect(out).toContain('review not reached')
    expect(out).toContain('0/0 tasks complete')
    expect(out).toContain('### Commits on sdd-test-branch')
    expect(out).toContain(`transcripts: runs/${state.runId}/transcripts/`)
    expect(fx.exitCodes).toEqual([0])
  })

  it('analyze over explicit workdirs and --json joins stateful runs to ground truth, skips stateless ones', async () => {
    const fx = makeEntryFixture()
    const otherDir = makeDir()
    execFileSync('git', ['init', '-b', 'sdd-test-branch', fx.repoRoot], { stdio: 'ignore' })
    const stateful = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(stateful)
    fs.writeFileSync(path.join(fx.workDir, 'runs', stateful.runId, 'events.ndjson'), '')
    fs.mkdirSync(path.join(otherDir, 'runs', 'stateless-run'), { recursive: true })
    fs.writeFileSync(path.join(otherDir, 'runs', 'stateless-run', 'events.ndjson'), '')
    fs.mkdirSync(path.join(fx.repoRoot, 'openspec', 'changes', 'add-thing'), { recursive: true })
    fs.writeFileSync(path.join(fx.repoRoot, 'openspec', 'changes', 'add-thing', 'tasks.md'), '- [x] one\n- [ ] two\n')
    await expect(
      runEntryAgainst(fx, ['analyze', fx.workDir, otherDir, '--json', '--config', fx.configPath]),
    ).rejects.toThrow(/intercepted process\.exit\(0\)/u)
    const report = z
      .object({
        workdirs: z.array(z.string()),
        runs: z.array(z.object({ runId: z.string() })),
        groundTruth: z.array(
          z.object({
            changeName: z.string(),
            exists: z.boolean(),
            tasksDone: z.number(),
            tasksTotal: z.number(),
          }),
        ),
      })
      .parse(JSON.parse(fx.writes.join('')))
    expect(report.workdirs).toEqual([fx.workDir, otherDir])
    expect(report.runs.map((run) => run.runId).sort()).toEqual([stateful.runId, 'stateless-run'].sort())
    expect(report.groundTruth).toHaveLength(1)
    expect(report.groundTruth[0]).toMatchObject({ changeName: 'add-thing', exists: true, tasksDone: 1, tasksTotal: 2 })
    expect(fx.exitCodes).toEqual([0])
  })

  it('analyze without positionals replays the config workdir and prints the text report', async () => {
    const fx = makeEntryFixture()
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    fs.writeFileSync(path.join(fx.workDir, 'runs', state.runId, 'events.ndjson'), '')
    await expect(runEntryAgainst(fx, ['analyze', '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    const out = fx.writes.join('')
    expect(out).toContain('sdd-runner corpus analysis')
    expect(out).toContain(`workdirs: ${fx.workDir}`)
    expect(out).toContain('runs: 1')
    expect(out).toContain(`## run ${state.runId} (${fx.workDir}) — add-thing ·`)
    expect(fx.exitCodes).toEqual([0])
  })

  /** The runner's own config-dir parent prefix, distinct from the loop's. */
  const CLAUDE_TMP_PREFIX = 'sdd-runner-claude-'

  function claudeParentsInTmp(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(CLAUDE_TMP_PREFIX))
  }

  interface RmTracker {
    readonly claudeTargets: string[]
    restore(): void
  }

  /** The one recorded claude-parent removal target, '' when none was attempted. */
  function soleClaudeTarget(tracker: RmTracker): string {
    return tracker.claudeTargets[0] ?? ''
  }

  /**
   * Records (and optionally fails) the teardown's removal of the config-dir
   * parent. Only claude-parent targets are touched: the same `rm` serves
   * unrelated cleanup inside a run, which must keep working.
   */
  function trackClaudeParentRemoval(fail: boolean): RmTracker {
    const claudeTargets: string[] = []
    const realRm = fsp.rm
    const spy = spyOn(fsp, 'rm').mockImplementation((target: PathLike, options?: RmOptions) => {
      const mine = path.basename(String(target)).startsWith(CLAUDE_TMP_PREFIX)
      if (!mine) return realRm(target, options)
      claudeTargets.push(String(target))
      return fail ? Promise.reject(new Error('teardown removal failed')) : realRm(target, options)
    })
    return {
      claudeTargets,
      restore: (): void => {
        spy.mockRestore()
      },
    }
  }

  /**
   * The claude route's credential guard (D3). `--reopen` is the run-driving
   * verb these cases drive: it is not one of the read-only verbs, and it fails
   * on its own terms (`no settled gate`) without spawning — so the refusal
   * being a credential one, rather than that, is the ordering evidence.
   */
  async function reopenClaudeRun(fx: EntryFixture): Promise<void> {
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    fs.writeFileSync(path.join(fx.workDir, 'runs', state.runId, 'events.ndjson'), '')
    await runEntryAgainst(fx, [state.runId, '--reopen', '1', '--config', fx.configPath])
  }

  it('the claude route refuses an empty credential environment before any run directory exists', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({})
    const taskFile = path.join(fx.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, '# Add a thing\n')
    await expect(runEntryAgainst(fx, [taskFile, '--config', fx.configPath])).rejects.toThrow(/\[CLAUDE_CREDENTIALS\]/u)
    // No run directory means no spawn: the pipeline's first agent starts only
    // after `runStart` has allocated one.
    expect(fs.existsSync(path.join(fx.workDir, 'runs'))).toBe(false)
  })

  it('the claude route refuses both Anthropic spellings set', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-0123456789' })
    await expect(reopenClaudeRun(fx)).rejects.toThrow(/\[CLAUDE_CREDENTIALS\]/u)
  })

  it("the claude route refuses a set LLM_API_KEY, the other route's carrier", async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789', LLM_API_KEY: 'gateway-key' })
    await expect(reopenClaudeRun(fx)).rejects.toThrow(/\[LLM_CREDENTIALS\]/u)
  })

  it('ANTHROPIC_API_KEY alone passes the guard and the verb does its own work', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    // Past the guard, so the failure is the verb's own. Which profile that
    // spelling buys is pinned on `resolveAgentBackend` itself.
    await expect(reopenClaudeRun(fx)).rejects.toThrow(/no settled gate to reopen/u)
  })

  it('CLAUDE_CODE_OAUTH_TOKEN alone passes the guard and the verb does its own work', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-0123456789' })
    await expect(reopenClaudeRun(fx)).rejects.toThrow(/no settled gate to reopen/u)
  })

  it('the stop verb runs on a claude-route config with no credential set', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({})
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    writeHolder(path.join(fx.workDir, 'runs', state.runId), process.pid)
    await expect(runEntryAgainst(fx, ['stop', state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fx.exitCodes).toEqual([0])
  })

  it('the analyze verb runs on a claude-route config with no credential set', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({})
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState(state)
    fs.writeFileSync(path.join(fx.workDir, 'runs', state.runId, 'events.ndjson'), '')
    await expect(runEntryAgainst(fx, ['analyze', '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fx.writes.join('')).toContain('sdd-runner corpus analysis')
    expect(fx.exitCodes).toEqual([0])
  })

  it('the report verb runs on a claude-route config with no credential set', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({})
    execFileSync('git', ['init', '-b', 'sdd-test-branch', fx.repoRoot], { stdio: 'ignore' })
    const state = await createRunState({ workDir: fx.workDir, repoRoot: fx.repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...state, status: 'completed' })
    fs.writeFileSync(path.join(fx.workDir, 'runs', state.runId, 'events.ndjson'), '')
    await expect(runEntryAgainst(fx, [state.runId, '--config', fx.configPath])).rejects.toThrow(
      /intercepted process\.exit\(0\)/u,
    )
    expect(fx.writes.join('')).toContain(`run: ${state.runId}`)
    expect(fx.exitCodes).toEqual([0])
  })

  it('the opencode route reads no credential and opens no config-dir parent', async () => {
    const fx = makeEntryFixture()
    // The environment that refuses a claude-route run outright; the default
    // route must not consult any of it.
    setCredentials({
      ANTHROPIC_API_KEY: 'sk-ant-key-0123456789',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-0123456789',
      LLM_API_KEY: 'gateway-key',
    })
    const tracker = trackClaudeParentRemoval(false)
    const before = claudeParentsInTmp()
    try {
      await expect(reopenClaudeRun(fx)).rejects.toThrow(/no settled gate to reopen/u)
    } finally {
      tracker.restore()
    }
    expect(tracker.claudeTargets).toEqual([])
    expect(claudeParentsInTmp()).toEqual(before)
  })

  it('opens the config-dir parent under the OS tmp root and removes it at teardown', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    const tracker = trackClaudeParentRemoval(false)
    const before = claudeParentsInTmp()
    try {
      await expect(reopenClaudeRun(fx)).rejects.toThrow(/no settled gate to reopen/u)
    } finally {
      tracker.restore()
    }
    expect(tracker.claudeTargets).toHaveLength(1)
    const parent = soleClaudeTarget(tracker)
    // Under the OS tmp root, and inside neither the checkout nor the work dir:
    // session files and CLI state must never land where a commit could stage
    // them or a later run could read them.
    expect(path.dirname(parent)).toBe(os.tmpdir())
    expect(parent.startsWith(fx.repoRoot)).toBe(false)
    expect(parent.startsWith(fx.workDir)).toBe(false)
    // Removed at teardown, whichever way the verb ended.
    expect(fs.existsSync(parent)).toBe(false)
    expect(claudeParentsInTmp()).toEqual(before)
  })

  it('a teardown removal failure changes neither the outcome nor the exit status', async () => {
    const fx = makeEntryFixture('claude')
    setCredentials({ ANTHROPIC_API_KEY: 'sk-ant-key-0123456789' })
    const tracker = trackClaudeParentRemoval(true)
    try {
      // The verb's own failure still surfaces — the teardown's rejection is
      // swallowed rather than replacing or masking it.
      await expect(reopenClaudeRun(fx)).rejects.toThrow(/no settled gate to reopen/u)
    } finally {
      tracker.restore()
      for (const leftover of claudeParentsInTmp()) {
        fs.rmSync(path.join(os.tmpdir(), leftover), { recursive: true, force: true })
      }
    }
    // Not vacuous: the removal really was attempted, and really did fail.
    expect(tracker.claudeTargets).toHaveLength(1)
    expect(fx.exitCodes).toEqual([])
  })
})

describe('report pricing wiring (subprocess)', () => {
  it('reprices the subtree total and per-child cost from the pricing cache, never unknown', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd-runner')
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ repoRoot: dir, workDir, model: 'test/priced-model', budget: 5 }),
    )
    execFileSync('git', ['init', '-b', 'sdd-test-branch', dir], { stdio: 'ignore' })

    const child = await createRunState({ workDir, repoRoot: dir, changeName: 'auth-db' })
    const childLog = path.join(workDir, 'runs', child.runId, 'events.ndjson')
    appendEvent(childLog, {
      altitude: 'L1',
      type: 'spawned',
      agent: 'impl-1',
      role: 'drafter',
      model: 'test/priced-model',
    })
    appendEvent(childLog, {
      altitude: 'L1',
      type: 'done',
      agent: 'impl-1',
      usage: { inputTokens: 1_000_000, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
    })
    await saveRunState({ ...child, status: 'completed' })

    const parent = await createRunState({ workDir, repoRoot: dir, changeName: 'composite' })
    const parentLog = path.join(workDir, 'runs', parent.runId, 'events.ndjson')
    appendEvent(parentLog, {
      altitude: 'L1',
      type: 'spawned',
      agent: 'planner-1',
      role: 'planner',
      model: 'test/priced-model',
    })
    appendEvent(parentLog, {
      altitude: 'L1',
      type: 'done',
      agent: 'planner-1',
      usage: { inputTokens: 2_000_000, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
    })
    appendEvent(parentLog, { altitude: 'L2', type: 'child_spawned', child: 'auth-db', runId: child.runId })
    await saveRunState({
      ...parent,
      status: 'completed',
      plan: { childIds: ['auth-db'], digest: 'd'.repeat(8) },
      children: { 'auth-db': { status: 'done' } },
    })

    const home = makeDir()
    fs.mkdirSync(path.join(home, '.cache', 'sdd-runner'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.cache', 'sdd-runner', 'models.json'),
      JSON.stringify({ test: { models: { 'priced-model': { cost: { input: 3, output: 6 } } } } }),
    )
    const proc = Bun.spawnSync(
      ['bun', 'sdd-runner/src/index.ts', parent.runId, '--config', path.join(dir, 'config.json')],
      {
        cwd: import.meta.dir + '/../../',
        env: { ...process.env, HOME: home },
      },
    )
    expect(proc.exitCode).toBe(0)
    const out = new TextDecoder().decode(proc.stdout)
    expect(out).toContain(`- auth-db · run ${child.runId} · completed · $3.00`)
    expect(out).toContain('subtree total: $6.00')
  })
})
