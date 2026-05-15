// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildCodeindexSpawnSpec,
  resolveCodeindexModulePaths,
  resolveCodeindexPaths,
} from '../../scripts/codeindex-cli-support.js'
import { runCodeindexCli, type RunCodeindexCliDeps } from '../../scripts/codeindex-cli.js'

type SpawnInvocation = Readonly<{
  command: string
  args: readonly string[]
  options: Readonly<{ cwd: string; stdio: 'inherit' }>
}>

type SpawnChildLike = Readonly<{
  once(event: 'error', handler: (error: unknown) => void): SpawnChildLike
  once(event: 'exit', handler: (code: number | null) => void): SpawnChildLike
}>

const SIBLING_PATHS = new Set(['/tmp/yourpapai/codeindex/package.json', '/tmp/yourpapai/codeindex/src/cli.ts'])
const CUSTOM_PATHS = new Set(['/opt/tools/codeindex/package.json', '/opt/tools/codeindex/src/cli.ts'])

const hasSiblingPath = (filePath: string): boolean => SIBLING_PATHS.has(filePath)

const hasCustomPath = (filePath: string): boolean => CUSTOM_PATHS.has(filePath)

const createExitChild = (code: number): SpawnChildLike => ({
  once(event: 'error' | 'exit', handler: ((error: unknown) => void) | ((code: number | null) => void)): SpawnChildLike {
    if (event === 'exit') {
      handler(code)
    }
    return createExitChild(code)
  },
})

function emitSpawnError(handler: (error: unknown) => void, error: Error): void {
  handler(error)
}

const isErrorHandler = (
  _handler: ((error: unknown) => void) | ((code: number | null) => void),
): _handler is (error: unknown) => void => true

const createErrorChild = (error: Error): SpawnChildLike => ({
  once(event: 'error' | 'exit', handler: ((error: unknown) => void) | ((code: number | null) => void)): SpawnChildLike {
    if (event === 'error' && isErrorHandler(handler)) {
      emitSpawnError(handler, error)
    }
    return createErrorChild(error)
  },
})

const expectSingleSpawnCall = (
  value: readonly SpawnInvocation[],
): Readonly<{ command: string; args: string[]; cwd: string; stdio: 'inherit' }> => {
  const [call] = value
  expect(value).toHaveLength(1)
  expect(call).toBeDefined()
  if (call === undefined) {
    throw new Error('Expected a spawn call')
  }
  return {
    command: call.command,
    args: [...call.args],
    cwd: call.options.cwd,
    stdio: call.options.stdio,
  }
}

describe('codeindex CLI support', () => {
  test('defaults to sibling ../codeindex when CODEINDEX_DIR is unset', () => {
    const result = resolveCodeindexPaths({
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      pathExists: hasSiblingPath,
    })

    expect(result).toEqual({
      repoDir: '/tmp/yourpapai/codeindex',
      cliPath: '/tmp/yourpapai/codeindex/src/cli.ts',
    })
  })

  test('prefers CODEINDEX_DIR when provided', () => {
    const result = resolveCodeindexPaths({
      repoRoot: '/tmp/yourpapai/papai',
      env: { CODEINDEX_DIR: '/opt/tools/codeindex' },
      pathExists: hasCustomPath,
    })

    expect(result).toEqual({
      repoDir: '/opt/tools/codeindex',
      cliPath: '/opt/tools/codeindex/src/cli.ts',
    })
  })

  test('resolves behavior-audit codeindex module paths from CODEINDEX_DIR', () => {
    const result = resolveCodeindexModulePaths({
      repoRoot: '/tmp/yourpapai/papai',
      env: { CODEINDEX_DIR: '/opt/tools/codeindex' },
      pathExists: hasCustomPath,
    })

    expect(result).toEqual({
      configModulePath: '/opt/tools/codeindex/src/config.js',
      searchModulePath: '/opt/tools/codeindex/src/search.js',
      storageDbModulePath: '/opt/tools/codeindex/src/storage/db.js',
      typesModulePath: '/opt/tools/codeindex/src/types.js',
    })
  })

  test('throws an actionable error when the repo is missing', () => {
    expect(() =>
      resolveCodeindexPaths({
        repoRoot: '/tmp/yourpapai/papai',
        env: {},
        pathExists: () => false,
      }),
    ).toThrow('Set CODEINDEX_DIR or clone the sibling repo at ../codeindex')
  })

  test('builds a bun run spawn spec for delegated subcommands', () => {
    const result = buildCodeindexSpawnSpec(['stats'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      executablePath: 'bun',
      pathExists: hasSiblingPath,
    })

    expect(result).toEqual({
      command: 'bun',
      args: ['run', '/tmp/yourpapai/codeindex/src/cli.ts', 'stats'],
      cwd: '/tmp/yourpapai/papai',
      repoDir: '/tmp/yourpapai/codeindex',
      cliPath: '/tmp/yourpapai/codeindex/src/cli.ts',
    })
  })
})

describe('runCodeindexCli', () => {
  test('spawns bun with inherited stdio and returns the child exit code', async () => {
    const spawnCalls: SpawnInvocation[] = []
    const spawnChild: NonNullable<RunCodeindexCliDeps['spawnChild']> = (command, args, options): SpawnChildLike => {
      spawnCalls.push({ command, args, options })
      return createExitChild(0)
    }

    const exitCode = await runCodeindexCli(['reindex'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      executablePath: 'bun',
      pathExists: hasSiblingPath,
      spawnChild,
      writeStderr: () => {},
    })

    expect(exitCode).toBe(0)
    expect(expectSingleSpawnCall(spawnCalls)).toEqual({
      command: 'bun',
      args: ['run', '/tmp/yourpapai/codeindex/src/cli.ts', 'reindex'],
      cwd: '/tmp/yourpapai/papai',
      stdio: 'inherit',
    })
  })

  test('writes a controlled error and returns 1 when the child fails to spawn', async () => {
    const stderrMessages: string[] = []
    const startupError = Object.assign(new Error('spawn bun ENOENT'), { code: 'ENOENT' })
    const spawnChild: NonNullable<RunCodeindexCliDeps['spawnChild']> = (): SpawnChildLike =>
      createErrorChild(startupError)

    const exitCode = await runCodeindexCli(['reindex'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      executablePath: 'bun',
      pathExists: hasSiblingPath,
      spawnChild,
      writeStderr: (message) => {
        stderrMessages.push(message)
      },
    })

    expect(exitCode).toBe(1)
    expect(stderrMessages).toEqual(['spawn bun ENOENT\n'])
  })
})
