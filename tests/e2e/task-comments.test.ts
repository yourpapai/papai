import { afterAll, afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

setDefaultTimeout(30000)

import { addComment } from '../../src/providers/kaneo/add-comment.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { getComments } from '../../src/providers/kaneo/get-comments.js'
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

  test('adds a comment to a task', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'This is a test comment' })

    expect(comment.id).toBeTruthy()
    expect(comment.comment).toBe('This is a test comment')
    expect(typeof comment.createdAt).toBe('string')
  })

  test('retrieves comments for a task', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'First comment' })
    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Second comment' })

    // Comments should now be retrievable (fixed content field access)
    const comments = await getComments({ config: kaneoConfig, taskId: task.id })

    expect(comments.length).toBe(2)
    expect(comments.map((entry) => entry.comment).sort()).toEqual(['First comment', 'Second comment'])
  })

  test('updates a comment', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Original text' })

    expect(comment.id).toBeTruthy()

    const { updateComment } = await import('../../src/providers/kaneo/update-comment.js')
    const updated = await updateComment({
      config: kaneoConfig,
      taskId: task.id,
      activityId: comment.id,
      comment: 'Updated text',
    })

    expect(updated.comment).toBe('Updated text')

    // Verify via re-fetch
    const comments = await getComments({ config: kaneoConfig, taskId: task.id })
    const updatedComment = comments.find((c) => c.id === comment.id)
    expect(updatedComment?.comment).toBe('Updated text')
  })

  test('keeps comment IDs stable through provider update and delete flows', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Original text' })

    const { updateComment } = await import('../../src/providers/kaneo/update-comment.js')
    const updated = await updateComment({
      config: kaneoConfig,
      taskId: task.id,
      activityId: comment.id,
      comment: 'Updated text',
    })

    expect(updated.id).toBe(comment.id)
    expect(updated.comment).toBe('Updated text')

    const commentsAfterUpdate = await getComments({ config: kaneoConfig, taskId: task.id })
    const updatedComment = commentsAfterUpdate.find((entry) => entry.id === comment.id)
    expect(updatedComment?.id).toBe(comment.id)
    expect(updatedComment?.comment).toBe('Updated text')

    const { removeComment } = await import('../../src/providers/kaneo/remove-comment.js')
    const removed = await removeComment({
      config: kaneoConfig,
      activityId: comment.id,
    })

    expect(removed.id).toBe(comment.id)
    expect(removed.success).toBe(true)

    const remainingComments = await getComments({ config: kaneoConfig, taskId: task.id })
    expect(remainingComments.find((entry) => entry.id === comment.id)).toBeUndefined()
  })

  test('removes a comment', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'To be deleted' })

    expect(comment.id).toBeTruthy()

    const { removeComment } = await import('../../src/providers/kaneo/remove-comment.js')
    const removed = await removeComment({
      config: kaneoConfig,
      activityId: comment.id,
    })

    expect(removed.success).toBe(true)

    // Verify via re-fetch: removed comment should not be in the list
    const remainingComments = await getComments({ config: kaneoConfig, taskId: task.id })
    const deletedComment = remainingComments.find((c) => c.id === comment.id)
    expect(deletedComment).toBeUndefined()
  })

  test('raw dedicated comment endpoints return the documented update and delete fields', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Original text' })

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

  test('throws error when adding comment to non-existent task', async () => {
    const promise = addComment({
      config: kaneoConfig,
      taskId: 'non-existent-id',
      comment: 'This should fail',
    })
    await expect(promise).rejects.toThrow()
  })

  test('handles long comments', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const longComment = 'A'.repeat(1000)
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: longComment })

    expect(comment.comment).toBe(longComment)
  })

  test('handles special characters in comments', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })
    testClient.trackTask(task.id)

    const specialComment = 'Comment with émojis 🎉 and <html> & "quotes"'
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: specialComment })

    expect(comment.comment).toBe(specialComment)
  })
})
