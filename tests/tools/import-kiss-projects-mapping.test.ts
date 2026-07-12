// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  kissProjectLabel,
  mapKissProjectToNervProject,
  toKissProjectDoc,
} from '../../tools/import-kiss-projects-mapping.js'
import type { KissProjectDoc } from '../../tools/import-kiss-projects-mapping.js'

const OPTS = { gitlabBaseUrl: 'https://gitlab.corp.example' }

describe('mapKissProjectToNervProject', () => {
  test('maps repositories, deriving repoUrl from the gitlab base URL', () => {
    const kiss: KissProjectDoc = {
      _id: 'p1',
      title: 'Demo',
      repositories: [
        { projectPath: 'team/demo', description: 'Demo repo', defaultBranch: 'main', worktreeSubdir: 'app' },
      ],
    }
    const { doc, warnings } = mapKissProjectToNervProject(kiss, OPTS)
    expect(doc.repositories).toEqual([
      {
        projectPath: 'team/demo',
        repoUrl: 'https://gitlab.corp.example/team/demo.git',
        description: 'Demo repo',
        baseBranch: 'main',
        worktreeSubdir: 'app',
      },
    ])
    expect(warnings).toEqual([])
  })

  test('maps maxTaskCost to costBudgetUsd, defaults null when absent', () => {
    const withCost = mapKissProjectToNervProject({ _id: 'p1', maxTaskCost: 12.5 }, OPTS)
    expect(withCost.doc.costBudgetUsd).toBe(12.5)
    const withoutCost = mapKissProjectToNervProject({ _id: 'p2' }, OPTS)
    expect(withoutCost.doc.costBudgetUsd).toBeNull()
  })

  test('maps autoReview/selfReviewEnabled with nerv-matching defaults', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, OPTS)
    expect(doc.autoReview).toBe(false)
    expect(doc.selfReviewEnabled).toBe(true)
  })

  test('carries mcpServers through untouched when present', () => {
    const mcpServers = [{ id: 'jira', url: 'https://mcp.example.com' }]
    const { doc } = mapKissProjectToNervProject({ _id: 'p1', mcpServers }, OPTS)
    expect(doc.mcpServers).toEqual(mcpServers)
  })

  test('omits mcpServers when absent', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, OPTS)
    expect(doc.mcpServers).toBeUndefined()
  })

  test('derives forge from the gitlab base URL, trimming a trailing slash', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, { gitlabBaseUrl: 'https://gitlab.corp.example/' })
    expect(doc.forge).toEqual({ kind: 'gitlab', apiBaseUrl: 'https://gitlab.corp.example/api/v4' })
  })

  test('warns and drops proxy/ignoreFiles/ephemeralSessionsEnabled/ephemeralModelProvider when set', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        title: 'Demo',
        proxy: 'http://proxy.internal',
        ignoreFiles: '.kissignore',
        ephemeralSessionsEnabled: true,
        ephemeralModelProvider: { id: 'eph' },
      },
      OPTS,
    )
    expect(warnings).toEqual([
      'project "Demo": dropping kiss field "proxy" (no nerv target)',
      'project "Demo": dropping kiss field "ignoreFiles" (no nerv target)',
      'project "Demo": dropping kiss field "ephemeralSessionsEnabled" (no nerv target)',
      'project "Demo": dropping kiss field "ephemeralModelProvider" (no nerv target)',
    ])
  })

  test('does not warn when dropped-field values are absent or false', () => {
    const { warnings } = mapKissProjectToNervProject(
      { _id: 'p1', title: 'Demo', ephemeralSessionsEnabled: false },
      OPTS,
    )
    expect(warnings).toEqual([])
  })

  test('warns per-repo when pipelineJobTrackList is set (nerv has no matching repo field yet)', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        title: 'Demo',
        repositories: [{ projectPath: 'team/demo', description: 'd', pipelineJobTrackList: ['build', 'test'] }],
      },
      OPTS,
    )
    expect(warnings).toEqual([
      'project "Demo" repo "team/demo": dropping kiss field "pipelineJobTrackList" ' +
        '(nerv Project.repositories has no matching field yet)',
    ])
  })

  test('does not warn about pipelineJobTrackList when null or empty', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        repositories: [
          { projectPath: 'a', description: 'd', pipelineJobTrackList: null },
          { projectPath: 'b', description: 'd', pipelineJobTrackList: [] },
        ],
      },
      OPTS,
    )
    expect(warnings).toEqual([])
  })

  test('uses the Mongo _id as the label when title is absent', () => {
    const { warnings } = mapKissProjectToNervProject({ _id: 'raw-id-123', proxy: 'x' }, OPTS)
    expect(warnings).toEqual(['project "raw-id-123": dropping kiss field "proxy" (no nerv target)'])
  })

  test('contextIds always starts empty (binding happens later via /nerv bind)', () => {
    const { doc } = mapKissProjectToNervProject({ _id: 'p1' }, OPTS)
    expect(doc.contextIds).toEqual([])
  })
})

describe('kissProjectLabel', () => {
  test('prefers title, falls back to _id', () => {
    expect(kissProjectLabel({ _id: 'x', title: 'Demo' })).toBe('Demo')
    expect(kissProjectLabel({ _id: 'x', title: '' })).toBe('x')
    expect(kissProjectLabel({ _id: 'x' })).toBe('x')
  })
})

describe('toKissProjectDoc', () => {
  test('parses a well-formed raw BSON document', () => {
    const raw = {
      _id: 'oid-1',
      title: 'Demo',
      repositories: [{ projectPath: 'a/b', description: 'd', defaultBranch: 'main' }],
      maxTaskCost: 5,
      autoReview: true,
    }
    const doc = toKissProjectDoc(raw)
    expect(doc).toEqual({
      _id: 'oid-1',
      title: 'Demo',
      repositories: [{ projectPath: 'a/b', description: 'd', defaultBranch: 'main' }],
      maxTaskCost: 5,
      autoReview: true,
    })
  })

  test('drops a malformed repo entry missing projectPath/description', () => {
    const raw = {
      _id: 'oid-1',
      repositories: [{ projectPath: 'a/b', description: 'd' }, { projectPath: 'no-description' }, 'not-an-object'],
    }
    const doc = toKissProjectDoc(raw)
    expect(doc.repositories).toEqual([{ projectPath: 'a/b', description: 'd' }])
  })

  test('leaves optional fields undefined when absent from the raw document', () => {
    const doc = toKissProjectDoc({ _id: 'oid-1' })
    expect(doc).toEqual({ _id: 'oid-1' })
  })
})
