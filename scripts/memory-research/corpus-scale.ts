// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  DETERMINISTIC_EMBEDDING_VERSION,
  LanguageSchema,
  MemoryEventSchema,
  MemoryScopeSchema,
  ScaleProfileSchema,
} from './types.js'
import type { MemoryEvent } from './types.js'

const ScaleDistractorOptionsSchema = z
  .object({
    scale: ScaleProfileSchema,
    scope: MemoryScopeSchema,
    language: LanguageSchema,
    seed: z.number().int().nonnegative(),
  })
  .strict()
  .readonly()

export type ScaleDistractorOptions = z.infer<typeof ScaleDistractorOptionsSchema>

const makeScaleDistractor = (options: ScaleDistractorOptions, index: number): MemoryEvent => {
  const suffix = `scale-${options.scale}-${options.scope.kind}-${options.scope.id}-${options.language}-${options.seed}-${index}`
  const eventTime = new Date(Date.UTC(2025, 0, 1) + index * 60_000).toISOString()
  return MemoryEventSchema.parse({
    eventId: `event-${suffix}`,
    evidenceId: `evidence-${suffix}`,
    scope: options.scope,
    language: options.language,
    eventTime,
    ingestTime: eventTime,
    content:
      options.language === 'ru'
        ? `Синтетическая масштабная помеха ${options.seed}-${index}.`
        : `Synthetic scale distractor ${options.seed}-${index}.`,
    type: 'message',
    threadId: null,
    entities: [],
    relations: [],
    validity: { validFrom: eventTime, validTo: null },
    embedding: {
      available: true,
      version: DETERMINISTIC_EMBEDDING_VERSION,
    },
  })
}

export const createScaleDistractors = (options: ScaleDistractorOptions): Iterable<MemoryEvent> => {
  const parsed = ScaleDistractorOptionsSchema.parse(options)
  return Object.freeze({
    *[Symbol.iterator](): Generator<MemoryEvent> {
      for (let index = 0; index < parsed.scale; index += 1) {
        yield makeScaleDistractor(parsed, index)
      }
    },
  })
}
