// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { startFakeYouTrackServer, type FakeYouTrackServer } from './fake-youtrack-server.js'

const postJson = (fake: FakeYouTrackServer, path: string, body: unknown): Promise<Response> =>
  fetch(`${fake.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
    body: JSON.stringify(body),
  })

const ProjectSchema = z.object({ id: z.string(), shortName: z.string() })

const createProject = async (
  fake: FakeYouTrackServer,
  name: string,
  shortName: string,
): Promise<{ id: string; shortName: string }> => {
  const res = await postJson(fake, '/api/admin/projects', { name, shortName })
  return ProjectSchema.parse(await res.json())
}

const CustomFieldsSchema = z.array(
  z.object({
    field: z.object({ name: z.string(), fieldType: z.object({ id: z.string() }) }),
    bundle: z.object({ id: z.string(), $type: z.string() }).optional(),
    canBeEmpty: z.boolean().optional(),
  }),
)

const BundleValuesSchema = z.array(z.object({ name: z.string() }))

const ProjectListSchema = z.array(z.unknown())

const ErrorBodySchema = z.object({ error: z.string().optional(), error_description: z.string().optional() })

describe('fake YouTrack server — projects & custom-field schema', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  test('creates then gets a project by db id', async () => {
    fake.reset()
    const project = await createProject(fake, 'Fake P', 'FP')
    expect(project.shortName).toBe('FP')
    const got = await fetch(`${fake.url}/api/admin/projects/${project.id}?fields=id,shortName`)
    expect(got.status).toBe(200)
    const body = ProjectSchema.parse(await got.json())
    expect(body.id).toBe(project.id)
    expect(body.shortName).toBe('FP')
  })

  test('serves State and Priority as bundle-typed project custom fields', async () => {
    fake.reset()
    const project = await createProject(fake, 'Schema P', 'SP')
    const res = await fetch(`${fake.url}/api/admin/projects/${project.id}/customFields?fields=id`)
    expect(res.status).toBe(200)
    const fields = CustomFieldsSchema.parse(await res.json())
    const byName = new Map(fields.map((f) => [f.field.name, f]))
    expect(byName.get('State')?.field.fieldType.id).toBe('state[1]')
    expect(byName.get('State')?.bundle?.$type).toBe('StateBundle')
    expect(byName.get('Priority')?.field.fieldType.id).toBe('enum[1]')
    expect(byName.get('Priority')?.bundle?.$type).toBe('EnumBundle')
    // canBeEmpty must be true so a title-only createTask never trips required-field validation.
    for (const f of fields) expect(f.canBeEmpty).toBe(true)
  })

  test('serves state bundle values including "In Progress"', async () => {
    const res = await fetch(
      `${fake.url}/api/admin/customFieldSettings/bundles/state/state-bundle-1/values?fields=name,localizedName,ordinal`,
    )
    expect(res.status).toBe(200)
    const values = BundleValuesSchema.parse(await res.json())
    expect(values.map((v) => v.name)).toContain('In Progress')
  })

  test('lists projects and reset() clears state', async () => {
    fake.reset()
    await createProject(fake, 'L', 'L1')
    const listed = ProjectListSchema.parse(await (await fetch(`${fake.url}/api/admin/projects?fields=id,name`)).json())
    expect(listed.length).toBe(1)
    fake.reset()
    const after = ProjectListSchema.parse(await (await fetch(`${fake.url}/api/admin/projects?fields=id,name`)).json())
    expect(after.length).toBe(0)
  })

  test('unknown route returns 404 with a YouTrack-shaped error body', async () => {
    const res = await fetch(`${fake.url}/api/nonsense`)
    expect(res.status).toBe(404)
    const body = ErrorBodySchema.parse(await res.json())
    expect(typeof body.error).toBe('string')
    expect(typeof body.error_description).toBe('string')
  })
})
