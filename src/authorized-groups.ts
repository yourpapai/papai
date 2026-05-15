// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { desc, eq } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { authorizedGroups } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'authorized-groups' })

export function addAuthorizedGroup(groupId: string, addedBy: string): void {
  log.debug({ groupId, addedBy }, 'addAuthorizedGroup called')
  const db = getDrizzleDb()

  db.insert(authorizedGroups).values({ groupId, addedBy }).onConflictDoNothing().run()

  const inserted = db.$client.query<{ 'changes()': number }, []>('SELECT changes()').get()
  if (inserted === null || inserted === undefined) {
    log.info({ groupId, addedBy }, 'Authorized group already present')
    return
  }

  if (inserted['changes()'] === 0) {
    log.info({ groupId, addedBy }, 'Authorized group already present')
    return
  }

  log.info({ groupId, addedBy }, 'Authorized group added')
}

export function removeAuthorizedGroup(groupId: string): boolean {
  log.debug({ groupId }, 'removeAuthorizedGroup called')
  const db = getDrizzleDb()

  const deletedRows = db
    .delete(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .returning({ groupId: authorizedGroups.groupId })
    .all()

  const removed = deletedRows.length > 0

  log.info({ groupId, removed }, 'Authorized group removal completed')

  return removed
}

export function isAuthorizedGroup(groupId: string): boolean {
  log.debug({ groupId }, 'isAuthorizedGroup called')
  const db = getDrizzleDb()

  const row = db
    .select({ groupId: authorizedGroups.groupId })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .get()

  return row !== undefined
}

export function listAuthorizedGroups(): Array<{
  group_id: string
  added_by: string
  added_at: string
}> {
  log.debug({}, 'listAuthorizedGroups called')
  const db = getDrizzleDb()

  return db
    .select({
      group_id: authorizedGroups.groupId,
      added_by: authorizedGroups.addedBy,
      added_at: authorizedGroups.addedAt,
    })
    .from(authorizedGroups)
    .orderBy(desc(authorizedGroups.addedAt), desc(authorizedGroups.groupId))
    .all()
}
