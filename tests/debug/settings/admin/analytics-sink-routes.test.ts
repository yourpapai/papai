// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import {
  CreateSinkBodySchema,
  GateAttestationSchema,
  RotateSinkBodySchema,
  handleCreateSink,
} from '../../../../src/debug/settings/admin/analytics-sink-routes.js'
import type { AdminAnalyticsRouteDeps } from '../../../../src/debug/settings/admin/analytics-view.js'
import { authenticate } from '../../../../src/debug/settings/respond.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import type { AuthenticatedSettingsRequest } from '../../../../src/settings/request-auth.js'
import { addUser } from '../../../../src/users.js'
import { KEYRING } from '../../../analytics/subject-fixtures.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const CreatedSchema = z.object({ status: z.literal('created'), sink: z.object({ sinkVersionId: z.string() }) })

describe('admin analytics sink route schemas', () => {
  test('gate attestation rejects unknown keys and missing review fields', () => {
    const valid = {
      capabilities: { callerControlledIdempotency: true, deterministicReconciliation: true, deleteActor: true },
      processorReview: {
        subprocessorReviewed: true,
        residencyReviewed: true,
        deletionPathReviewed: true,
        incidentReviewed: true,
        transferReviewed: true,
        noSecondaryUse: true,
      },
      httpsPolicyApproved: true,
    }
    expect(GateAttestationSchema.safeParse(valid).success).toBe(true)
    expect(GateAttestationSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
    const { noSecondaryUse: _dropped, ...partialReview } = valid.processorReview
    expect(GateAttestationSchema.safeParse({ ...valid, processorReview: partialReview }).success).toBe(false)
  })

  test('create and rotate bodies reject unknown keys and secret-echo fields', () => {
    const create = {
      logicalSinkId: 'ext',
      kind: 'webhook',
      egressMode: 'aggregate',
      endpoint: 'https://sink.example.net/hook',
      secret: 'write-only-secret',
    }
    expect(CreateSinkBodySchema.safeParse(create).success).toBe(true)
    expect(CreateSinkBodySchema.safeParse({ ...create, secretCiphertext: 'ct' }).success).toBe(false)
    expect(CreateSinkBodySchema.safeParse({ ...create, logicalSinkId: 'BAD ID' }).success).toBe(false)
    expect(RotateSinkBodySchema.safeParse({ ...create, logicalSinkId: 'ext' }).success).toBe(false)
  })
})

describe('admin analytics create sink handler', () => {
  let session: SettingsSession
  let deps: AdminAnalyticsRouteDeps

  beforeEach(async () => {
    mockLogger()
    const db = await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addAdmin('admin-1', 'pi-1')
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    deps = {
      getDrizzleDb: (): typeof db => db,
      analyticsKeyring: KEYRING.analytics,
      governanceKeyring: KEYRING.governance,
      probe: (): Promise<Readonly<{ ok: boolean }>> => Promise.resolve({ ok: true }),
    }
  })

  const authedOf = (req: Request): AuthenticatedSettingsRequest => {
    const auth = authenticate(req)
    if (!auth.ok) throw new Error('expected an authenticated request')
    return auth.authed
  }

  const createRequest = (withCsrf: boolean): Request =>
    new Request('https://x/settings/api/admin/analytics/sinks', {
      method: 'POST',
      headers: authHeaders(session, withCsrf),
      body: JSON.stringify({
        logicalSinkId: 'ext',
        kind: 'webhook',
        egressMode: 'aggregate',
        endpoint: 'https://sink.example.net/hook',
        secret: 'write-only-secret',
      }),
    })

  test('create requires CSRF and returns only the public view', async () => {
    const noCsrfReq = createRequest(false)
    const noCsrf = await handleCreateSink(noCsrfReq, authedOf(noCsrfReq), deps)
    expect(noCsrf.status).toBe(403)

    const createdReq = createRequest(true)
    const created = await handleCreateSink(createdReq, authedOf(createdReq), deps)
    expect(created.status).toBe(201)
    const body = CreatedSchema.parse(await created.json())
    expect(body.sink.sinkVersionId).toBe('ext:v1')
    expect(JSON.stringify(body)).not.toContain('write-only-secret')
  })
})
