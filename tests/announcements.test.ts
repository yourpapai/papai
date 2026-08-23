// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test, beforeEach, spyOn } from 'bun:test'

import type { LanguageModel } from 'ai'
import { eq } from 'drizzle-orm'

import packageJson from '../package.json' with { type: 'json' }
import type { AnnouncementsDeps } from '../src/announcements.js'
import { announceNewVersion } from '../src/announcements.js'
import { humanizeChangelog } from '../src/announcements/humanize.js'
import {
  getAnnouncementDraft,
  updateHumanizedBodies,
  upsertAnnouncementDraft,
  updateHumanizedBody,
} from '../src/announcements/store.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider } from '../src/chat/types.js'
import * as schema from '../src/db/schema.js'
import { versionAnnouncements } from '../src/db/schema.js'
import { t, type Locale } from '../src/i18n/index.js'
import { logger as rootLogger, logMultistream } from '../src/logger.js'
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
// Store: per-locale humanized bodies
// ---------------------------------------------------------------------------

describe('announcement store: per-locale humanized bodies', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('updateHumanizedBodies merges per locale: one locale write leaves the other untouched', () => {
    updateHumanizedBodies('v9.9.9', { en: 'EN body' })
    updateHumanizedBodies('v9.9.9', { ru: 'RU body' })
    expect(getAnnouncementDraft('v9.9.9')?.humanizedBodies).toEqual({ en: 'EN body', ru: 'RU body' })

    updateHumanizedBodies('v9.9.9', { en: 'EN body v2' })
    expect(getAnnouncementDraft('v9.9.9')?.humanizedBodies).toEqual({ en: 'EN body v2', ru: 'RU body' })
  })

  test('every en write mirrors into legacy humanized_body; ru-only writes do not', () => {
    updateHumanizedBodies('v9.9.8', { ru: 'RU only' })
    expect(getAnnouncementDraft('v9.9.8')?.humanizedBody).toBeNull()

    updateHumanizedBodies('v9.9.8', { en: 'EN body' })
    expect(getAnnouncementDraft('v9.9.8')?.humanizedBody).toBe('EN body')

    updateHumanizedBodies('v9.9.8', { en: 'EN body v2' })
    expect(getAnnouncementDraft('v9.9.8')?.humanizedBody).toBe('EN body v2')
  })

  test('getAnnouncementDraft coalesces legacy humanized_body as the en body, applied once', () => {
    upsertAnnouncementDraft({ version: 'v9.9.7', rawBody: 'raw', humanizedBody: 'legacy en' })
    expect(getAnnouncementDraft('v9.9.7')?.humanizedBodies).toEqual({ en: 'legacy en' })

    updateHumanizedBodies('v9.9.7', { ru: 'RU body' })
    expect(getAnnouncementDraft('v9.9.7')?.humanizedBodies).toEqual({ en: 'legacy en', ru: 'RU body' })
    const storedJson = getTestDb()
      .select({ humanizedBodies: versionAnnouncements.humanizedBodies })
      .from(versionAnnouncements)
      .where(eq(versionAnnouncements.version, 'v9.9.7'))
      .get()
    expect(storedJson?.humanizedBodies).toBe(JSON.stringify({ ru: 'RU body' }))

    updateHumanizedBodies('v9.9.7', { en: 'map en' })
    getTestDb()
      .update(versionAnnouncements)
      .set({ humanizedBody: 'legacy stale' })
      .where(eq(versionAnnouncements.version, 'v9.9.7'))
      .run()
    expect(getAnnouncementDraft('v9.9.7')?.humanizedBodies).toEqual({ en: 'map en', ru: 'RU body' })
  })

  test('unknown locales are stripped on write', () => {
    updateHumanizedBodies('v9.9.6', {
      en: 'EN body',
      ru: 'RU body',
      fr: 'sneaky',
    } as Partial<Record<Locale, string>>)
    expect(getAnnouncementDraft('v9.9.6')?.humanizedBodies).toEqual({ en: 'EN body', ru: 'RU body' })
  })
})

// ---------------------------------------------------------------------------
// Humanize: per-locale bodies
// ---------------------------------------------------------------------------

// humanize.ts captures `logger.child({ scope })` at module load, so mockLogger()
// cannot observe its warns. Capture through the real logger's public multistream
// extension point instead (same approach as tests/announcements/humanize.test.ts)
// and raise the root level per-test; pino children inherit it dynamically.
const humanizeLogCaptured: string[] = []
logMultistream.add({
  level: 'trace',
  stream: {
    write(raw: string): void {
      humanizeLogCaptured.push(raw)
    },
  },
})
const originalRootLogLevel = rootLogger.level

const isLogRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const humanizeWarns = (): Record<string, unknown>[] =>
  humanizeLogCaptured
    .flatMap((line) => {
      try {
        const entry: unknown = JSON.parse(line)
        return isLogRecord(entry) ? [entry] : []
      } catch {
        return []
      }
    })
    .filter((entry) => entry['level'] === 40 && entry['scope'] === 'announcements:humanize')

