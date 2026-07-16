// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flattenTeamCity, sanitizeTeamCityConfig } from '../../plugins/mcp-teamcity/format.js'

describe('flattenTeamCity', () => {
  test('unwraps parameters {property:[…]} into a flat array', () => {
    const raw = { id: 'P', parameters: { count: 2, property: [{ name: 'a', value: '1' }] } }
    expect(flattenTeamCity(raw)).toEqual({ id: 'P', parameters: [{ name: 'a', value: '1' }] })
  })

  test('unwraps projects/buildTypes/templates envelopes', () => {
    const raw = {
      id: 'P',
      projects: { project: [{ id: 'c1' }] },
      buildTypes: { buildType: [{ id: 'b1' }] },
    }
    expect(flattenTeamCity(raw)).toEqual({ id: 'P', projects: [{ id: 'c1' }], buildTypes: [{ id: 'b1' }] })
  })

  test('renames + flattens vcs-root-entries with nested vcs-root properties', () => {
    const raw = {
      'vcs-root-entries': {
        'vcs-root-entry': [
          {
            id: 'e1',
            'checkout-rules': '+:.',
            'vcs-root': { id: 'r1', properties: { property: [{ name: 'url', value: 'git@x' }] } },
          },
        ],
      },
    }
    expect(flattenTeamCity(raw)).toEqual({
      vcsRootEntries: [
        { id: 'e1', checkoutRules: '+:.', vcsRoot: { id: 'r1', properties: [{ name: 'url', value: 'git@x' }] } },
      ],
    })
  })

  test('renames artifact/snapshot dependencies + inner source-buildType', () => {
    const raw = {
      'artifact-dependencies': { 'artifact-dependency': [{ id: 'a1', properties: { property: [] } }] },
      'snapshot-dependencies': {
        'snapshot-dependency': [{ id: 's1', 'source-buildType': { id: 'b0' }, properties: { property: [] } }],
      },
    }
    expect(flattenTeamCity(raw)).toEqual({
      artifactDependencies: [{ id: 'a1', properties: [] }],
      snapshotDependencies: [{ id: 's1', sourceBuildType: { id: 'b0' }, properties: [] }],
    })
  })

  test('empty/missing envelope becomes an empty array', () => {
    expect(flattenTeamCity({ parameters: { count: 0 } })).toEqual({ parameters: [] })
    expect(flattenTeamCity({ steps: {} })).toEqual({ steps: [] })
  })

  test('passes through scalars, non-envelope objects, and arrays', () => {
    expect(flattenTeamCity({ id: 'P', name: 'n', archived: false })).toEqual({ id: 'P', name: 'n', archived: false })
    expect(flattenTeamCity('x')).toBe('x')
    expect(flattenTeamCity([{ id: 'a' }])).toEqual([{ id: 'a' }])
  })

  test('SECURITY: redaction survives flattening (sanitize then flatten)', () => {
    const raw = {
      id: 'P',
      parameters: {
        property: [
          { name: 'env.DEPLOY_TOKEN', value: 'sekret' },
          { name: 'harmless', value: 'ok' },
        ],
      },
    }
    const out = flattenTeamCity(sanitizeTeamCityConfig(raw))
    expect(out).toEqual({
      id: 'P',
      parameters: [
        { name: 'env.DEPLOY_TOKEN', value: '[REDACTED]' },
        { name: 'harmless', value: 'ok' },
      ],
    })
  })
})
