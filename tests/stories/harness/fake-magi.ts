// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isDeepStrictEqual } from 'node:util'

import { z } from 'zod'

import type { ScenarioEvents } from './events.js'
import type { StrictHttpDispatcher } from './strict-http.js'

const toolDecisionSchema = z.enum(['allow', 'ask', 'deny'])

const toolPolicySchema = z.strictObject({
  default: toolDecisionSchema,
  tools: z.record(z.string(), toolDecisionSchema).optional(),
})

const mcpUpstreamSchema = z.strictObject({
  id: z.string().min(1),
  url: z.url(),
  host: z.string().min(1),
  header: z.string().min(1),
  allowedHosts: z.array(z.string().min(1)),
  toolPolicy: toolPolicySchema.optional(),
})

const forgeSchema = z.strictObject({
  kind: z.enum(['github', 'gitlab']),
  apiBaseUrl: z.url(),
})

const projectSpecSchema = z.strictObject({
  name: z.string().min(1),
  repoUrl: z.url(),
  baseBranch: z.string().min(1),
  permissionPreset: z.enum(['autonomous', 'cautious', 'readonly']),
  agent: z.string().min(1),
  additionalEgressDomains: z.array(z.string().min(1)).optional(),
  forge: forgeSchema.optional(),
  providerHost: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  mcp: z.array(mcpUpstreamSchema).optional(),
})

const startSessionSchema = z.strictObject({
  agent: z.string().min(1),
  contextId: z.string().min(1),
  prompt: z.string().min(1),
  secrets: z.record(z.string(), z.string()),
  forgeToken: z.string().min(1).optional(),
  prNumber: z.number().int().positive().optional(),
  projectSpec: projectSpecSchema,
  mcpTokens: z.record(z.string(), z.string()).optional(),
})
const permissionDecisionSchema = z.strictObject({
  toolCallId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
})
const finishSessionSchema = z.strictObject({
  action: z.enum(['push', 'pr']),
  message: z.string().min(1),
  forgeToken: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
})
const followUpSchema = z.strictObject({
  prompt: z.string().min(1),
  contextId: z.string().min(1),
  secrets: z.record(z.string(), z.string()),
  forgeToken: z.string().min(1),
  mcpTokens: z.record(z.string(), z.string()).optional(),
})
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:"[^"]+"|[^;\s]+))?$/iu

type StartSessionBody = z.infer<typeof startSessionSchema>
type PermissionDecisionBody = z.infer<typeof permissionDecisionSchema>
type FinishSessionBody = z.infer<typeof finishSessionSchema>
type FollowUpBody = z.infer<typeof followUpSchema>

type ExpectedStart = Readonly<{
  contextId?: string
  prompt?: string
  project?: string
  agent?: string
}>

export type FakeMagiStart = Readonly<{
  id: string
  status?: string
  shareToken?: string
  transcriptUrl?: string
  expected?: ExpectedStart
}>

export type FakeMagiStartFailure = Readonly<{
  status: number
  body: unknown
  expected?: ExpectedStart
}>

export type FakeMagiPermissionDecision = Readonly<{
  toolCallId: PermissionDecisionBody['toolCallId']
  decision: PermissionDecisionBody['decision']
}>

export type FakeMagiFinishBody = Readonly<FinishSessionBody>

export type FakeMagiFollowUpBody = Readonly<FollowUpBody>

export type FakeMagiResponse = Readonly<{
  body?: unknown
  status?: number
}>

export type FakeMagi = Readonly<{
  expectAgents(agents: readonly unknown[], response?: FakeMagiResponse): void
  expectStartSession(session: FakeMagiStart): void
  expectStartFailure(failure: FakeMagiStartFailure): void
  expectSessions(
    filter: 'new' | 'active' | 'waiting' | 'done',
    sessions: readonly unknown[],
    response?: FakeMagiResponse,
  ): void
  expectSession(sessionId: string, session: unknown, response?: FakeMagiResponse): void
  expectPermissions(sessionId: string, permissions: readonly unknown[], response?: FakeMagiResponse): void
  expectPermissionDecision(sessionId: string, decision: FakeMagiPermissionDecision, response?: FakeMagiResponse): void
  expectFinish(sessionId: string, body: FakeMagiFinishBody, result?: unknown, status?: number): void
  expectCancel(sessionId: string, result?: unknown, status?: number): void
  expectFollowUp(sessionId: string, body: FakeMagiFollowUpBody, result?: unknown, status?: number): void
  verifyConsumed(): void
}>

