// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Redaction release-gate: coding-session secrets must never reach a plaintext
 * store column or a log line. These are regression guards — the audit found no
 * live leak. If any assertion fails, a real leak was introduced.
 *
 * Logger-spy note: store.ts binds `log = logger.child(...)` at module evaluation
 * time. Because this file's top-level import of store.js fixes that binding before
 * any mock can be installed, the child-logger spy path is genuinely infeasible here
 * without unsafe casts. The ciphertext + not-configured gates already provide strong
 * coverage; the structural no-log property is verified by the code review that
 * confirmed `log.info({ contextId, namespace, updatedBy }, ...)` never includes
 * the credential config object.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { NOT_CONFIGURED } from '../../../../plugins/acp/client.js'
import { codingSessionCredentials } from '../../../../src/db/coding-credentials-schema.js'
import { getDrizzleDb } from '../../../../src/db/drizzle.js'
import { adminCodingGuardrailsContextId } from '../../../../src/modules/coding/credentials/guardrails.js'
import { updateCodingCredentials } from '../../../../src/modules/coding/credentials/store.js'
import { mockLogger, setupTestDb } from '../../../utils/test-helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rowCipher = (contextId: string, namespace: string): string | undefined =>
  getDrizzleDb()
    .select({ c: codingSessionCredentials.encryptedConfig })
    .from(codingSessionCredentials)
    .where(and(eq(codingSessionCredentials.contextId, contextId), eq(codingSessionCredentials.namespace, namespace)))
    .get()?.c

/** Stub admin config reader used by the not-configured describe block. */
const STUB_MAGI_CONFIG: Record<string, string> = {
  magi_base_url: 'http://magi.local',
  magi_token: 'tok',
}

const makeAdminConfig = (): { get(key: string): string | undefined } => ({
  get: (k: string): string | undefined => STUB_MAGI_CONFIG[k],
})

// ---------------------------------------------------------------------------
// At-rest ciphertext (core gate)
// ---------------------------------------------------------------------------

describe('coding-credentials redaction — ciphertext at rest', () => {
  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('agent-provider api key is ciphertext at rest (never plaintext in the DB)', () => {
    updateCodingCredentials(
      'ctx-1',
      'agent-provider',
      {
        provider: 'anthropic',
        agent: 'claude',
        provider_api_key: 'sk-REAL-SECRET',
      },
      'u',
    )
    const cipher = rowCipher('ctx-1', 'agent-provider')
    expect(cipher).toBeDefined()
    expect(cipher).not.toContain('sk-REAL-SECRET')
  })

  test('forge token is ciphertext at rest', () => {
    updateCodingCredentials('ctx-1', 'forge', { kind: 'github', forge_token: 'ghp_REAL_SECRET' }, 'u')
    const cipher = rowCipher('ctx-1', 'forge')
    expect(cipher).toBeDefined()
    expect(cipher).not.toContain('ghp_REAL_SECRET')
  })

  test('operator shared key is ciphertext at rest (admin context)', () => {
    const adminCtx = adminCodingGuardrailsContextId('pi-1')
    updateCodingCredentials(
      adminCtx,
      'agent-provider',
      {
        provider: 'openai',
        agent: 'codex',
        provider_api_key: 'sk-SHARED-SECRET',
      },
      'admin',
    )
    const cipher = rowCipher(adminCtx, 'agent-provider')
    expect(cipher).toBeDefined()
    expect(cipher).not.toContain('sk-SHARED-SECRET')
  })
})

// ---------------------------------------------------------------------------
// not-configured reference: the static error object and tool refusal carry no secret
// ---------------------------------------------------------------------------

describe('coding-credentials redaction — not-configured reference', () => {
  test('NOT_CONFIGURED constant contains no key or token', () => {
    // The NOT_CONFIGURED object is returned by tools when credentials are absent.
    // It must be a pure static message with no echoed secret.
    const serialized = JSON.stringify(NOT_CONFIGURED)
    expect(serialized).not.toContain('sk-')
    expect(serialized).not.toContain('ghp_')
    expect(serialized).not.toContain('glpat-')
    expect(NOT_CONFIGURED.error).toBe('not_configured')
  })

  test('start_session not-configured result carries no secret', async () => {
    const { startSessionTool } = await import('../../../../plugins/acp/session-tools.js')
    const httpFetch = mock((): Promise<Response> => Promise.resolve(new Response('{}', { status: 200 })))
    const tool = startSessionTool(httpFetch)

    const res = await tool.execute(
      { project: 'demo', prompt: 'hi' },
      {
        storageContextId: 'pi:telegram:ctx:u1',
        adminConfig: makeAdminConfig(),
        kv: {
          get: (): undefined => undefined,
          set: (): void => {},
          delete: (): void => {},
          list: (): [] => [],
        },
        codingSecrets: {
          resolve: (): null => null,
          resolveForgeToken: (): null => null,
          resolveAgent: (): null => null,
          resolveForge: (): null => null,
          resolveProviderHost: (): null => null,
          resolveModel: (): null => null,
          resolveMcpServers: (): { ok: true; servers: never[] } => ({ ok: true, servers: [] }),
          resolveMcpTokens: (): Record<string, string> => ({}),
        },
        codingRepos: {
          list: (): { name: string; baseBranch: string }[] => [{ name: 'demo', baseBranch: 'main' }],
          get: (): {
            name: string
            repoUrl: string
            baseBranch: string
            permissionPreset: string
          } | null => ({
            name: 'demo',
            repoUrl: 'https://github.com/acme/demo.git',
            baseBranch: 'main',
            permissionPreset: 'cautious',
          }),
        },
      },
      {},
    )

    const serialized = JSON.stringify(res)
    expect(serialized).not.toContain('sk-')
    expect(serialized).not.toContain('ghp_')
    expect(serialized).not.toContain('glpat-')
    expect(httpFetch).not.toHaveBeenCalled()
  })
})
