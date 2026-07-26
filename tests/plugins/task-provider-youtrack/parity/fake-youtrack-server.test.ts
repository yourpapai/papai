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

const CreatedIssueSchema = z.object({
  id: z.string(),
  idReadable: z.string(),
  customFields: z.array(z.object({ name: z.string(), value: z.unknown() })),
})

const IssueGetSchema = z.object({
  customFields: z.array(z.object({ name: z.string(), value: z.unknown() })),
})

const CustomFieldValueSchema = z.union([z.object({ name: z.string().optional() }), z.number()])

const IssueCustomFieldsListSchema = z.array(z.object({ name: z.string(), value: z.unknown() }))

const IdReadableOnlySchema = z.object({ idReadable: z.string() })

const nameInMap = (byName: Map<string, z.infer<typeof CustomFieldValueSchema>>, key: string): string | undefined => {
  const value = byName.get(key)
  if (value === undefined || typeof value !== 'object') return undefined
  return value.name
}

describe('fake YouTrack server — issues & custom fields', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  test('creates an issue and echoes State/Priority/Due Date on GET', async () => {
    fake.reset()
    const project = await createProject(fake, 'Issue P', 'IP')
    const created = CreatedIssueSchema.parse(
      await (
        await postJson(fake, '/api/issues', {
          project: { id: project.id },
          summary: 'Hello',
          customFields: [
            { name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
            { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'high' } },
            { name: 'Due Date', $type: 'DateIssueCustomField', value: 1_800_000_000_000 },
          ],
        })
      ).json(),
    )

    expect(created.idReadable).toBe('IP-1')
    const got = IssueGetSchema.parse(
      await (await fetch(`${fake.url}/api/issues/${created.idReadable}?fields=id`)).json(),
    )
    const byName = new Map(got.customFields.map((f) => [f.name, CustomFieldValueSchema.parse(f.value)]))
    expect(nameInMap(byName, 'State')).toBe('In Progress')
    expect(nameInMap(byName, 'Priority')).toBe('high')
    expect(byName.get('Due Date')).toBe(1_800_000_000_000)
  })

  test('per-issue customFields endpoint returns Due Date as a number for enrich', async () => {
    fake.reset()
    const project = await createProject(fake, 'Enrich P', 'EP')
    const created = IdReadableOnlySchema.parse(
      await (
        await postJson(fake, '/api/issues', {
          project: { id: project.id },
          summary: 'Due',
          customFields: [{ name: 'Due Date', $type: 'DateIssueCustomField', value: 1_800_000_000_000 }],
        })
      ).json(),
    )
    const res = await fetch(`${fake.url}/api/issues/${created.idReadable}/customFields?fields=name,value`)
    const fields = IssueCustomFieldsListSchema.parse(await res.json())
    const due = fields.find((f) => f.name === 'Due Date')
    expect(due?.value).toBe(1_800_000_000_000)
  })

  test('delete removes the issue; subsequent GET is 404', async () => {
    fake.reset()
    const project = await createProject(fake, 'Del P', 'DP')
    const created = IdReadableOnlySchema.parse(
      await (await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'Bye' })).json(),
    )
    const del = await fetch(`${fake.url}/api/issues/${created.idReadable}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    const after = await fetch(`${fake.url}/api/issues/${created.idReadable}?fields=id`)
    expect(after.status).toBe(404)
  })

  test('creating an issue in a missing project is 404', async () => {
    fake.reset()
    const res = await postJson(fake, '/api/issues', { project: { id: 'nope' }, summary: 'x' })
    expect(res.status).toBe(404)
  })
})

const SummarySchema = z.object({ summary: z.string() })
const SummaryListSchema = z.array(SummarySchema)
const UnknownListSchema = z.array(z.unknown())

const UpdatedIssueSchema = z.object({
  summary: z.string(),
  customFields: z.array(z.object({ name: z.string(), value: z.object({ name: z.string().optional() }) })),
})

describe('fake YouTrack server — list, sort, paging, search', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  const seed = async (project: { id: string }, summary: string): Promise<void> => {
    await postJson(fake, '/api/issues', { project: { id: project.id }, summary })
  }

  test('sorts by title ascending when the query carries a sort-by clause', async () => {
    fake.reset()
    const project = await createProject(fake, 'Sort P', 'SORT')
    await seed(project, 'Sort B')
    await seed(project, 'Sort C')
    await seed(project, 'Sort A')
    const q = encodeURIComponent('project: {SORT} sort by: title asc')
    const res = await fetch(`${fake.url}/api/issues?query=${q}&$top=100`)
    const items = SummaryListSchema.parse(await res.json())
    expect(items.map((i) => i.summary)).toEqual(['Sort A', 'Sort B', 'Sort C'])
  })

  test('pages by $top/$skip in insertion order', async () => {
    fake.reset()
    const project = await createProject(fake, 'Page P', 'PAGE')
    await seed(project, 'Page A')
    await seed(project, 'Page B')
    await seed(project, 'Page C')
    const q = encodeURIComponent('project: {PAGE}')
    const first = SummaryListSchema.parse(await (await fetch(`${fake.url}/api/issues?query=${q}&$top=2`)).json())
    const second = SummaryListSchema.parse(
      await (await fetch(`${fake.url}/api/issues?query=${q}&$top=2&$skip=2`)).json(),
    )
    expect(first.map((i) => i.summary)).toEqual(['Page A', 'Page B'])
    expect(second.map((i) => i.summary)).toEqual(['Page C'])
  })

  test('search matches free-text within a project and excludes other projects', async () => {
    fake.reset()
    const a = await createProject(fake, 'Search A', 'SA')
    const b = await createProject(fake, 'Search B', 'SB')
    await seed(a, 'Searchable Falcon')
    await seed(a, 'Unrelated Item')
    await seed(b, 'Searchable Outsider')
    const q = encodeURIComponent('project: {SA} Searchable')
    const res = await fetch(`${fake.url}/api/issues?query=${q}&$top=100`)
    const items = SummaryListSchema.parse(await res.json())
    expect(items.map((i) => i.summary)).toEqual(['Searchable Falcon'])
  })

  test('search returns empty for a non-matching query', async () => {
    fake.reset()
    const project = await createProject(fake, 'Empty P', 'EMP')
    await seed(project, 'Present Task')
    const q = encodeURIComponent('project: {EMP} zzz-no-such-token-qxqx')
    const res = await fetch(`${fake.url}/api/issues?query=${q}&$top=100`)
    expect(UnknownListSchema.parse(await res.json())).toEqual([])
  })

  test('update via POST /api/issues/{id} changes summary and State', async () => {
    fake.reset()
    const project = await createProject(fake, 'Upd P', 'UP')
    const created = IdReadableOnlySchema.parse(
      await (await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'Before' })).json(),
    )
    await postJson(fake, `/api/issues/${created.idReadable}`, {
      summary: 'After',
      customFields: [{ name: 'State', $type: 'StateIssueCustomField', value: { name: 'Done' } }],
    })
    const got = UpdatedIssueSchema.parse(
      await (await fetch(`${fake.url}/api/issues/${created.idReadable}?fields=id`)).json(),
    )
    expect(got.summary).toBe('After')
    expect(got.customFields.find((f) => f.name === 'State')?.value.name).toBe('Done')
  })
})
