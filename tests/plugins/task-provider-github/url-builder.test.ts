// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildGitHubProjectUrl,
  buildGitHubTaskUrl,
  resolveWebBaseUrl,
} from '../../../plugins/task-provider-github/url-builder.js'

describe('resolveWebBaseUrl', () => {
  test('empty baseUrl resolves to https://github.com', () => {
    expect(resolveWebBaseUrl('')).toBe('https://github.com')
  })

  test('the public api.github.com host resolves to https://github.com', () => {
    expect(resolveWebBaseUrl('https://api.github.com')).toBe('https://github.com')
    expect(resolveWebBaseUrl('https://api.github.com/')).toBe('https://github.com')
  })

  test('a GHES subpath baseUrl resolves to its origin (api/v3 stripped)', () => {
    expect(resolveWebBaseUrl('https://ghes.example.com/api/v3')).toBe('https://ghes.example.com')
    expect(resolveWebBaseUrl('https://ghes.example.com/api/v3/')).toBe('https://ghes.example.com')
  })

  test('a GHES root baseUrl resolves to its origin', () => {
    expect(resolveWebBaseUrl('https://ghes.example.com')).toBe('https://ghes.example.com')
  })
})

describe('buildGitHubTaskUrl', () => {
  test('task URL is {web}/owner/repo/issues/{n} for the default host', () => {
    expect(buildGitHubTaskUrl('', 'octocat/Hello-World', '1347')).toBe(
      'https://github.com/octocat/Hello-World/issues/1347',
    )
  })

  test('task URL uses the GHES web root for enterprise installs', () => {
    expect(buildGitHubTaskUrl('https://ghes.example.com/api/v3', 'octocat/Hello-World', '1347')).toBe(
      'https://ghes.example.com/octocat/Hello-World/issues/1347',
    )
  })
})

describe('buildGitHubProjectUrl', () => {
  test('project URL is {web}/owner/repo for the default host', () => {
    expect(buildGitHubProjectUrl('', 'octocat/Hello-World')).toBe('https://github.com/octocat/Hello-World')
  })

  test('project URL uses the GHES web root for enterprise installs', () => {
    expect(buildGitHubProjectUrl('https://ghes.example.com/api/v3', 'octocat/Hello-World')).toBe(
      'https://ghes.example.com/octocat/Hello-World',
    )
  })
})
