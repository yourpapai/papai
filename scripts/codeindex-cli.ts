// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'

import { buildCodeindexSpawnSpec, type CodeindexResolutionInput } from './codeindex-cli-support.js'

type SpawnChildLike = Readonly<{
  once: (event: 'error', handler: (error: unknown) => void) => SpawnChildLike
}> & {
  once: (event: 'exit', handler: (code: number | null) => void) => SpawnChildLike
}

type SpawnChild = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; stdio: 'inherit' }>,
) => SpawnChildLike

export interface RunCodeindexCliDeps extends CodeindexResolutionInput {
  readonly spawnChild?: SpawnChild
  readonly writeStderr?: (message: string) => void
}

export const runCodeindexCli = async (argv: readonly string[], deps: RunCodeindexCliDeps = {}): Promise<number> => {
  const spawnChild: SpawnChild = deps.spawnChild ?? spawn
  const writeStderr =
    deps.writeStderr ??
    ((message: string): void => {
      process.stderr.write(message)
    })

  let spec
  try {
    spec = buildCodeindexSpawnSpec(argv, deps)
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  try {
    return await new Promise<number>((resolve) => {
      const child = spawnChild(spec.command, [...spec.args], {
        cwd: spec.cwd,
        stdio: 'inherit',
      })

      child.once('error', (error) => {
        writeStderr(`${error instanceof Error ? error.message : String(error)}\n`)
        resolve(1)
      })
      child.once('exit', (code) => {
        resolve(code ?? 1)
      })
    })
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (import.meta.main) {
  const exitCode = await runCodeindexCli(process.argv.slice(2))
  process.exit(exitCode)
}
