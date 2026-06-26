// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import packageJson from '../../package.json' with { type: 'json' }
import { announceNewVersion, type AnnouncementsDeps } from '../../src/announcements.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { createMockChat } from '../utils/test-helpers.js'

const VERSION = packageJson.version

function makeChat(sent: string[]): ReturnType<typeof createMockChat> {
  return createMockChat({
    sendMessage: (_pid: string, _target: DeferredDeliveryTarget, md: string): Promise<void> => {
      sent.push(md)
      return Promise.resolve()
    },
  })
}

function makeDeps(over: Partial<AnnouncementsDeps>): AnnouncementsDeps {
  return {
    readChangelogFile: () => Promise.resolve(`## [${VERSION}]\n\n### Added\n- thing\n\n## [0.0.1]\n- old`),
    humanizeChangelog: () => Promise.resolve('✨ New\n- A friendly thing'),
    persistDraft: () => {},
    isVersionAnnounced: () => false,
    ...over,
  }
}

describe('announceNewVersion', () => {
  test('humanizes, persists, and DMs the admin a review notice (no fan-out)', async () => {
    const sent: string[] = []
    let persisted: unknown = null
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        persistDraft: (d) => {
          persisted = { humanizedBody: d.humanizedBody }
        },
      }),
    )
    expect(persisted).toEqual({ humanizedBody: '✨ New\n- A friendly thing' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('✨ New')
    expect(sent[0]).toContain('Release notes')
  })

  test('falls back to raw body in the admin notice when humanization returns null', async () => {
    const sent: string[] = []
    let persisted: unknown = null
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        humanizeChangelog: () => Promise.resolve(null),
        persistDraft: (d) => {
          persisted = { humanizedBody: d.humanizedBody }
        },
      }),
    )
    expect(persisted).toEqual({ humanizedBody: null })
    expect(sent[0]).toContain('- thing')
  })

  test('skips entirely when the version is already announced', async () => {
    const sent: string[] = []
    let persistCalls = 0
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        isVersionAnnounced: () => true,
        persistDraft: () => {
          persistCalls += 1
        },
      }),
    )
    expect(persistCalls).toBe(0)
    expect(sent).toHaveLength(0)
  })
})
