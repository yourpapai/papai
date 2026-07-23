// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { canonicalSerialize } from './manifest.js'
import { ResearchSourceFileSchema, ResearchSourceInventorySchema, ScenarioSelectionSchema } from './report-schema.js'
import type { ResearchSourceFile, ResearchSourceInventory, ScenarioSelection } from './report-schema.js'
import type { MemoryScenario } from './types.js'

export const FROZEN_RESEARCH_SOURCE_PATHS_SHA256 = 'f93e8dba1d29f9c95db42c3453312ba01f3ccc2e952a2f9fc602ce552efe7ff0'

const requiredStaticResearchSourcePaths = [
  'bun.lock',
  'docs/research/agent-memory/00-protocol.md',
  'docs/research/agent-memory/evidence-ledger.csv',
  'docs/research/agent-memory/source-manifest.json',
  'docs/superpowers/plans/2026-07-23-agent-memory-deep-research.md',
  'package.json',
] as const

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

const orderedUnique = (values: readonly string[], label: string): readonly string[] => {
  const ordered = [...values].sort((left, right) => left.localeCompare(right))
  if (new Set(ordered).size !== ordered.length) throw new Error(`${label} must be unique`)
  return ordered
}

const orderedDistinct = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

export const selectionDigest = (
  suite: string,
  split: MemoryScenario['split'],
  scenarioIds: readonly string[],
): string => sha256(canonicalSerialize({ suite, split, scenarioIds: orderedUnique(scenarioIds, 'scenario IDs') }))

export const createScenarioSelection = (
  suite: string,
  split: MemoryScenario['split'],
  scenarios: readonly MemoryScenario[],
): ScenarioSelection => {
  if (scenarios.some((scenario) => scenario.split !== split)) {
    throw new Error(`scenario selection contains a scenario outside split ${split}`)
  }
  const scenarioIds = orderedUnique(
    scenarios.map(({ scenarioId }) => scenarioId),
    'scenario IDs',
  )
  return ScenarioSelectionSchema.parse({
    suite,
    split,
    scenarioIds,
    selectionSha256: selectionDigest(suite, split, scenarioIds),
  })
}

export const implementationDigest = (files: readonly ResearchSourceFile[]): string => {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path))
  if (new Set(ordered.map(({ path }) => path)).size !== ordered.length) {
    throw new Error('research source paths must be unique')
  }
  return sha256(canonicalSerialize(ordered))
}

export const sourcePathInventoryDigest = (paths: readonly string[]): string =>
  sha256(canonicalSerialize(orderedUnique(paths, 'research source paths')))

export const createResearchSourceInventory = (paths: readonly string[]): ResearchSourceInventory => {
  const pathsSha256 = sourcePathInventoryDigest(paths)
  return ResearchSourceInventorySchema.parse({
    contractVersion: 'memory-research-source-inventory-v1',
    scope: pathsSha256 === FROZEN_RESEARCH_SOURCE_PATHS_SHA256 ? 'complete' : 'fixture',
    pathsSha256,
  })
}

export const sourceInventoryErrors = (
  inventory: ResearchSourceInventory,
  files: readonly ResearchSourceFile[],
): readonly string[] => {
  const actualDigest = sourcePathInventoryDigest(files.map(({ path }) => path))
  const expectedScope = actualDigest === FROZEN_RESEARCH_SOURCE_PATHS_SHA256 ? 'complete' : 'fixture'
  return [
    ...(inventory.pathsSha256 === actualDigest ? [] : ['research source inventory path SHA-256 mismatch']),
    ...(inventory.scope === expectedScope ? [] : ['research source inventory completeness claim mismatch']),
    ...(inventory.scope !== 'complete' || files.some(({ path }) => path === 'bun.lock')
      ? []
      : ['complete research source inventory must cover bun.lock']),
  ]
}

const resolveContainedPath = (workspaceRoot: string, sourcePath: string): string => {
  if (isAbsolute(sourcePath)) throw new Error(`research source path must be relative: ${sourcePath}`)
  const root = resolve(workspaceRoot)
  const absolute = resolve(root, sourcePath)
  const child = relative(root, absolute)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`research source path escapes workspace: ${sourcePath}`)
  }
  return absolute
}

export const hashResearchSourceFiles = async (
  workspaceRoot: string,
  sourcePaths: readonly string[],
): Promise<
  Readonly<{
    inventory: ResearchSourceInventory
    files: readonly ResearchSourceFile[]
    implementationSha256: string
  }>
> => {
  const paths = orderedUnique(sourcePaths, 'research source paths')
  const files = await Promise.all(
    paths.map(async (path) =>
      ResearchSourceFileSchema.parse({
        path,
        sha256: sha256(await readFile(resolveContainedPath(workspaceRoot, path))),
      }),
    ),
  )
  return Object.freeze({
    inventory: createResearchSourceInventory(paths),
    files,
    implementationSha256: implementationDigest(files),
  })
}

const discoverTypeScriptFiles = async (
  workspaceRoot: string,
  relativeDirectory: string,
): Promise<readonly string[]> => {
  const absoluteDirectory = resolveContainedPath(workspaceRoot, relativeDirectory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const discovered = await Promise.all(
    entries
      .filter((entry) => !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry): Promise<readonly string[]> => {
        const relativePath = `${relativeDirectory}/${entry.name}`
        if (entry.isDirectory()) return discoverTypeScriptFiles(workspaceRoot, relativePath)
        return Promise.resolve(entry.isFile() && entry.name.endsWith('.ts') ? [relativePath] : [])
      }),
  )
  return discovered.flat()
}

export const discoverResearchSourcePaths = async (workspaceRoot: string): Promise<readonly string[]> => {
  const typeScript = await Promise.all([
    discoverTypeScriptFiles(workspaceRoot, 'scripts/memory-research'),
    discoverTypeScriptFiles(workspaceRoot, 'tests/memory-research'),
  ])
  return orderedUnique([...typeScript.flat(), ...requiredStaticResearchSourcePaths], 'research source paths')
}

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

export const resolveResearchSourcePaths = async (
  workspaceRoot: string,
  additionalPaths?: readonly string[],
): Promise<readonly string[]> => {
  if (additionalPaths === undefined) return discoverResearchSourcePaths(workspaceRoot)
  try {
    const discovered = await discoverResearchSourcePaths(workspaceRoot)
    return orderedDistinct([...discovered, ...additionalPaths])
  } catch (error) {
    if (!isMissingPathError(error)) throw error
    return orderedUnique(additionalPaths, 'research source paths')
  }
}
