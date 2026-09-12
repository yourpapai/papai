// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { createFakeYouTrackResponder } from './responder.js'

const ProjectSchema = z.object({ id: z.string(), name: z.string() })
const ProjectListSchema = z.array(z.object({ id: z.string() }))
const ErrorBodySchema = z.object({ error: z.string(), error_description: z.string() })
const LinkTypeListSchema = z.array(z.object({ name: z.string() }))
const StateValueArraySchema = z.array(z.object({ id: z.string(), name: z.string() }))
const StateValueSchema = z.object({
  id: z.string(),
  name: z.string(),
  ordinal: z.number(),
  isResolved: z.boolean(),
})

describe('createFakeYouTrackResponder', () => {
  test('creates a project and reads it back through the responder', async () => {
    const respond = createFakeYouTrackResponder()

    const created = await respond(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Responder Project', shortName: 'RP' }),
      }),
    )
    expect(created.status).toBe(200)
    const project = ProjectSchema.parse(await created.json())
    expect(project.name).toBe('Responder Project')

    const listed = await respond(new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName'))
    const projects = ProjectListSchema.parse(await listed.json())
    expect(projects.map((entry) => entry.id)).toContain(project.id)
  })

  test('404s an unrouted path with the router message', async () => {
    const respond = createFakeYouTrackResponder()

    const response = await respond(new Request('https://youtrack.invalid/api/nope'))

    expect(response.status).toBe(404)
    expect(ErrorBodySchema.parse(await response.json())).toEqual({
      error: 'no route for GET /api/nope',
      error_description: 'no route for GET /api/nope',
    })
  })

  test('passes the query string through to the router', async () => {
    const respond = createFakeYouTrackResponder()

    const response = await respond(new Request('https://youtrack.invalid/api/issueLinkTypes?fields=id,name,directed'))

    expect(response.status).toBe(200)
    expect(LinkTypeListSchema.parse(await response.json()).length).toBeGreaterThan(0)
  })

  test('gives each responder independent state', async () => {
    const first = createFakeYouTrackResponder()
    const second = createFakeYouTrackResponder()

    await first(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Only In First', shortName: 'OIF' }),
      }),
    )

    const listed = await second(new Request('https://youtrack.invalid/api/admin/projects?fields=id,name,shortName'))
    expect(ProjectListSchema.parse(await listed.json())).toHaveLength(0)
  })

  test('tolerates a POST with no body', async () => {
    const respond = createFakeYouTrackResponder()

    const response = await respond(new Request('https://youtrack.invalid/api/nope', { method: 'POST' }))

    expect(response.status).toBe(404)
  })
})

