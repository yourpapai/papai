// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  runCli,
  runResumeCommand,
  runRunsCommand,
  runStartCommand,
  runStatusCommand,
  runAnalyzeCommand,
  cliMain,
  fullStateSummary,
  parseStartArgs,
} from '../../afk-runner/src/cli.js'
import { readEvents } from '../../afk-runner/src/events.js'
import { BLOCKER_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

/** The run id from a start-command summary's first line. */
function runIdOf(summary: string): string {
  const first = summary.split('\n')[0]
  return first === undefined ? '' : first.replace('run: ', '')
}

/** Truncate the log to everything up to and including the first event of a type (crash simulation). */
function truncateAfterFirst(logPath: string, type: string): void {
  const events = readEvents(logPath)
  const cut = events.findIndex((event) => event.type === type)
  const keep = cut === -1 ? events.length - 1 : cut
  const truncated = events.filter((_event, index) => index <= keep)
  fs.writeFileSync(logPath, truncated.map((event) => JSON.stringify(event)).join('\n') + '\n')
}

/** How many times review was entered in the log. */
function reviewEnterCount(logPath: string): number {
  return readEvents(logPath).filter((event) => event.type === 'stage_enter' && event.stage === 'review').length
}

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: () => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

/**
 * Release ticks until the path exists on disk — a fixed tick count races the
 * presentation write's fs window under load (the wall-clock bound keeps releasing
 * while the write is still in flight).
 */
async function ticksUntilFile(
  clock: { readonly release: () => void },
  filePath: string,
  budgetMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
  }
  return fs.existsSync(filePath)
}

/** Answer a cap-hit blocker gate by hand: override the blocker, approve the gate. */
function overrideCapHitBlocker(gateMd: string): void {
  const md = fs.readFileSync(gateMd, 'utf8').replace('→ <answer or OVERRIDE>', '→ OVERRIDE')
  fs.writeFileSync(gateMd, `${md}\nAPPROVE\n`)
}

const FIXTURE_RUN = path.join(import.meta.dir, 'fixtures', 'real', '2026-08-21T19-44-19-770Z-2f6e644a')

describe('afk-runner cli', () => {
  it('prints a folded state summary with mapped/tolerated accounting for a run dir', () => {
    const summary = runCli([FIXTURE_RUN])
    expect(summary).toContain('value: completed')
    expect(summary).toContain('intake: done')
    expect(summary).toContain('gate: done')
    expect(summary).toContain('events: 886 (mapped 68, tolerated 818)')
  })

  it('exits with a usage error when no run dir is given', () => {
    expect(() => runCli([])).toThrow('usage: afk-runner <runDir>')
  })

  it('exits with a clear error for a run dir without events.ndjson', () => {
    expect(() => runCli([import.meta.dir])).toThrow('events.ndjson not found')
  })
})

describe('afk-runner cli commands (fake agents)', () => {
  it('start drives a fresh think-half run to park and prints the halt', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const summary = await runStartCommand(pipeline.deps, [taskFile])
    expect(summary).toContain('halted: final')
    const runId = runIdOf(summary)
    expect(fs.existsSync(path.join(pipeline.runDirOf(runId), 'events.ndjson'))).toBe(true)
  })

  it('status prints the folded full-state summary', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const started = await runStartCommand(pipeline.deps, [taskFile])
    const runId = runIdOf(started)
    const summary = await runStatusCommand(pipeline.deps, runId)
    expect(summary).toContain('value: completed')
    expect(summary).toContain('depth: S')
    expect(summary).toContain('round: 1/1')
    expect(summary).toContain('last verdict: converged')
    expect(summary).toContain('gate: final v1 answered')
    expect(summary).toContain('halted: final')
    expect(summary).toContain('report: afk-runner report add-thing')
  })

  it('fullStateSummary renders the gate-pending flavor from folded context', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const { statusRun } = await import('../../afk-runner/src/run.js')
    const status = await statusRun(pipeline.deps, runId)
    const lines = fullStateSummary(status)
    expect(lines).toContain('gate: early v1 awaiting')
    expect(lines).toContain('halted: gate-pending')
  })

  it('resume re-enters an interrupted think-half run through the review self-loop', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const logPath = path.join(pipeline.runDirOf(runId), 'events.ndjson')

    // simulate a crash mid-review: drop everything after round_open(1)
    truncateAfterFirst(logPath, 'round_open')
    fs.rmSync(path.join(pipeline.runDirOf(runId), 'state.json'))

    const summary = await runResumeCommand(pipeline.deps, runId)
    expect(summary).toContain('halted: final')
    expect(summary).toContain('resumed: re-entered work')

    expect(reviewEnterCount(logPath)).toBe(2)
  })
})

