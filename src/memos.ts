import { eq, and, sql, desc } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { memos, memoLinks } from './db/schema.js'
import { emitUser } from './debug/event-bus.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'memos' })

const generateId = (): string => crypto.randomUUID()

function parseTags(json: string): readonly string[] {
  const parsed: unknown = JSON.parse(json)
  return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
}

export interface Memo {
  readonly id: string
  readonly userId: string
  readonly content: string
  readonly summary: string | null
  readonly tags: readonly string[]
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ArchiveFilter {
  readonly tag?: string
  readonly beforeDate?: string
  readonly memoIds?: readonly string[]
}

type DrizzleMemoRow = typeof memos.$inferSelect
type MemoLinkRow = typeof memoLinks.$inferSelect

const drizzleRowToMemo = (row: DrizzleMemoRow): Memo => ({
  id: row.id,
  userId: row.userId,
  content: row.content,
  summary: row.summary,
  tags: parseTags(row.tags),
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const getRawDb = (): ReturnType<typeof getDrizzleDb>['$client'] => getDrizzleDb().$client

function countActive(userId: string): number {
  const rawDb = getRawDb()
  const rows = rawDb.prepare(`SELECT COUNT(*) as cnt FROM memos WHERE user_id = ? AND status = 'active'`).values(userId)
  const firstRow = rows[0]
  return typeof firstRow?.[0] === 'number' ? firstRow[0] : 0
}

export function saveMemo(userId: string, content: string, tags: readonly string[], summary?: string): Memo {
  log.debug({ userId, contentLength: content.length, tagCount: tags.length }, 'saveMemo called')
  const db = getDrizzleDb()
  const id = generateId()
  const tagsJson = JSON.stringify(tags)
  const now = new Date().toISOString()
  db.insert(memos)
    .values({
      id,
      userId,
      content,
      summary: summary ?? null,
      tags: tagsJson,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  log.info({ userId, memoId: id }, 'Memo saved')
  emitUser('memo:created', userId, { memoId: id, content })
  return { id, userId, content, summary: summary ?? null, tags, status: 'active', createdAt: now, updatedAt: now }
}

export function getMemo(userId: string, memoId: string): Memo | null {
  log.debug({ userId, memoId }, 'getMemo called')
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(memos)
    .where(and(eq(memos.id, memoId), eq(memos.userId, userId)))
    .get()
  if (row === undefined) {
    log.warn({ userId, memoId }, 'Memo not found')
    return null
  }
  return drizzleRowToMemo(row)
}

export function listMemos(userId: string, limit: number = 10, status: string = 'active'): readonly Memo[] {
  log.debug({ userId, limit, status }, 'listMemos called')
  const db = getDrizzleDb()
  const rows = db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, userId), eq(memos.status, status)))
    .orderBy(desc(memos.createdAt), desc(sql`rowid`))
    .limit(limit)
    .all()
  log.info({ userId, count: rows.length }, 'Memos listed')
  return rows.map(drizzleRowToMemo)
}

export function updateMemoEmbedding(userId: string, memoId: string, embedding: Float32Array): void {
  log.debug({ userId, memoId, embeddingDim: embedding.length }, 'updateMemoEmbedding called')
  const db = getDrizzleDb()
  const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
  db.update(memos)
    .set({ embedding: buffer, updatedAt: new Date().toISOString() })
    .where(and(eq(memos.id, memoId), eq(memos.userId, userId)))
    .run()
  log.info({ userId, memoId }, 'Memo embedding updated')
}

function sanitizeFtsQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

export function keywordSearchMemos(userId: string, query: string, limit: number = 5): readonly Memo[] {
  log.debug({ userId, query, limit }, 'keywordSearchMemos called')
  const db = getDrizzleDb()
  const safeQuery = sanitizeFtsQuery(query)
  const rows = db
    .select({
      id: memos.id,
      userId: memos.userId,
      content: memos.content,
      summary: memos.summary,
      tags: memos.tags,
      status: memos.status,
      createdAt: memos.createdAt,
      updatedAt: memos.updatedAt,
      embedding: memos.embedding,
    })
    .from(memos)
    .where(
      and(
        eq(memos.userId, userId),
        eq(memos.status, 'active'),
        sql`${memos.id} IN (SELECT m.id FROM memos m INNER JOIN memos_fts f ON m.rowid = f.rowid WHERE f.memos_fts MATCH ${safeQuery} AND m.user_id = ${userId} AND m.status = 'active')`,
      ),
    )
    .limit(limit)
    .all()
  log.info({ userId, query, resultCount: rows.length }, 'Keyword search completed')
  emitUser('memo:searched', userId, { query, resultCount: rows.length })
  return rows.map(drizzleRowToMemo)
}

export function loadEmbeddingsForUser(userId: string): readonly { id: string; embedding: Float32Array }[] {
  log.debug({ userId }, 'loadEmbeddingsForUser called')
  const db = getDrizzleDb()
  const rows = db
    .select({ id: memos.id, embedding: memos.embedding })
    .from(memos)
    .where(and(eq(memos.userId, userId), eq(memos.status, 'active'), sql`${memos.embedding} IS NOT NULL`))
    .all()
  const result = rows
    .filter((r): r is { id: string; embedding: Buffer } => r.embedding !== null)
    .map((r) => {
      const float32 = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)
      return { id: r.id, embedding: float32 }
    })
  log.info({ userId, count: result.length }, 'Embeddings loaded')
  return result
}

function archiveByTag(userId: string, tag: string): number {
  const rawDb = getRawDb()
  const before = countActive(userId)
  const now = new Date().toISOString()
  rawDb
    .prepare(
      `UPDATE memos SET status = 'archived', updated_at = ?
       WHERE user_id = ? AND status = 'active'
         AND id IN (SELECT m.id FROM memos m, json_each(m.tags) WHERE m.user_id = ? AND m.status = 'active' AND json_each.value = ?)`,
    )
    .run(now, userId, userId, tag)
  const count = before - countActive(userId)
  log.info({ userId, tag, count }, 'Memos archived by tag')
  return count
}

function archiveByIds(userId: string, ids: readonly string[]): number {
  const rawDb = getRawDb()
  const placeholders = ids.map(() => '?').join(', ')
  const before = countActive(userId)
  const now = new Date().toISOString()
  rawDb
    .prepare(
      `UPDATE memos SET status = 'archived', updated_at = ? WHERE user_id = ? AND status = 'active' AND id IN (${placeholders})`,
    )
    .run(now, userId, ...ids)
  const count = before - countActive(userId)
  log.info({ userId, count }, 'Memos archived by IDs')
  return count
}

function archiveByDate(userId: string, beforeDate: string): number {
  const rawDb = getRawDb()
  const before = countActive(userId)
  const now = new Date().toISOString()
  rawDb
    .prepare(
      `UPDATE memos SET status = 'archived', updated_at = ? WHERE user_id = ? AND status = 'active' AND created_at <= ?`,
    )
    .run(now, userId, beforeDate)
  const count = before - countActive(userId)
  log.info({ userId, count }, 'Memos archived by date')
  return count
}

/**
 * Archive memos matching the given filter.
 *
 * Exactly one filter should be provided per call (enforced by the tool layer).
 * If multiple filters are somehow passed, precedence is: memoIds > tag > beforeDate.
 */
export function archiveMemos(userId: string, filter: ArchiveFilter): number {
  log.debug({ userId, filter }, 'archiveMemos called')
  let archivedMemoIds: readonly string[] = []
  if (filter.memoIds !== undefined && filter.memoIds.length > 0) {
    const count = archiveByIds(userId, filter.memoIds)
    archivedMemoIds = filter.memoIds
    if (count > 0) emitUser('memo:archived', userId, { memoIds: [...archivedMemoIds] })
    return count
  }
  if (filter.tag !== undefined) {
    const count = archiveByTag(userId, filter.tag)
    if (count > 0) emitUser('memo:archived', userId, { memoIds: [] })
    return count
  }
  if (filter.beforeDate !== undefined) {
    const count = archiveByDate(userId, filter.beforeDate)
    if (count > 0) emitUser('memo:archived', userId, { memoIds: [] })
    return count
  }
  log.warn({ userId }, 'archiveMemos called with no filter')
  return 0
}

export function addMemoLink(
  sourceMemoId: string,
  targetTaskId: string,
  relationType: string = 'action_for',
): MemoLinkRow {
  log.debug({ sourceMemoId, targetTaskId, relationType }, 'addMemoLink called')
  const db = getDrizzleDb()
  const id = generateId()
  const now = new Date().toISOString()
  db.insert(memoLinks).values({ id, sourceMemoId, targetTaskId, relationType, createdAt: now }).run()
  log.info({ id, sourceMemoId, targetTaskId }, 'Memo link created')
  return { id, sourceMemoId, targetMemoId: null, targetTaskId, relationType, createdAt: now }
}
