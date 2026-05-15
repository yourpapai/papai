import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { groupMembers } from './db/schema.js'
import { emitGlobal } from './debug/event-bus.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'groups' })

export function addGroupMember(groupId: string, userId: string, addedBy: string): void {
  log.debug({ groupId, userId, addedBy }, 'addGroupMember called')
  const db = getDrizzleDb()

  db.insert(groupMembers).values({ groupId, userId, addedBy }).onConflictDoNothing().run()

  log.info({ groupId, userId, addedBy }, 'Group member added')

  emitGlobal('group_member:added', { groupId, userId })
}

export function removeGroupMember(groupId: string, userId: string): void {
  log.debug({ groupId, userId }, 'removeGroupMember called')
  const db = getDrizzleDb()

  db.delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .run()

  log.info({ groupId, userId }, 'Group member removed')

  emitGlobal('group_member:removed', { groupId, userId })
}

export function isGroupMember(groupId: string, userId: string): boolean {
  log.debug({ groupId, userId }, 'isGroupMember called')
  const db = getDrizzleDb()

  const row = db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get()

  return row !== undefined
}

export function listGroupMembers(groupId: string): Array<{
  user_id: string
  added_by: string
  added_at: string
}> {
  log.debug({ groupId }, 'listGroupMembers called')
  const db = getDrizzleDb()

  return db
    .select({
      user_id: groupMembers.userId,
      added_by: groupMembers.addedBy,
      added_at: groupMembers.addedAt,
    })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(sql`${groupMembers.addedAt} DESC`)
    .all()
}