describe('afk-runner cli start args (parseStartArgs)', () => {
  it('parses a task file with and without a --depth override', () => {
    expect(parseStartArgs(['task.md', '--depth', 'S'])).toEqual({ taskFile: 'task.md', depthOverride: 'S' })
    expect(parseStartArgs(['task.md'])).toEqual({ taskFile: 'task.md' })
  })

  it('keeps the invalid --depth error', () => {
    expect(() => parseStartArgs(['task.md', '--depth', 'X'])).toThrow("invalid --depth 'X' (expected S, M, or L)")
  })

  it('keeps the usage error on a missing task file', () => {
    expect(() => parseStartArgs([])).toThrow('usage: afk-runner start <taskFile> [--depth S|M|L]')
  })
})

/** A documented flag token with its value form, from the doc's backticked `--flag value` prose. */
interface DocFlag {
  readonly flag: string
  readonly valueForm: string
}

/** Extract every backticked `--flag value-form` token the doc names. */
function documentedFlags(doc: string): DocFlag[] {
  return [...doc.matchAll(/`(--[a-z][a-z0-9-]*(?: [^`]*)?)`/gu)].map((m) => {
    const text = m[1] ?? ''
    const space = text.indexOf(' ')
    return space === -1
      ? { flag: text, valueForm: '' }
      : { flag: text.slice(0, space), valueForm: text.slice(space + 1) }
  })
}

/** The argv a documented value form implies: the flag plus its first alternative (`S|M|L` → `S`). */
function argvFor(entry: DocFlag): readonly string[] {
  const first = entry.valueForm.split('|')[0]?.trim() ?? ''
  return first === '' ? ['task.md', entry.flag] : ['task.md', entry.flag, first]
}

/**
 * Accepted = parses without error AND is not silently ignored: the result must
 * differ from the no-flag baseline, so an unknown flag the lenient parser would
 * drop on the floor still trips the pin.
 */
function acceptedByStartParsing(entry: DocFlag): boolean {
  const baseline = JSON.stringify(parseStartArgs(['task.md']))
  try {
    return JSON.stringify(parseStartArgs(argvFor(entry))) !== baseline
  } catch {
    return false
  }
}

describe('sdd-auto command doc flag pin', () => {
  it('every documented flag parses through the start argument parsing with its documented value form', () => {
    const doc = fs.readFileSync(new URL('../../.claude/commands/sdd-auto.md', import.meta.url), 'utf8')
    const flags = documentedFlags(doc)
    // Today's inventory is exactly --depth; a doc that adds or renames a flag
    // fails here until the pin (and parser) consciously follow.
    expect(flags.map((entry) => entry.flag)).toEqual(['--depth'])
    for (const entry of flags) {
      expect(acceptedByStartParsing(entry)).toBe(true)
    }
  })

  it('flags a documented flag the start parsing ignores (doctored-doc tripwire)', () => {
    const doctored = 'Pass the optional `--depth S|M|L` flag, or `--wait 5` to stall.'
    const rejected = documentedFlags(doctored).filter((entry) => !acceptedByStartParsing(entry))
    expect(rejected.map((entry) => entry.flag)).toEqual(['--wait'])
  })
})

describe('afk-runner cli attach policy (start parks, resume attends)', () => {
  it('start parks and exits at a gate: zero gateWait ticks, pointer names the gate file and the resume command', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    let ticks = 0
    const gateWait = {
      tick: (): Promise<void> => {
        ticks += 1
        return Promise.reject(new Error('start must not attach the gate waiter (R4 D2)'))
      },
    }

    const summary = await runStartCommand({ ...pipeline.deps, gateWait }, [taskFile])

    expect(summary).toContain('halted: gate-pending')
    expect(ticks).toBe(0)
    const runId = firstRunOf(pipeline)
    const gatePath = path.join(pipeline.runDirOf(runId), 'gate-1.md')
    expect(fs.existsSync(gatePath)).toBe(true)
    expect(summary).toContain(gatePath)
    expect(summary).toContain(`resume ${runId}`)
  })

  it('resume attaches the foreground waiter at a gate-pending park and settles through released ticks', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const runDir = pipeline.runDirOf(runId)
    overrideCapHitBlocker(path.join(runDir, 'gate-1.md'))

    const clock = fakeClock()
    const resumed = runResumeCommand({ ...pipeline.deps, gateWait: { tick: clock.tick } }, runId)

    // attached: the resume holds in the waiter instead of reporting the park
    const beforeTick = await Promise.race([
      resumed.then((): string => 'returned'),
      new Promise((resolve) => {
        setTimeout((): void => resolve('pending'), 25)
      }),
    ])
    expect(beforeTick).toBe('pending')

    // released ticks settle v1; the re-drive presents the final gate (gate-2.md)
    expect(await ticksUntilFile(clock, path.join(runDir, 'gate-2.md'))).toBe(true)
    // the waiter holds for the v2 answer — Ctrl-C is the operator's exit
    void resumed
  })

  it('bare-arg miss error names the replacement verbs', () => {
    expect(() => runCli([import.meta.dir])).toThrow('start <taskFile>')
    expect(() => runCli([import.meta.dir])).toThrow('resume <runId>')
  })
})

const cliTmpDirs: string[] = []

afterEach(() => {
  while (cliTmpDirs.length > 0) {
    const dir = cliTmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** Content + mtime snapshot of every file under dir (the passive-read-only oracle). */
function snapshotTree(dir: string): Record<string, { content: string; mtimeMs: number }> {
  const snap: Record<string, { content: string; mtimeMs: number }> = {}
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const stat = fs.statSync(full)
        snap[path.relative(dir, full)] = { content: fs.readFileSync(full, 'utf8'), mtimeMs: stat.mtimeMs }
      }
    }
  }
  walk(dir)
  return snap
}

function writeRunsFixture(workDir: string): void {
  const T0 = Date.parse('2026-01-01T00:00:00.000Z')
  const usage = (inputTokens: number): string =>
    JSON.stringify({
      inputTokens,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
    })
  const runs: readonly {
    readonly id: string
    readonly state: Record<string, unknown>
    readonly log: readonly string[]
  }[] = [
    {
      id: 'done-run',
      state: { status: 'completed', gate: null, changeName: 'done-run', updatedAt: '2026-01-01T02:00:00.000Z' },
      log: [
        `{"altitude":"L1","type":"done","agent":"impl","usage":${usage(12_000_000)},"seq":1,"ts":"2026-01-01T00:00:00.000Z"}`,
        `{"altitude":"L1","type":"done","agent":"impl","usage":${usage(1_200_000)},"seq":2,"ts":"2026-01-01T01:00:00.000Z"}`,
      ],
    },
    {
      id: 'gate-run',
      state: {
        status: 'running',
        gate: { mode: 'escalation', version: 2 },
        changeName: 'gate-run',
        updatedAt: '2026-01-01T03:00:00.000Z',
      },
      log: [
        `{"altitude":"L2","type":"stage_enter","stage":"intake","seq":1,"ts":"2026-01-01T00:00:00.000Z"}`,
        `{"altitude":"L2","type":"gate","action":"presented","mode":"escalation","version":2,"seq":2,"ts":"2026-01-01T00:10:00.000Z"}`,
        `{"altitude":"L1","type":"done","agent":"impl","usage":${usage(5_000)},"seq":3,"ts":"2026-01-01T02:30:00.000Z"}`,
      ],
    },
  ]
  for (const run of runs) {
    const runDir = path.join(workDir, 'runs', run.id)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify({ runId: run.id, ...run.state }, null, 2)}\n`)
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${run.log.join('\n')}\n`)
  }
  void T0
}

describe('afk-runner runs command (cross-run accounting)', () => {
  it('prints the roster and totals footer without touching any file under the work dir', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-runs-cli-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const before = snapshotTree(workDir)
    const summary = await runRunsCommand(deps)

    expect(summary).toContain('done-run')
    expect(summary).toContain('gate-run')
    expect(summary).toContain('gate:escalation v2')
    expect(summary).toContain('totals: 2 runs')
    expect(summary).toContain('gate-pending: 1')
    expect(summary).toContain('cost: ≥ $0.00 (2 unpriced)')
    expect(snapshotTree(workDir)).toEqual(before)
  })
})

describe('afk-runner analyze command (read-only corpus report)', () => {
  it('routes by workdir paths, completes a gate-pending corpus byte-unchanged, and prints the report', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-cli-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const before = snapshotTree(workDir)
    const summary = await runAnalyzeCommand(deps, [workDir])

    expect(summary).toContain('afk-runner corpus analysis')
    expect(summary).toContain('## run gate-run')
    expect(summary).toContain('never-answered')
    expect(summary).toContain('## corpus')
    // the gate-pending run is neither presented, settled, nor routed anywhere
    expect(snapshotTree(workDir)).toEqual(before)
  })

  it('defaults to the configured workdir when no workdir args are given', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-def-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const summary = await runAnalyzeCommand(deps, [])
    expect(summary).toContain('## run gate-run')
    expect(summary).toContain('## run done-run')
  })

  it('--json emits the same structure machine-readably', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-json-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const raw = await runAnalyzeCommand(deps, [workDir, '--json'])
    const parsed: unknown = JSON.parse(raw)
    expect(parsed).toMatchObject({
      runs: [{ runId: 'done-run' }, { runId: 'gate-run' }],
      aggregates: { runsAggregated: 2 },
    })
  })

  it('the usage inventory names the analyze verb', async () => {
    const lines: string[] = []
    const original = console.log
    console.log = (line: string): void => {
      lines.push(line)
    }
    try {
      await cliMain(['help'])
    } finally {
      console.log = original
    }
    const usage = lines.join('\n')
    expect(usage).toContain('analyze [workdirs…] [--json]')
  })
})
