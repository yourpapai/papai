import { z } from 'zod'

import { MAX_RETRIES } from './config.js'
import { emptyPhase1b, emptyPhase2a, emptyPhase2b, emptyPhase3, type Progress } from './progress.js'

const FailedEntrySchema = z.object({
  error: z.string(),
  attempts: z.number(),
  lastAttempt: z.string(),
})

const Phase1CheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))),
  failedTests: z.record(z.string(), FailedEntrySchema),
  completedFiles: z.array(z.string()),
  stats: z.object({
    filesTotal: z.number(),
    filesDone: z.number(),
    testsExtracted: z.number(),
    testsFailed: z.number(),
  }),
})

const Phase1bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  lastRunAt: z.string().nullable(),
  threshold: z.number(),
  minClusterSize: z.number(),
  linkage: z.enum(['single', 'average', 'complete']),
  maxClusterSize: z.number(),
  gapThreshold: z.number(),
  embeddingModel: z.string(),
  embeddingBaseUrl: z.string(),
  embeddingCachePath: z.string().nullable(),
  stats: z.object({
    slugsBefore: z.number(),
    slugsAfter: z.number(),
    mergesApplied: z.number(),
    behaviorsUpdated: z.number(),
    keywordsRemapped: z.number(),
  }),
})

const LegacyPhase1bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  lastRunAt: z.string().nullable(),
  threshold: z.number(),
  minClusterSize: z.number().optional(),
  linkage: z.enum(['single', 'average', 'complete']).optional(),
  maxClusterSize: z.number().optional(),
  gapThreshold: z.number().optional(),
  embeddingModel: z.string().optional(),
  embeddingBaseUrl: z.string().optional(),
  embeddingCachePath: z.string().nullable().optional(),
  stats: z.object({
    slugsBefore: z.number(),
    slugsAfter: z.number(),
    mergesApplied: z.number(),
    behaviorsUpdated: z.number(),
    keywordsRemapped: z.number(),
  }),
})

const Phase2aCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    behaviorsTotal: z.number(),
    behaviorsDone: z.number(),
    behaviorsFailed: z.number(),
  }),
})

const Phase2bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedFeatureKeys: z.record(z.string(), z.literal('done')),
  failedFeatureKeys: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    featureKeysTotal: z.number(),
    featureKeysDone: z.number(),
    featureKeysFailed: z.number(),
    behaviorsConsolidated: z.number(),
  }),
})

const Phase3CheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedConsolidatedIds: z.record(z.string(), z.literal('done')),
  failedConsolidatedIds: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    consolidatedIdsTotal: z.number(),
    consolidatedIdsDone: z.number(),
    consolidatedIdsFailed: z.number(),
  }),
})

const ProgressV4Schema = z.strictObject({
  version: z.literal(4),
  startedAt: z.string(),
  phase1: Phase1CheckpointSchema,
  phase2a: Phase2aCheckpointSchema,
  phase2b: Phase2bCheckpointSchema,
  phase3: Phase3CheckpointSchema,
})

const ProgressV5Schema = z.strictObject({
  version: z.literal(5),
  startedAt: z.string(),
  phase1: Phase1CheckpointSchema,
  phase1b: Phase1bCheckpointSchema,
  phase2a: Phase2aCheckpointSchema,
  phase2b: Phase2bCheckpointSchema,
  phase3: Phase3CheckpointSchema,
})

const LegacyProgressV5Schema = z.strictObject({
  version: z.literal(5),
  startedAt: z.string(),
  phase1: Phase1CheckpointSchema,
  phase1b: LegacyPhase1bCheckpointSchema,
  phase2a: Phase2aCheckpointSchema,
  phase2b: Phase2bCheckpointSchema,
  phase3: Phase3CheckpointSchema,
})

function normalizePhase2aFailedAttempts(progress: Progress): Progress {
  return {
    ...progress,
    phase2a: {
      ...progress.phase2a,
      failedBehaviors: Object.fromEntries(
        Object.entries(progress.phase2a.failedBehaviors).map(([behaviorId, entry]) => [
          behaviorId,
          {
            ...entry,
            attempts:
              progress.phase2a.completedBehaviors[behaviorId] === 'done'
                ? entry.attempts
                : Math.max(entry.attempts, MAX_RETRIES),
          },
        ]),
      ),
    },
  }
}

function toVersion5Progress(input: {
  readonly startedAt: string
  readonly phase1: Progress['phase1']
  readonly phase1b?: Partial<Progress['phase1b']>
  readonly phase2a?: Partial<Progress['phase2a']>
  readonly phase2b?: Partial<Progress['phase2b']>
  readonly phase3?: Partial<Progress['phase3']>
}): Progress {
  return normalizePhase2aFailedAttempts(
    ProgressV5Schema.parse({
      version: 5,
      startedAt: input.startedAt,
      phase1: input.phase1,
      phase1b: {
        ...emptyPhase1b(),
        ...input.phase1b,
      },
      phase2a: {
        ...emptyPhase2a(),
        ...input.phase2a,
      },
      phase2b: {
        ...emptyPhase2b(),
        ...input.phase2b,
      },
      phase3: {
        ...emptyPhase3(),
        ...input.phase3,
      },
    }),
  )
}

function createIncompatibleResetProgress(startedAt: string): Progress {
  return toVersion5Progress({
    startedAt,
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
  })
}

export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v5Result = ProgressV5Schema.safeParse(raw)
  if (v5Result.success) return v5Result.data

  const legacyV5Result = LegacyProgressV5Schema.safeParse(raw)
  if (legacyV5Result.success) {
    return toVersion5Progress({
      startedAt: legacyV5Result.data.startedAt,
      phase1: legacyV5Result.data.phase1,
      phase1b: legacyV5Result.data.phase1b,
      phase2a: legacyV5Result.data.phase2a,
      phase2b: legacyV5Result.data.phase2b,
      phase3: legacyV5Result.data.phase3,
    })
  }

  const v4Result = ProgressV4Schema.safeParse(raw)
  if (v4Result.success) {
    return toVersion5Progress({
      startedAt: v4Result.data.startedAt,
      phase1: v4Result.data.phase1,
      phase2a: v4Result.data.phase2a,
      phase2b: v4Result.data.phase2b,
      phase3: v4Result.data.phase3,
    })
  }

  if (typeof raw === 'object' && raw !== null && 'startedAt' in raw) {
    const startedAt = (raw as Record<string, unknown>)['startedAt']
    if (typeof startedAt === 'string') {
      return createIncompatibleResetProgress(startedAt)
    }
  }

  return null
}
