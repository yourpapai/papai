import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { _userCaches, getCachedTools, setCachedTools } from '../../../src/cache.js'
import { isKaneoSessionCookie } from '../../../src/providers/kaneo/client.js'
import {
  maybeProvisionKaneo,
  provisionAndConfigure,
  provisionKaneoUser,
} from '../../../src/providers/kaneo/provision.js'
import { createProvider } from '../../../src/providers/registry.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../../utils/test-helpers.js'

function parseBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return JSON.parse(body) as unknown
  }
  return {}
}

function extractEmail(init: RequestInit | undefined): string | undefined {
  const body = init === undefined ? {} : parseBody(init.body)
  if (typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string') {
    return body.email
  }
  return undefined
}

function extractSlug(init: RequestInit | undefined): string | undefined {
  const body = init === undefined ? {} : parseBody(init.body)
  if (typeof body === 'object' && body !== null && 'slug' in body && typeof body.slug === 'string') {
    return body.slug
  }
  return undefined
}

function routeProvisionFetch(
  url: string,
  init: RequestInit | undefined,
  capturedEmails: string[],
  capturedSlugs: string[],
): Promise<Response> {
  if (url.includes('/sign-up')) {
    const email = extractEmail(init)
    if (email !== undefined) {
      capturedEmails.push(email)
    }
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
        status: 200,
        headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
      }),
    )
  }
  if (url.includes('/organization/create')) {
    const slug = extractSlug(init) ?? 'test-slug'
    capturedSlugs.push(slug)
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeProvisionFetchCaptureEmailOnly(
  url: string,
  init: RequestInit | undefined,
  onEmail: (email: string) => void,
): Promise<Response> {
  if (url.includes('/sign-up')) {
    const email = extractEmail(init)
    if (email !== undefined) {
      onEmail(email)
    }
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
        status: 200,
        headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
      }),
    )
  }
  if (url.includes('/organization/create')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug: 'test-ws' }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeSuccessfulProvision(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
        status: 200,
        headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
      }),
    )
  }
  if (url.includes('/organization/create')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-abc', slug: 'papai-999' }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response(JSON.stringify({ key: 'test-api-key' }), { status: 200 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeSecureCookieProvision(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'json-token-123' }), {
        status: 200,
        headers: { 'Set-Cookie': '__Secure-better-auth.session_token=secure-cookie-123; Path=/; HttpOnly; Secure' },
      }),
    )
  }
  if (url.includes('/organization/create')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-secure', slug: 'papai-secure' }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response('missing endpoint', { status: 404 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeJsonTokenProvision(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'json-token-456' }), {
        status: 200,
      }),
    )
  }
  if (url.includes('/organization/create')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-json', slug: 'papai-json' }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response('missing endpoint', { status: 404 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeSplitDeployProvision(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'json-token-split' }), {
        status: 200,
      }),
    )
  }
  if (url.includes('/organization/create')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-split', slug: 'papai-split' }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response('missing endpoint', { status: 404 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeSignUpDisabled(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(
      new Response(JSON.stringify({ code: 'signup_disabled', message: 'Sign up is disabled' }), { status: 403 }),
    )
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeSignUpServerError(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(new Response('database unavailable', { status: 500 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function routeStandardProvision(url: string): Promise<Response> {
  if (url.includes('/sign-up')) {
    return Promise.resolve(
      new Response(JSON.stringify({ user: { id: 'user-123' }, token: 'session-token' }), {
        status: 200,
        headers: { 'Set-Cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly' },
      }),
    )
  }
  if (url.includes('/organization/create')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'ws-123', slug: 'test-ws' }), { status: 200 }))
  }
  if (url.includes('/api-key/create')) {
    return Promise.resolve(new Response(JSON.stringify({ key: 'api-key-123' }), { status: 200 }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
}

function extractCapturedHeaders(_url: string, options: RequestInit | undefined): Record<string, string> {
  const headers = options === undefined ? undefined : options.headers
  if (headers === undefined) {
    return {}
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return { ...headers }
}

describe('provisionKaneoUser - unique email generation', () => {
  beforeEach(() => {
    mockLogger()
    // Set required environment variable
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'
  })

  test('generates unique email with random suffix', async () => {
    const capturedEmails: string[] = []
    const capturedSlugs: string[] = []

    setMockFetch((url: string, init: RequestInit | undefined) =>
      routeProvisionFetch(url, init, capturedEmails, capturedSlugs),
    )

    // Provision user twice with same ID
    await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '999', null)
    await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '999', null)

    // Should have captured two different emails
    expect(capturedEmails).toHaveLength(2)
    expect(capturedEmails[0]).not.toBe(capturedEmails[1])

    // Both should contain the user ID
    expect(capturedEmails[0]).toContain('999')
    expect(capturedEmails[1]).toContain('999')

    // Both should end with @pap.ai
    expect(capturedEmails[0]).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)
    expect(capturedEmails[1]).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)

    // Should have captured two different slugs
    expect(capturedSlugs).toHaveLength(2)
    expect(capturedSlugs[0]).not.toBe(capturedSlugs[1])
  })

  test('generates email with username when provided', async () => {
    let capturedEmail = ''

    setMockFetch((url: string, init: RequestInit | undefined) =>
      routeProvisionFetchCaptureEmailOnly(url, init, (email) => {
        capturedEmail = email
      }),
    )

    await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '123', 'alice')

    expect(capturedEmail).toMatch(/alice-[a-z0-9]{8}@pap\.ai$/i)
  })

  test('successful provisioning returns workspace and credentials', async () => {
    setMockFetch(routeSuccessfulProvision)

    const result = await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', '999', null)

    expect(result.workspaceId).toBe('ws-abc')
    expect(result.kaneoKey).toBe('test-api-key')
    expect(result.email).toMatch(/999-[a-z0-9]{8}@pap\.ai$/i)
  })

  test('preserves __Secure session cookie fallback from Set-Cookie for downstream use', async () => {
    setMockFetch(routeSecureCookieProvision)

    const result = await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', 'secure-user', null)

    expect(result.kaneoKey).toBe('__Secure-better-auth.session_token=secure-cookie-123')
    expect(isKaneoSessionCookie(result.kaneoKey)).toBe(true)

    const provider = createProvider('kaneo', {
      baseUrl: 'https://kaneo.test',
      sessionCookie: result.kaneoKey,
      workspaceId: result.workspaceId,
    })
    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedHeaders = extractCapturedHeaders(_url, options)
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    assert(provider.listProjects !== undefined, 'Expected Kaneo provider to support listProjects')

    await provider.listProjects()

    expect(capturedHeaders['Cookie']).toBe('__Secure-better-auth.session_token=secure-cookie-123')
    expect(capturedHeaders['Authorization']).toBeUndefined()
  })

  test('constructs session cookie from JSON token when Set-Cookie is absent for downstream use', async () => {
    setMockFetch(routeJsonTokenProvision)

    const result = await provisionKaneoUser('https://kaneo.test', 'https://kaneo.test', 'json-user', null)

    expect(result.kaneoKey).toBe('__Secure-better-auth.session_token=json-token-456')
    expect(isKaneoSessionCookie(result.kaneoKey)).toBe(true)

    const provider = createProvider('kaneo', {
      baseUrl: 'https://kaneo.test',
      sessionCookie: result.kaneoKey,
      workspaceId: result.workspaceId,
    })
    let capturedHeaders: Record<string, string> = {}
    setMockFetch((_url, options) => {
      capturedHeaders = extractCapturedHeaders(_url, options)
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    assert(provider.listProjects !== undefined, 'Expected Kaneo provider to support listProjects')

    await provider.listProjects()

    expect(capturedHeaders['Cookie']).toBe('__Secure-better-auth.session_token=json-token-456')
    expect(capturedHeaders['Authorization']).toBeUndefined()
  })

  test('uses public Kaneo URL to choose secure cookie prefix in split deployments without Set-Cookie', async () => {
    setMockFetch(routeSplitDeployProvision)

    const result = await provisionKaneoUser('http://kaneo-internal:1337', 'https://kaneo.test', 'split-user', null)

    expect(result.kaneoKey).toBe('__Secure-better-auth.session_token=json-token-split')
  })

  test('provisionAndConfigure returns registration_disabled for explicit sign-up disabled responses', async () => {
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'

    setMockFetch(routeSignUpDisabled)

    const result = await provisionAndConfigure('user-disabled', 'testuser')

    expect(result).toEqual({ status: 'registration_disabled' })
  })

  test('provisionAndConfigure keeps generic sign-up failures as failed', async () => {
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'

    setMockFetch(routeSignUpServerError)

    const result = await provisionAndConfigure('user-generic-failure', 'testuser')

    expect(result).toEqual({ status: 'failed', error: 'Sign-up failed (500): database unavailable' })
  })

  test('provisionAndConfigure clears all group-scoped tool cache variants after success', async () => {
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'

    setCachedTools('group-1', { scope: 'base' })
    setCachedTools('group-1:user-a', { scope: 'user-a' })
    setCachedTools('group-1:user-b', { scope: 'user-b' })
    setCachedTools('group-2:user-c', { scope: 'other-group' })

    setMockFetch(routeStandardProvision)

    const result = await provisionAndConfigure('group-1', null)

    expect(result.status).toBe('provisioned')
    expect(getCachedTools('group-1')).toBeUndefined()
    expect(getCachedTools('group-1:user-a')).toBeUndefined()
    expect(getCachedTools('group-1:user-b')).toBeUndefined()
    expect(getCachedTools('group-2:user-c')).toEqual({ scope: 'other-group' })
  })
})

describe('maybeProvisionKaneo', () => {
  let textCalls: string[] = []

  const mockReply = {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<void> => Promise.resolve(),
  }

  const originalTaskProvider = process.env['TASK_PROVIDER']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    _userCaches.clear()
    textCalls = []
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.test'
  })

  afterEach(() => {
    restoreFetch()
    if (originalTaskProvider === undefined) {
      delete process.env['TASK_PROVIDER']
    } else {
      process.env['TASK_PROVIDER'] = originalTaskProvider
    }
  })

  test('skips auto-provisioning when TASK_PROVIDER is youtrack', async () => {
    process.env['TASK_PROVIDER'] = 'youtrack'

    await maybeProvisionKaneo(mockReply, 'user-1', 'testuser')

    // Should not send any reply since we skip early
    expect(textCalls).toHaveLength(0)
  })

  test('proceeds with auto-provisioning when TASK_PROVIDER is kaneo', async () => {
    // Ensure fresh user that doesn't have workspace configured
    const uniqueUserId = `kaneo-test-${Date.now()}`
    process.env['TASK_PROVIDER'] = 'kaneo'

    setMockFetch(routeStandardProvision)

    await maybeProvisionKaneo(mockReply, uniqueUserId, 'testuser')

    // Should send welcome message with account details
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Your Kaneo account has been created')
  })

  test('proceeds with auto-provisioning when TASK_PROVIDER is not set (defaults to kaneo)', async () => {
    const uniqueUserId = `kaneo-default-${Date.now()}`
    delete process.env['TASK_PROVIDER']

    setMockFetch(routeStandardProvision)

    await maybeProvisionKaneo(mockReply, uniqueUserId, 'testuser')

    // Should send welcome message with account details
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Your Kaneo account has been created')
  })
})
