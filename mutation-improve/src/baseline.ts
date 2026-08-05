// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type BaselineMap = Record<string, number>

const BASELINE_REL = path.join('scripts', 'mutation', 'baseline.json')

export function parseBaseline(json: string): BaselineMap {
  const parsed: unknown = JSON.parse(json)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('baseline.json must be a JSON object mapping file paths to scores')
  }
  const out: BaselineMap = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`baseline.json entry "${key}" must be a finite number`)
    }
    out[key] = value
  }
  return out
}

export function serializeBaseline(map: BaselineMap): string {
  const sorted: BaselineMap = {}
  for (const key of Object.keys(map).sort()) {
    const value = map[key]
    if (value !== undefined) sorted[key] = value
  }
  return `${JSON.stringify(sorted, null, 2)}\n`
}

export function bumpScore(map: BaselineMap, file: string, score: number): BaselineMap {
  const previous = map[file] ?? -Infinity
  return { ...map, [file]: Math.max(previous, score) }
}

export async function readBaseline(repoRoot: string): Promise<BaselineMap> {
  const filePath = path.join(repoRoot, BASELINE_REL)
  try {
    const content = await readFile(filePath, 'utf8')
    return parseBaseline(content)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return {}
    }
    throw error
  }
}

export async function writeBaseline(repoRoot: string, map: BaselineMap): Promise<void> {
  await writeFile(path.join(repoRoot, BASELINE_REL), serializeBaseline(map))
}
