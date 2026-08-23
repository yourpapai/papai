// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { main, parseSddArgs } from '../../sdd-runner/src/cli.js'
import type { CliHarness } from '../../sdd-runner/src/cli.js'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdd-cli-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function seedRun(
  workDir: string,
  runId: string,
  mutate: (state: { gate: { mode: 'final' | 'early'; version: number } | null; status: string }) => void,
): void {
  const runDir = path.join(workDir, 'runs', runId)
  mkdirSync(runDir, { recursive: true })
  const now = '2026-01-01T00:00:00.000Z'
  const state = {
    runId,
    repoRoot: workDir,
    workDir,
    changeName: 'thing',
    stage: 'review',
    depth: 'S',
    round: 1,
    gate: null as { mode: 'final' | 'early'; version: number } | null,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
  }
  mutate(state)
  writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state, null, 2))
}

function captureHarness(workDir: string): { harness: CliHarness; calls: string[] } {
  const calls: string[] = []
  const harness: CliHarness = {
    workDir,
    runStart: (options) => {
      calls.push(`start:${options.taskFile}:${options.depthOverride ?? '-'}`)
      return Promise.resolve({ runId: 'run-1', halted: 'gate', gateMdPath: '/x/gate-1.md', version: 1 })
    },
    runResume: (runId) => {
      calls.push(`resume:${runId}`)
      return Promise.resolve({ runId, halted: 'stopped' })
    },
    runGateResume: (runId) => {
      calls.push(`gate:${runId}`)
      return Promise.resolve({ runId, outcome: 'approved', version: 1 })
    },
    runContinue: (runId) => {
      calls.push(`continue:${runId ?? '-'}`)
      return Promise.resolve({ runId: runId ?? '', routed: 'gate' })
    },
    buildReport: (runId, pr) => {
      calls.push(`report:${runId}:${pr ? 'pr' : 'full'}`)
      return Promise.resolve(`report of ${runId}`)
    },
    requestCalmStop: (runId) => {
      calls.push(`stop:${runId}`)
      return Promise.resolve({ kind: 'marker-requested', runId })
    },
    runGateReopen: (runId, version) => {
      calls.push(`reopen:${runId}:${version}`)
      return Promise.resolve({ runId, gateVersion: version })
    },
    stdout: (line) => {
      calls.push(`out:${line}`)
    },
  }
  return { harness, calls }
}

describe('parseSddArgs (6.1/6.2)', () => {
  it('parses a bare target, depth, config, pr, and reopen forms', () => {
    expect(parseSddArgs(['task.md'])).toMatchObject({ target: 'task.md', verb: 'route' })
    expect(parseSddArgs(['task.md', '--depth', 'S'])).toMatchObject({ target: 'task.md', depth: 'S' })
    expect(parseSddArgs(['run-1', '--pr'])).toMatchObject({ target: 'run-1', pr: true })
    expect(parseSddArgs(['run-1', '--reopen'])).toMatchObject({ reopen: true })
    expect(parseSddArgs(['run-1', '--reopen', '3'])).toMatchObject({ reopen: 3 })
    expect(parseSddArgs(['--config', '/x/config.json'])).toMatchObject({ configPath: '/x/config.json' })
    expect(parseSddArgs(['stop'])).toMatchObject({ verb: 'stop' })
    expect(parseSddArgs(['stop', 'run-1'])).toMatchObject({ verb: 'stop', target: 'run-1' })
  })

  it('rejects invalid depth and unknown flags listing the valid set', () => {
    expect(() => parseSddArgs(['task.md', '--depth', 'X'])).toThrow(/invalid --depth/u)
    expect(() => parseSddArgs(['task.md', '--wat'])).toThrow(/unknown flag: --wat.*--depth.*--config.*--pr.*--reopen/su)
  })

  it('removed decision flags fail pointing at the gate file', () => {
    expect(() => parseSddArgs(['run-1', '--confirm-all'])).toThrow(/gate file/u)
    expect(() => parseSddArgs(['run-1', '--veto', 'A1=x'])).toThrow(/gate file/u)
    expect(() => parseSddArgs(['run-1', '--autonomy', 'auto'])).toThrow(/gate file/u)
  })
})

