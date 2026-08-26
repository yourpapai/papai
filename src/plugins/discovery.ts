// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import pLimit from 'p-limit'

import { logger } from '../logger.js'
import { type SourceParser, withSourceParser } from '../ts-ast/source-parser.js'
import { readPluginSourceGraph } from './discovery-imports.js'
import {
  isPathInsideDirectory,
  isRealDirectory,
  isRelativePluginImport,
  resolveEntryImport,
  resolveRealPathInsidePlugin,
} from './discovery-paths.js'
import { pluginManifestSchema } from './types.js'
import type { DiscoveredPlugin } from './types.js'

const log = logger.child({ scope: 'plugins:discovery' })

const makeDiscoveryError = (directoryName: string, reason: string): DiscoveryError => ({ directoryName, reason })

export type DiscoveryError = {
  directoryName: string
  reason: string
}

export type DiscoveryResult = {
  plugins: DiscoveredPlugin[]
  errors: DiscoveryError[]
  /**
   * True when the configured plugins directory did not exist on disk at the
   * time of discovery. Indicates a deployment misconfiguration (e.g. the
   * Docker image was built without `COPY plugins ./plugins`).
   */
  directoryMissing: boolean
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

async function resolveEntrypointForDiscovery(
  parser: SourceParser,
  pluginDir: string,
  main: string | undefined,
): Promise<{ entryPoint: string; sourceFiles: string[] } | DiscoveryError> {
  if (main === undefined) return { entryPoint: '', sourceFiles: [] }

  const entryPoint = resolveEntryPoint(pluginDir, main)
  if (entryPoint === null) return makeDiscoveryError('', `Entry point "${main}" resolves outside the plugin directory`)

  try {
    const sourceFiles = await readPluginSourceGraph(
      parser,
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

async function discoverOne(
  parser: SourceParser,
  pluginsRootDir: string,
  dirName: string,
): Promise<DiscoveredPlugin | DiscoveryError> {
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

  const ep = await resolveEntrypointForDiscovery(parser, pluginDir, manifest.main)
  if ('reason' in ep) return { ...ep, directoryName: dirName }

  return {
    manifest,
    pluginDir: resolve(pluginDir),
    entryPoint: ep.entryPoint,
    manifestHash: computePluginManifestHash(manifestContent, ep.sourceFiles),
  }
}

export function discoverPlugins(pluginsDir: string): Promise<DiscoveryResult> {
  return withSourceParser((parser) => discoverWithParser(parser, pluginsDir))
}

/** Plugin source graphs are parsed through one shared parser, so bound the fan-out. */
const DISCOVERY_CONCURRENCY = 4

async function discoverWithParser(parser: SourceParser, pluginsDir: string): Promise<DiscoveryResult> {
  log.debug({ pluginsDir }, 'Starting plugin discovery')

  if (!fs.existsSync(pluginsDir)) {
    log.debug({ pluginsDir }, 'Plugins directory does not exist — no plugins to discover')
    return { plugins: [], errors: [], directoryMissing: true }
  }

  let entries: string[]
  try {
    entries = fs.readdirSync(pluginsDir).sort()
  } catch (error) {
    log.warn(
      { pluginsDir, error: error instanceof Error ? error.message : String(error) },
      'Failed to read plugins directory',
    )
    return { plugins: [], errors: [], directoryMissing: false }
  }

  const candidates = entries.filter((entry) => entry !== '.gitkeep' && !entry.startsWith('.'))
  const limit = pLimit(DISCOVERY_CONCURRENCY)
  const discovered = await Promise.all(candidates.map((entry) => limit(() => discoverOne(parser, pluginsDir, entry))))

  const { plugins, errors } = collectDiscovered(candidates, discovered)
  log.info({ discovered: plugins.length, errors: errors.length }, 'Plugin discovery complete')
  return { plugins, errors, directoryMissing: false }
}

/**
 * Fold sequentially over the original directory order so duplicate-id
 * resolution stays deterministic regardless of the order the parses, which run
 * concurrently, happened to finish in.
 */
function collectDiscovered(
  candidates: readonly string[],
  discovered: readonly (DiscoveredPlugin | DiscoveryError | undefined)[],
): { plugins: DiscoveredPlugin[]; errors: DiscoveryError[] } {
  const plugins: DiscoveredPlugin[] = []
  const errors: DiscoveryError[] = []
  const seenIds = new Set<string>()

  for (const [index, entry] of candidates.entries()) {
    const result = discovered[index]
    if (result === undefined) continue
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

  return { plugins, errors }
}
