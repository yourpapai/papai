// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getActivatedPluginIds } from '../../../src/plugins/loader.js'
import { executeScenario } from './scenario.js'
import type { ScenarioWorld } from './world.js'
import { createScenarioWorld } from './world.js'

const requireAggregateError = (value: unknown): AggregateError => {
  if (value instanceof AggregateError) return value
  throw new Error('Expected aggregate scenario failure')
}

describe('scenario execution', () => {
  test('preserves a primary assertion failure while surfacing every teardown failure and attempt', async () => {
    let capturedWorld: ScenarioWorld | undefined
    const createWorld = async (name: string): Promise<ScenarioWorld> => {
      const world = await createScenarioWorld(name)
      capturedWorld = world
      return world
    }

    const failure = await executeScenario(
      'failure cleanup',
      ({ world }): Promise<void> => {
        world.http.expect({ method: 'GET', url: 'https://unused.invalid/' }, () => new Response('unused'))
        expect('actual').toBe('expected')
        return Promise.resolve()
      },
      createWorld,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = requireAggregateError(failure)
    expect(String(aggregate.errors[0])).toContain('expected')
    expect(String(aggregate.errors[1])).toContain('unconsumed HTTP expectations')
    expect(capturedWorld).toBeDefined()
    const cleanupKinds = capturedWorld?.events
      .all()
      .filter(({ kind }) => kind.startsWith('world.cleanup.'))
      .map(({ kind }) => kind)
    expect(cleanupKinds).toEqual([
      'world.cleanup.runtime.stop',
      'world.cleanup.plugins.deactivate',
      'world.cleanup.provider.unregister',
      'world.cleanup.database.reset',
      'world.cleanup.http.verify',
      'world.cleanup.model.verify',
    ])
    expect(capturedWorld?.events.all().some(({ kind }) => kind === 'chat.start')).toBe(false)
    expect(getActivatedPluginIds()).toEqual([])
  })

  test('decorates DSL assertion failures with the sanitized event trace', async () => {
    const world = await createScenarioWorld('trace')

    try {
      const alice = world.api.given.user('alice')
      expect(() => world.api.then.replyTo(alice).equals('missing')).toThrow('recent events:')
    } finally {
      await world.stop()
    }
  })
})
