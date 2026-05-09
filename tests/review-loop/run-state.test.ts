import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { createRunState, loadRunState, saveRunState } from '../../review-loop/src/run-state.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

const SessionPointerSchema = z.object({
  sessionId: z.string().nullable(),
})

afterEach(cleanupTempDirs)

test('run state persists session ids through pointer files', async () => {
  const repoRoot = makeTempDir('review-loop-state-')
  const config = createReviewLoopConfigFixture(repoRoot)

  const state = await createRunState(
    config,
    path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'),
  )
  const persistedJson = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(state.statePath, 'utf8')))
  const persisted = z
    .object({
      runId: z.string(),
      repoRoot: z.string(),
      planPath: z.string(),
      currentRound: z.number(),
      noProgressRounds: z.number(),
    })
    .strict()
    .parse(persistedJson)
  const reviewerSessionPointer = SessionPointerSchema.parse(JSON.parse(readFileSync(state.reviewerSessionPath, 'utf8')))
  const fixerSessionPointer = SessionPointerSchema.parse(JSON.parse(readFileSync(state.fixerSessionPath, 'utf8')))

  expect(state.runDir.startsWith(path.join(config.workDir, 'runs'))).toBe(true)
  expect(persisted.planPath).toBe(
    path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'),
  )
  expect('reviewerSessionId' in persistedJson).toBe(false)
  expect('fixerSessionId' in persistedJson).toBe(false)
  expect('runDir' in persistedJson).toBe(false)
  expect('statePath' in persistedJson).toBe(false)
  expect(reviewerSessionPointer.sessionId).toBeNull()
  expect(fixerSessionPointer.sessionId).toBeNull()
  expect(existsSync(state.reviewerSessionPath)).toBe(true)
  expect(existsSync(state.fixerSessionPath)).toBe(true)

  state.reviewerSessionId = 'reviewer-session-123'
  state.fixerSessionId = 'fixer-session-456'
  await saveRunState(state)

  const minimalPersistedState = {
    runId: state.runId,
    repoRoot: state.repoRoot,
    planPath: state.planPath,
    currentRound: state.currentRound,
    noProgressRounds: state.noProgressRounds,
  }

  writeFileSync(state.statePath, JSON.stringify(minimalPersistedState, null, 2))
  writeFileSync(state.reviewerSessionPath, JSON.stringify({ sessionId: 'reviewer-session-123' }, null, 2))
  writeFileSync(state.fixerSessionPath, JSON.stringify({ sessionId: 'fixer-session-456' }, null, 2))

  const reloaded = await loadRunState(config.workDir, state.runId)
  const canonicalRunDir = path.join(config.workDir, 'runs', state.runId)
  const savedReviewerSessionPointer = SessionPointerSchema.parse(
    JSON.parse(readFileSync(state.reviewerSessionPath, 'utf8')),
  )
  const savedFixerSessionPointer = SessionPointerSchema.parse(JSON.parse(readFileSync(state.fixerSessionPath, 'utf8')))

  expect(reloaded.planPath).toBe(state.planPath)
  expect(reloaded.runDir).toBe(canonicalRunDir)
  expect(reloaded.transcriptDir).toBe(path.join(canonicalRunDir, 'transcripts'))
  expect(reloaded.statePath).toBe(path.join(canonicalRunDir, 'state.json'))
  expect(reloaded.reviewerSessionPath).toBe(path.join(canonicalRunDir, 'reviewer-session.json'))
  expect(reloaded.fixerSessionPath).toBe(path.join(canonicalRunDir, 'fixer-session.json'))
  expect(reloaded.reviewerSessionId).toBe('reviewer-session-123')
  expect(reloaded.fixerSessionId).toBe('fixer-session-456')
  expect(savedReviewerSessionPointer.sessionId).toBe('reviewer-session-123')
  expect(savedFixerSessionPointer.sessionId).toBe('fixer-session-456')

  writeFileSync(
    state.statePath,
    JSON.stringify(
      {
        ...minimalPersistedState,
        runDir: path.join(repoRoot, 'stale-run-dir'),
        transcriptDir: path.join(repoRoot, 'stale-transcripts'),
        statePath: path.join(repoRoot, 'stale-state.json'),
        reviewerSessionPath: path.join(repoRoot, 'stale-reviewer-session.json'),
        fixerSessionPath: path.join(repoRoot, 'stale-fixer-session.json'),
      },
      null,
      2,
    ),
  )

  const reloadedWithStalePaths = await loadRunState(config.workDir, state.runId)

  expect(reloadedWithStalePaths.runDir).toBe(canonicalRunDir)
  expect(reloadedWithStalePaths.transcriptDir).toBe(path.join(canonicalRunDir, 'transcripts'))
  expect(reloadedWithStalePaths.statePath).toBe(path.join(canonicalRunDir, 'state.json'))
  expect(reloadedWithStalePaths.reviewerSessionPath).toBe(path.join(canonicalRunDir, 'reviewer-session.json'))
  expect(reloadedWithStalePaths.fixerSessionPath).toBe(path.join(canonicalRunDir, 'fixer-session.json'))
})
