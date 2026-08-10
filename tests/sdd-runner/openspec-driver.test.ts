// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { ExecFn } from '../../sdd-runner/src/openspec-driver.js'

function fakeExec(routes: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>): {
  exec: ExecFn
  calls: string[][]
} {
  const calls: string[][] = []
  const exec: ExecFn = (args) => {
    calls.push([...args])
    const key = args.join(' ')
    for (const [prefix, result] of Object.entries(routes)) {
      if (key.includes(prefix)) {
        return Promise.resolve({
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: result.exitCode ?? 0,
        })
      }
    }
    return Promise.resolve({ stdout: '', stderr: `no route for: ${key}`, exitCode: 127 })
  }
  return { exec, calls }
}

const STATUS_JSON = JSON.stringify({
  changeName: 'add-thing',
  schemaName: 'auto-sdd',
  artifacts: [
    { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] },
    { id: 'specs', outputPath: 'specs/**/*.md', status: 'ready', requires: ['proposal'] },
    { id: 'design', outputPath: 'design.md', status: 'blocked', requires: ['proposal'] },
  ],
  isPlanningComplete: false,
})

describe('newChange', () => {
  it('runs openspec new change with the schema flag and returns the change name', async () => {
    const { exec, calls } = fakeExec({
      'new change': { stdout: "Created change 'add-thing' at openspec/changes/add-thing/\n" },
    })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    const result = await driver.newChange('add-thing', 'auto-sdd')
    expect(result.changeName).toBe('add-thing')
    expect(calls[0]).toContain('new')
    expect(calls[0]).toContain('change')
    expect(calls[0]).toContain('add-thing')
    expect(calls[0]).toContain('--schema')
    expect(calls[0]).toContain('auto-sdd')
  })

  it('surfaces stderr when the CLI fails', async () => {
    const { exec } = fakeExec({ 'new change': { stderr: 'change already exists', exitCode: 1 } })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    await expect(driver.newChange('add-thing', 'auto-sdd')).rejects.toThrow(/already exists/u)
  })
})

describe('status', () => {
  it('parses artifact states into a typed map', async () => {
    const { exec, calls } = fakeExec({ 'status --change': { stdout: STATUS_JSON } })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    const result = await driver.status('add-thing')
    expect(result.artifacts).toEqual({ proposal: 'done', specs: 'ready', design: 'blocked' })
    expect(result.schemaName).toBe('auto-sdd')
    expect(calls[0]).toContain('--json')
    expect(calls[0]).toContain('add-thing')
  })

  it('throws with command context when the JSON is unparseable', async () => {
    const { exec } = fakeExec({ 'status --change': { stdout: 'not json' } })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    await expect(driver.status('add-thing')).rejects.toThrow(/openspec status/u)
  })
})

describe('instructions', () => {
  it('returns instruction, template, rules, and output paths for an artifact', async () => {
    const payload = JSON.stringify({
      instruction: 'Create the proposal.',
      template: '## Why\n',
      rules: ['Name the affected instances'],
      resolvedOutputPath: '/repo/openspec/changes/add-thing/proposal.md',
      existingOutputPaths: [],
      dependencies: [],
    })
    const { exec, calls } = fakeExec({ 'instructions proposal': { stdout: payload } })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    const result = await driver.instructions('proposal', 'add-thing')
    expect(result.instruction).toBe('Create the proposal.')
    expect(result.template).toBe('## Why\n')
    expect(result.rules).toEqual(['Name the affected instances'])
    expect(result.resolvedOutputPath).toBe('/repo/openspec/changes/add-thing/proposal.md')
    const invoked = calls.map((args) => args.join(' ')).join('\n')
    expect(invoked).toContain('instructions')
    expect(invoked).toContain('proposal')
    expect(invoked).toContain('--change add-thing')
    expect(invoked).toContain('--json')
  })
})

describe('validateStrict', () => {
  it('reports ok when the change validates', async () => {
    const { exec, calls } = fakeExec({ 'validate add-thing': { stdout: "Change 'add-thing' is valid\n" } })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    const result = await driver.validateStrict('add-thing')
    expect(result.ok).toBe(true)
    expect(calls[0]).toContain('--strict')
  })

  it('reports the issues when validation fails without throwing', async () => {
    const { exec } = fakeExec({
      'validate add-thing': { stdout: "Change 'add-thing' has issues\n✗ [ERROR] file: no deltas\n", exitCode: 1 },
    })
    const driver = createOpenSpecDriver({ exec, cwd: '/repo' })
    const result = await driver.validateStrict('add-thing')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('no deltas')
  })
})
