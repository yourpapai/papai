// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../../..')
const RUNNER = `${ROOT}/scripts/test-stories.ts`
const PROBE = 'tests/stories/harness/io-guard-probe.ts'

type ChildResult = Readonly<{ exitCode: number; output: string }>

async function run(
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<ChildResult> {
  const child = Bun.spawn(['bun', RUNNER, ...args], {
    cwd: ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, output: `${stdout}\n${stderr}` }
}

const runProbe = (name: string): Promise<ChildResult> => run(['--fixture', PROBE, '--test-name-pattern', `^${name}$`])

describe('hermetic story runner', () => {
  test.each([
    ['rejects undeclared fetch', 'fetch'],
    ['rejects Bun.spawn', 'Bun.spawn'],
    ['rejects Bun.spawnSync', 'Bun.spawnSync'],
    ['rejects child_process execFile', 'child_process.execFile'],
    ['rejects child_process execFileSync', 'child_process.execFileSync'],
    ['rejects child_process spawn', 'child_process.spawn'],
    ['rejects child_process spawnSync', 'child_process.spawnSync'],
    ['rejects socket connect', 'net.connect'],
    ['rejects socket instance connect', 'net.Socket.connect'],
    ['rejects server listen', 'net.Server.listen'],
    ['rejects Bun.serve', 'Bun.serve'],
    ['rejects Bun.write outside root', 'Bun.write'],
    ['rejects Bun.write symlink escape', 'Bun.write'],
    ['rejects Bun.write unsupported target', 'Bun.write'],
    ['rejects fs write outside root', 'fs.writeFileSync'],
    ['rejects fs promises write outside root', 'fs.promises.writeFile'],
    ['rejects fs callback write outside root', 'fs.writeFile'],
    ['rejects fs createWriteStream outside root', 'fs.createWriteStream'],
    ['rejects write-capable fs open outside root', 'fs.promises.open'],
    ['rejects numeric write-capable fs open outside root', 'fs.openSync'],
    ['rejects raw fd write without write-capable open', 'fs.writeSync'],
    ['rejects fs truncate outside root', 'fs.truncateSync'],
    ['rejects fs copy outside root', 'fs.copyFileSync'],
    ['rejects fs removal outside root', 'fs.rmSync'],
    ['rejects symlink escape', 'fs.writeFileSync'],
    ['rejects timer leak', 'scenario leaks (active timers: 1)'],
    ['rejects node timers interval leak', 'scenario leaks (active timers: 1)'],
    ['rejects node timers promises interval leak', 'scenario leaks (active timers: 1)'],
    ['rejects node timers promises scheduler wait leak', 'scenario leaks (active timers: 1)'],
    ['rejects process listener leak', 'scenario leaks (process listeners: 1)'],
    ['rejects one remaining duplicate process listener', 'scenario leaks (process listeners: 1)'],
    ['rejects environment mutation', 'scenario leaks (environment mutations: PAPAI_MUTATED)'],
  ])('%s with a scenario-aware diagnostic', async (scenarioName, operation) => {
    const result = await runProbe(scenarioName)

    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain(scenarioName)
    expect(result.output).toContain('when.ioProbe')
    expect(result.output).toContain(operation)
  })

  test.each([
    'allows declared fetch',
    'allows write inside root',
    'allows Bun.write inside root',
    'allows FileHandle write inside root',
    'allows Bun.write URL inside root',
    'allows tracked raw fd write inside root',
    'allows removed process listener',
    'allows fired process once listener',
    'allows removing process once listener by original function',
    'allows cleared node timers interval',
    'allows completed node timers promise timeout',
    'allows returned node timers promises interval',
    'allows completed node timers promises scheduler wait',
    'allows aborted node timers promises scheduler wait',
    'allows completed node timers promises scheduler yield',
    'allows removing duplicate process listeners twice',
  ])('%s', async (scenarioName) => {
    const result = await runProbe(scenarioName)

    expect(result.exitCode).toBe(0)
  })

  test('does not inherit arbitrary environment or load .env', async () => {
    const result = await run(['--fixture', PROBE, '--test-name-pattern', '^uses sanitized environment$'], {
      ...process.env,
      PAPAI_IO_SENTINEL: 'must-not-leak',
      PAPAI_DOTENV_SENTINEL: 'must-not-load',
    })

    expect(result.exitCode).toBe(0)
  })

  test('rejects unknown command-line arguments', async () => {
    const result = await run(['--watch'])

    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain('Unsupported story runner argument: --watch')
  })

  test('default story-directory discovery excludes special-preload story files', async () => {
    const child = Bun.spawn(
      ['bun', 'test', 'tests/stories', '--test-name-pattern', '^no-default-story-test-can-match-this$'],
      { cwd: ROOT, env: process.env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const output = `${stdout}\n${stderr}`

    expect(exitCode).not.toBe(0)
    expect(output).toContain('tests/stories/harness/io-guard.test.ts')
    expect(output).not.toContain('.story.test.ts')
  })

  test('preload refuses direct use without the story launcher marker', async () => {
    const child = Bun.spawn(
      [
        'bun',
        '--no-env-file',
        'test',
        '--preload',
        './tests/stories/preload.ts',
        '--path-ignore-patterns',
        '',
        `./${PROBE}`,
      ],
      {
        cwd: ROOT,
        env: { PATH: process.env['PATH'], HOME: process.env['HOME'], TMPDIR: process.env['TMPDIR'] },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('PAPAI_STORY_RUNNER=1')
  })
})
