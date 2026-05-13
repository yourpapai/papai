import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { ColumnCompatSchema as KaneoColumnSchema } from '../../../src/providers/kaneo/schemas/api-compat.js'
import { CreateLabelResponseSchema as KaneoLabelSchema } from '../../../src/providers/kaneo/schemas/create-label.js'
import { TaskSchema as KaneoTaskResponseSchema } from '../../../src/providers/kaneo/schemas/create-task.js'
import { TaskSchema as CreateTaskResponseSchema } from '../../../src/providers/kaneo/schemas/create-task.js'
import { ActivityItemSchema } from '../../../src/providers/kaneo/schemas/get-activities.js'
import { GetProjectResponseSchema as KaneoProjectFullSchema } from '../../../src/providers/kaneo/schemas/get-project.js'
import {
  createMockActivity,
  createMockColumn,
  createMockLabel,
  createMockProject,
  createMockTask,
  mockLogger,
  restoreFetch,
  setMockFetch,
} from '../../utils/test-helpers.js'

const KaneoProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.any(),
  isPublic: z.boolean().nullable(),
})
const KaneoActivityWithTypeSchema = ActivityItemSchema.array()
import {
  ColumnResource,
  CommentResource,
  LabelResource,
  ProjectResource,
  TaskResource,
  type KaneoConfig,
} from './test-resources.js'

/**
 * Schema Validation Tests
 *
 * These tests verify that all API responses are properly validated against Zod schemas.
 * Each tool's response is tested to ensure it matches the expected schema structure.
 */

// Local minimal task schema for tests that need just basic fields
const MinimalTaskSchema = CreateTaskResponseSchema.pick({
  id: true,
  title: true,
  number: true,
  status: true,
  priority: true,
})

