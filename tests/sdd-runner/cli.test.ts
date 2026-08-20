// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { main, parseCliArgs } from '../../sdd-runner/src/cli.js'
import type { CliCommand, CliHarness } from '../../sdd-runner/src/cli.js'
import type { PendingGateEntry } from '../../sdd-runner/src/run-state.js'

function asGateCommand(cmd: CliCommand): Extract<CliCommand, { readonly subcommand: 'gate' }> {
  if (cmd.subcommand !== 'gate') throw new Error('expected a gate command')
  return cmd
}

describe('parseCliArgs', () => {
  it('parses start with a task file and depth override', () => {
    const cmd = parseCliArgs(['start', 'task.md', '--depth', 'S'])
    expect(cmd.subcommand).toBe('start')
    expect(cmd).toMatchObject({ taskFile: 'task.md', depth: 'S' })
  })

  it('parses start with verbosity flag', () => {
    const cmd = parseCliArgs(['start', 'task.md', '--verbosity', 'debug'])
    expect(cmd).toMatchObject({ verbosity: 'debug' })
  })

  it('maps every depth and verbosity value to itself', () => {
    for (const depth of ['S', 'M', 'L'] as const) {
      expect(parseCliArgs(['start', 'task.md', '--depth', depth])).toMatchObject({ depth })
    }
    for (const verbosity of ['brief', 'normal', 'debug'] as const) {
      expect(parseCliArgs(['start', 'task.md', '--verbosity', verbosity])).toMatchObject({ verbosity })
    }
  })

  it('rejects start without a task file', () => {
    expect(() => parseCliArgs(['start'])).toThrow(/task file/u)
  })

  it('rejects invalid --depth and --verbosity values naming the flag and value', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--depth', 'Q'])).toThrow(/invalid --depth: Q/u)
    expect(() => parseCliArgs(['start', 'task.md', '--verbosity', 'loud'])).toThrow(/invalid --verbosity: loud/u)
  })

  it('defaults verbosity to normal', () => {
    const cmd = parseCliArgs(['start', 'task.md'])
    expect(cmd).toMatchObject({ verbosity: 'normal' })
  })

  it('rejects the removed --wait flag as unknown', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--wait'])).toThrow(/unknown flag: --wait/u)
  })

  it('parses --autonomy and --auto-deadline on start', () => {
    const cmd = parseCliArgs(['start', 'task.md', '--autonomy', 'assist', '--auto-deadline', '10'])
    expect(cmd).toMatchObject({ autonomy: 'assist', autoDeadlineMinutes: 10 })
  })

  it('defaults autonomy and deadline to absent on start', () => {
    const cmd = parseCliArgs(['start', 'task.md'])
    expect('autonomy' in cmd).toBe(false)
    expect('autoDeadlineMinutes' in cmd).toBe(false)
  })

  it('rejects an invalid --autonomy level and a non-numeric --auto-deadline', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--autonomy', 'yolo'])).toThrow(/invalid --autonomy: yolo/u)
    expect(() => parseCliArgs(['start', 'task.md', '--auto-deadline', 'soon'])).toThrow(
      /invalid --auto-deadline: soon/u,
    )
  })

  it('maps the observe autonomy level to itself', () => {
    expect(parseCliArgs(['start', 'task.md', '--autonomy', 'observe'])).toMatchObject({ autonomy: 'observe' })
  })

  it('keeps a deadline-only start free of an autonomy key and vice versa', () => {
    const deadlineOnly = parseCliArgs(['start', 'task.md', '--auto-deadline', '10'])
    expect('autonomy' in deadlineOnly).toBe(false)
    expect(deadlineOnly).toMatchObject({ autoDeadlineMinutes: 10 })
    const autonomyOnly = parseCliArgs(['start', 'task.md', '--autonomy', 'auto'])
    expect('autoDeadlineMinutes' in autonomyOnly).toBe(false)
    expect(autonomyOnly).toMatchObject({ autonomy: 'auto' })
  })

  it('rejects zero, negative, infinite, and reformatted --auto-deadline values', () => {
    for (const val of ['0', '-5', 'Infinity', '1e2']) {
      expect(() => parseCliArgs(['start', 'task.md', '--auto-deadline', val])).toThrow(
        `invalid --auto-deadline: ${val}`,
      )
    }
  })

  it('accepts a --auto-deadline value with surrounding whitespace', () => {
    expect(parseCliArgs(['start', 'task.md', '--auto-deadline', ' 10'])).toMatchObject({ autoDeadlineMinutes: 10 })
  })

  it('reports an empty value when a value-taking flag ends the args', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--autonomy'])).toThrow(/invalid --autonomy: $/u)
    expect(() => parseCliArgs(['start', 'task.md', '--auto-deadline'])).toThrow(/invalid --auto-deadline: $/u)
    expect(() => parseCliArgs(['start', 'task.md', '--depth'])).toThrow(/invalid --depth: $/u)
    expect(() => parseCliArgs(['start', 'task.md', '--verbosity'])).toThrow(/invalid --verbosity: $/u)
  })

  it('parses standard flags that come before the autonomy flags', () => {
    expect(parseCliArgs(['start', 'task.md', '--verbosity', 'debug', '--autonomy', 'auto'])).toMatchObject({
      verbosity: 'debug',
      autonomy: 'auto',
    })
  })

  it('parses --autonomy and --auto-deadline on resume and continue', () => {
    expect(parseCliArgs(['resume', 'run-1', '--autonomy', 'auto'])).toMatchObject({
      subcommand: 'resume',
      runId: 'run-1',
      autonomy: 'auto',
    })
    expect(parseCliArgs(['resume', 'run-1', '--auto-deadline', '5'])).toMatchObject({
      subcommand: 'resume',
      runId: 'run-1',
      autoDeadlineMinutes: 5,
    })
    expect(parseCliArgs(['continue', 'run-1', '--autonomy', 'assist'])).toMatchObject({
      subcommand: 'continue',
      runId: 'run-1',
      autonomy: 'assist',
    })
    expect(parseCliArgs(['continue', '--autonomy', 'auto'])).toMatchObject({
      subcommand: 'continue',
      runId: null,
      autonomy: 'auto',
    })
  })

  it('rejects --autonomy on report as an unknown flag', () => {
    expect(() => parseCliArgs(['report', 'run-1', '--autonomy', 'auto'])).toThrow(/unknown flag/u)
  })

  it('parses resume with a run id', () => {
    const cmd = parseCliArgs(['resume', 'run-123'])
    expect(cmd).toMatchObject({ subcommand: 'resume', runId: 'run-123' })
  })

  it('parses gate resume with flags', () => {
    const cmd = parseCliArgs(['gate', 'resume', 'run-123', '--confirm-all'])
    expect(cmd).toMatchObject({ subcommand: 'gate', runId: 'run-123', confirmAll: true })
  })

  it('parses gate resume with abort', () => {
    const cmd = parseCliArgs(['gate', 'resume', 'run-456', '--abort'])
    expect(cmd).toMatchObject({ subcommand: 'gate', runId: 'run-456', abort: true })
  })

  it('parses gate resume with --extend', () => {
    const cmd = parseCliArgs(['gate', 'resume', 'run-1', '--extend'])
    expect(cmd).toMatchObject({ subcommand: 'gate', runId: 'run-1', extend: true })
  })

  it('parses repeatable --veto flags splitting on the first = only', () => {
    const cmd = parseCliArgs([
      'gate',
      'resume',
      'run-1',
      '--veto',
      'A1=redirect=https://example.com',
      '--veto',
      'F2=narrow the gap',
    ])
    expect(cmd).toMatchObject({
      vetoes: [
        { id: 'A1', redirect: 'redirect=https://example.com' },
        { id: 'F2', redirect: 'narrow the gap' },
      ],
    })
  })

  it('rejects --veto without a value', () => {
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--veto'])).toThrow(/--veto/u)
  })

  it('rejects --veto values without an = or with an empty id', () => {
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--veto', 'plain'])).toThrow(/--veto expects/u)
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--veto', '=x'])).toThrow(/--veto expects/u)
  })

  it('omits the redirect when the --veto value ends at =', () => {
    const cmd = asGateCommand(parseCliArgs(['gate', 'resume', 'run-1', '--veto', 'A1=']))
    expect(cmd.vetoes[0]).toStrictEqual({ id: 'A1' })
  })

  it('rejects unknown flags on gate resume', () => {
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--bogus'])).toThrow(/unknown flag: --bogus/u)
  })

  it('requires the resume verb after gate', () => {
    expect(() => parseCliArgs(['gate', 'bogus'])).toThrow(/gate requires/u)
  })

  it('requires a run id for gate resume', () => {
    expect(() => parseCliArgs(['gate', 'resume'])).toThrow(/requires a run id/u)
  })

  it('rejects --extend combined with --confirm-all, --veto, or --abort', () => {
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--extend', '--confirm-all'])).toThrow(/--extend/u)
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--extend', '--abort'])).toThrow(/--extend/u)
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--extend', '--veto', 'A1=x'])).toThrow(/--extend/u)
  })

  it('parses a bare gate command with no run id', () => {
    expect(parseCliArgs(['gate'])).toStrictEqual({
      subcommand: 'gate',
      runId: null,
      confirmAll: false,
      abort: false,
      extend: false,
      vetoes: [],
    })
  })

  it('rejects a bare gate command that carries decision flags', () => {
    expect(() => parseCliArgs(['gate', '--confirm-all'])).toThrow(/gate resume/u)
  })

  it('parses continue with a run id', () => {
    const cmd = parseCliArgs(['continue', 'run-7'])
    expect(cmd).toMatchObject({ subcommand: 'continue', runId: 'run-7' })
  })

  it('parses continue without a run id', () => {
    const cmd = parseCliArgs(['continue'])
    expect(cmd).toStrictEqual({ subcommand: 'continue', runId: null })
  })

  it('rejects extra args on continue', () => {
    expect(() => parseCliArgs(['continue', 'run-1', '--x'])).toThrow(/unknown flag/u)
  })

  it('requires a run id for resume', () => {
    expect(() => parseCliArgs(['resume'])).toThrow(/requires a run id/u)
  })

  it('requires a run id for report', () => {
    expect(() => parseCliArgs(['report'])).toThrow(/requires a run id/u)
  })

  it('defaults report --pr off and rejects unknown report flags', () => {
    expect(parseCliArgs(['report', 'run-1'])).toStrictEqual({ subcommand: 'report', runId: 'run-1', pr: false })
    expect(() => parseCliArgs(['report', 'run-1', '--bogus'])).toThrow(/unknown flag/u)
  })

  it('parses report with --pr', () => {
    const cmd = parseCliArgs(['report', 'run-1', '--pr'])
    expect(cmd).toMatchObject({ subcommand: 'report', runId: 'run-1', pr: true })
  })

  it('throws on missing subcommand', () => {
    expect(() => parseCliArgs([])).toThrow(/missing subcommand/u)
  })

  it('throws on unknown subcommand', () => {
    expect(() => parseCliArgs(['frobnicate'])).toThrow(/unknown.*subcommand/u)
  })
})

