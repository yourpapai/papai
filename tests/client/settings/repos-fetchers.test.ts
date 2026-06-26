// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { addRepo, deleteRepo, fetchRepos } from '../../../client/settings/repos-fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

type CapturedFetchCall = Readonly<{ url: string; init: RequestInit }>

const captured: CapturedFetchCall[] = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const installFetch = (payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init: init ?? {} })
    return Promise.resolve(json(payload))
  })
}

const lastRequest = (): CapturedFetchCall => {
  const last = captured[captured.length - 1]
  if (last === undefined) throw new Error('No requests captured')
  return last
}

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

const reposPayload = {
  repos: [
    {
      repoId: 'r1',
      name: 'demo',
      repoUrl: 'https://github.com/acme/demo.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
  ],
}

describe('repos fetchers', () => {
  test('fetchRepos GETs /settings/api/coding-repos with contextId and parses', async () => {
    installFetch(reposPayload)
    const res = await fetchRepos('pi:telegram:ctx:u1')
    expect(captured[0]?.url).toContain('/settings/api/coding-repos?contextId=pi%3Atelegram%3Actx%3Au1')
    expect(methodOf(captured[0]!.init)).toBe('GET')
    expect(res.repos).toHaveLength(1)
    expect(res.repos[0]?.name).toBe('demo')
    expect(res.repos[0]?.repoUrl).toBe('https://github.com/acme/demo.git')
    expect(res.repos[0]?.permissionPreset).toBe('cautious')
  })

  test('addRepo POSTs to /settings/api/coding-repos with the full payload', async () => {
    setCsrfToken('csrf-t')
    installFetch({ ok: true, repoId: 'r2', contextId: 'pi:telegram:ctx:u1' })
    await addRepo({
      contextId: 'pi:telegram:ctx:u1',
      name: 'my-repo',
      repoUrl: 'https://github.com/acme/my-repo.git',
      baseBranch: 'dev',
      permissionPreset: 'autonomous',
    })
    expect(methodOf(lastRequest().init)).toBe('POST')
    expect(lastRequest().url).toBe('/settings/api/coding-repos')
    expect(parseBody(lastRequest().init.body)).toEqual({
      contextId: 'pi:telegram:ctx:u1',
      name: 'my-repo',
      repoUrl: 'https://github.com/acme/my-repo.git',
      baseBranch: 'dev',
      permissionPreset: 'autonomous',
    })
  })

  test('deleteRepo sends DELETE with repoId and contextId in query string', async () => {
    setCsrfToken('csrf-t')
    installFetch({ ok: true, contextId: 'pi:telegram:ctx:u1' })
    await deleteRepo({ contextId: 'pi:telegram:ctx:u1', repoId: 'r1' })
    expect(methodOf(lastRequest().init)).toBe('DELETE')
    expect(lastRequest().url).toContain('/settings/api/coding-repos?')
    expect(lastRequest().url).toContain('repoId=r1')
    expect(lastRequest().url).toContain('contextId=pi%3Atelegram%3Actx%3Au1')
  })

  test('addRepo attaches the CSRF header on POST', async () => {
    setCsrfToken('csrf-xyz')
    installFetch({ ok: true, repoId: 'r3', contextId: 'pi:telegram:ctx:u1' })
    await addRepo({
      contextId: 'pi:telegram:ctx:u1',
      name: 'x',
      repoUrl: 'https://github.com/acme/x.git',
      baseBranch: 'main',
      permissionPreset: 'readonly',
    })
    const csrfHeader = new Headers(lastRequest().init.headers).get('X-Settings-CSRF')
    expect(csrfHeader).toBe('csrf-xyz')
  })

  test('deleteRepo attaches the CSRF header on DELETE', async () => {
    setCsrfToken('csrf-del')
    installFetch({ ok: true, contextId: 'pi:telegram:ctx:u1' })
    await deleteRepo({ contextId: 'pi:telegram:ctx:u1', repoId: 'r1' })
    const csrfHeader = new Headers(lastRequest().init.headers).get('X-Settings-CSRF')
    expect(csrfHeader).toBe('csrf-del')
  })
})
