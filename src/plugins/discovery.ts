// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

function isRealDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return false
    return stat.isDirectory()
  } catch {
    return false
  }
}

function computeManifestHash(manifestContent: string, entryPointContent: string): string {
  return createHash('sha256')
    .update(`${manifestContent.length}:`)
    .update(manifestContent)
    .update(`${entryPointContent.length}:`)
    .update(entryPointContent)
    .digest('hex')
}

function resolveEntryPoint(pluginDir: string, main: string): string | null {
  const resolved = resolve(join(pluginDir, main))
  // Ensure the entry point stays inside the plugin directory (not above or at the dir itself)
  if (!resolved.startsWith(resolve(pluginDir) + '/')) {
    return null
  }
  try {
    const realPluginDir = realpathSync(pluginDir)
    const realEntryPoint = realpathSync(resolved)
    if (!realEntryPoint.startsWith(realPluginDir + '/')) return null
  } catch {
    return resolved
  }
  return resolved
}

function parseAndValidateManifest(
  manifestPath: string,
  dirName: string,
): { manifest: ReturnType<typeof pluginManifestSchema.parse>; manifestContent: string } | DiscoveryError {
  let manifestContent: string
  try {
    manifestContent = readFileSync(manifestPath, 'utf-8')
    JSON.parse(manifestContent)
  } catch (error) {
    return {
      directoryName: dirName,
      reason: `Invalid JSON in plugin.json: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const parseResult = pluginManifestSchema.safeParse(JSON.parse(manifestContent) as unknown)
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

  return { manifest: parseResult.data, manifestContent }
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

  const { manifest, manifestContent } = parsed
  const entryPoint = resolveEntryPoint(pluginDir, manifest.main)
  if (entryPoint === null) {
    return {
      directoryName: dirName,
      reason: `Entry point "${manifest.main}" resolves outside the plugin directory`,
    }
  }

  let entryPointContent: string
  try {
    entryPointContent = readFileSync(entryPoint, 'utf-8')
  } catch (error) {
    return {
      directoryName: dirName,
      reason: `Entry point file not readable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return {
    manifest,
    pluginDir: resolve(pluginDir),
    entryPoint,
    manifestHash: computeManifestHash(manifestContent, entryPointContent),
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

/** Compute a hash for a manifest+entrypoint combo. Re-exported for tests. */
export { computeManifestHash }
