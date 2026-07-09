// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test, beforeEach, spyOn } from 'bun:test'

import { eq } from 'drizzle-orm'

import packageJson from '../package.json' with { type: 'json' }
import type { AnnouncementsDeps } from '../src/announcements.js'
import { announceNewVersion } from '../src/announcements.js'
import { upsertAnnouncementDraft, updateHumanizedBody } from '../src/announcements/store.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider } from '../src/chat/types.js'
import * as schema from '../src/db/schema.js'
import { versionAnnouncements } from '../src/db/schema.js'
import * as proactiveHistoryModule from '../src/proactive-history.js'
import { extractChangelogSection } from './helpers/extract-changelog-section.js'
import { createMockChat, getTestDb, mockLogger, seedTestPlatformInstance, setupTestDb } from './utils/test-helpers.js'

const ADMIN_USER_ID = 'admin123'
const PLATFORM_INSTANCE_ID = 'telegram-default'

type RouterLikeChatProvider = ChatProvider & { getInstance: (id: string) => unknown }

const VERSION: string = packageJson.version

// Canonical CHANGELOG fixture aligned with the actual package version
const CHANGELOG = `# Changelog

## [${VERSION}] - 2026-01-01

### Added
- Feature A

### Fixed
- Bug B

## [0.0.1] - 2025-01-01

### Added
- Feature X
`

// ---------------------------------------------------------------------------
// Unit tests for extractChangelogSection
// ---------------------------------------------------------------------------

