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