describe('fake YouTrack state-bundle operations', () => {
  const BUNDLE_BASE = 'https://youtrack.invalid/api/admin/customFieldSettings/bundles/state/state-bundle-1'
  const createProject = async (respond: (r: Request) => Promise<Response>, name: string): Promise<string> => {
    const res = await respond(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, shortName: name.slice(0, 2).toUpperCase() }),
      }),
    )
    return ProjectSchema.parse(await res.json()).id
  }

  test('GET bundle metadata reports aggregated projects (isShared when >1)', async () => {
    const respond = createFakeYouTrackResponder()
    await createProject(respond, 'Alpha')
    await createProject(respond, 'Beta')

    const res = await respond(new Request(BUNDLE_BASE))
    expect(res.status).toBe(200)
    const body = z
      .object({
        id: z.string(),
        aggregated: z.object({ project: z.array(z.object({ id: z.string() })) }).optional(),
      })
      .parse(await res.json())
    expect(body.id).toBe('state-bundle-1')
    expect(body.aggregated?.project).toHaveLength(2)
  })

  test('GET values returns seeded state values with id/name/ordinal/isResolved', async () => {
    const respond = createFakeYouTrackResponder()
    await createProject(respond, 'Solo')

    const res = await respond(new Request(`${BUNDLE_BASE}/values?fields=id,name,ordinal,isResolved`))
    expect(res.status).toBe(200)
    const values = z.array(StateValueSchema).parse(await res.json())
    expect(values).toHaveLength(3)
    expect(values[0]).toMatchObject({ name: 'Open', ordinal: 0, isResolved: false })
    expect(values[2]).toMatchObject({ name: 'Done', ordinal: 2, isResolved: true })
    expect(typeof values[0]?.id).toBe('string')
  })

  test('POST values creates a new state value', async () => {
    const respond = createFakeYouTrackResponder()
    await createProject(respond, 'Solo')

    const res = await respond(
      new Request(`${BUNDLE_BASE}/values?fields=id,name,ordinal,isResolved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Review', isResolved: false }),
      }),
    )
    expect(res.status).toBe(200)
    const created = StateValueSchema.parse(await res.json())
    expect(created.name).toBe('Review')
    expect(created.ordinal).toBe(3)
    expect(created.isResolved).toBe(false)

    const list = await respond(new Request(`${BUNDLE_BASE}/values?fields=id,name,ordinal,isResolved`))
    expect(StateValueArraySchema.parse(await list.json()).map((v) => v.name)).toContain('Review')
  })

  test('POST per-status updates name and isResolved', async () => {
    const respond = createFakeYouTrackResponder()
    await createProject(respond, 'Solo')

    const res = await respond(
      new Request(`${BUNDLE_BASE}/values/state-val-1?fields=id,name,ordinal,isResolved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Reopened', isResolved: false }),
      }),
    )
    expect(res.status).toBe(200)
    const updated = StateValueSchema.parse(await res.json())
    expect(updated.name).toBe('Reopened')
    expect(updated.isResolved).toBe(false)
  })

  test('POST per-status updates ordinal (reorder)', async () => {
    const respond = createFakeYouTrackResponder()
    await createProject(respond, 'Solo')

    const res = await respond(
      new Request(`${BUNDLE_BASE}/values/state-val-3?fields=id,name,ordinal,isResolved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordinal: 0 }),
      }),
    )
    expect(res.status).toBe(200)
    expect(StateValueSchema.parse(await res.json()).ordinal).toBe(0)
  })

  test('DELETE per-status removes the value', async () => {
    const respond = createFakeYouTrackResponder()
    await createProject(respond, 'Solo')

    const del = await respond(new Request(`${BUNDLE_BASE}/values/state-val-2`, { method: 'DELETE' }))
    expect(del.status).toBe(204)

    const list = await respond(new Request(`${BUNDLE_BASE}/values?fields=id,name`))
    const remaining = StateValueArraySchema.parse(await list.json())
    expect(remaining).toHaveLength(2)
    expect(remaining.map((v) => v.name)).not.toContain('In Progress')
  })
})

describe('fake YouTrack agile operations', () => {
  const AGILES = 'https://youtrack.invalid/api/agiles'
  const AgileListSchema = z.array(z.object({ id: z.string(), name: z.string() }))
  const SprintSchema = z.object({
    id: z.string(),
    name: z.string(),
    archived: z.boolean().optional(),
    goal: z.string().nullable().optional(),
    isDefault: z.boolean().optional(),
    start: z.number().nullable().optional(),
    finish: z.number().nullable().optional(),
    unresolvedIssuesCount: z.number().optional(),
  })
  const listBoards = async (
    respond: (r: Request) => Promise<Response>,
  ): Promise<readonly { id: string; name: string }[]> =>
    AgileListSchema.parse(await (await respond(new Request(AGILES))).json())
  const firstBoardId = async (respond: (r: Request) => Promise<Response>): Promise<string> =>
    (await listBoards(respond)).map((board) => board.id)[0] ?? ''
  const createTask = async (respond: (r: Request) => Promise<Response>, stateName?: string): Promise<string> => {
    const project = await respond(
      new Request('https://youtrack.invalid/api/admin/projects?fields=id,name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Tasks', shortName: 'TA' }),
      }),
    )
    const projectId = ProjectSchema.parse(await project.json()).id
    const issue = await respond(
      new Request('https://youtrack.invalid/api/issues?fields=id,idReadable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: { id: projectId },
          summary: 'Assignable task',
          ...(stateName === undefined ? {} : { customFields: [{ name: 'State', value: { name: stateName } }] }),
        }),
      }),
    )
    return z.object({ id: z.string() }).parse(await issue.json()).id
  }

  test('GET /api/agiles lists the seeded board with sprints id shape', async () => {
    const respond = createFakeYouTrackResponder()

    const res = await respond(new Request(`${AGILES}?fields=id,name,sprints(id)`))
    expect(res.status).toBe(200)
    const boards = z
      .array(z.object({ id: z.string(), name: z.string(), sprints: z.array(z.object({ id: z.string() })) }))
      .parse(await res.json())
    expect(boards).toHaveLength(1)
    expect(boards[0]?.sprints).toEqual([])
  })

  test('POST sprints creates and GET sprints roundtrips the stored fields', async () => {
    const respond = createFakeYouTrackResponder()
    const agileId = await firstBoardId(respond)

    const created = await respond(
      new Request(`${AGILES}/${agileId}/sprints?fields=id,name,goal,start,finish,isDefault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sprint 1', goal: 'Ship it', start: 1772461200000, finish: 1773414000000 }),
      }),
    )
    expect(created.status).toBe(200)
    const sprint = SprintSchema.parse(await created.json())
    expect(sprint).toMatchObject({ name: 'Sprint 1', goal: 'Ship it', start: 1772461200000, finish: 1773414000000 })

    const list = await respond(new Request(`${AGILES}/${agileId}/sprints?fields=id,name`))
    expect(
      z
        .array(SprintSchema)
        .parse(await list.json())
        .map((s) => s.id),
    ).toContain(sprint.id)

    const boardRead = await respond(new Request(`${AGILES}?fields=id,sprints(id)`))
    const withSprints = z
      .array(z.object({ sprints: z.array(z.object({ id: z.string() })) }))
      .parse(await boardRead.json())
    expect(withSprints[0]?.sprints.map((s) => s.id)).toContain(sprint.id)
  })

  test('POST sprint update clears goal with null and archives', async () => {
    const respond = createFakeYouTrackResponder()
    const agileId = await firstBoardId(respond)
    const created = await respond(
      new Request(`${AGILES}/${agileId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sprint 1', goal: 'Ship it' }),
      }),
    )
    const sprint = SprintSchema.parse(await created.json())

    const updated = await respond(
      new Request(`${AGILES}/${agileId}/sprints/${sprint.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: null, archived: true }),
      }),
    )
    expect(updated.status).toBe(200)
    expect(SprintSchema.parse(await updated.json())).toMatchObject({ goal: null, archived: true, name: 'Sprint 1' })
  })

  test('POST issues assigns a task and unresolvedIssuesCount reflects resolution state', async () => {
    const respond = createFakeYouTrackResponder()
    const agileId = await firstBoardId(respond)
    const created = await respond(
      new Request(`${AGILES}/${agileId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sprint 1' }),
      }),
    )
    const sprint = SprintSchema.parse(await created.json())
    const openTaskId = await createTask(respond)
    const doneTaskId = await createTask(respond, 'Done')

    const assigned = await respond(
      new Request(`${AGILES}/${agileId}/sprints/${sprint.id}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: openTaskId, $type: 'Issue' }),
      }),
    )
    expect(assigned.status).toBe(200)
    await respond(
      new Request(`${AGILES}/${agileId}/sprints/${sprint.id}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doneTaskId, $type: 'Issue' }),
      }),
    )

    const list = await respond(new Request(`${AGILES}/${agileId}/sprints?fields=id,unresolvedIssuesCount`))
    const readback = z
      .array(SprintSchema)
      .parse(await list.json())
      .find((s) => s.id === sprint.id)
    expect(readback?.unresolvedIssuesCount).toBe(1)
  })

  test('sprint routes 404 for an unknown board', async () => {
    const respond = createFakeYouTrackResponder()

    const res = await respond(new Request(`${AGILES}/agile-unknown/sprints`))
    expect(res.status).toBe(404)
  })
})
