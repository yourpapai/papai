// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createOpenSpecDriver } from '../../opencode-agent/src/openspec-driver.js'
import type { OpenSpecDriverDeps } from '../../opencode-agent/src/openspec-driver.js'
import type { CommandRunner, CommandResult } from '../../opencode-agent/src/shell.js'

/**
 * The OpenSpec CLI driver is the thin TypeScript seam over the `openspec`
 * binary — the same division of labour the archived `sdd-runner` established
 * (design D3): TypeScript owns the CLI protocol, the model composes artifact
 * content. These tests pin the argv shape and the zod-decoded JSON contract.
 */
function fakeRunner(routes: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>): {
  runner: CommandRunner
  calls: string[][]
} {
  const calls: string[][] = []
  const runner: CommandRunner = (argv) => {
    calls.push([...argv])
    const key = argv.join(' ')
    for (const [prefix, result] of Object.entries(routes)) {
      if (key.includes(prefix)) {
        const out: CommandResult = {
          command: argv.join(' '),
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: result.exitCode ?? 0,
        }
        return Promise.resolve(out)
      }
    }
    return Promise.resolve({ command: argv.join(' '), stdout: '', stderr: `no route for: ${key}`, exitCode: 127 })
  }
  return { runner, calls }
}

const deps = (runner: CommandRunner, binary = 'openspec'): OpenSpecDriverDeps => ({ runner, cwd: '/repo', binary })

const STATUS_JSON = JSON.stringify({
  changeName: 'add-thing',
  schemaName: 'spec-driven',
  artifacts: [
    { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] },
    { id: 'specs', outputPath: 'specs/**/*.md', status: 'ready', requires: ['proposal'] },
    { id: 'design', outputPath: 'design.md', status: 'blocked', requires: ['proposal'] },
  ],
  isPlanningComplete: false,
})

