// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { logger } from '../logger.js'
import { readPluginSourceGraph } from './discovery-imports.js'
import { pluginManifestSchema } from './types.js'
import type { DiscoveredPlugin } from './types.js'

const log = logger.child({ scope: 'plugins:discovery' })

export const discoveryPathOps: { realpathSync: (path: fs.PathLike) => string } = {
  realpathSync: (path) => fs.realpathSync(path),
}

export type DiscoveryError = {
  directoryName: string
  reason: string
}

export type DiscoveryResult = {
  plugins: DiscoveredPlugin[]
  errors: DiscoveryError[]
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

function isRealDirectory(path: string): boolean {
  try {
    const stat = fs.lstatSync(path)
    if (stat.isSymbolicLink()) return false
    return stat.isDirectory()
  } catch {
    return false
  }
}

function resolveRealPathInsidePlugin(pluginDir: string, candidatePath: string, specifier: string): string {
  const realPluginDir = discoveryPathOps.realpathSync(pluginDir)
  const realCandidatePath = discoveryPathOps.realpathSync(candidatePath)
  if (!isPathInsideDirectory(realPluginDir, realCandidatePath)) {
    throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
  }
  return realCandidatePath
}

const isRelativePluginImport = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../')

function wrapPluginImportVerificationError(specifier: string, error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error))
  return new Error(`Failed to verify plugin import path for ${specifier}: ${cause.message}`, { cause })
}

const makeDiscoveryError = (directoryName: string, reason: string): DiscoveryError => ({ directoryName, reason })

function resolveEntryImport(fromFile: string, pluginDir: string, specifier: string): string {
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

function computePluginManifestHash(manifestContent: string, sourceFiles: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update(`${manifestContent.length}:`).update(manifestContent)

  const sourceRoot = sourceFiles[0] === undefined ? '' : dirname(sourceFiles[0])

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const relativeFilePath = sourceRoot === '' ? filePath : relative(sourceRoot, filePath).split(sep).join('/')
    hash.update(`${relativeFilePath.length}:`).update(relativeFilePath)
    hash.update(`${content.length}:`).update(content)
  }

  return hash.digest('hex')
}

function resolveEntryPoint(pluginDir: string, main: string): string | null {
  const resolved = resolve(join(pluginDir, main))
  if (!isPathInsideDirectory(pluginDir, resolved)) return null
  try {
    resolveRealPathInsidePlugin(pluginDir, resolved, main)
  } catch {
    return null
  }
  return resolved
}

function parseAndValidateManifest(
  manifestPath: string,
  dirName: string,
): { manifest: ReturnType<typeof pluginManifestSchema.parse>; manifestContent: string } | DiscoveryError {
  let manifestContent: string
  try {
    manifestContent = fs.readFileSync(manifestPath, 'utf-8')
  } catch (error) {
    return makeDiscoveryError(
      dirName,
      `Failed to read plugin.json: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(manifestContent) as unknown
  } catch (error) {
    return makeDiscoveryError(
      dirName,
      `Invalid JSON in plugin.json: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const parseResult = pluginManifestSchema.safeParse(parsed)
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => i.message).join('; ')
    return makeDiscoveryError(dirName, `Manifest validation failed: ${issues}`)
  }

  if (parseResult.data.id !== dirName)
    return makeDiscoveryError(dirName, `Plugin id "${parseResult.data.id}" does not match directory name "${dirName}"`)

  return { manifest: parseResult.data, manifestContent }
}

function resolveEntrypointForDiscovery(
  pluginDir: string,
  main: string | undefined,
): { entryPoint: string; sourceFiles: string[] } | DiscoveryError {
  if (main === undefined) return { entryPoint: '', sourceFiles: [] }

  const entryPoint = resolveEntryPoint(pluginDir, main)
  if (entryPoint === null) return makeDiscoveryError('', `Entry point "${main}" resolves outside the plugin directory`)

  try {
    const sourceFiles = readPluginSourceGraph(
      entryPoint,
      pluginDir,
      {
        isRelativePluginImport,
        resolveEntryImport,
      },
      fs.readFileSync,
    )
    return { entryPoint, sourceFiles }
  } catch (error) {
    return makeDiscoveryError('', error instanceof Error ? error.message : String(error))
  }
}

function discoverOne(pluginsRootDir: string, dirName: string): DiscoveredPlugin | DiscoveryError {
  const pluginDir = join(pluginsRootDir, dirName)

  if (!isRealDirectory(pluginDir)) {
    return {
      directoryName: dirName,
      reason: `${dirName} is not a real directory (may be a symlink)`,
    }
  }

  const manifestPath = join(pluginDir, 'plugin.json')
  if (!fs.existsSync(manifestPath)) {
    return { directoryName: dirName, reason: 'Missing plugin.json' }
  }

  const parsed = parseAndValidateManifest(manifestPath, dirName)
  if ('reason' in parsed) return parsed

  const { manifest, manifestContent } = parsed

  const ep = resolveEntrypointForDiscovery(pluginDir, manifest.main)
  if ('reason' in ep) return { ...ep, directoryName: dirName }

  return {
    manifest,
    pluginDir: resolve(pluginDir),
    entryPoint: ep.entryPoint,
    manifestHash: computePluginManifestHash(manifestContent, ep.sourceFiles),
  }
}

export function discoverPlugins(pluginsDir: string): DiscoveryResult {
  log.debug({ pluginsDir }, 'Starting plugin discovery')

  if (!fs.existsSync(pluginsDir)) {
    log.debug({ pluginsDir }, 'Plugins directory does not exist — no plugins to discover')
    return { plugins: [], errors: [] }
  }

  let entries: string[]
  try {
    entries = fs.readdirSync(pluginsDir).sort()
  } catch (error) {
    log.warn(
      { pluginsDir, error: error instanceof Error ? error.message : String(error) },
      'Failed to read plugins directory',
    )
    return { plugins: [], errors: [] }
  }

  const plugins: DiscoveredPlugin[] = []
  const errors: DiscoveryError[] = []
  const seenIds = new Set<string>()

  for (const entry of entries) {
    if (entry === '.gitkeep' || entry.startsWith('.')) continue

    const result = discoverOne(pluginsDir, entry)
    if ('reason' in result) {
      errors.push(result)
      log.warn({ dirName: entry, reason: result.reason }, 'Plugin discovery error')
      continue
    }

    if (seenIds.has(result.manifest.id)) {
      errors.push({ directoryName: entry, reason: `Duplicate plugin ID: ${result.manifest.id}` })
      log.warn({ pluginId: result.manifest.id }, 'Duplicate plugin ID detected during discovery')
      continue
    }

    seenIds.add(result.manifest.id)
    plugins.push(result)
    log.info({ pluginId: result.manifest.id, version: result.manifest.version }, 'Plugin discovered')
  }

  log.info({ discovered: plugins.length, errors: errors.length }, 'Plugin discovery complete')
  return { plugins, errors }
}
