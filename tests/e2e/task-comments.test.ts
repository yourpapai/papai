// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

setDefaultTimeout(30000)

import { addComment } from '../../plugins/task-provider-kaneo/add-comment.js'
import type { KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { createTask } from '../../plugins/task-provider-kaneo/create-task.js'
import { cleanupE2E } from './global-setup.js'
import { kaneoApiJsonParsed } from './kaneo-api-helpers.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'
import { generateUniqueSuffix } from './test-helpers.js'

const taskCommentsTestPathSuffix = 'tests/e2e/task-comments.test.ts'
const RawCommentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

function normalizeArgPath(arg: string): string {
  return arg.replaceAll('\\', '/')
}

function getExplicitTestTargets(argv: readonly string[]): string[] {
  const optionsWithSeparateValues = new Set(['--path-ignore-patterns', '--preload'])
  const targets: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) {
      continue
    }

    if (optionsWithSeparateValues.has(arg)) {
      index += 1
      continue
    }

    if (arg.startsWith('-')) {
      continue
    }

    const normalizedArg = normalizeArgPath(arg)
    if (!normalizedArg.endsWith('.test.ts')) {
      continue
    }

    targets.push(normalizedArg)
  }

  return targets
}

function isTaskCommentsTestTarget(arg: string): boolean {
  return arg === 'task-comments.test.ts' || arg.endsWith(taskCommentsTestPathSuffix)
}

function isDirectTaskCommentsTarget(argv: readonly string[] = process.argv): boolean {
  const explicitTargets = getExplicitTestTargets(argv)
  const [onlyTarget] = explicitTargets
  return explicitTargets.length === 1 && onlyTarget !== undefined && isTaskCommentsTestTarget(onlyTarget)
}

describe('isDirectTaskCommentsTarget', () => {
  test('returns true when task-comments is the sole explicit test target', () => {
    expect(
      isDirectTaskCommentsTarget([
        'bun',
        'test',
        '--preload',
        './tests/e2e/bun-test-setup.ts',
        '--path-ignore-patterns',
        '',
        'tests/e2e/task-comments.test.ts',
      ]),
    ).toBe(true)
  })

  test('returns false for the aggregated e2e entrypoint', () => {
    expect(
      isDirectTaskCommentsTarget([
        'bun',
        'test',
        '--preload',
        './tests/e2e/bun-test-setup.ts',
        '--path-ignore-patterns',
        '',
        'tests/e2e/e2e.test.ts',
      ]),
    ).toBe(false)
  })

  test('returns false when multiple explicit test files are targeted', () => {
    expect(
      isDirectTaskCommentsTarget([
        'bun',
        'test',
        '--preload',
        './tests/e2e/bun-test-setup.ts',
        '--path-ignore-patterns',
        '',
        'tests/e2e/task-comments.test.ts',
        'tests/e2e/task-search.test.ts',
      ]),
    ).toBe(false)
  })
})

describe('E2E: Task Comments', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  afterAll(async () => {
    if (isDirectTaskCommentsTarget()) {
      await cleanupE2E()
    }
  })

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()

    const suffix = generateUniqueSuffix()
    const project = await testClient.createTestProject(`Comments Test ${suffix}`)
    projectId = project.id
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('raw dedicated comment endpoints return the documented update and delete fields', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const comment = await addComment({
      config: kaneoConfig,
      taskId: task.id,
      comment: 'Original text',
    })

    const updated = await kaneoApiJsonParsed(`/comment/${comment.id}`, RawCommentSchema, {
      method: 'PUT',
      body: JSON.stringify({
        content: 'Updated through raw endpoint',
      }),
    })

    expect(updated.id).toBe(comment.id)
    expect(updated.taskId).toBe(task.id)
    expect(updated.userId).toBeString()
    expect(updated.content).toBe('Updated through raw endpoint')
    expect(updated.createdAt).toBeString()
    expect(updated.updatedAt).toBeString()

    const removed = await kaneoApiJsonParsed(`/comment/${comment.id}`, RawCommentSchema, {
      method: 'DELETE',
    })

    expect(removed.id).toBe(comment.id)
    expect(removed.taskId).toBe(task.id)
    expect(removed.userId).toBeString()
    expect(removed.content).toBeString()
    expect(removed.createdAt).toBeString()
    expect(removed.updatedAt).toBeString()
  })
})
