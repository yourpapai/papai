// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { classifyFieldType, resolveCustomFieldValue } from '../../../plugins/task-provider-youtrack/field-engine.js'

const stateField = {
  $type: 'StateProjectCustomField',
  field: { name: 'State', fieldType: { id: 'state[1]' } },
  bundle: { id: 'sb-1', $type: 'StateBundle' },
}

const enumMultiField = {
  $type: 'EnumProjectCustomField',
  field: { name: 'Tags', fieldType: { id: 'enum[*]' } },
  bundle: { id: 'eb-1', $type: 'EnumBundle' },
}

const stateElements = [{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }, { name: 'Fixed' }]

const fetcher = (_segment: string, _bundleId: string): Promise<typeof stateElements> => Promise.resolve(stateElements)

describe('classifyFieldType', () => {
  test('classifies a single state field', () => {
    const c = classifyFieldType(stateField)
    expect(c.kind).toBe('bundle')
    expect(c.label).toBe('state')
    expect(c.multi).toBe(false)
    expect(c.singleType).toBe('StateIssueCustomField')
    expect(c.bundleSegment).toBe('state')
  })

  test('classifies a multi enum field', () => {
    const c = classifyFieldType(enumMultiField)
    expect(c.multi).toBe(true)
    expect(c.multiType).toBe('MultiEnumIssueCustomField')
    expect(c.bundleSegment).toBe('enum')
  })
})

describe('resolveCustomFieldValue', () => {
  test('resolves a state value case-insensitively against the bundle', async () => {
    const payload = await resolveCustomFieldValue(stateField, 'in progress', { getBundleElements: fetcher })
    expect(payload).toEqual({ name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } })
  })

  test('resolves a state value by localized (Russian) name', async () => {
    const payload = await resolveCustomFieldValue(stateField, 'В работе', { getBundleElements: fetcher })
    expect(payload.value).toEqual({ name: 'In Progress' })
  })

  test('throws a teaching error listing allowed values when no match', async () => {
    await expect(resolveCustomFieldValue(stateField, 'to-do', { getBundleElements: fetcher })).rejects.toThrow(
      /not a valid value.*Open, In Progress, Fixed/u,
    )
  })

  test('resolves multi enum values from a comma list', async () => {
    const payload = await resolveCustomFieldValue(enumMultiField, 'Open, Fixed', { getBundleElements: fetcher })
    expect(payload.$type).toBe('MultiEnumIssueCustomField')
    expect(payload.value).toEqual([{ name: 'Open' }, { name: 'Fixed' }])
  })

  test('builds a text payload without touching the bundle', async () => {
    const textField = { $type: 'TextProjectCustomField', field: { name: 'Notes', fieldType: { id: 'text' } } }
    const payload = await resolveCustomFieldValue(textField, 'hello', {
      getBundleElements: () => Promise.reject(new Error('should not fetch')),
    })
    expect(payload).toEqual({ name: 'Notes', $type: 'TextIssueCustomField', value: { text: 'hello' } })
  })

  test('throws a teaching error when an integer field gets a non-numeric value', async () => {
    const intField = {
      $type: 'SimpleProjectCustomField',
      field: { name: 'Story points', fieldType: { id: 'integer' } },
    }
    await expect(
      resolveCustomFieldValue(intField, 'lots', { getBundleElements: () => Promise.reject(new Error('no fetch')) }),
    ).rejects.toThrow(/Story points.*number/u)
  })

  test('resolves a valid integer field to a number', async () => {
    const intField = {
      $type: 'SimpleProjectCustomField',
      field: { name: 'Story points', fieldType: { id: 'integer' } },
    }
    const payload = await resolveCustomFieldValue(intField, '5', {
      getBundleElements: () => Promise.reject(new Error('no fetch')),
    })
    expect(payload).toEqual({ name: 'Story points', $type: 'SimpleIssueCustomField', value: 5 })
  })
})
