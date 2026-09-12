// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  FAKE_GITHUB_OWNER,
  FAKE_GITHUB_REPO,
  FAKE_GITHUB_USER_LOGIN,
  type FakeGitHubState,
  type StoredComment,
  type StoredIssue,
  type StoredLabel,
} from './state.js'

/** Transport-free request context the router answers; the responder adapts it. */
export type FakeGitHubCtx = Readonly<{
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  state: FakeGitHubState
}>

const userPayload = (): Record<string, unknown> => ({
  login: FAKE_GITHUB_USER_LOGIN,
  id: 1,
  avatar_url: `https://github.invalid/avatars/${FAKE_GITHUB_USER_LOGIN}.png`,
  html_url: `https://github.invalid/${FAKE_GITHUB_USER_LOGIN}`,
  type: 'User',
})

const repoPayload = (): Record<string, unknown> => ({
  id: 10,
  name: FAKE_GITHUB_REPO,
  full_name: `${FAKE_GITHUB_OWNER}/${FAKE_GITHUB_REPO}`,
  owner: userPayload(),
  html_url: `https://github.invalid/${FAKE_GITHUB_OWNER}/${FAKE_GITHUB_REPO}`,
  private: false,
  description: null,
})

const labelPayload = (state: FakeGitHubState, name: string): Record<string, unknown> => {
  const label = state.labelByName(name)
  return {
    id: label?.id ?? 0,
    name,
    color: label?.color ?? 'ededed',
  }
}

const issuePayload = (state: FakeGitHubState, issue: StoredIssue): Record<string, unknown> => ({
  id: issue.id,
  number: issue.number,
  title: issue.title,
  body: issue.body,
  user: userPayload(),
  labels: issue.labelNames.map((name) => labelPayload(state, name)),
  assignees: [],
  state: issue.state,
  state_reason: null,
  comments: state.issueComments(issue.number).length,
  created_at: issue.createdAt,
  updated_at: issue.updatedAt,
  closed_at: null,
  milestone: null,
  html_url: `https://github.invalid/${FAKE_GITHUB_OWNER}/${FAKE_GITHUB_REPO}/issues/${issue.number}`,
})

const commentPayload = (comment: StoredComment): Record<string, unknown> => ({
  id: comment.id,
  body: comment.body,
  user: userPayload(),
  created_at: comment.createdAt,
  updated_at: comment.updatedAt,
  html_url: `https://github.invalid/${FAKE_GITHUB_OWNER}/${FAKE_GITHUB_REPO}/issues/${comment.issueNumber}#issuecomment-${comment.id}`,
  issue_url: `https://github.invalid/repos/${FAKE_GITHUB_OWNER}/${FAKE_GITHUB_REPO}/issues/${comment.issueNumber}`,
  author_association: 'CONTRIBUTOR',
})

const repoLabelPayload = (label: StoredLabel): Record<string, unknown> => ({
  id: label.id,
  name: label.name,
  color: label.color,
  description: label.description,
})

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

const notFound = (resource: string): Response => jsonResponse(404, { message: `Not Found — ${resource}` })

const paginate = <T>(items: readonly T[], query: URLSearchParams): readonly T[] => {
  const page = Math.max(1, Number(query.get('page') ?? '1'))
  const perPage = Math.max(1, Number(query.get('per_page') ?? '30'))
  return items.slice((page - 1) * perPage, page * perPage)
}

const bodyObject = (ctx: FakeGitHubCtx): Record<string, unknown> => {
  const body = ctx.body
  if (typeof body !== 'object' || body === null) return {}
  const record: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) record[key] = value
  return record
}

const stringField = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

const issueNumberSegment = (segment: string): number | undefined => {
  if (!/^\d+$/u.test(segment)) return undefined
  return Number(segment)
}

const repoSegments = (
  segments: readonly string[],
): Readonly<{ owner: string; repo: string; rest: readonly string[] }> | undefined => {
  if (segments[0] !== 'repos') return undefined
  const owner = segments[1]
  const repo = segments[2]
  if (owner !== FAKE_GITHUB_OWNER || repo !== FAKE_GITHUB_REPO) return undefined
  return { owner, repo, rest: segments.slice(3) }
}

function handleIssueCollection(ctx: FakeGitHubCtx, issueNumber: number, sub: string): Response {
  const { state, method } = ctx
  if (sub === 'comments') {
    if (method === 'GET') {
      if (!state.issues.has(issueNumber)) return notFound('issue')
      return jsonResponse(200, paginate(state.issueComments(issueNumber), ctx.query).map(commentPayload))
    }
    if (method === 'POST') {
      if (!state.issues.has(issueNumber)) return notFound('issue')
      const body = stringField(bodyObject(ctx), 'body')
      if (body === undefined) return jsonResponse(422, { message: 'body is required' })
      return jsonResponse(201, commentPayload(state.createComment(issueNumber, body)))
    }
    return notFound('route')
  }
  if (sub === 'labels') {
    if (!state.issues.has(issueNumber)) return notFound('issue')
    if (method === 'GET') {
      const issue = state.issues.get(issueNumber)
      if (issue === undefined) return notFound('issue')
      return jsonResponse(
        200,
        paginate(issue.labelNames, ctx.query).map((name) => labelPayload(state, name)),
      )
    }
    if (method === 'PUT' || method === 'POST') {
      const raw = bodyObject(ctx)['labels']
      if (!Array.isArray(raw)) return jsonResponse(422, { message: 'labels array is required' })
      const names = raw.map(String)
      if (method === 'PUT') state.setIssueLabels(issueNumber, names)
      else state.addIssueLabels(issueNumber, names)
      const issue = state.issues.get(issueNumber)
      if (issue === undefined) return notFound('issue')
      return jsonResponse(
        200,
        issue.labelNames.map((name) => labelPayload(state, name)),
      )
    }
    if (method === 'DELETE') {
      state.setIssueLabels(issueNumber, [])
      return new Response(null, { status: 204 })
    }
    return notFound('route')
  }
  return notFound('route')
}

