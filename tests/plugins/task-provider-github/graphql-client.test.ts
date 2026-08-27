// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { createTrackedLoggerMock } from '../../utils/logger-mock.js'
import { restoreFetch } from '../../utils/test-helpers.js'

const tracked = createTrackedLoggerMock()
// Top-level mock + delayed import: the module under test must load after the logger mock installs.
void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

const { resolveGraphqlEndpoint } = await import('../../../plugins/task-provider-github/graphql-client.js')

afterEach(() => {
  restoreFetch()
  tracked.clearCalls()
})

type EndpointCase = Readonly<{
  label: string
  baseUrl: string
  expected: string
}>

const endpointCases: EndpointCase[] = [
  {
    label: 'an empty baseUrl resolves to the public GraphQL endpoint',
    baseUrl: '',
    expected: 'https://api.github.com/graphql',
  },
  {
    label: 'an explicit public REST base resolves to the public GraphQL endpoint',
    baseUrl: 'https://api.github.com',
    expected: 'https://api.github.com/graphql',
  },
  {
    label: 'a GHES /api/v3 base swaps the suffix for /api/graphql on the same origin',
    baseUrl: 'https://ghes.example.com/api/v3',
    expected: 'https://ghes.example.com/api/graphql',
  },
  {
    label: 'a GHES /api/v3 base behind a sub-path prefix keeps the prefix and swaps the suffix',
    baseUrl: 'https://corp.example.com/gh/api/v3',
    expected: 'https://corp.example.com/gh/api/graphql',
  },
  {
    label: 'a GHES bare origin appends /api/graphql',
    baseUrl: 'https://ghes.example.com',
    expected: 'https://ghes.example.com/api/graphql',
  },
  {
    label: 'trailing slashes on a GHES /api/v3 base are stripped before the suffix swap',
    baseUrl: 'https://ghes.example.com/api/v3///',
    expected: 'https://ghes.example.com/api/graphql',
  },
  {
    label: 'trailing slashes on the public base still resolve to the public GraphQL endpoint',
    baseUrl: 'https://api.github.com///',
    expected: 'https://api.github.com/graphql',
  },
]

describe('resolveGraphqlEndpoint', () => {
  test.each(endpointCases)('$label', ({ baseUrl, expected }: EndpointCase) => {
    expect(resolveGraphqlEndpoint(baseUrl)).toBe(expected)
  })
})
