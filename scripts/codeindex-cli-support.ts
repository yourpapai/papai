// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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

export interface ResolvedCodeindexModulePaths {
  readonly configModulePath: string
  readonly searchModulePath: string
  readonly storageDbModulePath: string
  readonly typesModulePath: string
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
    throw new Error(
      [`codeindex repo not found at ${repoDir}`, 'Set CODEINDEX_DIR or clone the sibling repo at ../codeindex'].join(
        '\n',
      ),
    )
  }

  return { repoDir, cliPath }
}

export const resolveCodeindexModulePaths = (input: CodeindexResolutionInput = {}): ResolvedCodeindexModulePaths => {
  const { repoDir } = resolveCodeindexPaths(input)

  return {
    configModulePath: path.join(repoDir, 'src', 'config.js'),
    searchModulePath: path.join(repoDir, 'src', 'search.js'),
    storageDbModulePath: path.join(repoDir, 'src', 'storage', 'db.js'),
    typesModulePath: path.join(repoDir, 'src', 'types.js'),
  }
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
