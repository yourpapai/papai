// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { logger } from '../logger.js'
import { pluginManifestSchema } from './types.js'
import type { DiscoveredPlugin } from './types.js'

const log = logger.child({ scope: 'plugins:discovery' })

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
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return false
    return stat.isDirectory()
  } catch {
    return false
  }
}

const STATIC_IMPORT_RE = /(?:import\s+(?:[^'";]+\s+from\s+)?|export\s+[^'";]*\s+from\s+)(['"])(\.[^'"]+)\1/gu
const DYNAMIC_IMPORT_RE = /import\s*\(([^)]+)\)/gu

function resolveEntryImport(fromFile: string, pluginDir: string, specifier: string): string {
  const candidate = resolve(join(dirname(fromFile), specifier))
  if (!isPathInsideDirectory(pluginDir, candidate)) {
    throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
  }

  const candidates =
    candidate.endsWith('.ts') || candidate.endsWith('.js')
      ? [candidate]
      : [`${candidate}.ts`, `${candidate}.js`, join(candidate, 'index.ts'), join(candidate, 'index.js')]

  const resolvedPath = candidates.find((path) => existsSync(path))
  if (resolvedPath === undefined) throw new Error(`Imported plugin file not found: ${specifier}`)

  try {
    const realPluginDir = realpathSync(pluginDir)
    const realImportedPath = realpathSync(resolvedPath)
    if (!isPathInsideDirectory(realPluginDir, realImportedPath)) {
      throw new Error(`Plugin import resolves outside plugin directory: ${specifier}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Plugin import resolves outside plugin directory:')) {
      throw error
    }
  }

  return resolvedPath
}

function readPluginSourceGraph(entryPoint: string, pluginDir: string): string[] {
  const pending = [entryPoint]
  const visited = new Set<string>()
  const ordered: string[] = []

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue

    visited.add(current)
    ordered.push(current)

    const source = readFileSync(current, 'utf-8')

    for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
      const raw = match[1]?.trim()
      if (raw === undefined) continue
      if (!raw.startsWith("'") && !raw.startsWith('"')) {
        throw new Error(`Unresolvable plugin dynamic import in ${current}`)
      }

      const specifier = raw.slice(1, -1)
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      pending.push(resolveEntryImport(current, pluginDir, specifier))
    }

    for (const match of source.matchAll(STATIC_IMPORT_RE)) {
      const specifier = match[2]
      if (specifier === undefined) continue
      pending.push(resolveEntryImport(current, pluginDir, specifier))
    }
  }

  return ordered.sort()
}

function computePluginManifestHash(manifestContent: string, sourceFiles: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update(`${manifestContent.length}:`).update(manifestContent)

  const sourceRoot = sourceFiles[0] === undefined ? '' : dirname(sourceFiles[0])

  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, 'utf-8')
    const relativeFilePath = sourceRoot === '' ? filePath : relative(sourceRoot, filePath).split(sep).join('/')
    hash.update(`${relativeFilePath.length}:`).update(relativeFilePath)
    hash.update(`${content.length}:`).update(content)
  }

  return hash.digest('hex')
}

function resolveEntryPoint(pluginDir: string, main: string): string | null {
  const resolved = resolve(join(pluginDir, main))
  if (!isPathInsideDirectory(pluginDir, resolved)) {
    return null
  }
  try {
    const realPluginDir = realpathSync(pluginDir)
    const realEntryPoint = realpathSync(resolved)
    if (!isPathInsideDirectory(realPluginDir, realEntryPoint)) return null
  } catch {
    return resolved
  }
  return resolved
}

function parseAndValidateManifest(
  manifestPath: string,
  dirName: string,
):
  | { manifest: ReturnType<typeof pluginManifestSchema.parse>; manifestContent: string; rawManifest: unknown }
  | DiscoveryError {
  let manifestContent: string
  try {
    manifestContent = readFileSync(manifestPath, 'utf-8')
  } catch (error) {
    return {
      directoryName: dirName,
      reason: `Invalid JSON in plugin.json: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(manifestContent) as unknown
  } catch (error) {
    return {
      directoryName: dirName,
      reason: `Invalid JSON in plugin.json: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const parseResult = pluginManifestSchema.safeParse(parsed)
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => i.message).join('; ')
    return { directoryName: dirName, reason: `Manifest validation failed: ${issues}` }
  }

  if (parseResult.data.id !== dirName) {
    return {
      directoryName: dirName,
      reason: `Plugin id "${parseResult.data.id}" does not match directory name "${dirName}"`,
    }
  }

  return { manifest: parseResult.data, manifestContent, rawManifest: parsed }
}

function resolveEntrypointForDiscovery(
  pluginDir: string,
  main: string | undefined,
  isMcpOnly: boolean,
): { entryPoint: string; sourceFiles: string[] } | DiscoveryError {
  if (isMcpOnly) return { entryPoint: '', sourceFiles: [] }
  if (main === undefined) return { directoryName: '', reason: 'Non-MCP plugin must declare a main entry point' }

  const entryPoint = resolveEntryPoint(pluginDir, main)
  if (entryPoint === null)
    return { directoryName: '', reason: `Entry point "${main}" resolves outside the plugin directory` }

  try {
    const sourceFiles = readPluginSourceGraph(entryPoint, pluginDir)
    return { entryPoint, sourceFiles }
  } catch (error) {
    return {
      directoryName: '',
      reason: error instanceof Error ? error.message : String(error),
    }
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
  if (!existsSync(manifestPath)) {
    return { directoryName: dirName, reason: 'Missing plugin.json' }
  }

  const parsed = parseAndValidateManifest(manifestPath, dirName)
  if ('reason' in parsed) return parsed

  const { manifest, manifestContent, rawManifest } = parsed
  const rawObj = typeof rawManifest === 'object' && rawManifest !== null ? rawManifest : undefined
  const isMcpOnly = rawObj !== undefined && 'mcp' in rawObj && !('main' in rawObj)

  const ep = resolveEntrypointForDiscovery(pluginDir, manifest.main, isMcpOnly)
  if ('reason' in ep) return { ...ep, directoryName: dirName }

  return {
    manifest,
    pluginDir: resolve(pluginDir),
    entryPoint: ep.entryPoint,
    manifestHash: computePluginManifestHash(manifestContent, ep.sourceFiles),
  }
}

/** Discover plugins in the given directory. Returns sorted (by id) plugins and errors. */
export function discoverPlugins(pluginsDir: string): DiscoveryResult {
  log.debug({ pluginsDir }, 'Starting plugin discovery')

  if (!existsSync(pluginsDir)) {
    log.debug({ pluginsDir }, 'Plugins directory does not exist — no plugins to discover')
    return { plugins: [], errors: [] }
  }

  let entries: string[]
  try {
    entries = readdirSync(pluginsDir).sort()
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