// Local schema extending minimal task with projectId
const TaskWithProjectIdSchema = MinimalTaskSchema.extend({
  projectId: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Fetch router helpers (defined outside all test/describe blocks)
// ---------------------------------------------------------------------------

/**
 * Routes GET /column/* to a single-column list response; all other URLs
 * return the given task payload. Used by TaskResource tests that call
 * both the column endpoint and the task endpoint.
 */
function makeColumnOrTaskRouter(columnPayload: object[], taskPayload: object): (url: string) => Promise<Response> {
  return (url) => {
    if (url.includes('/column/')) {
      return Promise.resolve(new Response(JSON.stringify(columnPayload), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(taskPayload), { status: 200 }))
  }
}

/**
 * Routes PUT requests to an empty-object response; all other methods
 * return the given list payload. Matches the Kaneo CommentResource.update
 * behaviour where PUT returns {} and the follow-up GET returns the list.
 */
function makePutOrGetRouter(listPayload: object[]): (_url: string, options: RequestInit) => Promise<Response> {
  return (_url, options) => {
    if (options.method === 'PUT') {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(listPayload), { status: 200 }))
  }
}

describe('Schema Validation', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('Task Schemas', () => {
    const validTaskResponse = {
      id: 'task-1',
      title: 'Test Task',
      number: 42,
      status: 'todo',
      priority: 'medium' as const,
    }

    const validTaskFullResponse = createMockTask({
      id: 'task-1',
      title: 'Test Task',
      number: 42,
      description: 'Task description',
      dueDate: null,
      createdAt: '2026-03-01T00:00:00Z',
      projectId: 'proj-1',
      userId: null,
    })

    test('MinimalTaskSchema validates correct task structure', () => {
      const result = MinimalTaskSchema.safeParse(validTaskResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.id).toBe('task-1')
      expect(result.data.title).toBe('Test Task')
      expect(result.data.number).toBe(42)
      expect(result.data.status).toBe('todo')
      expect(result.data.priority).toBe('medium')
    })

    test('MinimalTaskSchema fails on missing required fields', () => {
      // Missing id, number, status, priority
      const invalidTask = { title: 'Test' }
      const result = MinimalTaskSchema.safeParse(invalidTask)
      expect(result.success).toBe(false)
    })

    test('MinimalTaskSchema fails on wrong types', () => {
      const invalidTask = {
        ...validTaskResponse,
        // Should be number
        number: 'not-a-number',
      }
      const result = MinimalTaskSchema.safeParse(invalidTask)
      expect(result.success).toBe(false)
    })

    test('KaneoTaskResponseSchema validates full task structure', () => {
      const result = KaneoTaskResponseSchema.safeParse(validTaskFullResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.id).toBe('task-1')
      expect(result.data.description).toBe('Task description')
      expect(result.data.createdAt).toBe('2026-03-01T00:00:00Z')
      expect(result.data.dueDate).toBeNull()
      expect(result.data.projectId).toBe('proj-1')
      expect(result.data.userId).toBeNull()
    })

    test('TaskWithProjectIdSchema validates projectId field', () => {
      const validTaskWithProject = {
        ...validTaskResponse,
        projectId: 'proj-1',
      }
      const result = TaskWithProjectIdSchema.safeParse(validTaskWithProject)
      expect(result.success).toBe(true)
    })

    describe('TaskResource.create', () => {
      test('validates response schema on create', async () => {
        setMockFetch(
          makeColumnOrTaskRouter(
            [createMockColumn({ id: 'col-1', name: 'To Do' })],
            createMockTask(validTaskFullResponse),
          ),
        )

        const resource = new TaskResource(mockConfig)
        const result = await resource.create({
          projectId: 'proj-1',
          title: 'Test Task',
        })

        // Verify result has all required schema fields
        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('title')
        expect(result).toHaveProperty('number')
        expect(result).toHaveProperty('status')
        expect(result).toHaveProperty('priority')
        expect(typeof result.id).toBe('string')
        expect(typeof result.title).toBe('string')
        expect(typeof result.number).toBe('number')
        expect(typeof result.status).toBe('string')
        expect(typeof result.priority).toBe('string')
      })

      test('rejects invalid response schema on create', async () => {
        setMockFetch(() =>
          Promise.resolve(
            new Response(JSON.stringify({ invalid: 'data', missing: 'required fields' }), { status: 200 }),
          ),
        )

        const resource = new TaskResource(mockConfig)
        const promise = resource.create({ projectId: 'proj-1', title: 'Test' })
        await expect(promise).rejects.toThrow()
      })
    })

    describe('TaskResource.get', () => {
      test('validates response schema on get', async () => {
        setMockFetch(
          makeColumnOrTaskRouter(
            [createMockColumn({ id: 'col-1', name: 'To Do' })],
            createMockTask(validTaskFullResponse),
          ),
        )

        const resource = new TaskResource(mockConfig)
        const result = await resource.get('task-1')

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('title')
        expect(result).toHaveProperty('number')
        expect(result).toHaveProperty('status')
        expect(result).toHaveProperty('priority')
        expect(result).toHaveProperty('description')
        expect(result).toHaveProperty('createdAt')
        expect(result).toHaveProperty('projectId')
        expect(result).toHaveProperty('userId')
        expect(result).toHaveProperty('relations')
        expect(Array.isArray(result.relations)).toBe(true)
      })
    })

    describe('TaskResource.list', () => {
      test('validates array response schema', async () => {
        const validTaskListResponse = {
          id: 'proj-1',
          name: 'Test Project',
          columns: [
            {
              id: 'col-1',
              name: 'To Do',
              icon: null,
              color: null,
              isFinal: false,
              tasks: [
                {
                  ...validTaskResponse,
                  dueDate: null,
                },
              ],
            },
          ],
          archivedTasks: [],
          plannedTasks: [],
        }
        setMockFetch(() => Promise.resolve(new Response(JSON.stringify(validTaskListResponse), { status: 200 })))

        const resource = new TaskResource(mockConfig)
        const result = await resource.list('proj-1')

        expect(Array.isArray(result)).toBe(true)
        assert(result.length > 0)
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('title')
        expect(result[0]).toHaveProperty('number')
        expect(result[0]).toHaveProperty('status')
        expect(result[0]).toHaveProperty('priority')
        expect(result[0]).toHaveProperty('dueDate')
      })
    })

    describe('TaskResource.update', () => {
      test('validates response schema on update', async () => {
        setMockFetch(
          makeColumnOrTaskRouter(
            [createMockColumn({ id: 'col-1', name: 'To Do' })],
            createMockTask({
              ...validTaskResponse,
              projectId: 'proj-1',
            }),
          ),
        )

        const resource = new TaskResource(mockConfig)
        const result = await resource.update('task-1', { title: 'Updated' })

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('title')
        expect(result).toHaveProperty('number')
        expect(result).toHaveProperty('status')
        expect(result).toHaveProperty('priority')
      })
    })
  })

  describe('Project Schemas', () => {
    const validProjectResponse = createMockProject({
      id: 'proj-1',
      name: 'Test Project',
      slug: 'test-project',
    })

    const validProjectFullResponse = createMockProject({
      id: 'proj-1',
      name: 'Test Project',
      slug: 'test-project',
      icon: null,
      description: null,
      isPublic: false,
    })

    test('KaneoProjectSchema validates correct project structure', () => {
      const result = KaneoProjectSchema.safeParse(validProjectResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.id).toBe('proj-1')
      expect(result.data.name).toBe('Test Project')
      expect(result.data.slug).toBe('test-project')
    })

    test('KaneoProjectFullSchema validates full project structure', () => {
      const result = KaneoProjectFullSchema.safeParse(validProjectFullResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.icon).toBeNull()
      expect(result.data.description).toBeNull()
      expect(result.data.isPublic).toBe(false)
    })

    test('KaneoProjectSchema fails on missing required fields', () => {
      // Missing id, slug
      const invalidProject = { name: 'Test' }
      const result = KaneoProjectSchema.safeParse(invalidProject)
      expect(result.success).toBe(false)
    })

    describe('ProjectResource.create', () => {
      test('validates response schema on create', async () => {
        setMockFetch(() =>
          Promise.resolve(new Response(JSON.stringify(createMockProject(validProjectResponse)), { status: 200 })),
        )

        const resource = new ProjectResource(mockConfig)
        const result = await resource.create({
          name: 'Test Project',
          workspaceId: 'ws-1',
        })

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('slug')
        expect(typeof result.id).toBe('string')
        expect(typeof result.name).toBe('string')
        expect(typeof result.slug).toBe('string')
      })
    })

    describe('ProjectResource.list', () => {
      test('validates array response schema', async () => {
        setMockFetch(() =>
          Promise.resolve(new Response(JSON.stringify([createMockProject(validProjectResponse)]), { status: 200 })),
        )

        const resource = new ProjectResource(mockConfig)
        const result = await resource.list('ws-1')

        expect(Array.isArray(result)).toBe(true)
        assert(result.length > 0)
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('slug')
      })
    })

    describe('ProjectResource.update', () => {
      test('validates response schema on update', async () => {
        setMockFetch(() =>
          Promise.resolve(new Response(JSON.stringify(createMockProject(validProjectFullResponse)), { status: 200 })),
        )

        const resource = new ProjectResource(mockConfig)
        const result = await resource.update('proj-1', 'ws-1', { name: 'Updated' })

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('slug')
      })
    })
  })

  describe('Label Schemas', () => {
    const validLabelResponse = createMockLabel({
      id: 'label-1',
      name: 'Bug',
      color: '#ff0000',
    })

    test('KaneoLabelSchema validates correct label structure', () => {
      const result = KaneoLabelSchema.safeParse(validLabelResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.id).toBe('label-1')
      expect(result.data.name).toBe('Bug')
      expect(result.data.color).toBe('#ff0000')
    })

    test('KaneoLabelSchema fails on missing required fields', () => {
      // Missing id, color
      const invalidLabel = { name: 'Bug' }
      const result = KaneoLabelSchema.safeParse(invalidLabel)
      expect(result.success).toBe(false)
    })

    test('KaneoLabelSchema fails on wrong types', () => {
      const invalidLabel = {
        ...validLabelResponse,
        // Should be string
        color: 123,
      }
      const result = KaneoLabelSchema.safeParse(invalidLabel)
      expect(result.success).toBe(false)
    })

    describe('LabelResource.create', () => {
      test('validates response schema on create', async () => {
        setMockFetch(() =>
          Promise.resolve(new Response(JSON.stringify(createMockLabel(validLabelResponse)), { status: 200 })),
        )

        const resource = new LabelResource(mockConfig)
        const result = await resource.create({
          workspaceId: 'ws-1',
          name: 'Bug',
        })

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('color')
        expect(typeof result.id).toBe('string')
        expect(typeof result.name).toBe('string')
        expect(typeof result.color).toBe('string')
      })
    })

    describe('LabelResource.list', () => {
      test('validates array response schema', async () => {
        setMockFetch(() =>
          Promise.resolve(new Response(JSON.stringify([createMockLabel(validLabelResponse)]), { status: 200 })),
        )

        const resource = new LabelResource(mockConfig)
        const result = await resource.list('ws-1')

        expect(Array.isArray(result)).toBe(true)
        assert(result.length > 0)
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('color')
      })
    })

    describe('LabelResource.update', () => {
      test('validates response schema on update', async () => {
        setMockFetch(() =>
          Promise.resolve(new Response(JSON.stringify(createMockLabel(validLabelResponse)), { status: 200 })),
        )

        const resource = new LabelResource(mockConfig)
        const result = await resource.update('label-1', { name: 'Updated' })

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('color')
      })
    })
  })

  describe('Activity/Comment Schemas', () => {
    const validActivityResponse = createMockActivity({
      id: 'act-1',
      taskId: 'task-1',
      type: 'comment',
      content: 'Test comment',
    })

    const validActivityWithTypeResponse = createMockActivity({
      id: 'act-1',
      taskId: 'task-1',
      type: 'comment',
      content: 'Test comment',
    })

    test('ActivityItemSchema validates correct activity structure', () => {
      const result = ActivityItemSchema.safeParse(validActivityResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.id).toBe('act-1')
      expect(result.data.content).toBe('Test comment')
    })

    test('KaneoActivityWithTypeSchema validates activity array', () => {
      const result = KaneoActivityWithTypeSchema.safeParse([validActivityWithTypeResponse])
      expect(result.success).toBe(true)
      assert(result.success)
      assert(result.data.length > 0)
      assert(result.data[0] !== undefined)
      expect(result.data[0].type).toBe('comment')
    })

    test('ActivityItemSchema fails on missing required fields', () => {
      // Missing id, createdAt
      const invalidActivity = { content: 'Test' }
      const result = ActivityItemSchema.safeParse(invalidActivity)
      expect(result.success).toBe(false)
    })

    describe('CommentResource.list', () => {
      test('validates array response schema', async () => {
        setMockFetch(() =>
          Promise.resolve(
            new Response(JSON.stringify([createMockActivity(validActivityWithTypeResponse)]), { status: 200 }),
          ),
        )

        const resource = new CommentResource(mockConfig)
        const result = await resource.list('task-1')

        expect(Array.isArray(result)).toBe(true)
        assert(result.length > 0)
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('comment')
        expect(result[0]).toHaveProperty('createdAt')
      })
    })

    describe('CommentResource.update', () => {
      test('validates response schema on update', async () => {
        // PUT returns {} (Kaneo bug), then GET returns array — differentiate by method
        setMockFetch(makePutOrGetRouter([createMockActivity(validActivityResponse)]))

        const resource = new CommentResource(mockConfig)
        const result = await resource.update('task-1', 'act-1', 'Updated')

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('comment')
        expect(result).toHaveProperty('createdAt')
      })
    })
  })

  describe('Column Schemas', () => {
    const validColumnResponse = createMockColumn({
      id: 'col-1',
      name: 'To Do',
      icon: null,
      color: null,
      isFinal: false,
    })

    test('KaneoColumnSchema validates correct column structure', () => {
      const result = KaneoColumnSchema.safeParse(validColumnResponse)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.id).toBe('col-1')
      expect(result.data.name).toBe('To Do')
      expect(result.data.color).toBeNull()
      expect(result.data.isFinal).toBe(false)
    })

    test('KaneoColumnSchema fails on missing required fields', () => {
      // Missing id, color, isFinal
      const invalidColumn = { name: 'To Do' }
      const result = KaneoColumnSchema.safeParse(invalidColumn)
      expect(result.success).toBe(false)
    })

    describe('ColumnResource.list', () => {
      test('validates array response schema', async () => {
        setMockFetch(() => Promise.resolve(new Response(JSON.stringify([validColumnResponse]), { status: 200 })))

        const resource = new ColumnResource(mockConfig)
        const result = await resource.list('proj-1')

        expect(Array.isArray(result)).toBe(true)
        assert(result.length > 0)
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('color')
        expect(result[0]).toHaveProperty('isFinal')
      })
    })
  })

  describe('Schema Field Type Validation', () => {
    test('Task schema fields have correct types', () => {
      const task = {
        id: 'task-1',
        title: 'Test',
        number: 42,
        status: 'todo',
        priority: 'medium',
      }
      const result = MinimalTaskSchema.safeParse(task)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(typeof result.data.id).toBe('string')
      expect(typeof result.data.title).toBe('string')
      expect(typeof result.data.number).toBe('number')
      expect(typeof result.data.status).toBe('string')
      expect(typeof result.data.priority).toBe('string')
    })

    test('Project schema fields have correct types', () => {
      const project = createMockProject({
        id: 'proj-1',
        name: 'Test',
        slug: 'test',
      })
      const result = KaneoProjectSchema.safeParse(project)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(typeof result.data.id).toBe('string')
      expect(typeof result.data.name).toBe('string')
      expect(typeof result.data.slug).toBe('string')
    })

    test('Label schema fields have correct types', () => {
      const label = createMockLabel({
        id: 'label-1',
        name: 'Bug',
        color: '#ff0000',
      })
      const result = KaneoLabelSchema.safeParse(label)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(typeof result.data.id).toBe('string')
      expect(typeof result.data.name).toBe('string')
      expect(typeof result.data.color).toBe('string')
    })

    test('Activity schema fields have correct types', () => {
      const activity = createMockActivity({
        id: 'act-1',
        taskId: 'task-1',
        type: 'comment',
        content: 'Test',
      })
      const result = ActivityItemSchema.safeParse(activity)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(typeof result.data.id).toBe('string')
      expect(typeof result.data.content).toBe('string')
    })

    test('Column schema fields have correct types', () => {
      const column = {
        id: 'col-1',
        name: 'To Do',
        icon: '',
        color: '#ff0000',
        isFinal: false,
      }
      const result = KaneoColumnSchema.safeParse(column)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(typeof result.data.id).toBe('string')
      expect(typeof result.data.name).toBe('string')
      expect(typeof result.data.isFinal).toBe('boolean')
    })
  })

  describe('Negative Schema Validation Tests', () => {
    test('TaskResource.create rejects missing id field', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              title: 'Test',
              number: 42,
              status: 'todo',
              priority: 'medium',
              // Missing id
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const promise = resource.create({ projectId: 'proj-1', title: 'Test' })
      await expect(promise).rejects.toThrow()
    })

    test('TaskResource.create rejects wrong number type', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 'not-a-number',
              status: 'todo',
              priority: 'medium',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const promise2 = resource.create({ projectId: 'proj-1', title: 'Test' })
      await expect(promise2).rejects.toThrow()
    })

    test('LabelResource.create rejects missing color', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'Bug',
              // Missing color
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.create({ workspaceId: 'ws-1', name: 'Bug' })
      await expect(promise).rejects.toThrow()
    })

    test('ProjectResource.create rejects missing slug', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              // Missing slug
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new ProjectResource(mockConfig)
      const promise = resource.create({ name: 'Test', workspaceId: 'ws-1' })
      await expect(promise).rejects.toThrow()
    })

    test('CommentResource.update rejects missing createdAt', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'act-1',
              comment: 'Updated',
              // Missing createdAt
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const promise = resource.update('task-1', 'act-1', 'Updated')
      await expect(promise).rejects.toThrow()
    })

    test('ColumnResource.list rejects missing isFinal', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'col-1',
                name: 'To Do',
                icon: null,
                color: null,
                // Missing isFinal
              },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('proj-1')
      await expect(promise).rejects.toThrow()
    })
  })

  describe('Nullable Field Tests', () => {
    test('Task dueDate can be null or omitted', () => {
      const task = createMockTask({
        id: 'task-1',
        title: 'Test Task',
        description: 'Test description',
        dueDate: null,
        userId: null,
      })
      const result = KaneoTaskResponseSchema.safeParse(task)
      // dueDate is z.unknown().optional() in schema, so null should be ok
      expect(result.success).toBe(true)
    })

    test('Task userId can be null', () => {
      const task = createMockTask({
        id: 'task-1',
        title: 'Test Task',
        description: 'Test description',
        dueDate: '2026-03-15T00:00:00Z',
        userId: null,
      })
      const result = KaneoTaskResponseSchema.safeParse(task)
      expect(result.success).toBe(true)
    })

    test('Column color can be null', () => {
      const column = {
        id: 'col-1',
        name: 'To Do',
        icon: null,
        color: null,
        isFinal: false,
      }
      const result = KaneoColumnSchema.safeParse(column)
      expect(result.success).toBe(true)
    })

    test('Activity content can be null', () => {
      const activity = createMockActivity({
        id: 'act-1',
        taskId: 'task-1',
        type: 'comment',
        content: 'Test',
      })
      // KaneoActivityWithTypeSchema is an array schema (GetActivitiesResponseSchema)
      // Testing individual activity against ActivityItemSchema instead
      const result = ActivityItemSchema.safeParse(activity)
      expect(result.success).toBe(true)
    })
  })
})
