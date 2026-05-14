import { describe, expect, test } from 'bun:test'

import {
  buildCodeindexSpawnSpec,
  resolveCodeindexPaths,
} from '../../scripts/codeindex-cli-support.js'
import { runCodeindexCli } from '../../scripts/codeindex-cli.js'

describe('codeindex CLI support', () => {
  test('defaults to sibling ../codeindex when CODEINDEX_DIR is unset', () => {
    const result = resolveCodeindexPaths({
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      pathExists: (filePath) =>
        filePath === '/tmp/yourpapai/codeindex/package.json' ||
        filePath === '/tmp/yourpapai/codeindex/src/cli.ts',
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
      pathExists: (filePath) =>
        filePath === '/opt/tools/codeindex/package.json' ||
        filePath === '/opt/tools/codeindex/src/cli.ts',
    })

    expect(result).toEqual({
      repoDir: '/opt/tools/codeindex',
      cliPath: '/opt/tools/codeindex/src/cli.ts',
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
      pathExists: (filePath) =>
        filePath === '/tmp/yourpapai/codeindex/package.json' ||
        filePath === '/tmp/yourpapai/codeindex/src/cli.ts',
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

    const exitCode = await runCodeindexCli(['reindex'], {
      repoRoot: '/tmp/yourpapai/papai',
      env: {},
      pathExists: (filePath) =>
        filePath === '/tmp/yourpapai/codeindex/package.json' ||
        filePath === '/tmp/yourpapai/codeindex/src/cli.ts',
      spawnChild: (command, args, options) => {
        spawnCalls.push({
          command,
          args: [...args],
          cwd: options.cwd,
          stdio: options.stdio,
        })

        return {
          once(event, handler) {
            if (event === 'exit') handler(0)
            return this
          },
        } as unknown as ReturnType<typeof import('node:child_process').spawn>
      },
      writeStderr: () => undefined,
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
})