function makeHarness(calls: string[], pending: PendingGateEntry[] = []): CliHarness {
  return {
    runStart: (options) => {
      calls.push(`start:${options.taskFile}:${options.depthOverride ?? '-'}:${options.verbosity ?? '-'}`)
      return Promise.resolve({ runId: 'run-1', halted: 'gate', gateMdPath: '/x/gate-1.md', version: 1 })
    },
    runResume: (runId) => {
      calls.push(`resume:${runId}`)
      return Promise.resolve({ runId, halted: 'gate' })
    },
    runGateResume: (runId, options) => {
      const vetoes = options.vetoes === undefined ? 'none' : options.vetoes.map((veto) => veto.id).join('+')
      calls.push(`gate:${runId}:${options.confirmAll ?? false}:${options.abort ?? false}:${vetoes}`)
      return Promise.resolve({ runId, outcome: 'approved', version: 1 })
    },
    runContinue: (runId) => {
      calls.push(`continue:${runId ?? '-'}`)
      return Promise.resolve({ runId: runId ?? 'run-1', routed: 'gate' })
    },
    listPendingGates: () => Promise.resolve(pending),
    buildReport: (runId, pr) => {
      calls.push(`report:${runId}:${pr}`)
      return Promise.resolve(`body for ${runId}`)
    },
    buildAuditReport: () => Promise.reject(new Error('unused')),
    runGateReopen: () => Promise.reject(new Error('unused')),
    runWatch: () => Promise.resolve(),
    stdout: (line) => {
      calls.push(`out:${line}`)
    },
  }
}

