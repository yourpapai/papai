// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import packageJson from '../../package.json' with { type: 'json' }
import { announceNewVersion, type AnnouncementsDeps } from '../../src/announcements.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { setConfigValue } from '../../src/config.js'
import type { Locale } from '../../src/i18n/index.js'
import { createMockChat, mockLogger, setupTestDb } from '../utils/test-helpers.js'

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
    humanizeChangelog: () => Promise.resolve({ en: '✨ New\n- A friendly thing' }),
    persistDraft: () => {},
    updateHumanizedBodies: () => {},
    isVersionAnnounced: () => false,
    ...over,
  }
}

describe('announceNewVersion', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('humanizes, persists, and DMs the admin a review notice (no fan-out)', async () => {
    const sent: string[] = []
    const persistCalls: Array<{ version: string; rawBody: string; humanizedBody: string | null }> = []
    const updateHumanizedCalls: Array<{ version: string; bodies: Partial<Record<Locale, string>> }> = []
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        persistDraft: (d) => {
          persistCalls.push({ version: d.version, rawBody: d.rawBody, humanizedBody: d.humanizedBody })
        },
        updateHumanizedBodies: (version, bodies) => {
          updateHumanizedCalls.push({ version, bodies })
        },
      }),
    )
    expect(persistCalls).toHaveLength(1)
    expect(persistCalls[0]?.version).toBe(VERSION)
    expect(persistCalls[0]?.rawBody).toContain('- thing')
    expect(persistCalls[0]?.humanizedBody).toBeNull()
    expect(updateHumanizedCalls).toHaveLength(1)
    expect(updateHumanizedCalls[0]?.version).toBe(VERSION)
    expect(updateHumanizedCalls[0]?.bodies).toEqual({ en: '✨ New\n- A friendly thing' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('✨ New')
    expect(sent[0]).toContain('Release notes')
  })

  test('falls back to raw body in the admin notice when humanization returns an empty map', async () => {
    const sent: string[] = []
    let persistedHumanized: string | null | undefined
    let updateHumanizedCalled = false
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        humanizeChangelog: () => Promise.resolve({}),
        persistDraft: (d) => {
          persistedHumanized = d.humanizedBody
        },
        updateHumanizedBodies: () => {
          updateHumanizedCalled = true
        },
      }),
    )
    expect(persistedHumanized).toBeNull()
    expect(updateHumanizedCalled).toBe(false)
    expect(sent[0]).toContain('- thing')
  })

  test('skips entirely when the version is already announced', async () => {
    const sent: string[] = []
    let persistCalls = 0
    let updateHumanizedCalls = 0
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        isVersionAnnounced: () => true,
        persistDraft: () => {
          persistCalls += 1
        },
        updateHumanizedBodies: () => {
          updateHumanizedCalls += 1
        },
      }),
    )
    expect(persistCalls).toBe(0)
    expect(updateHumanizedCalls).toBe(0)
    expect(sent).toHaveLength(0)
  })
})

describe('announceNewVersion per locale', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('renders the ru review notice for a ru-configured admin', async () => {
    const adminCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'admin-ru' })
    setConfigValue(adminCtx, 'language', 'ru')
    const sent: string[] = []
    await announceNewVersion(makeChat(sent), 'pi-1', 'admin-ru', makeDeps({}))
    expect(sent[0]).toContain(`🆕 papai v${VERSION} готова к объявлению!`)
    expect(sent[0]).toContain('✨ New')
    expect(sent[0]).toContain('_Проверьте и разошлите подписчикам в Настройки → Release notes._')
  })

  test('renders the en review notice otherwise', async () => {
    const sent: string[] = []
    await announceNewVersion(makeChat(sent), 'pi-1', 'admin-en', makeDeps({}))
    expect(sent[0]).toContain(`🆕 papai v${VERSION} is ready to announce!`)
    expect(sent[0]).toContain('_Review and broadcast to subscribers in Settings → Release notes._')
  })
})

describe('announceNewVersion per-locale bodies', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('startup humanizes both locales and persists the whole map once', async () => {
    const sent: string[] = []
    const persisted: Array<Partial<Record<Locale, string>>> = []
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        humanizeChangelog: () => Promise.resolve({ en: 'EN body', ru: 'RU body' }),
        updateHumanizedBodies: (_version, bodies) => {
          persisted.push(bodies)
        },
      }),
    )
    expect(persisted).toEqual([{ en: 'EN body', ru: 'RU body' }])
  })

  test('ru admin receives the ru body inside the ru wrapper', async () => {
    const adminCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'admin-ru' })
    setConfigValue(adminCtx, 'language', 'ru')
    const sent: string[] = []
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-ru',
      makeDeps({
        humanizeChangelog: () => Promise.resolve({ en: 'EN body', ru: 'RU body' }),
      }),
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(`🆕 papai v${VERSION} готова к объявлению!`)
    expect(sent[0]).toContain('RU body')
    expect(sent[0]).not.toContain('EN body')
    expect(sent[0]).toContain('_Проверьте и разошлите подписчикам в Настройки → Release notes._')
  })

  test('ru admin with a missing ru body falls back to the en body', async () => {
    const adminCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'admin-ru' })
    setConfigValue(adminCtx, 'language', 'ru')
    const sent: string[] = []
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-ru',
      makeDeps({
        humanizeChangelog: () => Promise.resolve({ en: 'EN body' }),
      }),
    )
    expect(sent[0]).toContain(`🆕 papai v${VERSION} готова к объявлению!`)
    expect(sent[0]).toContain('EN body')
  })

  test('empty map sends the raw changelog section as the admin body', async () => {
    const sent: string[] = []
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-en',
      makeDeps({
        humanizeChangelog: () => Promise.resolve({}),
      }),
    )
    expect(sent[0]).toContain(`🆕 papai v${VERSION} is ready to announce!`)
    expect(sent[0]).toContain('- thing')
  })
})
