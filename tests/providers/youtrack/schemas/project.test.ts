// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/project.test.ts
import { describe, expect, test } from 'bun:test'

import { ProjectSchema } from '../../../../src/providers/youtrack/schemas/project.js'

describe('Project schemas', () => {
  const validProject = {
    id: '0-0',
    $type: 'Project',
    name: 'My Project',
    shortName: 'MP',
    description: 'Description',
    archived: false,
  }

  test('validates project', () => {
    const result = ProjectSchema.parse(validProject)
    expect(result.shortName).toBe('MP')
  })

  test('validates minimal project (only id, name, shortName)', () => {
    expect(() => ProjectSchema.parse({ id: '0-0', name: 'New Project', shortName: 'NP' })).not.toThrow()
  })

  test('missing name rejects', () => {
    const { name: _, ...invalid } = validProject
    expect(() => ProjectSchema.parse(invalid)).toThrow()
  })

  test('missing shortName rejects', () => {
    const { shortName: _, ...invalid } = validProject
    expect(() => ProjectSchema.parse(invalid)).toThrow()
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = validProject
    expect(() => ProjectSchema.parse(invalid)).toThrow()
  })

  test('name as number rejects', () => {
    expect(() => ProjectSchema.parse({ ...validProject, name: 42 })).toThrow()
  })

  test('shortName as number rejects', () => {
    expect(() => ProjectSchema.parse({ ...validProject, shortName: 42 })).toThrow()
  })

  test('archived as string rejects', () => {
    expect(() => ProjectSchema.parse({ ...validProject, archived: 'true' })).toThrow()
  })

  test('description as null accepts (nullable)', () => {
    const result = ProjectSchema.parse({ ...validProject, description: null })
    expect(result.description).toBeNull()
  })

  test('leader with valid user accepts', () => {
    const result = ProjectSchema.parse({
      ...validProject,
      leader: { id: '1', login: 'john', fullName: 'John Doe' },
    })
    expect(result.leader?.login).toBe('john')
  })

  test('leader with invalid user (missing login) rejects', () => {
    expect(() => ProjectSchema.parse({ ...validProject, leader: { id: '1', fullName: 'X' } })).toThrow()
  })

  test('created as ISO string rejects', () => {
    expect(() => ProjectSchema.parse({ ...validProject, created: '2024-01-01' })).toThrow()
  })

  test('extra fields stripped', () => {
    const result = ProjectSchema.parse({ ...validProject, custom: true })
    expect('custom' in result).toBe(false)
  })
})