type FakeMagiOptions = Readonly<{
  http: StrictHttpDispatcher
  events: ScenarioEvents
  baseUrl: string
  token: string
}>

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function assertAuthorization(request: Request, token: string): void {
  if (request.headers.get('authorization') !== `Bearer ${token}`) {
    throw new Error('Fake magi rejected authorization')
  }
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type')
  if (contentType === null || !JSON_CONTENT_TYPE.test(contentType.trim())) {
    throw new Error('Fake magi expected Content-Type application/json')
  }
}

async function parseStartBody(request: Request): Promise<StartSessionBody> {
  const body = await parseJsonBody(request, 'POST /sessions')
  const parsed = startSessionSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error(`Fake magi rejected POST /sessions: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

async function parseJsonBody(request: Request, route: string): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new Error(`Fake magi expected valid JSON for ${route}`)
  }
}

async function assertExactJsonBody(
  request: Request,
  route: string,
  schema: z.ZodType,
  expected: unknown,
): Promise<void> {
  assertJsonContentType(request)
  const actual = await parseJsonBody(request, route)
  const parsed = schema.safeParse(actual)
  if (!parsed.success) throw new Error(`Fake magi rejected ${route}: ${z.prettifyError(parsed.error)}`)
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Fake magi expected exact JSON body for ${route}`)
}

async function assertEmptyBody(request: Request, route: string): Promise<void> {
  if (request.headers.has('content-type')) throw new Error(`Fake magi expected no Content-Type for ${route}`)
  if ((await request.text()) !== '') throw new Error(`Fake magi expected an empty body for ${route}`)
}

function sessionUrl(baseUrl: string, sessionId: string, suffix = ''): string {
  return `${baseUrl}/sessions/${encodeURIComponent(sessionId)}${suffix}`
}

function resolveResponse(
  response: FakeMagiResponse | undefined,
  fallbackBody: unknown,
  fallbackStatus: number,
): Readonly<{ body: unknown; status: number }> {
  return { body: response?.body ?? fallbackBody, status: response?.status ?? fallbackStatus }
}

function recordEvent(
  events: ScenarioEvents,
  kind: string,
  data: Readonly<Record<string, string | number | boolean>>,
): void {
  events.record(kind, data)
}

function assertExpected(body: StartSessionBody, expected: ExpectedStart | undefined): void {
  if (expected === undefined) return
  if (expected.contextId !== undefined && body.contextId !== expected.contextId)
    throw new Error(`Fake magi expected contextId=${expected.contextId}`)
  if (expected.prompt !== undefined && body.prompt !== expected.prompt)
    throw new Error(`Fake magi expected prompt=${expected.prompt}`)
  if (expected.project !== undefined && body.projectSpec.name !== expected.project)
    throw new Error(`Fake magi expected project=${expected.project}`)
  if (expected.agent !== undefined && body.projectSpec.agent !== expected.agent)
    throw new Error(`Fake magi expected agent=${expected.agent}`)
}

function recordStart(events: ScenarioEvents, body: StartSessionBody, status: number): void {
  recordEvent(events, 'magi.session.start', {
    agent: body.agent,
    contextId: body.contextId,
    hasPr: body.prNumber !== undefined,
    project: body.projectSpec.name,
    status,
    ...(body.prNumber === undefined ? {} : { prNumber: body.prNumber }),
  })
}

