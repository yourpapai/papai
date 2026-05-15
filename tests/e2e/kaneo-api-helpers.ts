import { z } from 'zod'

import { getE2EConfigSync } from './global-setup.js'

const SessionSchema = z.object({
  user: z.object({
    id: z.string(),
  }),
})

const WorkspaceMembersSchema = z.array(
  z.object({
    id: z.string(),
  }),
)

function buildApiUrl(path: string): string {
  const { baseUrl } = getE2EConfigSync()
  return `${baseUrl}/api${path}`
}

function buildHeaders(init?: RequestInit): Headers {
  const { apiKey } = getE2EConfigSync()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  if (!headers.has('Content-Type') && init?.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

export async function kaneoApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: buildHeaders(init),
  })

  if (!response.ok) {
    throw new Error(`Kaneo API request failed: ${response.status} ${response.statusText} for ${path}`)
  }

  return response
}

export async function kaneoApiJson(path: string, init?: RequestInit): Promise<unknown> {
  return kaneoApiFetch(path, init).then((response) => response.json() as Promise<unknown>)
}

async function getCurrentKaneoSession(): Promise<unknown | null> {
  try {
    return await kaneoApiJson('/auth/get-session')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('/auth/get-session')) {
      return null
    }

    throw error
  }
}

export async function getCurrentKaneoUserId(): Promise<string> {
  const session = await getCurrentKaneoSession()
  if (session !== null) {
    return SessionSchema.parse(session).user.id
  }

  const { workspaceId } = getE2EConfigSync()
  const members = WorkspaceMembersSchema.parse(await kaneoApiJson(`/workspace/${workspaceId}/members`))
  if (members.length !== 1) {
    throw new Error(
      `Expected exactly one workspace member for ${workspaceId} when session lookup is unavailable, got ${members.length}`,
    )
  }

  return members[0].id
}
