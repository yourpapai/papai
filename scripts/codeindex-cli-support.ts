import { existsSync } from 'node:fs'
import path from 'node:path'

export interface CodeindexResolutionInput {
  readonly repoRoot?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly executablePath?: string
  readonly pathExists?: (filePath: string) => boolean
}

export interface ResolvedCodeindexPaths {
  readonly repoDir: string
  readonly cliPath: string
}

export interface CodeindexSpawnSpec extends ResolvedCodeindexPaths {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

const DEFAULT_REPO_ROOT = path.resolve(import.meta.dir, '..')

const requiredPaths = (repoDir: string): Readonly<{ packageJsonPath: string; cliPath: string }> => ({
  packageJsonPath: path.join(repoDir, 'package.json'),
  cliPath: path.join(repoDir, 'src', 'cli.ts'),
})

export const resolveCodeindexPaths = (input: CodeindexResolutionInput = {}): ResolvedCodeindexPaths => {
  const repoRoot = input.repoRoot ?? DEFAULT_REPO_ROOT
  const env = input.env ?? process.env
  const pathExists = input.pathExists ?? existsSync
  const configuredDir = env['CODEINDEX_DIR']?.trim()
  const repoDir = path.resolve(
    configuredDir === undefined || configuredDir === '' ? path.join(repoRoot, '..', 'codeindex') : configuredDir,
  )
  const { packageJsonPath, cliPath } = requiredPaths(repoDir)

  if (!pathExists(packageJsonPath) || !pathExists(cliPath)) {
    throw new Error([
      `codeindex repo not found at ${repoDir}`,
      'Set CODEINDEX_DIR or clone the sibling repo at ../codeindex',
    ].join('\n'))
  }

  return { repoDir, cliPath }
}

export const buildCodeindexSpawnSpec = (
  argv: readonly string[],
  input: CodeindexResolutionInput = {},
): CodeindexSpawnSpec => {
  const repoRoot = input.repoRoot ?? DEFAULT_REPO_ROOT
  const executablePath = input.executablePath ?? process.execPath
  const { repoDir, cliPath } = resolveCodeindexPaths({ ...input, repoRoot })

  return {
    command: executablePath,
    args: ['run', cliPath, ...argv],
    cwd: repoRoot,
    repoDir,
    cliPath,
  }
}