describe('main', () => {
  it('routes start to runStart with parsed flags', async () => {
    const calls: string[] = []
    const code = await main(['start', 'task.md', '--depth', 'S'], makeHarness(calls))
    expect(code).toBe(0)
    expect(calls).toContain('start:task.md:S:normal')
  })

  it('forwards --verbosity to runStart', async () => {
    const calls: string[] = []
    await main(['start', 'task.md', '--verbosity', 'debug'], makeHarness(calls))
    expect(calls).toContain('start:task.md:-:debug')
  })

  it('routes resume and gate resume', async () => {
    const calls: string[] = []
    await main(['resume', 'run-9'], makeHarness(calls))
    await main(['gate', 'resume', 'run-9', '--confirm-all'], makeHarness(calls))
    expect(calls).toContain('resume:run-9')
    expect(calls).toContain('gate:run-9:true:false:none')
  })

  it('routes report and prints the body; --pr propagates', async () => {
    const calls: string[] = []
    await main(['report', 'run-2', '--pr'], makeHarness(calls))
    expect(calls).toContain('report:run-2:true')
    expect(calls.some((c) => c.startsWith('out:body for run-2'))).toBe(true)
  })

  it('routes continue with and without a run id', async () => {
    const calls: string[] = []
    await main(['continue', 'run-4'], makeHarness(calls))
    await main(['continue'], makeHarness(calls))
    expect(calls).toContain('continue:run-4')
    expect(calls).toContain('continue:-')
  })

  it('forwards --veto decisions to runGateResume', async () => {
    const calls: string[] = []
    await main(['gate', 'resume', 'run-9', '--veto', 'A1=narrow it', '--veto', 'F2='], makeHarness(calls))
    expect(calls).toContain('gate:run-9:false:false:A1+F2')
  })

  it('lists pending gates on a bare gate command without resuming anything', async () => {
    const calls: string[] = []
    const pending: PendingGateEntry[] = [
      {
        runId: 'run-1',
        changeName: 'add-x',
        gateMode: 'early',
        gateVersion: 2,
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]
    const code = await main(['gate'], makeHarness(calls, pending))
    expect(code).toBe(0)
    expect(calls).toContain('out:gate-pending: run-1  (add-x, gate v2, updated 2026-02-01T00:00:00.000Z)')
    expect(calls).toContain('out:  sdd-runner gate resume run-1')
    expect(calls.every((line) => !line.startsWith('gate:'))).toBe(true)
  })

  it('says so when no runs await gate decisions', async () => {
    const calls: string[] = []
    await main(['gate'], makeHarness(calls))
    expect(calls).toContain('out:no runs await gate decisions')
  })
})

interface MainCapture {
  readonly startOptions: unknown[]
  readonly resumeCalls: unknown[][]
  readonly continueCalls: unknown[][]
  readonly gateCalls: unknown[][]
  readonly harness: CliHarness
}

function captureHarness(): MainCapture {
  const startOptions: unknown[] = []
  const resumeCalls: unknown[][] = []
  const continueCalls: unknown[][] = []
  const gateCalls: unknown[][] = []
  const harness: CliHarness = {
    runStart: (options) => {
      startOptions.push(options)
      return Promise.resolve({ runId: 'run-1', halted: 'gate', gateMdPath: '/x/gate-1.md', version: 1 })
    },
    runResume: (runId, autonomy) => {
      resumeCalls.push([runId, autonomy])
      return Promise.resolve({ runId, halted: 'gate' })
    },
    runGateResume: (runId, options) => {
      gateCalls.push([runId, options])
      return Promise.resolve({ runId, outcome: 'approved', version: 1 })
    },
    runContinue: (runId, autonomy) => {
      continueCalls.push([runId, autonomy])
      return Promise.resolve({ runId: runId ?? 'run-1', routed: 'gate' })
    },
    listPendingGates: () => Promise.resolve([]),
    buildReport: () => Promise.resolve('body'),
    buildAuditReport: () => Promise.resolve('audit-body'),
    runGateReopen: (runId) => Promise.resolve({ runId, gateVersion: 1 }),
    runWatch: () => Promise.resolve(),
    stdout: () => {},
  }
  return { startOptions, resumeCalls, continueCalls, gateCalls, harness }
}

describe('main autonomy and gate decision wiring', () => {
  it('gate resume without a run id lists pending gates and never reopens', async () => {
    const cap = captureHarness()
    const pendingCalls: number[] = []
    const reopenCalls: string[][] = []
    const harness: CliHarness = {
      ...cap.harness,
      listPendingGates: () => {
        pendingCalls.push(1)
        return Promise.resolve([])
      },
      runGateReopen: (runId, version) => {
        reopenCalls.push([runId, String(version)])
        return Promise.resolve({ runId, gateVersion: version })
      },
    }
    await main(['gate'], harness)
    expect(pendingCalls).toHaveLength(1)
    expect(reopenCalls).toEqual([])
  })

  it('nests parsed autonomy overrides under autonomy on start options', async () => {
    const cap = captureHarness()
    await main(['start', 'task.md', '--autonomy', 'assist', '--auto-deadline', '10'], cap.harness)
    expect(cap.startOptions[0]).toMatchObject({
      taskFile: 'task.md',
      autonomy: { level: 'assist', deadlineMinutes: 10 },
    })
  })

  it('sends empty autonomy overrides on start when no autonomy flags are given', async () => {
    const cap = captureHarness()
    await main(['start', 'task.md'], cap.harness)
    expect(cap.startOptions[0]).toMatchObject({ autonomy: {} })
  })

  it('forwards autonomy overrides on resume and continue', async () => {
    const cap = captureHarness()
    await main(['resume', 'run-1', '--autonomy', 'auto'], cap.harness)
    expect(cap.resumeCalls[0]).toEqual(['run-1', { level: 'auto' }])
    await main(['continue', 'run-1', '--auto-deadline', '5'], cap.harness)
    expect(cap.continueCalls[0]).toEqual(['run-1', { deadlineMinutes: 5 }])
    await main(['resume', 'run-2'], cap.harness)
    expect(cap.resumeCalls[1]).toEqual(['run-2', {}])
  })

  it('forwards --abort and --extend decisions to runGateResume as sole keys', async () => {
    const cap = captureHarness()
    await main(['gate', 'resume', 'run-1', '--abort'], cap.harness)
    expect(cap.gateCalls[0]).toEqual(['run-1', { abort: true }])
    await main(['gate', 'resume', 'run-2', '--extend'], cap.harness)
    expect(cap.gateCalls[1]).toEqual(['run-2', { extend: true }])
  })

  it('forwards --wait-deadline and --no-wait to runGateResume as sole keys', async () => {
    const cap = captureHarness()
    await main(['gate', 'resume', 'run-1', '--wait-deadline'], cap.harness)
    expect(cap.gateCalls[0]).toEqual(['run-1', { waitDeadline: true }])
    await main(['gate', 'resume', 'run-2', '--no-wait'], cap.harness)
    expect(cap.gateCalls[1]).toEqual(['run-2', { noWait: true }])
  })

  it('forwards gate --verbosity as its own key', async () => {
    const cap = captureHarness()
    await main(['gate', 'resume', 'run-1', '--verbosity', 'quiet'], cap.harness)
    expect(cap.gateCalls[0]).toEqual(['run-1', { verbosity: 'quiet' }])
  })

  it('omits verbosity from gate resume options when the flag is absent', async () => {
    const cap = captureHarness()
    await main(['gate', 'resume', 'run-1', '--abort'], cap.harness)
    expect(cap.gateCalls[0]).toStrictEqual(['run-1', { abort: true }])
  })

  it('gate resume routes to runGateResume even when another gate verb exists in the grammar', async () => {
    const cap = captureHarness()
    const reopenCalls: string[] = []
    const harness: CliHarness = {
      ...cap.harness,
      runGateReopen: (runId) => {
        reopenCalls.push(runId)
        return Promise.resolve({ runId, gateVersion: 1 })
      },
    }
    await main(['gate', 'resume', 'run-1', '--confirm-all'], harness)
    expect(cap.gateCalls[0]).toStrictEqual(['run-1', { confirmAll: true }])
    expect(reopenCalls).toHaveLength(0)
  })

  it('never claims an empty pending list while entries print', async () => {
    const pending: PendingGateEntry[] = [
      {
        runId: 'run-1',
        changeName: 'add-x',
        gateMode: 'early',
        gateVersion: 1,
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]
    const lines: string[] = []
    const harness: CliHarness = {
      ...captureHarness().harness,
      listPendingGates: () => Promise.resolve(pending),
      stdout: (line) => {
        lines.push(line)
      },
    }
    await main(['gate'], harness)
    expect(lines).toContain('gate-pending: run-1  (add-x, gate v1, updated 2026-02-01T00:00:00.000Z)')
    expect(lines).not.toContain('no runs await gate decisions')
  })
})

describe('audit and gate reopen verbs', () => {
  it('parses audit <runId>', () => {
    expect(parseCliArgs(['audit', 'run-1'])).toMatchObject({ subcommand: 'audit', runId: 'run-1' })
    expect(() => parseCliArgs(['audit'])).toThrow(/run id/u)
  })

  it('parses gate reopen <runId> --gate <n> and rejects invalid gate versions', () => {
    expect(parseCliArgs(['gate', 'reopen', 'run-1', '--gate', '2'])).toMatchObject({
      subcommand: 'gate',
      gateVerb: 'reopen',
      runId: 'run-1',
      reopenGateVersion: 2,
    })
    expect(() => parseCliArgs(['gate', 'reopen', 'run-1', '--gate', 'x'])).toThrow(/invalid --gate/u)
    expect(() => parseCliArgs(['gate', 'reopen', 'run-1'])).toThrow(/--gate/u)
    expect(() => parseCliArgs(['gate', 'reopen', 'run-1', '--gate'])).toThrow(/invalid --gate: $/u)
  })

  it('gate reopen requires a run id and rejects unknown flags naming them', () => {
    expect(() => parseCliArgs(['gate', 'reopen'])).toThrow('gate reopen requires a run id')
    expect(() => parseCliArgs(['gate', 'reopen', 'run-1', '--bogus'])).toThrow('unknown flag: --bogus')
  })

  it('gate reopen rejects zero and negative gate versions', () => {
    expect(() => parseCliArgs(['gate', 'reopen', 'run-1', '--gate', '0'])).toThrow('invalid --gate: 0')
    expect(() => parseCliArgs(['gate', 'reopen', 'run-1', '--gate', '-1'])).toThrow('invalid --gate: -1')
  })

  it('gate reopen carries no decision flags in its parsed shape', () => {
    expect(parseCliArgs(['gate', 'reopen', 'run-1', '--gate', '3'])).toStrictEqual({
      subcommand: 'gate',
      gateVerb: 'reopen',
      runId: 'run-1',
      reopenGateVersion: 3,
      confirmAll: false,
      abort: false,
      extend: false,
      vetoes: [],
    })
  })

  it('gate resume without --verbosity carries no verbosity key, and with it carries the value', () => {
    const without = parseCliArgs(['gate', 'resume', 'run-1', '--abort'])
    expect('verbosity' in without).toBe(false)
    const withVerbosity = parseCliArgs(['gate', 'resume', 'run-1', '--verbosity', 'debug'])
    expect(withVerbosity).toMatchObject({ verbosity: 'debug' })
    expect('waitDeadline' in withVerbosity).toBe(false)
    expect('noWait' in withVerbosity).toBe(false)
  })

  it('a standard start flag followed by autonomy flags parses both', () => {
    expect(parseCliArgs(['start', 'task.md', '--depth', 'L', '--autonomy', 'auto'])).toStrictEqual({
      subcommand: 'start',
      taskFile: 'task.md',
      depth: 'L',
      verbosity: 'normal',
      autonomy: 'auto',
    })
    expect(parseCliArgs(['start', 'task.md', '--depth', 'S', '--verbosity', 'debug'])).toMatchObject({
      depth: 'S',
      verbosity: 'debug',
    })
  })

  it('an invalid verbosity value after a depth flag is rejected as an invalid verbosity, not an unknown flag', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--depth', 'S', '--verbosity', 'silent'])).toThrow(
      /invalid --verbosity: silent/u,
    )
  })

  it('a bare gate listing never routes to runGateReopen', async () => {
    const cap = captureHarness()
    const reopenCalls: string[] = []
    const harness: CliHarness = {
      ...cap.harness,
      runGateReopen: (runId) => {
        reopenCalls.push(runId)
        return Promise.resolve({ runId, gateVersion: 1 })
      },
    }
    await main(['gate'], harness)
    expect(reopenCalls).toHaveLength(0)
    await main(['gate', 'resume', 'run-1', '--abort'], harness)
    expect(reopenCalls).toHaveLength(0)
    expect(cap.gateCalls[0]).toStrictEqual(['run-1', { abort: true }])
  })

  it('audit rejects extra flags as unknown', () => {
    expect(() => parseCliArgs(['audit', 'run-1', '--bogus'])).toThrow('unknown flag: --bogus')
  })

  it('main routes audit to harness.buildAuditReport output', async () => {
    const calls: string[] = []
    await main(['audit', 'run-9'], makeAuditHarness(calls))
    expect(calls.join('\n')).toContain('audit:run-9')
    expect(calls.join('\n')).toContain('report-body')
  })

  it('main routes gate reopen to harness.runGateReopen, and only reopen does', async () => {
    const calls: string[] = []
    const harness: CliHarness = {
      ...makeAuditHarness(calls),
      runGateResume: () => Promise.resolve({ runId: 'run-9', outcome: 'approved', version: 1 }),
    }
    await main(['gate', 'resume', 'run-9', '--abort'], harness)
    expect(calls.filter((c) => c.startsWith('reopen:'))).toHaveLength(0)
    calls.length = 0
    await main(['gate', 'reopen', 'run-9', '--gate', '3'], harness)
    expect(calls).toContain('reopen:run-9:3')
  })
})

