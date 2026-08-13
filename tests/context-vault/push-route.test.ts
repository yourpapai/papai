// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { handleContextVaultPush } from '../../src/context-vault/push-route.js'
import { createToken, revokeToken } from '../../src/context-vault/token-store.js'
import { contextVaultSpecs } from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX_A = 'pi:telegram:grp:a'
const CTX_B = 'pi:telegram:grp:b'

const PushResponseSchema = z.object({
  ok: z.literal(true),
  specId: z.string(),
  changedPaths: z.array(z.string()),
  deletedPaths: z.array(z.string()),
})

const ErrorResponseSchema = z.object({ error: z.string() })

// The real summarization queue holds a 15s debounce timer; injecting a no-op keeps
// route tests from leaking it past their own teardown.
const handlePush = (req: Request): Promise<Response> =>
  handleContextVaultPush(req, { enqueueSummarization: () => undefined })

interface PushBody {
  repo: string
  changeName: string
  files: Array<Record<string, unknown>>
  deletions: string[]
}

const validBody = (): PushBody => ({
  repo: 'papai',
  changeName: 'context-vault-plugin',
  files: [
    {
      path: 'openspec/changes/context-vault-plugin/proposal.md',
      kind: 'proposal',
      hash: 'h1',
      mtime: 1710000000000,
      text: '# Proposal\n\nbody',
    },
  ],
  deletions: [],
})

const push = (token: string | null, body: unknown, headers: Record<string, string> = {}): Request => {
  const allHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...headers }
  if (token !== null) allHeaders['Authorization'] = `Bearer ${token}`
  return new Request('https://x/api/context-vault/push', {
    method: 'POST',
    headers: allHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const specExists = (ctx: string, id: string): boolean =>
  getDrizzleDb()
    .select({ id: contextVaultSpecs.id })
    .from(contextVaultSpecs)
    .where(eq(contextVaultSpecs.configContextId, ctx))
    .all()
    .some((row) => row.id === id)

describe('context-vault push route', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('missing Authorization header returns 401', async () => {
    const res = await handlePush(push(null, validBody()))
    expect(res.status).toBe(401)
    ErrorResponseSchema.parse(await res.json())
  })

  test('unknown token returns the same uniform 401', async () => {
    const res = await handlePush(push('f'.repeat(64), validBody()))
    expect(res.status).toBe(401)
    ErrorResponseSchema.parse(await res.json())
  })

  test('revoked token returns the same uniform 401', async () => {
    const created = createToken(CTX_A, 'indexer')
    revokeToken(CTX_A, created.tokenId)
    const res = await handlePush(push(created.plaintext, validBody()))
    expect(res.status).toBe(401)
    ErrorResponseSchema.parse(await res.json())
  })

  test('malformed Authorization scheme returns 401', async () => {
    const created = createToken(CTX_A, 'indexer')
    const res = await handlePush(push(null, validBody(), { Authorization: `Token ${created.plaintext}` }))
    expect(res.status).toBe(401)
  })

  test('invalid JSON body returns 400', async () => {
    const created = createToken(CTX_A, 'indexer')
    const res = await handlePush(push(created.plaintext, '{not json'))
    expect(res.status).toBe(400)
    ErrorResponseSchema.parse(await res.json())
  })

  test('schema violations return 422', async () => {
    const created = createToken(CTX_A, 'indexer')

    const missingRepo = await handlePush(push(created.plaintext, { changeName: 'x', files: [], deletions: [] }))
    expect(missingRepo.status).toBe(422)

    const extraField = await handlePush(push(created.plaintext, { ...validBody(), evil: true }))
    expect(extraField.status).toBe(422)

    const badFile = await handlePush(
      push(created.plaintext, { repo: 'r', changeName: 'c', files: [{ path: 'a.md' }], deletions: [] }),
    )
    expect(badFile.status).toBe(422)
  })

  test('oversized body returns 413', async () => {
    const created = createToken(CTX_A, 'indexer')
    const huge = {
      repo: 'papai',
      changeName: 'context-vault-plugin',
      files: [
        {
          path: 'a/big.md',
          kind: 'proposal',
          hash: 'h1',
          mtime: 1710000000000,
          text: 'x'.repeat(2 * 1024 * 1024),
        },
      ],
      deletions: [],
    }
    const res = await handlePush(push(created.plaintext, huge))
    expect(res.status).toBe(413)
    ErrorResponseSchema.parse(await res.json())
  })

  test('valid push stores rows under the token config context', async () => {
    const created = createToken(CTX_A, 'indexer')
    const res = await handlePush(push(created.plaintext, validBody()))
    expect(res.status).toBe(200)
    const body = PushResponseSchema.parse(await res.json())
    expect(body.specId).toBe('papai:context-vault-plugin')
    expect(body.changedPaths).toEqual(['openspec/changes/context-vault-plugin/proposal.md'])
    expect(specExists(CTX_A, 'papai:context-vault-plugin')).toBe(true)
  })

  test('re-push with identical content is idempotent', async () => {
    const created = createToken(CTX_A, 'indexer')
    await handlePush(push(created.plaintext, validBody()))
    const second = await handlePush(push(created.plaintext, validBody()))
    expect(second.status).toBe(200)
    const body = PushResponseSchema.parse(await second.json())
    expect(body.changedPaths).toEqual([])
    expect(body.deletedPaths).toEqual([])
  })

  test('a token only writes to its own config context', async () => {
    const tokenA = createToken(CTX_A, 'indexer-a')
    createToken(CTX_B, 'indexer-b')

    const res = await handlePush(push(tokenA.plaintext, validBody()))
    expect(res.status).toBe(200)
    expect(specExists(CTX_A, 'papai:context-vault-plugin')).toBe(true)
    expect(specExists(CTX_B, 'papai:context-vault-plugin')).toBe(false)
  })

  test('non-POST method returns 405', async () => {
    const created = createToken(CTX_A, 'indexer')
    const res = await handlePush(
      new Request('https://x/api/context-vault/push', {
        method: 'GET',
        headers: { Authorization: `Bearer ${created.plaintext}` },
      }),
    )
    expect(res.status).toBe(405)
  })
})
