import { expect, test } from 'bun:test'

import { resetPhase1bAndBelow } from '../../../scripts/behavior-audit/progress-resets.js'
import {
  createEmptyProgress,
  emptyPhase1b,
  emptyPhase2a,
  emptyPhase2b,
  emptyPhase3,
} from '../../../scripts/behavior-audit/progress.js'

test('emptyPhase1b returns a fresh Phase1bProgress with all-zero stats', () => {
  const p = emptyPhase1b()
  expect(p.status).toBe('not-started')
  expect(p.lastRunAt).toBeNull()
  expect(p.threshold).toBe(0)
  expect(p.minClusterSize).toBe(2)
  expect(p.linkage).toBe('single')
  expect(p.maxClusterSize).toBe(0)
  expect(p.gapThreshold).toBe(0)
  expect(p.embeddingModel).toBe('')
  expect(p.embeddingBaseUrl).toBe('')
  expect(p.embeddingCachePath).toBeNull()
  expect(p.stats.slugsBefore).toBe(0)
  expect(p.stats.slugsAfter).toBe(0)
  expect(p.stats.mergesApplied).toBe(0)
  expect(p.stats.behaviorsUpdated).toBe(0)
  expect(p.stats.keywordsRemapped).toBe(0)
})

test('createEmptyProgress returns version 5 progress with phase1b included', () => {
  const p = createEmptyProgress(10)
  expect(p.version).toBe(5)
  expect(p.phase1b).toEqual(emptyPhase1b())
  expect(p.phase1.stats.filesTotal).toBe(10)
})

test('resetPhase1bAndBelow resets phase1b, phase2a, phase2b, and phase3', () => {
  const p = createEmptyProgress(0)
  p.phase1b.status = 'done'
  p.phase2a.status = 'done'
  p.phase2b.status = 'done'
  p.phase3.status = 'done'

  resetPhase1bAndBelow(p)

  expect(p.phase1b).toEqual(emptyPhase1b())
  expect(p.phase2a).toEqual(emptyPhase2a())
  expect(p.phase2b).toEqual(emptyPhase2b())
  expect(p.phase3).toEqual(emptyPhase3())
})

test('resetPhase1bAndBelow does not touch phase1', () => {
  const p = createEmptyProgress(5)
  p.phase1.status = 'done'
  p.phase1.stats.filesDone = 5

  resetPhase1bAndBelow(p)

  expect(p.phase1.status).toBe('done')
  expect(p.phase1.stats.filesDone).toBe(5)
})
