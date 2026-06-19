// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test, beforeEach } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import packageJson from '../package.json' with { type: 'json' }
import type { AnnouncementsDeps } from '../src/announcements.js'
import { announceNewVersion } from '../src/announcements.js'
import type { ChatProvider } from '../src/chat/types.js'
import { runMigrations } from '../src/db/migrate.js'
import { migration001Initial } from '../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../src/db/migrations/007_platform_user_id.js'
import { migration040PlatformInstances } from '../src/db/migrations/040_platform_instances.js'
import { migration041UsersPlatformInstanceIndex } from '../src/db/migrations/041_users_platform_instance_index.js'
import { migration058OpenDmAccess } from '../src/db/migrations/058_open_dm_access.js'
import * as schema from '../src/db/schema.js'
import { extractChangelogSection } from './helpers/extract-changelog-section.js'
import { createMockChat, mockLogger, setTestDrizzleDb } from './utils/test-helpers.js'

const ADMIN_USER_ID = 'admin123'
const PLATFORM_INSTANCE_ID = 'telegram-default'

type RouterLikeChatProvider = ChatProvider & { getInstance: (id: string) => unknown }

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration040PlatformInstances,
  migration041UsersPlatformInstanceIndex,
  migration058OpenDmAccess,
] as const

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
  // --- Test database setup with Drizzle ---
  let testDb: ReturnType<typeof drizzle<typeof schema>>
  let testSqlite: Database

  // --- Mock ChatProvider for testing ---
  let sentMessages: Array<{ platformInstanceId: string; userId: string; text: string }>
  let sendMessageImpl: (platformInstanceId: string, userId: string, text: string) => Promise<void>

  let mockChat: ChatProvider

  // --- Changelog deps (controlled per-test via changelogProvider) ---
  let changelogProvider: (() => Promise<string>) | null
  let announcementDeps: AnnouncementsDeps

  beforeEach(() => {
    // Reset mutable state to defaults
    sentMessages = []
    sendMessageImpl = (platformInstanceId: string, userId: string, text: string): Promise<void> => {
      sentMessages.push({ platformInstanceId, userId, text })
      return Promise.resolve()
    }
    changelogProvider = null

    // Register mocks
    mockLogger()

    announcementDeps = {
      readChangelogFile: (): Promise<string> => {
        if (changelogProvider === null) {
          return Promise.reject(new Error('CHANGELOG.md not found'))
        }
        return changelogProvider()
      },
    }

    // Setup test database
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    setTestDrizzleDb(testDb)
    runMigrations(testSqlite, MIGRATIONS)

    // Add admin user to the database
    testDb
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
    testDb.insert(schema.userConfig).values({ userId: '101', key: 'kaneo_apikey', value: 'key1' }).run()
    testDb.insert(schema.userConfig).values({ userId: '102', key: 'kaneo_apikey', value: 'key2' }).run()

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

    // Only one message should be sent (to admin) on first call
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

    // No messages sent due to failure
    expect(sentMessages).toHaveLength(0)
  })

  test('retries announcement after send failure', async () => {
    const sendResponses: Array<(platformInstanceId: string, userId: string, text: string) => Promise<void>> = [
      () => Promise.reject(new Error('API error')),
      (platformInstanceId, userId, text) => {
        sentMessages.push({ platformInstanceId, userId, text })
        return Promise.resolve()
      },
    ]
    sendMessageImpl = (platformInstanceId, userId, text): Promise<void> =>
      sendResponses.shift()!(platformInstanceId, userId, text)
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.userId).toBe(ADMIN_USER_ID)
  })

  test('retries announcement when router instance is unknown', async () => {
    const routerChat = { ...mockChat, getInstance: (_id: string): unknown => undefined } as RouterLikeChatProvider
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(routerChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    expect(sentMessages).toHaveLength(0)

    mockChat = createMockChat({
      sendMessage: (platformInstanceId, target, text): Promise<void> =>
        sendMessageImpl(platformInstanceId, target.contextId, text),
    })
    await announceNewVersion(mockChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]!.userId).toBe(ADMIN_USER_ID)
  })

  test('retries announcement when routed send is refused', async () => {
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

    await announceNewVersion(routerChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)
    await announceNewVersion(routerChat, PLATFORM_INSTANCE_ID, ADMIN_USER_ID, announcementDeps)

    expect(attempts).toBe(2)
    expect(sentMessages).toHaveLength(0)
  })
})
