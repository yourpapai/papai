import { beforeAll, afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(30000)

import { addComment } from '../../src/providers/kaneo/add-comment.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createProject } from '../../src/providers/kaneo/create-project.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { deleteTask } from '../../src/providers/kaneo/delete-task.js'
import { getComments } from '../../src/providers/kaneo/get-comments.js'
import { getSharedKaneoConfig, getSharedWorkspaceId, generateUniqueSuffix } from './test-helpers.js'

describe('E2E: Task Comments', () => {
  let kaneoConfig: KaneoConfig
  let workspaceId: string
  let projectId: string

  beforeAll(async () => {
    // This will trigger global setup if not already done
    kaneoConfig = await getSharedKaneoConfig()
    workspaceId = await getSharedWorkspaceId()
  })

  afterAll(async () => {
    // Only cleanup once after ALL test files
    // Bun test doesn't have a way to detect if this is the last file,
    // so we need a different approach
  })

  beforeEach(async () => {
    // Create a unique project for each test to avoid conflicts
    const suffix = generateUniqueSuffix()
    const project = await createProject({
      config: kaneoConfig,
      workspaceId,
      name: `Comments Test ${suffix}`,
    })
    projectId = project.id
  })

  test('adds a comment to a task', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'This is a test comment' })

    expect(comment.id).toBeTruthy()
    expect(comment.comment).toBe('This is a test comment')
    expect(typeof comment.createdAt).toBe('string')

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('retrieves comments for a task', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'First comment' })
    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Second comment' })

    // Comments should now be retrievable (fixed content field access)
    const comments = await getComments({ config: kaneoConfig, taskId: task.id })

    expect(comments.length).toBe(2)
    expect(comments.map((entry) => entry.comment).sort()).toEqual(['First comment', 'Second comment'])

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('updates a comment', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

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

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('removes a comment', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

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

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
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

    const longComment = 'A'.repeat(1000)
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: longComment })

    expect(comment.comment).toBe(longComment)

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('handles special characters in comments', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const specialComment = 'Comment with émojis 🎉 and <html> & "quotes"'
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: specialComment })

    expect(comment.comment).toBe(specialComment)

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })
})
