// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import type { CoverageMap } from './coverage-map.js'
import { SHARD_RESULT_VERSION } from './shard-measure.js'
import type { ShardResult } from './shard-measure.js'
import { SHARD_PLAN_VERSION } from './shard-plan.js'
import type { ShardPlanManifest } from './shard-plan.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * Shape check for a manifest read back off disk. Deliberately structural rather than exhaustive:
 * a manifest that fails this is treated as absent, and an absent manifest is a well-defined state
 * — the shard builds its own coverage map, and the gate has no planned set to reconcile against
 * and therefore refuses to render a verdict. Neither path can silently narrow the gate.
 */
const isShardPlanManifest = (value: unknown): value is ShardPlanManifest => {
  if (!isRecord(value)) return false
  if (value['version'] !== SHARD_PLAN_VERSION) return false
  if (typeof value['baseRef'] !== 'string') return false
  if (!isStringArray(value['targets']) || !isStringArray(value['toMeasure'])) return false
  if (!Array.isArray(value['reused']) || !Array.isArray(value['shards'])) return false
  if (typeof value['shardCount'] !== 'number') return false
  if (!isRecord(value['coverageMap']) || !isRecord(value['budget'])) return false
  return true
}

export const writeShardPlan = (filePath: string, manifest: ShardPlanManifest): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Read a manifest, or null when it is missing, unparseable, or not this version's shape. */
export const readShardPlan = (filePath: string): ShardPlanManifest | null => {
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return isShardPlanManifest(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Shape check for a shard result. The gate's entire job is to not trust these blindly: a result
 * it cannot validate contributes nothing, and its targets then surface as missing rather than as
 * a quietly narrower verdict.
 */
const isShardResult = (value: unknown): value is ShardResult => {
  if (!isRecord(value)) return false
  if (value['version'] !== SHARD_RESULT_VERSION) return false
  if (typeof value['shardIndex'] !== 'number') return false
  if (!isStringArray(value['targets'])) return false
  if (!Array.isArray(value['perFile']) || !Array.isArray(value['skipped']) || !Array.isArray(value['errored'])) {
    return false
  }
  return typeof value['durationSeconds'] === 'number' && typeof value['estimatedSeconds'] === 'number'
}

/** Read one shard result, or null when it is missing, unparseable, or not this version's shape. */
export const readShardResult = (filePath: string): ShardResult | null => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return isShardResult(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * A `PairedRunDeps.buildMap` over the plan's published attribution, or undefined when there is no
 * plan to read — which is what makes `pairedRun` fall back to building its own map, as the
 * `mutation-shard-planning` spec requires of an executor that cannot consume shared preparation.
 */
export const coverageMapReaderFor = (
  manifest: ShardPlanManifest | null,
): ((sourceFiles: readonly string[]) => CoverageMap) | undefined => {
  if (manifest === null) return undefined
  return (sourceFiles) => {
    const served: CoverageMap = {}
    for (const sourceFile of sourceFiles) {
      const covering = manifest.coverageMap[sourceFile]
      if (covering !== undefined) served[sourceFile] = covering
    }
    return served
  }
}
