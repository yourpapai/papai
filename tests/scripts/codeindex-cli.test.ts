import { describe, expect, test } from 'bun:test'
import type { SpawnOptions } from 'node:child_process'

import {
  buildCodeindexSpawnSpec,
  resolveCodeindexModulePaths,
  resolveCodeindexPaths,
} from '../../scripts/codeindex-cli-support.js'
import { runCodeindexCli, type RunCodeindexCliDeps } from '../../scripts/codeindex-cli.js'

const SIBLING_PATHS = new Set(['/tmp/yourpapai/codeindex/package.json', '/tmp/yourpapai/codeindex/src/cli.ts'])
const CUSTOM_PATHS = new Set(['/opt/tools/codeindex/package.json', '/opt/tools/codeindex/src/cli.ts'])

const hasSiblingPath = (filePath: string): boolean => SIBLING_PATHS.has(filePath)

const hasCustomPath = (filePath: string): boolean => CUSTOM_PATHS.has(filePath)

const createExitChild = (code: number): ReturnType<typeof import('node:child_process').spawn> =>
  ({
    once(event: string, handler: (value: number) => void) {
      if (event === 'exit') handler(code)
      return this
    },
  }) as ReturnType<typeof import('node:child_process').spawn>

const createErrorChild = (error: Error): ReturnType<typeof import('node:child_process').spawn> =>
  ({
    once(event: string, handler: (value: Error) => void) {
      if (event === 'error') handler(error)
      return this
    },
  }) as ReturnType<typeof import('node:child_process').spawn>

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
    const spawnCalls: Array<{ command: string; args: string[]; cwd: string; stdio: string }> = []
    const spawnChild = ((command: string, args?: readonly string[], options?: SpawnOptions) => {
      if (
        args === undefined ||
        options === undefined ||
        typeof options.cwd !== 'string' ||
        options.stdio !== 'inherit'
      ) {
        throw new Error('Unexpected spawn arguments')
      }

      spawnCalls.push({
        command,
        args: [...args],
        cwd: options.cwd,
        stdio: options.stdio,
      })

      return createExitChild(0)
    }) as NonNullable<RunCodeindexCliDeps['spawnChild']>

    const exitCode = await runCodeindexCli(['reindex'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      executablePath: 'bun',
      pathExists: hasSiblingPath,
      spawnChild,
      writeStderr: () => {},
    })

    expect(exitCode).toBe(0)
    expect(spawnCalls).toEqual([
      {
        command: 'bun',
        args: ['run', '/tmp/yourpapai/codeindex/src/cli.ts', 'reindex'],
        cwd: '/tmp/yourpapai/papai',
        stdio: 'inherit',
      },
    ])
  })

  test('writes a controlled error and returns 1 when the child fails to spawn', async () => {
    const stderrMessages: string[] = []
    const startupError = Object.assign(new Error('spawn bun ENOENT'), { code: 'ENOENT' })
    const spawnChild = (() => createErrorChild(startupError)) as NonNullable<RunCodeindexCliDeps['spawnChild']>

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
