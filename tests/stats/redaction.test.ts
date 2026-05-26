// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  alertPrompts,
  attachments,
  authorizedGroups,
  conversationHistory,
  groupUserObservations,
  knownGroupContexts,
  memorySummary,
  memos,
  messageMetadata,
  recurringTasks,
  scheduledPrompts,
  stagedFiles,
  systemConfig,
  userInstructions,
  users,
  webCache,
} from '../../src/db/schema.js'
import { clearStatsCacheForTesting, getGlobalStats, getSubjectStats } from '../../src/stats/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const FORBIDDEN_MARKERS = [
  'FORBIDDEN_MEMO_BODY_XYZ',
  'FORBIDDEN_MEMO_SUMMARY_XYZ',
  'FORBIDDEN_MEMO_TAG_XYZ',
  'FORBIDDEN_MESSAGE_TEXT_XYZ',
  'FORBIDDEN_AUTHOR_USERNAME_XYZ',
  'FORBIDDEN_INSTRUCTION_TEXT_XYZ',
  'FORBIDDEN_FILENAME_XYZ',
  'FORBIDDEN_MIME_XYZ',
  'FORBIDDEN_USERNAME_XYZ',
  'FORBIDDEN_GROUP_OBS_XYZ',
  'FORBIDDEN_GROUP_NAME_XYZ',
  'FORBIDDEN_WEB_CONTENT_XYZ',
  'FORBIDDEN_SCHEDULED_PROMPT_XYZ',
  'FORBIDDEN_ALERT_PROMPT_XYZ',
  'FORBIDDEN_RECURRING_XYZ',
  'FORBIDDEN_CONVERSATION_TEXT_XYZ',
  'FORBIDDEN_SUMMARY_TEXT_XYZ',
  'FORBIDDEN_STAGED_FILENAME_XYZ',
  'FORBIDDEN_SALT_XYZ',
] as const

const SUBJECT_ID = 'subject-redaction-1'

