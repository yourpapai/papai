// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  createSinkVersion,
  disableSinkVersion,
  getSinkVersion,
  listSinkVersions,
  rotateSinkVersion,
  verifySinkVersion,
} from '../../../src/analytics/delivery/sink-service.js'
import type {
  RotateSinkVersionResult,
  SinkProbe,
  SinkPublicView,
  SinkServiceDeps,
} from '../../../src/analytics/delivery/sink-service.js'
import type { SinkCapabilities } from '../../../src/analytics/delivery/sink.js'
import { analyticsSinks } from '../../../src/db/schema.js'
import type { AnalyticsSinkRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const requireDefined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

const requireRotatedView = (result: RotateSinkVersionResult): SinkPublicView => {
  if (result.status !== 'rotated') throw new Error('expected rotation to succeed')
  return result.view
}

const NOW = 1_700_000_000_000
const ENDPOINT = 'https://sink.example.com/ingest'
const SECRET = 'top-secret-token'

const FULL_CAPABILITIES: SinkCapabilities = {
  callerControlledIdempotency: true,
  deterministicReconciliation: true,
  deleteActor: true,
}

const REVIEWED_PROCESSOR = {
  subprocessorReviewed: true,
  residencyReviewed: true,
  deletionPathReviewed: true,
  incidentReviewed: true,
  transferReviewed: true,
  noSecondaryUse: true,
}

const okProbe: SinkProbe = () => Promise.resolve({ ok: true })

const failingProbe: SinkProbe = () => Promise.resolve({ ok: false, failureClass: 'network' })

const getRow = (db: Db, sinkVersionId: string): AnalyticsSinkRow | undefined =>
  db.select().from(analyticsSinks).where(eq(analyticsSinks.sinkVersionId, sinkVersionId)).get()

describe('analytics sink lifecycle', () => {
  let db: Db
  let deps: SinkServiceDeps
  const originalKey = process.env['INSTANCE_CONFIG_KEY']

  beforeEach(async () => {
    process.env['INSTANCE_CONFIG_KEY'] = '9'.repeat(64)
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db, probe: okProbe }
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalKey
  })

  const create = (overrides: Partial<Parameters<typeof createSinkVersion>[0]> = {}): SinkPublicView =>
    createSinkVersion(
      {
        logicalSinkId: 'sink-a',
        kind: 'webhook',
        egressMode: 'pseudonymous',
        endpoint: ENDPOINT,
        secret: SECRET,
        nowMs: NOW,
        ...overrides,
      },
      deps,
    )

  test('admin create stores only ciphertext and returns a redacted public view', () => {
    const view = create()
    expect(view).toMatchObject({
      sinkVersionId: 'sink-a:v1',
      logicalSinkId: 'sink-a',
      version: 1,
      kind: 'webhook',
      egressMode: 'pseudonymous',
      state: 'pending_verification',
      payloadSchemaVersion: 1,
      verifiedAtMs: null,
      createdAtMs: NOW,
      disabledAtMs: null,
    })
    expect(view.configFingerprint).toMatch(/^[0-9a-f]{64}$/u)

    const row = requireDefined(getRow(db, view.sinkVersionId))
    expect(row.endpointCiphertext).not.toContain(ENDPOINT)
    expect(row.secretCiphertext).not.toContain(SECRET)
    expect(JSON.stringify(view)).not.toContain(ENDPOINT)
    expect(JSON.stringify(view)).not.toContain(SECRET)
    expect(JSON.stringify(view)).not.toContain(row.endpointCiphertext)
    expect(JSON.stringify(view)).not.toContain(row.secretCiphertext)
  })

  test('create requires a fixed HTTPS endpoint', () => {
    expect(() => create({ endpoint: 'http://sink.example.com/ingest' })).toThrow()
  })

  test('verification failure keeps the version pending', async () => {
    const view = create()
    const result = await verifySinkVersion(
      {
        sinkVersionId: view.sinkVersionId,
        capabilities: FULL_CAPABILITIES,
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 10,
      },
      { ...deps, probe: failingProbe },
    )
    expect(result).toEqual({ status: 'verification_failed', failureClass: 'network' })
    expect(getRow(db, view.sinkVersionId)).toMatchObject({ state: 'pending_verification', verifiedAtMs: null })
  })

  test('verification success enables the version and stamps verification time', async () => {
    const view = create()
    const result = await verifySinkVersion(
      {
        sinkVersionId: view.sinkVersionId,
        capabilities: FULL_CAPABILITIES,
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 10,
      },
      deps,
    )
    expect(result.status).toBe('enabled')
    expect(getRow(db, view.sinkVersionId)).toMatchObject({ state: 'enabled', verifiedAtMs: NOW + 10 })
  })

  test('verification applies the capability gate before enabling', async () => {
    const view = create()
    const result = await verifySinkVersion(
      {
        sinkVersionId: view.sinkVersionId,
        capabilities: { ...FULL_CAPABILITIES, deleteActor: false },
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 10,
      },
      deps,
    )
    expect(result).toEqual({ status: 'gate_denied', reason: 'missing_delete_actor' })
    expect(getRow(db, view.sinkVersionId)?.state).toBe('pending_verification')
  })

  test('verifying a non-pending version is rejected', async () => {
    const view = create()
    await verifySinkVersion(
      {
        sinkVersionId: view.sinkVersionId,
        capabilities: FULL_CAPABILITIES,
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 10,
      },
      deps,
    )
    const again = await verifySinkVersion(
      {
        sinkVersionId: view.sinkVersionId,
        capabilities: FULL_CAPABILITIES,
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 20,
      },
      deps,
    )
    expect(again).toEqual({ status: 'not_pending' })
  })

  const enableFirstVersion = async (): Promise<string> => {
    const view = create()
    await verifySinkVersion(
      {
        sinkVersionId: view.sinkVersionId,
        capabilities: FULL_CAPABILITIES,
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 10,
      },
      deps,
    )
    return view.sinkVersionId
  }

  const rotate = (probe: SinkProbe): Promise<RotateSinkVersionResult> =>
    rotateSinkVersion(
      {
        logicalSinkId: 'sink-a',
        kind: 'webhook',
        egressMode: 'pseudonymous',
        endpoint: 'https://sink.example.com/ingest-v2',
        secret: 'rotated-secret',
        capabilities: FULL_CAPABILITIES,
        processorReview: REVIEWED_PROCESSOR,
        httpsPolicyApproved: true,
        nowMs: NOW + 100,
      },
      { ...deps, probe },
    )

  test('failed rotation leaves the predecessor enabled', async () => {
    const predecessorId = await enableFirstVersion()
    const result = await rotate(failingProbe)
    expect(result.status).toBe('verification_failed')
    expect(getRow(db, predecessorId)).toMatchObject({ state: 'enabled', disabledAtMs: null })
    const successor = getRow(db, 'sink-a:v2')
    expect(successor).toMatchObject({ state: 'pending_verification', verifiedAtMs: null })
  })

  test('verified rotation atomically enables the successor and soft-disables the predecessor', async () => {
    const predecessorId = await enableFirstVersion()
    const result = await rotate(okProbe)
    expect(result.status).toBe('rotated')
    const rotatedView = requireRotatedView(result)
    expect(rotatedView).toMatchObject({
      sinkVersionId: 'sink-a:v2',
      logicalSinkId: 'sink-a',
      version: 2,
      state: 'enabled',
      verifiedAtMs: NOW + 100,
    })
    expect(getRow(db, predecessorId)).toMatchObject({ state: 'disabled', disabledAtMs: NOW + 100 })
    expect(getRow(db, 'sink-a:v2')?.state).toBe('enabled')
  })

  test('disable retires an enabled version and keeps its ledger evidence', async () => {
    const sinkVersionId = await enableFirstVersion()
    expect(disableSinkVersion({ sinkVersionId, nowMs: NOW + 200 }, deps)).toBe('disabled')
    expect(getRow(db, sinkVersionId)).toMatchObject({ state: 'disabled', disabledAtMs: NOW + 200 })
    expect(disableSinkVersion({ sinkVersionId, nowMs: NOW + 300 }, deps)).toBe('not_enabled')
    expect(disableSinkVersion({ sinkVersionId: 'missing', nowMs: NOW + 300 }, deps)).toBe('not_found')
  })

  test('read and list responses never contain endpoint, secret, or ciphertext material', () => {
    const view = create()
    const read = getSinkVersion(view.sinkVersionId, deps)
    const listed = listSinkVersions(deps)
    expect(read).toEqual(view)
    expect(listed).toEqual([view])

    const row = requireDefined(getRow(db, view.sinkVersionId))
    for (const payload of [read, listed]) {
      const json = JSON.stringify(payload)
      expect(json).not.toContain(ENDPOINT)
      expect(json).not.toContain(SECRET)
      expect(json).not.toContain(row.endpointCiphertext)
      expect(json).not.toContain(row.secretCiphertext)
      expect(json).not.toContain('Ciphertext')
    }
    expect(getSinkVersion('missing', deps)).toBeNull()
  })
})
