import { spawn } from 'node:child_process'

import { buildCodeindexSpawnSpec, type CodeindexResolutionInput } from './codeindex-cli-support.js'

export interface RunCodeindexCliDeps extends CodeindexResolutionInput {
  readonly spawnChild?: typeof spawn
  readonly writeStderr?: (message: string) => void
}

export const runCodeindexCli = async (
  argv: readonly string[],
  deps: RunCodeindexCliDeps = {},
): Promise<number> => {
  const spawnChild = deps.spawnChild ?? spawn
  const writeStderr = deps.writeStderr ?? ((message: string) => process.stderr.write(message))

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
