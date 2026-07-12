// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ScenarioEvents } from './events.js'
import type { StrictHttpDispatcher } from './strict-http.js'

const projectSpecSchema = z.looseObject({
  name: z.string().min(1),
  repoUrl: z.url(),
  baseBranch: z.string().min(1),
  permissionPreset: z.string().min(1),
  agent: z.string().min(1),
})

const startSessionSchema = z.looseObject({
  agent: z.string().min(1),
  contextId: z.string().min(1),
  prompt: z.string().min(1),
  secrets: z.record(z.string(), z.string()),
  forgeToken: z.string().min(1).optional(),
  prNumber: z.number().int().positive().optional(),
  projectSpec: projectSpecSchema,
  mcpTokens: z.record(z.string(), z.string()).optional(),
})

type StartSessionBody = z.infer<typeof startSessionSchema>

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

export type FakeMagi = Readonly<{
  expectAgents(agents: readonly unknown[]): void
  expectStartSession(session: FakeMagiStart): void
  expectSessions(filter: 'new' | 'active' | 'waiting' | 'done', sessions: readonly unknown[]): void
  expectSession(sessionId: string, session: unknown): void
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

async function parseStartBody(request: Request): Promise<StartSessionBody> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new Error('Fake magi expected valid JSON for POST /sessions')
  }
  const parsed = startSessionSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error(`Fake magi rejected POST /sessions: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
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

function recordStart(events: ScenarioEvents, body: StartSessionBody): void {
  events.record('magi.session.start', {
    agent: body.agent,
    contextId: body.contextId,
    prompt: body.prompt,
    projectSpec: body.projectSpec,
    environmentNames: Object.keys(body.secrets).sort(),
    forgeIncluded: body.forgeToken !== undefined,
  })
}

export function createFakeMagi(options: FakeMagiOptions): FakeMagi {
  const baseUrl = options.baseUrl.replace(/\/+$/u, '')
  const authorized = (request: Request): void => assertAuthorization(request, options.token)
  return {
    expectAgents(agents): void {
      options.http.expect({ method: 'GET', url: `${baseUrl}/agents` }, (request) => {
        authorized(request)
        return jsonResponse(agents)
      })
    },
    expectStartSession(session): void {
      options.http.expect({ method: 'POST', url: `${baseUrl}/sessions` }, async (request) => {
        authorized(request)
        const body = await parseStartBody(request)
        assertExpected(body, session.expected)
        recordStart(options.events, body)
        const shareToken = session.shareToken ?? `share-${session.id}`
        return jsonResponse(
          {
            id: session.id,
            status: session.status ?? 'queued',
            shareToken,
            transcriptUrl: session.transcriptUrl ?? `https://papai.invalid/t/${shareToken}`,
          },
          202,
        )
      })
    },
    expectSessions(filter, sessions): void {
      options.http.expect({ method: 'GET', url: `${baseUrl}/sessions?filter=${filter}` }, (request) => {
        authorized(request)
        return jsonResponse(sessions)
      })
    },
    expectSession(sessionId, session): void {
      options.http.expect({ method: 'GET', url: `${baseUrl}/sessions/${encodeURIComponent(sessionId)}` }, (request) => {
        authorized(request)
        return jsonResponse(session)
      })
    },
    verifyConsumed: options.http.verifyConsumed,
  }
}
