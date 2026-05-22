// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { evaluatedArtifactPathForFeatureKey } from './artifact-paths.js'

const PersonaScoreSchema = z
  .object({
    discover: z.number(),
    use: z.number(),
    retain: z.number(),
    notes: z.string(),
  })
  .strict()
  .readonly()

const EvaluatedFeatureRecordSchema = z
  .object({
    consolidatedId: z.string(),
    maria: PersonaScoreSchema,
    dani: PersonaScoreSchema,
    viktor: PersonaScoreSchema,
    flaws: z.array(z.string()).readonly(),
    improvements: z.array(z.string()).readonly(),
    evaluatedAt: z.string(),
  })
  .strict()
  .readonly()

const EvaluatedFeatureRecordArraySchema = z.array(EvaluatedFeatureRecordSchema).readonly()

export type EvaluatedFeatureRecord = z.infer<typeof EvaluatedFeatureRecordSchema>

export async function writeEvaluatedFile(
  featureKey: string,
  records: readonly EvaluatedFeatureRecord[],
): Promise<void> {
  const outPath = evaluatedArtifactPathForFeatureKey(featureKey)
  await mkdir(dirname(outPath), { recursive: true })
  const sortedRecords = [...records].toSorted((a, b) => a.consolidatedId.localeCompare(b.consolidatedId))
  await Bun.write(outPath, JSON.stringify(sortedRecords, null, 2) + '\n')
}

export async function readEvaluatedFile(featureKey: string): Promise<readonly EvaluatedFeatureRecord[] | null> {
  const filePath = evaluatedArtifactPathForFeatureKey(featureKey)
  try {
    await access(filePath, constants.F_OK)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }

  const raw: unknown = JSON.parse(await Bun.file(filePath).text())
  return EvaluatedFeatureRecordArraySchema.parse(raw)
}
