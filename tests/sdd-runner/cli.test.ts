// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { main, parseCliArgs } from '../../sdd-runner/src/cli.js'
import type { CliHarness } from '../../sdd-runner/src/cli.js'

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

  it('defaults verbosity to normal', () => {
    const cmd = parseCliArgs(['start', 'task.md'])
    expect(cmd).toMatchObject({ verbosity: 'normal' })
  })

  it('rejects the removed --wait flag as unknown', () => {
    expect(() => parseCliArgs(['start', 'task.md', '--wait'])).toThrow(/unknown flag: --wait/u)
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

  it('parses report with --pr', () => {
    const cmd = parseCliArgs(['report', 'run-1', '--pr'])
    expect(cmd).toMatchObject({ subcommand: 'report', runId: 'run-1', pr: true })
  })

  it('throws on missing subcommand', () => {
    expect(() => parseCliArgs([])).toThrow(/subcommand/u)
  })

  it('throws on unknown subcommand', () => {
    expect(() => parseCliArgs(['frobnicate'])).toThrow(/unknown.*subcommand/u)
  })
})

function makeHarness(calls: string[]): CliHarness {
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
      calls.push(`gate:${runId}:${options.confirmAll ?? false}:${options.abort ?? false}`)
      return Promise.resolve({ runId, outcome: 'approved', version: 1 })
    },
    buildReport: (runId, pr) => {
      calls.push(`report:${runId}:${pr}`)
      return Promise.resolve(`body for ${runId}`)
    },
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
    expect(calls).toContain('gate:run-9:true:false')
  })

  it('routes report and prints the body; --pr propagates', async () => {
    const calls: string[] = []
    await main(['report', 'run-2', '--pr'], makeHarness(calls))
    expect(calls).toContain('report:run-2:true')
    expect(calls.some((c) => c.startsWith('out:body for run-2'))).toBe(true)
  })
})