describe('openspec driver · newChange', () => {
  it('runs `openspec new change <name> --schema <schema>` and returns the name', async () => {
    const { runner, calls } = fakeRunner({ 'new change': { stdout: "Created change 'add-thing'\n" } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.newChange('add-thing', 'spec-driven')
    expect(result.changeName).toBe('add-thing')
    expect(calls[0]).toEqual(['openspec', 'new', 'change', 'add-thing', '--schema', 'spec-driven'])
  })

  it('surfaces stderr when the CLI exits non-zero', async () => {
    const { runner } = fakeRunner({ 'new change': { stderr: 'change already exists', exitCode: 1 } })
    const driver = createOpenSpecDriver(deps(runner))
    await expect(driver.newChange('add-thing', 'spec-driven')).rejects.toThrow(/already exists/u)
  })
})

describe('openspec driver · status', () => {
  it('parses artifact states into a typed map and surfaces planning completeness', async () => {
    const { runner, calls } = fakeRunner({ 'status --change': { stdout: STATUS_JSON } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.status('add-thing')
    expect(result.artifacts).toEqual({ proposal: 'done', specs: 'ready', design: 'blocked' })
    expect(result.schemaName).toBe('spec-driven')
    expect(result.isPlanningComplete).toBe(false)
    expect(calls[0]).toEqual(['openspec', 'status', '--change', 'add-thing', '--json'])
  })

  it('throws naming the command when the JSON is unparseable', async () => {
    const { runner } = fakeRunner({ 'status --change': { stdout: 'not json' } })
    const driver = createOpenSpecDriver(deps(runner))
    await expect(driver.status('add-thing')).rejects.toThrow(/openspec status/u)
  })

  it('treats a missing isPlanningComplete as false rather than undefined', async () => {
    const payload = JSON.stringify({
      changeName: 'add-thing',
      schemaName: 'spec-driven',
      artifacts: [{ id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] }],
    })
    const { runner } = fakeRunner({ 'status --change': { stdout: payload } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.status('add-thing')
    expect(result.isPlanningComplete).toBe(false)
  })
})

describe('openspec driver · instructions', () => {
  it('returns instruction, template, rules, output paths and dependencies for an artifact', async () => {
    const payload = JSON.stringify({
      instruction: 'Create the proposal.',
      template: '## Why\n',
      rules: ['Name the affected instances'],
      resolvedOutputPath: '/repo/openspec/changes/add-thing/proposal.md',
      existingOutputPaths: [],
      dependencies: [],
    })
    const { runner, calls } = fakeRunner({ 'instructions proposal': { stdout: payload } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.instructions('proposal', 'add-thing')
    expect(result.instruction).toBe('Create the proposal.')
    expect(result.template).toBe('## Why\n')
    expect(result.rules).toEqual(['Name the affected instances'])
    expect(result.resolvedOutputPath).toBe('/repo/openspec/changes/add-thing/proposal.md')
    expect(calls[0]).toEqual(['openspec', 'instructions', 'proposal', '--change', 'add-thing', '--json'])
  })

  it('parses structured dependencies (the real CLI shape)', async () => {
    const payload = JSON.stringify({
      instruction: 'Create the specs.',
      resolvedOutputPath: '/repo/openspec/changes/add-thing/specs/x/spec.md',
      dependencies: [{ id: 'proposal', done: true, path: 'proposal.md', description: 'Initial proposal document' }],
    })
    const { runner } = fakeRunner({ 'instructions specs': { stdout: payload } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.instructions('specs', 'add-thing')
    expect(result.dependencies).toEqual([
      { id: 'proposal', done: true, path: 'proposal.md', description: 'Initial proposal document' },
    ])
  })

  it('carries `changeDir`, which is what a glob output path is resolved against', async () => {
    // Recorded from `openspec instructions specs --change <name> --json` on the
    // pinned 1.8.0: the `specs` artifact resolves to a **pattern**, and the
    // change folder beside it is the base the drafter's per-capability paths are
    // relative to. Without it the drafter wrote the pattern itself and PLANNING
    // died on ENOENT.
    const payload = JSON.stringify({
      instruction: 'Create specification files.',
      changeDir: '/repo/openspec/changes/add-thing',
      outputPath: 'specs/**/*.md',
      resolvedOutputPath: '/repo/openspec/changes/add-thing/specs/**/*.md',
    })
    const { runner } = fakeRunner({ 'instructions specs': { stdout: payload } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.instructions('specs', 'add-thing')
    expect(result.changeDir).toBe('/repo/openspec/changes/add-thing')
    expect(result.resolvedOutputPath).toBe('/repo/openspec/changes/add-thing/specs/**/*.md')
  })

  it('leaves `changeDir` undefined when the CLI omits it, rather than rejecting the payload', async () => {
    // Every phase reads `instructions`, so a field that is merely useful must
    // never be the thing that fails them all on a CLI that stops emitting it.
    const payload = JSON.stringify({ instruction: 'Do the thing.', resolvedOutputPath: '/repo/x.md' })
    const { runner } = fakeRunner({ 'instructions design': { stdout: payload } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.instructions('design', 'add-thing')
    expect(result.changeDir).toBeUndefined()
  })

  it('defaults template/rules/paths to empty when the CLI omits them', async () => {
    const payload = JSON.stringify({ instruction: 'Do the thing.', resolvedOutputPath: '/repo/x.md' })
    const { runner } = fakeRunner({ 'instructions design': { stdout: payload } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.instructions('design', 'add-thing')
    expect(result.template).toBeUndefined()
    expect(result.rules).toEqual([])
    expect(result.existingOutputPaths).toEqual([])
    expect(result.dependencies).toEqual([])
  })
})

describe('openspec driver · validateStrict', () => {
  it('reports ok and passes --strict', async () => {
    const { runner, calls } = fakeRunner({ 'validate add-thing': { stdout: "Change 'add-thing' is valid\n" } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.validateStrict('add-thing')
    expect(result.ok).toBe(true)
    expect(result.output).toContain('is valid')
    expect(calls[0]).toEqual(['openspec', 'validate', 'add-thing', '--strict'])
  })

  it('reports not-ok with the complaint in `output` so the drafter retry can attach it', async () => {
    const complaint = "Change 'add-thing' has issues\n\u2713 [ERROR] design.md: no deltas\n"
    const { runner } = fakeRunner({ 'validate add-thing': { stdout: complaint, exitCode: 1 } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.validateStrict('add-thing')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('no deltas')
  })

  it('does not throw on a failing validation — the drafter owns the retry decision', async () => {
    const { runner } = fakeRunner({ 'validate add-thing': { stderr: 'boom', exitCode: 2 } })
    const driver = createOpenSpecDriver(deps(runner))
    const result = await driver.validateStrict('add-thing')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('boom')
  })
})

describe('openspec driver · archive', () => {
  it('runs `openspec archive <name>` for the merged-PR door (design D7)', async () => {
    const { runner, calls } = fakeRunner({ 'archive add-thing': { stdout: "Archived 'add-thing'\n" } })
    const driver = createOpenSpecDriver(deps(runner))
    await driver.archive('add-thing')
    expect(calls[0]).toEqual(['openspec', 'archive', 'add-thing'])
  })

  it('throws naming the command when archive fails', async () => {
    const { runner } = fakeRunner({ 'archive add-thing': { stderr: 'not complete', exitCode: 1 } })
    const driver = createOpenSpecDriver(deps(runner))
    await expect(driver.archive('add-thing')).rejects.toThrow(/openspec archive/u)
  })
})

describe('openspec driver · binary override', () => {
  it('honours a non-default binary path', async () => {
    const { runner, calls } = fakeRunner({ 'new change': { stdout: '' } })
    const driver = createOpenSpecDriver(deps(runner, '/opt/openspec/bin/openspec'))
    await driver.newChange('x', 'spec-driven')
    const [invoked] = calls
    expect(invoked?.[0]).toBe('/opt/openspec/bin/openspec')
  })
})