function handleIssueLabelItem(ctx: FakeGitHubCtx, issueNumber: number, name: string): Response {
  if (ctx.method !== 'DELETE') return notFound('route')
  if (!ctx.state.issues.has(issueNumber)) return notFound('issue')
  if (!ctx.state.removeIssueLabel(issueNumber, name)) return notFound('label')
  return new Response(null, { status: 204 })
}

function handleCommentItem(ctx: FakeGitHubCtx, commentId: number): Response {
  const { state, method } = ctx
  if (method === 'PATCH') {
    const body = stringField(bodyObject(ctx), 'body')
    if (body === undefined) return jsonResponse(422, { message: 'body is required' })
    const updated = state.updateComment(commentId, body)
    if (updated === undefined) return notFound('comment')
    return jsonResponse(200, commentPayload(updated))
  }
  if (method === 'DELETE') {
    if (!state.deleteComment(commentId)) return notFound('comment')
    return new Response(null, { status: 204 })
  }
  return notFound('route')
}

function handleLabelCollection(ctx: FakeGitHubCtx): Response {
  const { state, method } = ctx
  if (method === 'GET') {
    return jsonResponse(200, paginate([...state.labels.values()], ctx.query).map(repoLabelPayload))
  }
  if (method === 'POST') {
    const body = bodyObject(ctx)
    const name = stringField(body, 'name')
    if (name === undefined) return jsonResponse(422, { message: 'name is required' })
    const description = body['description']
    const created = state.createLabel({
      name,
      color: stringField(body, 'color') ?? 'ededed',
      description: typeof description === 'string' ? description : null,
    })
    return jsonResponse(201, repoLabelPayload(created))
  }
  return notFound('route')
}

function handleLabelItem(ctx: FakeGitHubCtx, name: string): Response {
  const { state, method } = ctx
  const decodedName = decodeURIComponent(name)
  if (method === 'PATCH') {
    const body = bodyObject(ctx)
    const result = state.updateLabel(decodedName, {
      newName: stringField(body, 'new_name'),
      color: stringField(body, 'color'),
    })
    if (!result.renamed || result.label === undefined) return notFound('label')
    return jsonResponse(200, repoLabelPayload(result.label))
  }
  if (method === 'DELETE') {
    if (!state.deleteLabel(decodedName)) return notFound('label')
    return new Response(null, { status: 204 })
  }
  return notFound('route')
}

function handleIssuesCollection(ctx: FakeGitHubCtx): Response {
  const { state, method } = ctx
  if (method === 'GET') {
    return jsonResponse(
      200,
      paginate([...state.issues.values()], ctx.query).map((issue) => issuePayload(state, issue)),
    )
  }
  if (method === 'POST') {
    const body = bodyObject(ctx)
    const title = stringField(body, 'title')
    if (title === undefined) return jsonResponse(422, { message: 'title is required' })
    const description = body['body']
    const created = state.createIssue({
      title,
      body: typeof description === 'string' ? description : null,
    })
    return jsonResponse(201, issuePayload(state, created))
  }
  return notFound('route')
}

function handleIssueItem(ctx: FakeGitHubCtx, issueNumber: number): Response {
  if (ctx.method !== 'GET') return notFound('route')
  const issue = ctx.state.issues.get(issueNumber)
  if (issue === undefined) return notFound('issue')
  return jsonResponse(200, issuePayload(ctx.state, issue))
}

function handleRepoRoute(ctx: FakeGitHubCtx): Response {
  const segments = ctx.path.split('/').filter((segment) => segment !== '')
  const repo = repoSegments(segments)
  if (repo === undefined) return notFound('repository')
  const rest = repo.rest

  if (rest.length === 0) {
    if (ctx.method === 'GET') return jsonResponse(200, repoPayload())
    return notFound('route')
  }
  if (rest[0] === 'issues') {
    if (rest.length === 1) return handleIssuesCollection(ctx)
    const second = rest[1] ?? ''
    // The issue-comments collection addresses a comment by id directly
    // (PATCH/DELETE /repos/{o}/{r}/issues/comments/{id}), never by issue.
    if (second === 'comments' && rest.length === 3) {
      const commentId = issueNumberSegment(rest[2] ?? '')
      if (commentId === undefined) return notFound('comment')
      return handleCommentItem(ctx, commentId)
    }
    const issueNumber = issueNumberSegment(second)
    if (issueNumber === undefined) return notFound('issue')
    if (rest.length === 2) return handleIssueItem(ctx, issueNumber)
    if (rest.length === 3) {
      const collection = rest[2]
      if (collection === undefined) return notFound('route')
      return handleIssueCollection(ctx, issueNumber, collection)
    }
    if (rest.length === 4 && rest[2] === 'labels') {
      const labelName = rest[3]
      if (labelName === undefined) return notFound('route')
      return handleIssueLabelItem(ctx, issueNumber, labelName)
    }
    return notFound('route')
  }
  if (rest[0] === 'labels') {
    if (rest.length === 1) return handleLabelCollection(ctx)
    if (rest.length === 2) {
      const labelName = rest[1]
      if (labelName === undefined) return notFound('route')
      return handleLabelItem(ctx, labelName)
    }
    return notFound('route')
  }
  return notFound('route')
}

/** Routes one fake GitHub REST request; unknown paths 404 like the real API. */
export function handleFakeGitHubRequest(ctx: FakeGitHubCtx): Response {
  return handleRepoRoute(ctx)
}
