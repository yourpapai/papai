// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The per-issue collaboration surfaces: watchers, votes, attachments, work
 * items and the activity feed. They live beside `router.ts` rather than in it
 * because each is an independent sub-resource of an issue, and because the
 * issue router is already the fake's largest file.
 */

import { errorResponse, fakeUser, findIssue, json, matchPath, noContent } from './shared.js'
import {
  type FakeYouTrackCtx,
  type FakeYouTrackState,
  nextId,
  nextTs,
  type StoredAttachment,
  type StoredIssue,
  type StoredWorkItem,
  WORK_ITEM_TYPES,
} from './state.js'

const FAKE_AUTHOR_ID = 'fake-user-1'

const paged = (ctx: FakeYouTrackCtx, rows: readonly unknown[]): Response => {
  const top = Number(ctx.query.get('$top') ?? '100')
  const skip = Number(ctx.query.get('$skip') ?? '0')
  return json(rows.slice(skip, skip + top))
}

// ---------- Watchers and votes ----------

export const handleWatchersAndVotes = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state } = ctx

  const onePath = matchPath('/api/issues/:id/watchers/issueWatchers/:userId', path)
  if (onePath !== null && method === 'DELETE') {
    const issue = findIssue(state, onePath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    issue.watcherIds = issue.watcherIds.filter((id) => id !== (onePath['userId'] ?? ''))
    return noContent()
  }

  const collectionPath = matchPath('/api/issues/:id/watchers/issueWatchers', path)
  if (collectionPath !== null && method === 'POST') {
    const issue = findIssue(state, collectionPath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    const body = (ctx.body ?? {}) as { user?: { id?: string } }
    const userId = body.user?.id
    if (userId === undefined) return errorResponse(400, 'watcher requires user.id')
    if (!issue.watcherIds.includes(userId)) issue.watcherIds.push(userId)
    return json({ id: nextId(state, 'watcher'), user: fakeUser(userId), isStarred: true })
  }

  const votersPath = matchPath('/api/issues/:id/voters', path)
  if (votersPath !== null && (method === 'POST' || method === 'DELETE')) {
    const issue = findIssue(state, votersPath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    issue.voted = method === 'POST'
    return method === 'POST' ? json({ hasVote: true }) : noContent()
  }

  return undefined
}

// ---------- Attachments ----------

const attachmentProjection = (a: StoredAttachment): Record<string, unknown> => ({
  id: a.id,
  name: a.name,
  mimeType: a.mimeType,
  size: a.size,
  url: `/api/files/${a.id}`,
  thumbnailURL: null,
  author: { login: 'fake.user' },
  created: a.created,
})

export const handleAttachments = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state } = ctx

  const onePath = matchPath('/api/issues/:id/attachments/:attachmentId', path)
  if (onePath !== null && method === 'DELETE') {
    const attachmentId = onePath['attachmentId'] ?? ''
    if (!state.attachments.has(attachmentId)) return errorResponse(404, 'attachment not found')
    state.attachments.delete(attachmentId)
    return noContent()
  }

  const collectionPath = matchPath('/api/issues/:id/attachments', path)
  if (collectionPath === null) return undefined
  const issue = findIssue(state, collectionPath['id'] ?? '')
  if (issue === undefined) return errorResponse(404, 'issue not found')

  if (method === 'GET') {
    const rows = [...state.attachments.values()]
      .filter((a) => a.issueId === issue.id)
      .map((a) => attachmentProjection(a))
    return paged(ctx, rows)
  }

  if (method === 'POST') {
    const upload = (ctx.body ?? {}) as { upload?: { name?: string; type?: string; size?: number } }
    const file = upload.upload
    if (file === undefined) return errorResponse(400, 'attachment upload requires an `upload` part')
    const attachment: StoredAttachment = {
      id: nextId(state, 'attachment'),
      issueId: issue.id,
      name: file.name ?? 'unnamed',
      mimeType: file.type === undefined || file.type === '' ? 'application/octet-stream' : file.type,
      size: file.size ?? 0,
      created: nextTs(state),
    }
    state.attachments.set(attachment.id, attachment)
    // YouTrack answers an upload with the list of attachments it created.
    return json([attachmentProjection(attachment)])
  }

  return undefined
}

// ---------- Work items ----------