export function createFakeMagi(options: FakeMagiOptions): FakeMagi {
  const baseUrl = options.baseUrl.replace(/\/+$/u, '')
  const authorized = (request: Request): void => assertAuthorization(request, options.token)
  return {
    expectAgents(agents, expectedResponse): void {
      options.http.expect({ method: 'GET', url: `${baseUrl}/agents` }, async (request) => {
        authorized(request)
        await assertEmptyBody(request, 'GET /agents')
        const response = resolveResponse(expectedResponse, agents, 200)
        recordEvent(options.events, 'magi.agents.list', { count: agents.length, status: response.status })
        return jsonResponse(response.body, response.status)
      })
    },
    expectStartSession(session): void {
      options.http.expect({ method: 'POST', url: `${baseUrl}/sessions` }, async (request) => {
        authorized(request)
        assertJsonContentType(request)
        const body = await parseStartBody(request)
        assertExpected(body, session.expected)
        const shareToken = session.shareToken ?? `share-${session.id}`
        const response = jsonResponse(
          {
            id: session.id,
            status: session.status ?? 'queued',
            shareToken,
            transcriptUrl: session.transcriptUrl ?? `https://papai.invalid/t/${shareToken}`,
          },
          202,
        )
        recordStart(options.events, body, response.status)
        return response
      })
    },
    expectStartFailure(failure): void {
      if (failure.status >= 200 && failure.status < 300) {
        throw new Error('Fake magi start failure must use a non-2xx status')
      }
      options.http.expect({ method: 'POST', url: `${baseUrl}/sessions` }, async (request) => {
        authorized(request)
        assertJsonContentType(request)
        const body = await parseStartBody(request)
        assertExpected(body, failure.expected)
        const response = jsonResponse(failure.body, failure.status)
        recordStart(options.events, body, response.status)
        return response
      })
    },
    expectSessions(filter, sessions, expectedResponse): void {
      options.http.expect({ method: 'GET', url: `${baseUrl}/sessions?filter=${filter}` }, async (request) => {
        authorized(request)
        await assertEmptyBody(request, `GET /sessions?filter=${filter}`)
        const response = resolveResponse(expectedResponse, sessions, 200)
        recordEvent(options.events, 'magi.sessions.list', { count: sessions.length, status: response.status })
        return jsonResponse(response.body, response.status)
      })
    },
    expectSession(sessionId, session, expectedResponse): void {
      options.http.expect({ method: 'GET', url: sessionUrl(baseUrl, sessionId) }, async (request) => {
        authorized(request)
        await assertEmptyBody(request, `GET /sessions/${encodeURIComponent(sessionId)}`)
        const response = resolveResponse(expectedResponse, session, 200)
        recordEvent(options.events, 'magi.session.status', { sessionId, status: response.status })
        return jsonResponse(response.body, response.status)
      })
    },
    expectPermissions(sessionId, permissions, expectedResponse): void {
      options.http.expect({ method: 'GET', url: sessionUrl(baseUrl, sessionId, '/permissions') }, async (request) => {
        authorized(request)
        await assertEmptyBody(request, `GET /sessions/${encodeURIComponent(sessionId)}/permissions`)
        const response = resolveResponse(expectedResponse, permissions, 200)
        recordEvent(options.events, 'magi.permissions.list', {
          count: permissions.length,
          sessionId,
          status: response.status,
        })
        return jsonResponse(response.body, response.status)
      })
    },
    expectPermissionDecision(sessionId, decision, response): void {
      options.http.expect({ method: 'POST', url: sessionUrl(baseUrl, sessionId, '/permission') }, async (request) => {
        authorized(request)
        await assertExactJsonBody(
          request,
          `POST /sessions/${encodeURIComponent(sessionId)}/permission`,
          permissionDecisionSchema,
          decision,
        )
        const resolved = resolveResponse(response, { resolved: true }, 200)
        recordEvent(options.events, 'magi.permission.answer', { ...decision, sessionId, status: resolved.status })
        return jsonResponse(resolved.body, resolved.status)
      })
    },
    expectFinish(sessionId, body, result = { id: sessionId, status: 'finished' }, status = 200): void {
      options.http.expect({ method: 'POST', url: sessionUrl(baseUrl, sessionId, '/finish') }, async (request) => {
        authorized(request)
        await assertExactJsonBody(
          request,
          `POST /sessions/${encodeURIComponent(sessionId)}/finish`,
          finishSessionSchema,
          body,
        )
        recordEvent(options.events, 'magi.session.finish', {
          action: body.action,
          hasPr: body.action === 'pr',
          sessionId,
          status,
        })
        return jsonResponse(result, status)
      })
    },
    expectCancel(sessionId, result = { id: sessionId, status: 'cancelled' }, status = 200): void {
      options.http.expect({ method: 'POST', url: sessionUrl(baseUrl, sessionId, '/cancel') }, async (request) => {
        authorized(request)
        await assertEmptyBody(request, `POST /sessions/${encodeURIComponent(sessionId)}/cancel`)
        recordEvent(options.events, 'magi.session.cancel', { sessionId, status })
        return jsonResponse(result, status)
      })
    },
    expectFollowUp(sessionId, body, result = { id: `${sessionId}-follow-up`, status: 'queued' }, status = 202): void {
      options.http.expect({ method: 'POST', url: sessionUrl(baseUrl, sessionId, '/follow-up') }, async (request) => {
        authorized(request)
        await assertExactJsonBody(
          request,
          `POST /sessions/${encodeURIComponent(sessionId)}/follow-up`,
          followUpSchema,
          body,
        )
        recordEvent(options.events, 'magi.session.follow_up', { sessionId, status })
        return jsonResponse(result, status)
      })
    },
    verifyConsumed: options.http.verifyConsumed,
  }
}