describe('extractChangelogSection', () => {
  test('returns section content for a matching version', () => {
    const result = extractChangelogSection(VERSION, CHANGELOG)
    expect(result).toContain('Feature A')
    expect(result).toContain('Bug B')
  })

  test('does not include the next version header in the section', () => {
    const result = extractChangelogSection(VERSION, CHANGELOG)
    expect(result).not.toContain('## [0.0.1]')
  })

  test('returns null when version is not found', () => {
    const result = extractChangelogSection('9.9.9', CHANGELOG)
    expect(result).toBeNull()
  })

  test('returns section for last version in file (no following header boundary)', () => {
    const result = extractChangelogSection('0.0.1', CHANGELOG)
    expect(result).not.toBeNull()
    expect(result).toContain('Feature X')
  })

  test('returns null for empty changelog', () => {
    const result = extractChangelogSection(VERSION, '')
    expect(result).toBeNull()
  })

  test('returns empty string when section has no body lines between two headers', () => {
    const tightChangelog = `## [${VERSION}] - 2026-01-01\n## [0.0.1] - 2025-01-01\n`
    const result = extractChangelogSection(VERSION, tightChangelog)
    expect(result).toBe('')
  })

  test('trims leading and trailing blank lines from section', () => {
    const changelogWithPadding = `## [${VERSION}] - 2026-01-01\n\n\n### Added\n- X\n\n\n`
    const result = extractChangelogSection(VERSION, changelogWithPadding)
    expect(result).not.toBeNull()
    expect(result!.startsWith('\n')).toBe(false)
    expect(result!.endsWith('\n')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration-style tests for announceNewVersion
// ---------------------------------------------------------------------------

describe('announceNewVersion', () => {
  // --- Mock ChatProvider for testing ---
  let sentMessages: Array<{ platformInstanceId: string; userId: string; text: string }>
  let sendMessageImpl: (platformInstanceId: string, userId: string, text: string) => Promise<void>

  let mockChat: ChatProvider

  // --- Changelog deps (controlled per-test via changelogProvider) ---
  let changelogProvider: (() => Promise<string>) | null
  let announcementDeps: AnnouncementsDeps

  beforeEach(async () => {
    // Reset mutable state to defaults
    sentMessages = []
    sendMessageImpl = (platformInstanceId: string, userId: string, text: string): Promise<void> => {
      sentMessages.push({ platformInstanceId, userId, text })
      return Promise.resolve()
    }
    changelogProvider = null

    // Register mocks
    mockLogger()

    await setupTestDb()

    announcementDeps = {
      readChangelogFile: (): Promise<string> => {
        if (changelogProvider === null) {
          return Promise.reject(new Error('CHANGELOG.md not found'))
        }
        return changelogProvider()
      },
      humanizeChangelog: (): Promise<string | null> => Promise.resolve(null),
      persistDraft: upsertAnnouncementDraft,
      updateHumanizedBody: updateHumanizedBody,
      isVersionAnnounced: (version): boolean => {
        const row = getTestDb()
          .select()
          .from(versionAnnouncements)
          .where(eq(versionAnnouncements.version, version))
          .get()
        return row !== undefined
      },
    }

    // Seed platform instance before inserting the user (foreign key)
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })

    // Add admin user to the database
    getTestDb()
      .insert(schema.users)
      .values({ platformUserId: ADMIN_USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: ADMIN_USER_ID })
      .run()

    mockChat = createMockChat({
      sendMessage: (platformInstanceId, target, text): Promise<void> =>
        sendMessageImpl(platformInstanceId, target.contextId, text),
    })
  })

  test('sends announcement only to admin user', async () => {
    // Insert test users with kaneo_apikey config
    getTestDb().insert(schema.userConfig).values({ userId: '101', key: 'kaneo_apikey', value: 'key1' }).run()
    getTestDb().insert(schema.userConfig).values({ userId: '102', key: 'kaneo_apikey', value: 'key2' }).run()

    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    // Only admin should receive announcement, not regular users
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.platformInstanceId).toBe(PLATFORM_INSTANCE_ID)
    expect(sentMessages[0]!.userId).toBe(ADMIN_USER_ID)
    expect(sentMessages[0]!.text).toContain(VERSION)
  })

  test('does not send announcement twice for the same version', async () => {
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    // Only one message should be sent (to admin) on first call; second call is skipped
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.userId).toBe(ADMIN_USER_ID)
  })

  test('marks version as announced and sends to admin', async () => {
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    // Admin should receive announcement
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.userId).toBe(ADMIN_USER_ID)

    // Verify idempotency - second call should not send messages
    sentMessages.length = 0
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    expect(sentMessages).toHaveLength(0)
  })

  test('returns early without sending when CHANGELOG.md cannot be read', async () => {
    changelogProvider = null

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(sentMessages).toHaveLength(0)
  })

  test('returns early without sending when version is missing from changelog', async () => {
    changelogProvider = (): Promise<string> =>
      Promise.resolve('# Changelog\n\n## [0.0.1] - 2024-01-01\n\n- old stuff\n')

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(sentMessages).toHaveLength(0)
  })

  test('handles send failure to admin gracefully', async () => {
    sendMessageImpl = (_platformInstanceId: string, _userId: string, _text: string): Promise<void> => {
      return Promise.reject(new Error('API error'))
    }

    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    // No messages sent due to failure; draft is still persisted for retry via settings UI
    expect(sentMessages).toHaveLength(0)
  })

  test('does not retry after send failure once draft is persisted', async () => {
    let callCount = 0
    sendMessageImpl = (_platformInstanceId: string, _userId: string, _text: string): Promise<void> => {
      callCount++
      return Promise.reject(new Error('API error'))
    }
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    // First call: send fails, but draft is persisted
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    // Second call: version already in DB (draft persisted), so skipped entirely
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(callCount).toBe(1)
    expect(sentMessages).toHaveLength(0)
  })

  test('skips when router instance is unknown', async () => {
    const routerChat = { ...mockChat, getInstance: (_id: string): unknown => undefined } as RouterLikeChatProvider
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    // First call: draft persisted, but getInstance returns undefined so send is skipped
    await announceNewVersion(routerChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    expect(sentMessages).toHaveLength(0)

    // Second call: version already in DB, skipped
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    expect(sentMessages).toHaveLength(0)
  })

  test('skips second attempt when routed send is refused', async () => {
    let attempts = 0
    const routerChat = {
      ...mockChat,
      getInstance: (_id: string): unknown => ({ id: PLATFORM_INSTANCE_ID }),
      sendMessage: (_platformInstanceId: string, _target: unknown, _text: string): Promise<false> => {
        attempts++
        return Promise.resolve(false)
      },
    } as RouterLikeChatProvider
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    // First call: draft persisted, send refused (returns false)
    await announceNewVersion(routerChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    // Second call: version already in DB, skipped — no second send attempt
    await announceNewVersion(routerChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(attempts).toBe(1)
    expect(sentMessages).toHaveLength(0)
  })

  describe('proactive history recording', () => {
    const spies: Array<{ mockRestore: () => void }> = []

    const track = <T extends { mockRestore: () => void }>(spy: T): T => {
      spies.push(spy)
      return spy
    }

    afterEach(() => {
      for (const spy of spies) spy.mockRestore()
      spies.length = 0
    })

    test('records the admin review notice in history once delivery is confirmed', async () => {
      changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)
      const recordCalls: Array<[string, string]> = []
      track(
        spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
          recordCalls.push([storageContextId, markdown])
        }),
      )

      await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

      expect(sentMessages).toHaveLength(1)
      expect(recordCalls).toHaveLength(1)
      expect(recordCalls[0]?.[0]).toBe(
        toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: ADMIN_USER_ID }),
      )
      expect(recordCalls[0]?.[1]).toBe(sentMessages[0]?.text)
    })
  })
})