const workItemProjection = (wi: StoredWorkItem): Record<string, unknown> => {
  const type = WORK_ITEM_TYPES.find((t) => t.id === wi.typeId)
  return {
    id: wi.id,
    date: wi.dateMs,
    duration: { minutes: wi.minutes, presentation: `${wi.minutes}m` },
    text: wi.text ?? null,
    author: { id: FAKE_AUTHOR_ID, login: 'fake.user', name: 'Fake User' },
    // The provider's schema accepts an absent type but not a null one.
    ...(type === undefined ? {} : { type: { id: type.id, name: type.name } }),
  }
}

type WorkItemBody = {
  duration?: { minutes?: number }
  date?: number
  text?: string
  type?: { id?: string }
}

const applyWorkItemBody = (item: StoredWorkItem, body: WorkItemBody): void => {
  if (body.duration?.minutes !== undefined) item.minutes = body.duration.minutes
  if (body.date !== undefined) item.dateMs = body.date
  if (body.text !== undefined) item.text = body.text
  if (body.type?.id !== undefined) item.typeId = body.type.id
}

export const handleWorkItems = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state } = ctx

  if (path === '/api/admin/timeTrackingSettings/workItemTypes' && method === 'GET') {
    return json(WORK_ITEM_TYPES.map((type) => ({ id: type.id, name: type.name })))
  }

  const onePath = matchPath('/api/issues/:id/timeTracking/workItems/:workItemId', path)
  if (onePath !== null) {
    const item = state.workItems.get(onePath['workItemId'] ?? '')
    if (item === undefined) return errorResponse(404, 'work item not found')
    if (method === 'DELETE') {
      state.workItems.delete(item.id)
      return noContent()
    }
    if (method === 'POST') {
      applyWorkItemBody(item, (ctx.body ?? {}) as WorkItemBody)
      return json(workItemProjection(item))
    }
    return undefined
  }

  const collectionPath = matchPath('/api/issues/:id/timeTracking/workItems', path)
  if (collectionPath === null) return undefined
  const issue = findIssue(state, collectionPath['id'] ?? '')
  if (issue === undefined) return errorResponse(404, 'issue not found')

  if (method === 'GET') {
    const rows = [...state.workItems.values()]
      .filter((wi) => wi.issueId === issue.id)
      .map((wi) => workItemProjection(wi))
    return paged(ctx, rows)
  }

  if (method === 'POST') {
    const body = (ctx.body ?? {}) as WorkItemBody
    const item: StoredWorkItem = {
      id: nextId(state, 'work-item'),
      issueId: issue.id,
      minutes: 0,
      dateMs: nextTs(state),
      text: undefined,
      typeId: undefined,
    }
    applyWorkItemBody(item, body)
    state.workItems.set(item.id, item)
    return json(workItemProjection(item))
  }

  return undefined
}

// ---------- Activities ----------

/**
 * The fake records no activity log, so it derives one from what the issue is
 * now: its creation, and one comment-added entry per stored comment. That is
 * enough to prove the provider's request shape and its activity mapping.
 */
const deriveActivities = (state: FakeYouTrackState, issue: StoredIssue): unknown[] => {
  const author = { id: FAKE_AUTHOR_ID, login: 'fake.user', name: 'Fake User', fullName: 'Fake User' }
  const activities: unknown[] = [
    {
      id: `activity-created-${issue.id}`,
      timestamp: issue.created,
      author,
      category: { id: 'IssueCreatedCategory' },
      field: { name: 'created' },
      targetMember: null,
      added: issue.summary,
      removed: null,
    },
  ]
  for (const comment of state.comments.values()) {
    if (comment.issueId !== issue.id) continue
    activities.push({
      id: `activity-comment-${comment.id}`,
      timestamp: comment.created,
      author,
      category: { id: 'CommentsCategory' },
      field: { name: 'comments' },
      targetMember: null,
      added: comment.text,
      removed: null,
    })
  }
  return activities
}

export const handleActivities = (ctx: FakeYouTrackCtx): Response | undefined => {
  const activitiesPath = matchPath('/api/issues/:id/activities', ctx.path)
  if (activitiesPath === null || ctx.method !== 'GET') return undefined
  const issue = findIssue(ctx.state, activitiesPath['id'] ?? '')
  if (issue === undefined) return errorResponse(404, 'issue not found')
  const activities = deriveActivities(ctx.state, issue)
  const ordered = ctx.query.get('reverse') === 'true' ? [...activities].reverse() : activities
  return paged(ctx, ordered)
}
