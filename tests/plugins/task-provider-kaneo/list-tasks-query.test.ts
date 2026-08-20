// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ListTasksParams } from 'papai/plugin-types'

import { buildListTasksQuery } from '../../../plugins/task-provider-kaneo/list-tasks-query.js'

describe('buildListTasksQuery', () => {
  test('stringifies every defined param and keeps them in the result', () => {
    const params: ListTasksParams = { status: 'open', page: 3 }

    const result = buildListTasksQuery(params)

    expect(JSON.stringify(result)).toBe('{"status":"open","page":"3"}')
  })

  test('omits params whose value is explicitly undefined', () => {
    const params: ListTasksParams = { status: 'open', assigneeId: undefined }

    const result = buildListTasksQuery(params)

    expect(JSON.stringify(result)).toBe('{"status":"open"}')
  })

  test('omits params whose value is null', () => {
    const params: ListTasksParams = Object.assign({ status: 'open', priority: 'high' }, { priority: null })

    const result = buildListTasksQuery(params)

    expect(JSON.stringify(result)).toBe('{"status":"open"}')
  })
})
