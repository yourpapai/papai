import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { closeClients, parseCliArgs } from '../../review-loop/src/cli.js'
import { loadReviewLoopConfig } from '../../review-loop/src/config.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('review-loop CLI bootstrap', () => {
  test('parseCliArgs requires --plan and returns resume-run when provided', () => {
    expect(() => parseCliArgs(['--config', '.review-loop/config.json'])).toThrow('Missing required --plan')

    expect(
      parseCliArgs([
        '--config',
        '.review-loop/config.json',
        '--plan',
        'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md',
        '--resume-run',
        '2026-04-12T05-31-44Z',
      ]),
    ).toEqual({
      configPath: '.review-loop/config.json',
      planPath: 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md',
      repoRoot: undefined,
      resumeRunId: '2026-04-12T05-31-44Z',
    })
  })

  test('loadReviewLoopConfig resolves relative config paths from config and repo roots', async () => {
    const dir = makeTempDir('review-loop-cli-')
    const configDir = path.join(dir, 'config')
    const repoDir = path.join(dir, 'repo')
    const configPath = path.join(configDir, 'review-loop.config.json')

    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          ...createReviewLoopConfigFixture('../repo', { workDir: '.review-loop' }),
        },
        null,
        2,
      ),
    )

    const config = await loadReviewLoopConfig({ configPath })

    expect(config.repoRoot).toBe(repoDir)
    expect(config.workDir).toBe(path.join(repoDir, '.review-loop'))
    expect(existsSync(config.workDir)).toBe(true)
    expect(config.reviewer.invocationPrefix).toBe('/review-code')
    expect(config.fixer.verifyInvocationPrefix).toBe('/verify-issue')
  })

  test('loadReviewLoopConfig resolves --repo overrides from the caller cwd', async () => {
    const dir = makeTempDir('review-loop-cli-')
    const configDir = path.join(dir, 'config')
    const configPath = path.join(configDir, 'review-loop.config.json')
    const previousCwd = process.cwd()

    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          ...createReviewLoopConfigFixture('../repo', { workDir: '.review-loop' }),
        },
        null,
        2,
      ),
    )

    try {
      process.chdir(dir)
      const expectedRepoRoot = process.cwd()

      const config = await loadReviewLoopConfig({ configPath, repoRoot: '.' })

      expect(config.repoRoot).toBe(expectedRepoRoot)
      expect(config.workDir).toBe(path.join(expectedRepoRoot, '.review-loop'))
      expect(existsSync(config.workDir)).toBe(true)
    } finally {
      process.chdir(previousCwd)
    }
  })

  test('closeClients aggregates multiple close errors after attempting both closes', async () => {
    let reviewerClosed = false
    let fixerClosed = false
    const reviewerError = new Error('reviewer close failed')
    const fixerError = new Error('fixer close failed')

    const thrown = await closeClients(
      {
        close: () => {
          reviewerClosed = true
          return Promise.reject(reviewerError)
        },
      },
      {
        close: () => {
          fixerClosed = true
          return Promise.reject(fixerError)
        },
      },
    ).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(AggregateError)
    expect(thrown).toMatchObject({
      errors: [reviewerError, fixerError],
      message: 'Failed to close ACP clients',
    })
    expect(reviewerClosed).toBe(true)
    expect(fixerClosed).toBe(true)
  })
})