describe('main routing dispatch (6.2)', () => {
  it('a task file starts a run with the depth override', async () => {
    const dir = makeDir()
    const task = path.join(dir, 'task.md')
    writeFileSync(task, '# Add thing\n')
    const { harness, calls } = captureHarness(path.join(dir, '.sdd'))
    await main([task, '--depth', 'L'], harness)
    expect(calls[0]).toBe(`start:${task}:L`)
  })

  it('a gate-pending run opens the decision flow; a completed run prints its report', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'gatey', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    seedRun(workDir, 'fin', (state) => {
      state.status = 'completed'
    })
    const gate = captureHarness(workDir)
    await main(['gatey'], gate.harness)
    expect(gate.calls[0]).toBe('gate:gatey')
    const report = captureHarness(workDir)
    await main(['fin', '--pr'], report.harness)
    expect(report.calls[0]).toBe('report:fin:pr')
  })

  it('sdd stop targets the sole active run and stays calm', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'only-active', (state) => {
      state.status = 'running'
    })
    const { harness, calls } = captureHarness(workDir)
    await main(['stop'], harness)
    expect(calls[0]).toBe('stop:only-active')
    expect(calls[1]).toBe('out:calm stop requested for only-active — honored at the next boundary')
  })

  it('sdd stop prints the settle line for a dead run', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'zombie', (state) => {
      state.status = 'running'
    })
    const calls: string[] = []
    const harness: CliHarness = {
      ...captureHarness(workDir).harness,
      requestCalmStop: (runId) => {
        calls.push(`stop:${runId}`)
        return Promise.resolve({ kind: 'settled', runId, to: 'aborted' })
      },
      stdout: (line) => {
        calls.push(`out:${line}`)
      },
    }
    await main(['stop', 'zombie'], harness)
    expect(calls[0]).toBe('stop:zombie')
    expect(calls[1]).toBe(
      'out:run zombie has no live process — settled as aborted · nothing to resume, start fresh: sdd <task-file>',
    )
  })

  it('sdd <run> --reopen forwards to the gate reopen verb', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'reopenable', (state) => {
      state.status = 'completed'
    })
    const { harness, calls } = captureHarness(workDir)
    await main(['reopenable', '--reopen', '2'], harness)
    expect(calls[0]).toBe('reopen:reopenable:2')
  })

  it('legacy subcommand shapes fail naming the routing replacement', async () => {
    const dir = makeDir()
    const { harness } = captureHarness(path.join(dir, '.sdd'))
    await expect(main(['start', 'task.md'], harness)).rejects.toThrow(/sdd <task-file>/u)
    await expect(main(['gate', 'resume', 'run-1'], harness)).rejects.toThrow(/sdd <run-id>/u)
  })
})

describe('main interactive dispatch (session loop)', () => {
  function interactiveHarness(workDir: string): { harness: CliHarness; loops: string[] } {
    const loops: string[] = []
    const harness: CliHarness = {
      ...captureHarness(workDir).harness,
      interactive: (): boolean => true,
      sessionLoop: (options): Promise<void> => {
        loops.push(`${options.initial}:${options.depth ?? '-'}`)
        return Promise.resolve()
      },
    }
    return { harness, loops }
  }

  it('ambiguous runs on a terminal enter the looping screen once, on the list', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'run-a', (state) => {
      state.status = 'completed'
    })
    seedRun(workDir, 'run-b', (state) => {
      state.status = 'completed'
    })
    const { harness, loops } = interactiveHarness(workDir)
    await main([], harness)
    expect(loops).toEqual(['list:-'])
  })

  it('zero runs on a terminal enter the loop on the creation screen, depth carried', async () => {
    const dir = makeDir()
    const { harness, loops } = interactiveHarness(path.join(dir, '.sdd'))
    await main(['--depth', 'L'], harness)
    expect(loops).toEqual(['create:L'])
  })

  it('a missing loop seam on an interactive route fails loudly', async () => {
    const dir = makeDir()
    const harness: CliHarness = { ...captureHarness(path.join(dir, '.sdd')).harness, interactive: () => true }
    await expect(main([], harness)).rejects.toThrow(/sessionLoop/u)
  })
})
