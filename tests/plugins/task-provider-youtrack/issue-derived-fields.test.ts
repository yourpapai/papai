// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchProjectCustomFieldsViaIssue } from '../../../plugins/task-provider-youtrack/issue-derived-fields.js'
import { fetchProjectCustomFields } from '../../../plugins/task-provider-youtrack/task-helpers.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'
import { createUniqueYouTrackConfig } from './fetch-mock-utils.js'

// Mirrors the real (localized, homoglyph-polluted) AUDIT project schema reached through an
// issue, where the admin /customFields endpoint returns [] for a non-admin token.
const SAMPLE_ISSUE = {
  $type: 'Issue',
  customFields: [
    {
      name: 'Cтaтус',
      $type: 'StateIssueCustomField',
      projectCustomField: {
        $type: 'StateProjectCustomField',
        canBeEmpty: false,
        bundle: { id: '72-976', $type: 'StateBundle' },
        field: {
          name: 'Cтaтус',
          localizedName: null,
          $type: 'CustomField',
          fieldType: { id: 'state[1]', presentation: 'state[1]' },
        },
      },
    },
    {
      name: 'URL адеса где будет размещаться приложение. Одна строчка - один URL',
      $type: 'TextIssueCustomField',
      projectCustomField: {
        $type: 'TextProjectCustomField',
        canBeEmpty: true,
        field: {
          name: 'URL адеса где будет размещаться приложение. Одна строчка - один URL',
          $type: 'CustomField',
          fieldType: { id: 'text', presentation: 'text' },
        },
      },
    },
  ],
}

const nameOf = (field: { field?: { name?: string } | null }): string => field.field?.name ?? ''

const queueResponses = (responses: readonly unknown[]): void => {
  let i = 0
  setMockFetch(() => {
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

describe('fetchProjectCustomFieldsViaIssue', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('lifts projectCustomField settings from a sample issue into ProjectCustomField shape', async () => {
    const config = createUniqueYouTrackConfig()
    // 1) project shortName lookup, 2) sample issue
    queueResponses([{ shortName: 'AUDIT' }, [SAMPLE_ISSUE]])

    const fields = await fetchProjectCustomFieldsViaIssue(config, '39-1118')

    expect(fields).toHaveLength(2)
    const state = fields.find((f) => f.field?.name === 'Cтaтус')
    expect(state?.$type).toBe('StateProjectCustomField')
    expect(state?.canBeEmpty).toBe(false)
    expect(state?.bundle?.id).toBe('72-976')
    expect(state?.field?.fieldType?.id).toBe('state[1]')
    const url = fields.find((f) => nameOf(f).startsWith('URL'))
    expect(url?.$type).toBe('TextProjectCustomField')
  })

  test('returns an empty list when the project has no issues to sample', async () => {
    const config = createUniqueYouTrackConfig()
    queueResponses([{ shortName: 'EMPTY' }, []])

    const fields = await fetchProjectCustomFieldsViaIssue(config, '0-9')

    expect(fields).toEqual([])
  })
})

describe('fetchProjectCustomFields admin→issue fallback', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('returns admin fields directly when the admin endpoint is populated', async () => {
    const config = createUniqueYouTrackConfig()
    const adminFields = [
      { $type: 'TextProjectCustomField', field: { name: 'Notes', fieldType: { id: 'text' } }, canBeEmpty: true },
    ]
    // Only the admin endpoint should be hit (the sample-fetch responses below stay unused).
    queueResponses([adminFields, { shortName: 'NOPE' }, [SAMPLE_ISSUE]])

    const fields = await fetchProjectCustomFields(config, '39-1', { deriveFromIssueWhenEmpty: true })

    expect(fields).toHaveLength(1)
    expect(fields[0]?.field?.name).toBe('Notes')
  })

  test('does not derive when the flag is off, even if the admin endpoint returns []', async () => {
    const config = createUniqueYouTrackConfig()
    queueResponses([[]])

    const fields = await fetchProjectCustomFields(config, '39-1118')

    expect(fields).toEqual([])
  })

  test('falls back to the issue-derived schema when the admin endpoint returns []', async () => {
    const config = createUniqueYouTrackConfig()
    // 1) admin customFields → [], 2) project shortName, 3) sample issue
    queueResponses([[], { shortName: 'AUDIT' }, [SAMPLE_ISSUE]])

    const fields = await fetchProjectCustomFields(config, '39-1118', { deriveFromIssueWhenEmpty: true })

    expect(fields.map((f) => f.field?.name)).toContain('Cтaтус')
    expect(fields.some((f) => nameOf(f).startsWith('URL'))).toBe(true)
  })
})
