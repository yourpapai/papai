// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import * as fs from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * Path containment and plugin-relative import resolution: the rules that keep a
 * plugin's entry graph inside its own directory.
 */
export const discoveryPathOps: { realpathSync: (path: fs.PathLike) => string } = {
  realpathSync: (path) => fs.realpathSync(path),
}

export function isPathInsideDirectory(
  directoryPath: string,
  candidatePath: string,
  pathOps: {
    isAbsolute(path: string): boolean
    relative(from: string, to: string): string
    resolve(...paths: string[]): string
    sep: string
  } = { isAbsolute: (path) => resolve(path) === path, relative, resolve, sep },
): boolean {
  const relativePath = pathOps.relative(pathOps.resolve(directoryPath), pathOps.resolve(candidatePath))
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${pathOps.sep}`) && relativePath !== '..' && !pathOps.isAbsolute(relativePath))
  )
}

export function isRealDirectory(path: string): boolean {
  try {
    const stat = fs.lstatSync(path)
    if (stat.isSymbolicLink()) return false
    return stat.isDirectory()
  } catch {
    return false
  }
}

export function resolveRealPathInsidePlugin(pluginDir: string, candidatePath: string, specifier: string): string {
  const realPluginDir = discoveryPathOps.realpathSync(pluginDir)
  const realCandidatePath = discoveryPathOps.realpathSync(candidatePath)
  if (!isPathInsideDirectory(realPluginDir, realCandidatePath)) {
    throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
  }
  return realCandidatePath
}

export const isRelativePluginImport = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../')

function wrapPluginImportVerificationError(specifier: string, error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error))
  return new Error(`Failed to verify plugin import path for ${specifier}: ${cause.message}`, { cause })
}

export function resolveEntryImport(fromFile: string, pluginDir: string, specifier: string): string {
  const candidate = resolve(join(dirname(fromFile), specifier))
  if (!isPathInsideDirectory(pluginDir, candidate)) {
    throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
  }

  const candidates = candidate.endsWith('.ts')
    ? [candidate]
    : candidate.endsWith('.js')
      ? [candidate, `${candidate.slice(0, -3)}.ts`]
      : [`${candidate}.ts`, `${candidate}.js`, join(candidate, 'index.ts'), join(candidate, 'index.js')]

  const resolvedPath = candidates.find((path) => fs.existsSync(path))
  if (resolvedPath === undefined) throw new Error(`Imported plugin file not found: ${specifier}`)

  try {
    resolveRealPathInsidePlugin(pluginDir, resolvedPath, specifier)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Plugin import resolves outside plugin directory:')) {
      throw error
    }
    throw wrapPluginImportVerificationError(specifier, error)
  }

  return resolvedPath
}
