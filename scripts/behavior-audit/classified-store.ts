// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { classifiedArtifactPathForTestFile } from './artifact-paths.js'

export interface ClassifiedBehavior {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly featureKey: string | null
  readonly featureLabel: string | null
  readonly supportingBehaviorRefs: readonly { readonly behaviorId: string; readonly reason: string }[]
  readonly relatedBehaviorHints: readonly {
    readonly testKey: string
    readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
    readonly reason: string
  }[]
  readonly classificationNotes: string
  readonly classifiedAt: string
}

const RelatedBehaviorHintSchema = z
  .object({
    testKey: z.string(),
    relation: z.enum(['same-feature', 'supporting-detail', 'possibly-related']),
    reason: z.string(),
  })
  .readonly()

const SupportingBehaviorRefSchema = z
  .object({
    behaviorId: z.string(),
    reason: z.string(),
  })
  .readonly()

const ClassifiedBehaviorSchema = z.object({
  behaviorId: z.string(),
  testKey: z.string(),
  domain: z.string(),
  visibility: z.enum(['user-facing', 'internal', 'ambiguous']),
  featureKey: z.string().nullable(),
  featureLabel: z.string().nullable(),
  supportingBehaviorRefs: z.array(SupportingBehaviorRefSchema).readonly(),
  relatedBehaviorHints: z.array(RelatedBehaviorHintSchema).readonly(),
  classificationNotes: z.string(),
  classifiedAt: z.string(),
})

const ClassifiedBehaviorArraySchema = z.array(ClassifiedBehaviorSchema).readonly()

export async function writeClassifiedFile(
  testFilePath: string,
  behaviors: readonly ClassifiedBehavior[],
): Promise<void> {
  const outPath = classifiedArtifactPathForTestFile(testFilePath)
  await mkdir(dirname(outPath), { recursive: true })
  const sorted = [...behaviors].toSorted((a, b) => a.behaviorId.localeCompare(b.behaviorId))
  await Bun.write(outPath, JSON.stringify(sorted, null, 2) + '\n')
}

export async function readClassifiedFile(testFilePath: string): Promise<readonly ClassifiedBehavior[] | null> {
  const filePath = classifiedArtifactPathForTestFile(testFilePath)
  try {
    await access(filePath, constants.F_OK)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }

  const raw: unknown = JSON.parse(await Bun.file(filePath).text())
  return ClassifiedBehaviorArraySchema.parse(raw)
}
