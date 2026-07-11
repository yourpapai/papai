// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  mattermostCreatePostSchema,
  mattermostDownloadAttachmentSchema,
  mattermostGetChannelPostsSchema,
  mattermostGetPostSchema,
  mattermostGetThreadSchema,
} from '../../plugins/mcp-mattermost/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So these tests assert the declared contract of each
// schema — required fields, closed shape — rather than simulating validation
// behavior that never runs in production.
describe('mcp-mattermost schemas', () => {
  test('get_post requires linkOrId and rejects unknown properties', () => {
    expect(mattermostGetPostSchema.required).toContain('linkOrId')
    expect(mattermostGetPostSchema.additionalProperties).toBe(false)
  })

  test('get_thread requires linkOrId', () => {
    expect(mattermostGetThreadSchema.required).toContain('linkOrId')
  })

  test('get_channel_posts requires channelId and constrains perPage/since', () => {
    expect(mattermostGetChannelPostsSchema.required).toContain('channelId')
    expect(mattermostGetChannelPostsSchema.properties.perPage.type).toBe('integer')
    expect(mattermostGetChannelPostsSchema.properties.perPage.maximum).toBe(200)
    expect(mattermostGetChannelPostsSchema.properties.since).toBeDefined()
  })

  test('create_post requires channelId and message', () => {
    expect(mattermostCreatePostSchema.required).toContain('channelId')
    expect(mattermostCreatePostSchema.required).toContain('message')
  })

  test('download_attachment requires fileId', () => {
    expect(mattermostDownloadAttachmentSchema.required).toContain('fileId')
  })
})