function seedForbiddenRows(): void {
  const db = getDrizzleDb()

  db.insert(users)
    .values({
      platformUserId: SUBJECT_ID,
      platformInstanceId: 'legacy-single',
      addedBy: 'admin',
      username: 'FORBIDDEN_USERNAME_XYZ',
    })
    .run()
  db.insert(authorizedGroups).values({ groupId: 'group-redaction-1', addedBy: 'admin' }).run()

  db.insert(memos)
    .values({
      id: 'm1',
      userId: SUBJECT_ID,
      content: 'memo body FORBIDDEN_MEMO_BODY_XYZ',
      summary: 'memo summary FORBIDDEN_MEMO_SUMMARY_XYZ',
      tags: JSON.stringify(['FORBIDDEN_MEMO_TAG_XYZ']),
    })
    .run()

  db.insert(messageMetadata)
    .values({
      contextId: SUBJECT_ID,
      messageId: 'msg1',
      authorId: SUBJECT_ID,
      authorUsername: 'FORBIDDEN_AUTHOR_USERNAME_XYZ',
      text: 'message text FORBIDDEN_MESSAGE_TEXT_XYZ',
      timestamp: 1000,
      expiresAt: 9999999,
    })
    .run()

  db.insert(userInstructions)
    .values({ id: 'i1', contextId: SUBJECT_ID, text: 'instruction FORBIDDEN_INSTRUCTION_TEXT_XYZ' })
    .run()

  db.insert(attachments)
    .values({
      attachmentId: 'a1',
      contextId: SUBJECT_ID,
      sourceProvider: 'telegram',
      filename: 'FORBIDDEN_FILENAME_XYZ.bin',
      mimeType: 'application/FORBIDDEN_MIME_XYZ',
      size: 100,
      checksum: 'c',
      blobKey: 'b',
      status: 'stored',
      isActive: 1,
      createdAt: '2026-01-01T00:00:00Z',
    })
    .run()

  db.insert(groupUserObservations)
    .values({
      provider: 'telegram',
      contextId: 'group-redaction-1',
      userId: 'u-obs',
      username: 'FORBIDDEN_GROUP_OBS_XYZ',
      displayLabel: 'FORBIDDEN_GROUP_OBS_XYZ-label',
      lastSeenAt: '2026-01-01T00:00:00Z',
    })
    .run()

  db.insert(knownGroupContexts)
    .values({
      provider: 'telegram',
      contextId: 'group-redaction-1',
      displayName: 'FORBIDDEN_GROUP_NAME_XYZ',
      parentName: 'FORBIDDEN_GROUP_NAME_XYZ-parent',
      firstSeenAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-01T00:00:00Z',
    })
    .run()

  db.insert(webCache)
    .values({
      urlHash: 'wh1',
      url: 'https://FORBIDDEN_WEB_CONTENT_XYZ.example.com/path',
      finalUrl: 'https://FORBIDDEN_WEB_CONTENT_XYZ.example.com/path',
      title: 'FORBIDDEN_WEB_CONTENT_XYZ-title',
      summary: 'FORBIDDEN_WEB_CONTENT_XYZ-summary',
      excerpt: 'FORBIDDEN_WEB_CONTENT_XYZ-excerpt',
      contentType: 'text/html',
      fetchedAt: 1,
      expiresAt: 2,
    })
    .run()

  db.insert(scheduledPrompts)
    .values({
      id: 'sp1',
      createdByUserId: SUBJECT_ID,
      prompt: 'FORBIDDEN_SCHEDULED_PROMPT_XYZ',
      fireAt: '2026-01-01T00:00:00Z',
    })
    .run()

  db.insert(alertPrompts)
    .values({
      id: 'ap1',
      createdByUserId: SUBJECT_ID,
      prompt: 'FORBIDDEN_ALERT_PROMPT_XYZ',
      condition: 'FORBIDDEN_ALERT_PROMPT_XYZ-condition',
    })
    .run()

  db.insert(recurringTasks)
    .values({
      id: 'rt1',
      userId: SUBJECT_ID,
      projectId: 'p',
      title: 'FORBIDDEN_RECURRING_XYZ',
      description: 'FORBIDDEN_RECURRING_XYZ-desc',
      enabled: '1',
    })
    .run()

  db.insert(conversationHistory)
    .values({
      userId: SUBJECT_ID,
      messages: JSON.stringify([{ role: 'user', content: 'FORBIDDEN_CONVERSATION_TEXT_XYZ' }]),
    })
    .run()

  db.insert(memorySummary)
    .values({
      userId: SUBJECT_ID,
      summary: 'FORBIDDEN_SUMMARY_TEXT_XYZ',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    .run()

  db.insert(stagedFiles)
    .values({
      stagedId: 'sf1',
      contextId: SUBJECT_ID,
      senderId: SUBJECT_ID,
      filename: 'FORBIDDEN_STAGED_FILENAME_XYZ.bin',
      platformFileId: 'pf1',
      sourceProvider: 'telegram',
      status: 'staged',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-12-31T00:00:00Z',
    })
    .run()

  db.insert(systemConfig)
    .values({
      key: 'stats_anonymity_salt',
      value: 'FORBIDDEN_SALT_XYZ',
      updatedAt: 0,
      updatedBy: 'test',
    })
    .run()
}

describe('stats redaction contract (release-blocking)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearStatsCacheForTesting()
    seedForbiddenRows()
  })

  test('getGlobalStats output contains none of the forbidden markers', () => {
    const serialized = JSON.stringify(getGlobalStats({ noCache: true }))
    for (const marker of FORBIDDEN_MARKERS) expect(serialized).not.toContain(marker)
  })

  test('getSubjectStats output contains none of the forbidden markers', () => {
    const result = getSubjectStats(SUBJECT_ID)
    expect(result).not.toBeNull()
    const serialized = JSON.stringify(result)
    for (const marker of FORBIDDEN_MARKERS) expect(serialized).not.toContain(marker)
  })
})
