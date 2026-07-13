// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  gitlabGetFileContentSchema,
  gitlabGetJobSchema,
  gitlabGetMrInfoSchema,
  gitlabGetMrsSchema,
  gitlabGetRepositoryTreeSchema,
} from '../../plugins/mcp-gitlab/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So these tests assert the declared contract of each
// schema — required fields, closed shape — rather than simulating validation
// behavior that never runs in production.
describe('mcp-gitlab schemas', () => {
  test('get_repository_tree requires projectPath, has boolean recursive, and rejects unknown properties', () => {
    expect(gitlabGetRepositoryTreeSchema.required).toContain('projectPath')
    expect(gitlabGetRepositoryTreeSchema.properties.recursive.type).toBe('boolean')
    expect(gitlabGetRepositoryTreeSchema.additionalProperties).toBe(false)
  })

  test('get_file_content requires projectPath and filePath', () => {
    expect(gitlabGetFileContentSchema.required).toContain('projectPath')
    expect(gitlabGetFileContentSchema.required).toContain('filePath')
  })

  test('get_mr_info requires projectPath and mrIid', () => {
    expect(gitlabGetMrInfoSchema.required).toContain('projectPath')
    expect(gitlabGetMrInfoSchema.required).toContain('mrIid')
  })

  test('get_mrs requires only projectPath and constrains enum/limit fields', () => {
    expect(gitlabGetMrsSchema.required).toContain('projectPath')
    expect(gitlabGetMrsSchema.required).not.toContain('state')
    expect(gitlabGetMrsSchema.required).not.toContain('search')
    expect(gitlabGetMrsSchema.required).not.toContain('labels')
    expect(gitlabGetMrsSchema.required).not.toContain('sourceBranch')
    expect(gitlabGetMrsSchema.required).not.toContain('targetBranch')
    expect(gitlabGetMrsSchema.required).not.toContain('orderBy')
    expect(gitlabGetMrsSchema.required).not.toContain('sort')
    expect(gitlabGetMrsSchema.required).not.toContain('perPage')
    expect(gitlabGetMrsSchema.required).not.toContain('page')
    expect(gitlabGetMrsSchema.properties.state.enum).toEqual(['opened', 'closed', 'merged', 'all'])
    expect(gitlabGetMrsSchema.properties.orderBy.enum).toEqual(['created_at', 'updated_at'])
    expect(gitlabGetMrsSchema.properties.sort.enum).toEqual(['asc', 'desc'])
    expect(gitlabGetMrsSchema.properties.perPage.maximum).toBe(100)
    expect(gitlabGetMrsSchema.properties.all.type).toBe('boolean')
  })

  test('get_job accepts either jobUrl or projectPath+jobId, has no required array, and rejects unknown properties', () => {
    expect(gitlabGetJobSchema).not.toHaveProperty('required')
    expect(gitlabGetJobSchema.properties.projectPath.type).toBe('string')
    expect(gitlabGetJobSchema.properties.jobId.type).toBe('string')
    expect(gitlabGetJobSchema.properties.jobUrl.type).toBe('string')
    expect(gitlabGetJobSchema.additionalProperties).toBe(false)
  })
})
