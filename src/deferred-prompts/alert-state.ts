// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { alertPrompts } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'deferred:alerts' })

export const updateAlertMatchedTaskIds = (id: string, userId: string, matchedTaskIds: string[]): void => {
  log.debug({ id, userId, count: matchedTaskIds.length }, 'updateAlertMatchedTaskIds called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ matchedTaskIds: JSON.stringify(matchedTaskIds) })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert matched task ids updated')
}

/** Record a filter alert's baseline-on-create match set. The baselined-at
 * timestamp rides the nullable last_activity_cursor column — pure-field
 * conditions never use it otherwise (mixed trees are refused at create and
 * condition update), so it doubles as the once-per-alert-life baseline
 * marker; a condition edit clears it and re-arms the baseline. */
export const updateAlertBaseline = (
  id: string,
  userId: string,
  matchedTaskIds: string[],
  baselinedAt: string,
): void => {
  log.debug({ id, userId, count: matchedTaskIds.length }, 'updateAlertBaseline called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ matchedTaskIds: JSON.stringify(matchedTaskIds), lastActivityCursor: baselinedAt })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert baseline recorded')
}

export const updateAlertMatchState = (
  id: string,
  userId: string,
  lastTriggeredAt: string,
  matchedTaskIds: string[],
): void => {
  log.debug({ id, userId, lastTriggeredAt, count: matchedTaskIds.length }, 'updateAlertMatchState called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ lastTriggeredAt, matchedTaskIds: JSON.stringify(matchedTaskIds) })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert match state updated')
}

export const updateAlertActivityState = (
  id: string,
  userId: string,
  lastTriggeredAt: string | null,
  lastActivityCursor: string,
): void => {
  log.debug({ id, userId, lastTriggeredAt, lastActivityCursor }, 'updateAlertActivityState called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ lastTriggeredAt, lastActivityCursor })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert activity state updated')
}