function makeAuditHarness(calls: string[]): CliHarness {
  return {
    runStart: () => Promise.reject(new Error('unused')),
    runResume: () => Promise.reject(new Error('unused')),
    runGateResume: () => Promise.reject(new Error('unused')),
    runContinue: () => Promise.reject(new Error('unused')),
    listPendingGates: () => Promise.resolve([]),
    buildReport: () => Promise.reject(new Error('unused')),
    buildAuditReport: (runId: string) => {
      calls.push(`audit:${runId}`)
      return Promise.resolve('report-body')
    },
    runWatch: (): Promise<void> => Promise.resolve(),
    runGateReopen: (runId: string, gateVersion: number) => {
      calls.push(`reopen:${runId}:${gateVersion}`)
      return Promise.resolve({ runId, gateVersion })
    },
    stdout: (line: string) => {
      calls.push(`out:${line}`)
    },
  }
}

describe('gate resume deadline flags (12.2)', () => {
  it('parses --wait-deadline and --no-wait on gate resume', () => {
    expect(parseCliArgs(['gate', 'resume', 'run-1', '--wait-deadline'])).toMatchObject({ waitDeadline: true })
    expect(parseCliArgs(['gate', 'resume', 'run-1', '--no-wait'])).toMatchObject({ noWait: true })
  })

  it('--no-wait and --wait-deadline conflict', () => {
    expect(() => parseCliArgs(['gate', 'resume', 'run-1', '--wait-deadline', '--no-wait'])).toThrow(
      /cannot be combined/u,
    )
  })
})

