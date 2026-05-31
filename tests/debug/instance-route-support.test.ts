// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { ChatRouter } from '../../src/chat/router.js'
import type { ManagedChatInstanceSnapshot } from '../../src/chat/router.js'
import { applyPlatformInstances, platformInstanceSchema } from '../../src/debug/instance-route-support.js'
import type { InstanceApiDeps } from '../../src/debug/instance-route-support.js'
import type { InstanceDecodeResult, PlatformInstance } from '../../src/instances/types.js'

describe('platformInstanceSchema', () => {
  test('accepts kontur-talk type', () => {
    const result = platformInstanceSchema.safeParse({
      id: 'kontur-talk-default',
      type: 'kontur-talk',
      config: { jwtToken: 'test-token' },
    })
    expect(result.success).toBe(true)
  })

  test('accepts telegram type', () => {
    const result = platformInstanceSchema.safeParse({
      id: 'telegram-default',
      type: 'telegram',
      config: { token: 'test-token' },
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = platformInstanceSchema.safeParse({
      id: 'test-default',
      type: 'unknown',
      config: {},
    })
    expect(result.success).toBe(false)
  })
})

const applyBodySchema = z.object({
  removed: z.array(z.string()),
  unreadable: z.array(z.object({ id: z.string() })),
})

class FakeRouter extends ChatRouter {
  readonly removedIds: string[] = []
  private readonly snapshots: ManagedChatInstanceSnapshot[]

  constructor(snapshots: ManagedChatInstanceSnapshot[]) {
    super(() => {
      throw new Error('factory should not be called in FakeRouter')
    })
    this.snapshots = snapshots
  }

  override listInstances(): readonly ManagedChatInstanceSnapshot[] {
    return this.snapshots
  }

  override removeInstanceStrict(id: string): Promise<void> {
    this.removedIds.push(id)
    return Promise.resolve()
  }
}

const makeDeps = (router: FakeRouter, safeResult: InstanceDecodeResult<PlatformInstance>): InstanceApiDeps => ({
  getRuntimeChatRouter: (): ChatRouter => router,
  listPlatformInstances: (): PlatformInstance[] => [],
  listPlatformInstancesSafe: (): InstanceDecodeResult<PlatformInstance> => safeResult,
})

describe('applyPlatformInstances — unreadable instance guard', () => {
  test('does not remove a running instance whose DB row failed to decode', async () => {
    const snapshot: ManagedChatInstanceSnapshot = {
      id: 'inst-1',
      type: 'telegram',
      status: 'active',
      configFingerprint: 'fp-1',
    }
    const router = new FakeRouter([snapshot])

    const safeResult: InstanceDecodeResult<PlatformInstance> = {
      instances: [],
      failures: [{ table: 'platform_instances', id: 'inst-1', type: 'telegram', error: 'decrypt failed' }],
    }

    const response = await applyPlatformInstances(makeDeps(router, safeResult))
    const body = applyBodySchema.parse(await response.json())

    expect(router.removedIds).not.toContain('inst-1')
    expect(body.removed).not.toContain('inst-1')
    expect(body.unreadable.map((f) => f.id)).toContain('inst-1')
  })

  test('still removes a running instance that is genuinely absent from the DB (not a decode failure)', async () => {
    const snapshot: ManagedChatInstanceSnapshot = {
      id: 'inst-gone',
      type: 'telegram',
      status: 'active',
      configFingerprint: 'fp-gone',
    }
    const router = new FakeRouter([snapshot])

    const safeResult: InstanceDecodeResult<PlatformInstance> = {
      instances: [],
      failures: [],
    }

    const response = await applyPlatformInstances(makeDeps(router, safeResult))
    const body = applyBodySchema.parse(await response.json())

    expect(router.removedIds).toContain('inst-gone')
    expect(body.removed).toContain('inst-gone')
    expect(body.unreadable).toHaveLength(0)
  })
})