const llmRole = (model: string): { apiKey: string; baseUrl: string; model: string; source: 'global' } => ({
  apiKey: 'k',
  baseUrl: 'https://llm.example',
  model,
  source: 'global',
})

const okLlmConfig = {
  ok: true as const,
  source: 'global' as const,
  main: llmRole('main'),
  small: llmRole('small'),
  embedding: llmRole('embed'),
}

const twoClassifiedEntries = {
  entries: [
    { kind: 'new' as const, text: 'feat: edit a message to update the task' },
    { kind: 'fix' as const, text: 'fix: stale memory results' },
  ],
}

/** Write-pass stub keyed on the ru system prompt (module scope: no conditional inside a test body). */
const localeAwareGenerate =
  (ru: () => Promise<{ text: string }>, en: () => Promise<{ text: string }>) =>
  (opts: { system: string }): Promise<{ text: string }> =>
    opts.system.includes('Russian') ? ru() : en()

describe('humanizeChangelog: per-locale bodies', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    rootLogger.level = 'trace'
    humanizeLogCaptured.length = 0
  })

  afterEach(() => {
    rootLogger.level = originalRootLogLevel
  })

  test('one classify pass serves both locale bodies', async () => {
    let classifyCalls = 0
    let writeCalls = 0
    const result = await humanizeChangelog('### Added\n- thing', {
      resolveConfig: () => okLlmConfig,
      buildModel: (): LanguageModel => 'test-model',
      generateStructured: (): Promise<typeof twoClassifiedEntries> => {
        classifyCalls++
        return Promise.resolve(twoClassifiedEntries)
      },
      generate: (): Promise<{ text: string }> => {
        writeCalls++
        return Promise.resolve({ text: 'Humanized!' })
      },
    })
    expect(classifyCalls).toBe(1)
    expect(writeCalls).toBe(2)
    // Bind through unknown: the current signature returns string | null, the
    // per-locale contract under construction returns a body map.
    const bodies: unknown = result
    expect(bodies).toEqual({ en: 'Humanized!', ru: 'Humanized!' })
  })

  test('ru write failure yields an en-only result, a warn naming ru, and a non-null result', async () => {
    const result = await humanizeChangelog('raw', {
      resolveConfig: () => okLlmConfig,
      buildModel: (): LanguageModel => 'test-model',
      generateStructured: (): Promise<typeof twoClassifiedEntries> => Promise.resolve(twoClassifiedEntries),
      generate: localeAwareGenerate(
        () => Promise.reject(new Error('ru boom')),
        () => Promise.resolve({ text: 'EN body' }),
      ),
    })
    const bodies: unknown = result
    expect(bodies).toEqual({ en: 'EN body' })
    const warns = humanizeWarns()
    expect(warns.some((entry) => entry['locale'] === 'ru')).toBe(true)
  })

  test('ru write returning only whitespace yields an en-only result and a warn naming ru', async () => {
    const result = await humanizeChangelog('raw', {
      resolveConfig: () => okLlmConfig,
      buildModel: (): LanguageModel => 'test-model',
      generateStructured: (): Promise<typeof twoClassifiedEntries> => Promise.resolve(twoClassifiedEntries),
      generate: localeAwareGenerate(
        () => Promise.resolve({ text: '   ' }),
        () => Promise.resolve({ text: 'EN body' }),
      ),
    })
    const whitespaceBodies: unknown = result
    expect(whitespaceBodies).toEqual({ en: 'EN body' })
    const warns = humanizeWarns()
    expect(warns.some((entry) => entry['locale'] === 'ru')).toBe(true)
  })

  test('both write passes failing yields an empty map, not null', async () => {
    const result = await humanizeChangelog('raw', {
      resolveConfig: () => okLlmConfig,
      buildModel: (): LanguageModel => 'test-model',
      generateStructured: (): Promise<typeof twoClassifiedEntries> => Promise.resolve(twoClassifiedEntries),
      generate: (): Promise<{ text: string }> => Promise.reject(new Error('boom')),
    })
    const emptyBodies: unknown = result
    expect(emptyBodies).toEqual({})
  })

  test('empty release returns the localized announcements.emptyReleaseNote per locale', async () => {
    const result = await humanizeChangelog('raw', {
      resolveConfig: () => okLlmConfig,
      buildModel: (): LanguageModel => 'test-model',
      generateStructured: (): Promise<{ entries: [] }> => Promise.resolve({ entries: [] }),
      generate: (): Promise<{ text: string }> => Promise.resolve({ text: 'not called' }),
    })
    const noteBodies: unknown = result
    expect(noteBodies).toEqual({
      en: t('announcements.emptyReleaseNote', 'en'),
      ru: t('announcements.emptyReleaseNote', 'ru'),
    })
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