describe('quiet verbosity (13.7)', () => {
  it('parses quiet on start and rejects unknown values naming the flag', () => {
    expect(parseCliArgs(['start', 'task.md', '--verbosity', 'quiet'])).toMatchObject({ verbosity: 'quiet' })
    expect(() => parseCliArgs(['start', 'task.md', '--verbosity', 'silent'])).toThrow(/invalid --verbosity: silent/u)
  })

  it('accepts --verbosity on resume, continue, and gate', () => {
    expect(parseCliArgs(['resume', 'r1', '--verbosity', 'quiet'])).toMatchObject({ verbosity: 'quiet' })
    expect(parseCliArgs(['continue', 'r1', '--verbosity', 'quiet'])).toMatchObject({ verbosity: 'quiet' })
    expect(parseCliArgs(['gate', 'resume', 'r1', '--verbosity', 'quiet'])).toMatchObject({ verbosity: 'quiet' })
  })

  it('maps every gate verbosity value to itself, rejecting empty and unknown values', () => {
    for (const value of ['quiet', 'brief', 'normal', 'debug'] as const) {
      expect(parseCliArgs(['gate', 'resume', 'r1', '--verbosity', value])).toMatchObject({ verbosity: value })
    }
    expect(() => parseCliArgs(['gate', 'resume', 'r1', '--verbosity', 'loud'])).toThrow('invalid --verbosity: loud')
    expect(() => parseCliArgs(['gate', 'resume', 'r1', '--verbosity', ''])).toThrow('invalid --verbosity: ')
  })

  it('deadline-only and level-only overrides carry exactly one key', () => {
    const deadlineOnly = parseCliArgs(['start', 'task.md', '--auto-deadline', '10'])
    expect('autonomy' in deadlineOnly).toBe(false)
    const levelOnly = parseCliArgs(['start', 'task.md', '--autonomy', 'assist'])
    expect('autoDeadlineMinutes' in levelOnly).toBe(false)
  })

  it('rejects a trailing --autonomy or --verbosity value naming the empty value', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--autonomy'])).toThrow(/invalid --autonomy: $/u)
    expect(() => parseCliArgs(['gate', 'resume', 'r1', '--verbosity'])).toThrow(/invalid --verbosity: $/u)
  })
})

describe('watch verb (15.3)', () => {
  it('parses watch <runId> and rejects missing ids', () => {
    expect(parseCliArgs(['watch', 'run-1'])).toMatchObject({ subcommand: 'watch', runId: 'run-1' })
    expect(() => parseCliArgs(['watch'])).toThrow(/run id/u)
    expect(() => parseCliArgs(['watch', 'a/b'])).toThrow(/path separator/u)
  })

  it('rejects unknown watch flags naming the flag', () => {
    expect(() => parseCliArgs(['watch', 'run-1', '--bogus'])).toThrow('unknown flag: --bogus')
  })

  it('dispatches watch <runId> to the harness and returns 0', async () => {
    const watchCalls: string[] = []
    const harness: CliHarness = {
      ...captureHarness().harness,
      runWatch: (runId) => {
        watchCalls.push(runId)
        return Promise.resolve()
      },
    }
    const code = await main(['watch', 'run-7'], harness)
    expect(code).toBe(0)
    expect(watchCalls).toEqual(['run-7'])
  })
})
